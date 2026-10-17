"""
NOME: rotas/conta.py
FUNÇÃO: Dados do usuário logado e da propriedade dele.
ROTAS:  GET  /api/usuario                  dados da conta
        PUT  /api/usuario                  altera nome e telefone
        PUT  /api/usuario/senha            altera a senha
        POST /api/usuario/email            pede a troca de e-mail (confirmação por link)
        GET  /api/usuario/email/confirmar  confirma a troca (link recebido por e-mail)
        POST /api/propriedades             cadastro da propriedade (etapa 2 do cadastro)
        GET  /api/propriedade              dados da propriedade
        PUT  /api/propriedade              altera a propriedade
TELAS:  Cadastro de propriedade e Configurações (abas Minha conta / Minha propriedade).
Controle de acesso: as rotas NÃO recebem id de usuário ou de propriedade. Elas usam o usuário
da sessão (g.usuario), então ninguém consegue ler ou alterar dados de outra pessoa.
"""
import html
import logging

from flask import Blueprint, current_app, g, jsonify, request

import banco
import emails
import validacoes as v
from erros import ErroApi
from seguranca import (conferir_senha, gerar_hash_senha, hash_token, iniciar_sessao,
                       ler_token_cadastro, limite_senha_atual, login_obrigatorio, novo_token)

log = logging.getLogger('aquasmart.conta')
bp = Blueprint('conta', __name__, url_prefix='/api')

COLUNAS_PROPRIEDADE = ('id, usuario_id, nome, localizacao, area_hectares, cultura, metodo_irrigacao, '
                       'limite_umidade, limite_umidade_desliga')
METODOS_IRRIGACAO = ("Bomba d'água", 'Gravidade')        # os dois valores aceitos pelo banco (CHECK)
AREA_MAXIMA_HECTARES = 1_000_000


def _dados_usuario(u):
    return {'id': u['id'], 'nome': u['nome'], 'email': u['email'], 'telefone': u['telefone']}


# ------------------------------------------------------------------ usuário
@bp.get('/usuario')
@login_obrigatorio
def obter_usuario():
    return jsonify(_dados_usuario(g.usuario))


@bp.put('/usuario')
@login_obrigatorio
def atualizar_usuario():
    """Só nome e telefone. O e-mail tem rota própria (exige senha e confirmação)."""
    dados = v.corpo_json()
    nome = v.texto(dados, 'nome', 'nome', maximo=100)
    telefone = v.telefone(dados, obrigatorio=False)
    atualizado = banco.executar(
        'UPDATE usuarios SET nome = %s, telefone = %s WHERE id = %s RETURNING id, nome, email, telefone',
        (nome, telefone, g.usuario['id']), retornar=True)
    return jsonify(_dados_usuario(atualizado))


def _conferir_senha_atual(dados):
    """Confere a senha atual do usuário logado (com limite de tentativas)."""
    informada = v.senha_informada(dados, 'senha_atual', 'senha atual')
    chave = f"usuario-{g.usuario['id']}"
    limite_senha_atual.verificar(chave)
    linha = banco.consultar('SELECT senha_hash FROM usuarios WHERE id = %s', (g.usuario['id'],), um=True)
    if not conferir_senha(linha['senha_hash'], informada):
        limite_senha_atual.registrar(chave)
        # 400 (e não 401): o front-end trata 401 como "sessão vencida" e volta ao login.
        raise ErroApi('A senha atual está incorreta.', 400, 'senha_atual')
    limite_senha_atual.limpar(chave)
    return informada


@bp.put('/usuario/senha')
@login_obrigatorio
def alterar_senha():
    dados = v.corpo_json()
    nova = v.senha_nova(dados, 'nova_senha')
    atual = _conferir_senha_atual(dados)
    if nova == atual:
        raise ErroApi('A nova senha deve ser diferente da atual.', 400, 'nova_senha')
    atualizado = banco.executar(
        'UPDATE usuarios SET senha_hash = %s, senha_alterada_em = LOCALTIMESTAMP WHERE id = %s '
        'RETURNING id, nome, email, senha_alterada_em',
        (gerar_hash_senha(nova), g.usuario['id']), retornar=True)
    # links de recuperação pendentes deixam de valer
    banco.executar('UPDATE tokens_recuperacao_senha SET usado_em = LOCALTIMESTAMP '
                   'WHERE usuario_id = %s AND usado_em IS NULL', (g.usuario['id'],))
    iniciar_sessao(atualizado)         # este navegador continua logado; os demais acessos caem
    return jsonify({'mensagem': 'Senha alterada com sucesso. Os outros acessos à sua conta foram encerrados.'})


@bp.post('/usuario/email')
@login_obrigatorio
def solicitar_troca_email():
    dados = v.corpo_json()
    novo = v.email(dados, 'novo_email')
    _conferir_senha_atual(dados)
    if novo.lower() == g.usuario['email'].lower():
        raise ErroApi('Este já é o e-mail da sua conta.', 400, 'novo_email')
    em_uso = banco.consultar('SELECT 1 AS ok FROM usuarios WHERE LOWER(email) = LOWER(%s)', (novo,), um=True)
    if em_uso:
        raise ErroApi('Este e-mail já está em uso por outra conta.', 409, 'novo_email')

    cfg = current_app.config
    token = novo_token()
    banco.executar('UPDATE solicitacoes_troca_email SET expira_em = LOCALTIMESTAMP '
                   'WHERE usuario_id = %s AND confirmado_em IS NULL AND expira_em > LOCALTIMESTAMP',
                   (g.usuario['id'],))                    # cancela pedidos anteriores
    banco.executar('INSERT INTO solicitacoes_troca_email (usuario_id, novo_email, token_hash, expira_em) '
                   'VALUES (%s, %s, %s, LOCALTIMESTAMP + make_interval(mins => %s))',
                   (g.usuario['id'], novo, hash_token(token), cfg['MINUTOS_VALIDADE_LINK']))
    link = f"{cfg['URL_SITE']}/api/usuario/email/confirmar?token={token}"
    try:
        modo = emails.enviar_email(
            emails.configuracao_email(cfg), novo, 'AquaSmart - confirme seu novo e-mail',
            f"Para usar este endereço na sua conta do AquaSmart, abra o link abaixo "
            f"(vale por {cfg['MINUTOS_VALIDADE_LINK']} minutos):\n{link}\n\n"
            f"Se não foi você, ignore este e-mail.")
    except Exception:
        log.exception('Falha ao enviar o e-mail de confirmação')
        raise ErroApi('Não foi possível enviar o e-mail de confirmação. Tente novamente mais tarde.', 502)
    if modo == 'smtp':
        mensagem = 'Enviamos um link de confirmação para o novo e-mail. O e-mail só muda depois da confirmação.'
    else:
        mensagem = ('Modo de desenvolvimento: nenhum e-mail foi enviado. O link de confirmação '
                    'apareceu no terminal do servidor.')
    return jsonify({'mensagem': mensagem})


def _pagina(titulo, texto, status=200):
    """Página simples exibida depois de clicar no link do e-mail."""
    corpo = (f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
             f'<meta name="viewport" content="width=device-width, initial-scale=1">'
             f'<title>AquaSmart - {html.escape(titulo)}</title>'
             f'<style>body{{font-family:system-ui,Arial,sans-serif;background:#f3f6f9;display:flex;'
             f'align-items:center;justify-content:center;min-height:100vh;margin:0;color:#14213d}}'
             f'main{{background:#fff;border-radius:12px;padding:32px 40px;max-width:420px;text-align:center;'
             f'box-shadow:0 4px 18px rgba(0,0,0,.08)}}a{{color:#0b86d1}}</style></head>'
             f'<body><main><h1>{html.escape(titulo)}</h1><p>{html.escape(texto)}</p>'
             f'<p><a href="/login/login.html">Ir para o login</a></p></main></body></html>')
    return corpo, status, {'Content-Type': 'text/html; charset=utf-8'}


@bp.get('/usuario/email/confirmar')
def confirmar_troca_email():
    token = request.args.get('token', '')
    linha = None
    if token:
        linha = banco.executar(
            'UPDATE solicitacoes_troca_email SET confirmado_em = LOCALTIMESTAMP '
            'WHERE token_hash = %s AND confirmado_em IS NULL AND expira_em > LOCALTIMESTAMP '
            'RETURNING usuario_id, novo_email', (hash_token(token),), retornar=True)
    if linha is None:
        return _pagina('Link inválido', 'Este link é inválido ou expirou. Peça a troca de e-mail novamente.', 400)
    try:
        banco.executar('UPDATE usuarios SET email = %s WHERE id = %s', (linha['novo_email'], linha['usuario_id']))
    except banco.ErroUnicidade:
        return _pagina('E-mail em uso', 'Este e-mail já está em uso por outra conta.', 409)
    return _pagina('E-mail confirmado', 'Seu e-mail foi alterado com sucesso.')


# ------------------------------------------------------------------ propriedade
def _campos_propriedade(dados, localizacao_obrigatoria):
    nome = v.texto(dados, 'nome', 'nome da propriedade', maximo=100)
    localizacao = v.texto(dados, 'localizacao', 'localização', obrigatorio=localizacao_obrigatoria, maximo=150)
    area = v.numero(dados, 'area_hectares', 'área cultivada', minimo=0, maximo=AREA_MAXIMA_HECTARES,
                    minimo_exclusivo=True)
    cultura = v.texto(dados, 'cultura', 'cultura', obrigatorio=False, maximo=100)
    metodo = dados.get('metodo_irrigacao')
    if metodo not in METODOS_IRRIGACAO:
        raise ErroApi("O modo de irrigação deve ser \"Bomba d'água\" ou \"Gravidade\".", 400, 'metodo_irrigacao')
    return nome, localizacao, area, cultura, metodo


@bp.post('/propriedades')
def cadastrar_propriedade():
    """Etapa 2 do cadastro. Ainda não há login: quem é o dono vem do token da etapa 1
    (assinado pelo servidor). O usuario_id que o front-end envia é só conferido, nunca usado."""
    dados = v.corpo_json()
    usuario_id = ler_token_cadastro(dados.get('token_cadastro'))
    if dados.get('usuario_id') not in (None, usuario_id):
        raise ErroApi('Dados de cadastro inconsistentes. Comece o cadastro novamente.', 403)
    campos = _campos_propriedade(dados, localizacao_obrigatoria=True)
    try:
        propriedade = banco.executar(
            'INSERT INTO propriedades (usuario_id, nome, localizacao, area_hectares, cultura, metodo_irrigacao) '
            'VALUES (%s, %s, %s, %s, %s, %s) RETURNING ' + COLUNAS_PROPRIEDADE,
            (usuario_id,) + campos, retornar=True)
    except banco.ErroUnicidade:
        raise ErroApi('Este usuário já possui uma propriedade cadastrada.', 409)
    except banco.ErroReferencia:
        raise ErroApi('Usuário não encontrado. Comece o cadastro novamente.', 404)
    return jsonify(propriedade), 201


@bp.get('/propriedade')
@login_obrigatorio
def obter_propriedade():
    propriedade = banco.consultar('SELECT ' + COLUNAS_PROPRIEDADE + ' FROM propriedades WHERE usuario_id = %s',
                                  (g.usuario['id'],), um=True)
    if propriedade is None:
        raise ErroApi('Você ainda não cadastrou uma propriedade.', 404)
    return jsonify(propriedade)


@bp.put('/propriedade')
@login_obrigatorio
def atualizar_propriedade():
    """Nome, localização, área, cultura e modo de irrigação. Os limites de umidade (liga/desliga)
    não têm tela de edição e ficam como estão no banco."""
    dados = v.corpo_json()
    campos = _campos_propriedade(dados, localizacao_obrigatoria=False)
    propriedade = banco.executar(
        'UPDATE propriedades SET nome = %s, localizacao = %s, area_hectares = %s, cultura = %s, '
        'metodo_irrigacao = %s WHERE usuario_id = %s RETURNING ' + COLUNAS_PROPRIEDADE,
        campos + (g.usuario['id'],), retornar=True)
    if propriedade is None:
        raise ErroApi('Você ainda não cadastrou uma propriedade.', 404)
    return jsonify(propriedade)
