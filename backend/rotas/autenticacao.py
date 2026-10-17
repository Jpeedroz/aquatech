"""
NOME: rotas/autenticacao.py
FUNÇÃO: Entrada no sistema.
ROTAS:  POST /api/usuarios                     cadastro do usuário (etapa 1)
        POST /api/login                        entrar
        POST /api/logout                       sair
        POST /api/recuperar-senha              pede o link de redefinição por e-mail
        GET  /api/redefinir-senha/verificar    confere se o link ainda vale
        POST /api/redefinir-senha              grava a nova senha
TELAS:  Cadastro, Login, Recuperar senha, Redefinir senha.
"""
from flask import Blueprint, current_app, jsonify, request, session

import banco
import emails
import validacoes as v
from erros import ErroApi
from seguranca import (conferir_senha, gerar_hash_senha, gerar_token_cadastro, hash_token,
                       iniciar_sessao, limite_login, limite_recuperacao, novo_token)

bp = Blueprint('autenticacao', __name__, url_prefix='/api')

MENSAGEM_RECUPERACAO = 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.'


@bp.post('/usuarios')
def cadastrar_usuario():
    """Etapa 1 do cadastro. Cria o usuário, mas NÃO faz login: a etapa 2 (propriedade) usa o
    token devolvido aqui, e o acesso ao sistema só acontece no login."""
    dados = v.corpo_json()
    nome = v.texto(dados, 'nome', 'nome', maximo=100)
    email = v.email(dados)
    telefone = v.telefone(dados, obrigatorio=True)      # o formulário de cadastro exige telefone
    senha = v.senha_nova(dados)
    try:
        usuario = banco.executar(
            'INSERT INTO usuarios (nome, email, telefone, senha_hash) VALUES (%s, %s, %s, %s) '
            'RETURNING id, nome, email',
            (nome, email, telefone, gerar_hash_senha(senha)), retornar=True)
    except banco.ErroUnicidade:
        raise ErroApi('Este e-mail já está cadastrado.', 409, 'email')
    return jsonify({
        'usuario_id': usuario['id'], 'propriedade_id': None,
        'nome': usuario['nome'], 'email': usuario['email'],
        'token': gerar_token_cadastro(usuario['id']),
    }), 201


@bp.post('/login')
def login():
    dados = v.corpo_json()
    email = v.email(dados)
    senha = v.senha_informada(dados)

    chave = f'{request.remote_addr}|{email.lower()}'
    limite_login.verificar(chave)

    usuario = banco.consultar(
        'SELECT id, nome, email, senha_hash, senha_alterada_em FROM usuarios WHERE LOWER(email) = LOWER(%s)',
        (email,), um=True)
    if usuario is None:
        limite_login.registrar(chave)
        # O front-end pede aviso específico quando a conta não existe (campo "email").
        raise ErroApi('Não encontramos uma conta com este e-mail. Cadastre-se para criar a sua.', 401, 'email')
    if not conferir_senha(usuario['senha_hash'], senha):
        limite_login.registrar(chave)
        raise ErroApi('E-mail ou senha incorretos.', 401)
    limite_login.limpar(chave)

    propriedade = banco.consultar('SELECT id FROM propriedades WHERE usuario_id = %s', (usuario['id'],), um=True)
    resposta = {
        'usuario_id': usuario['id'],
        'propriedade_id': propriedade['id'] if propriedade else None,
        'nome': usuario['nome'], 'email': usuario['email'],
    }
    if propriedade is None:
        # Cadastro incompleto: o usuário ainda precisa da etapa 2, que usa este token.
        resposta['token'] = gerar_token_cadastro(usuario['id'])
        return jsonify(resposta)

    iniciar_sessao(usuario)
    return jsonify(resposta)


@bp.post('/logout')
def logout():
    session.clear()
    return jsonify({'mensagem': 'Sessão encerrada.'})


@bp.post('/recuperar-senha')
def recuperar_senha():
    """A resposta é SEMPRE a mesma, exista o e-mail ou não (não revela quem tem conta)."""
    dados = v.corpo_json()
    email = v.email(dados)
    chave = f'{request.remote_addr}|{email.lower()}'
    limite_recuperacao.verificar(chave)
    limite_recuperacao.registrar(chave)

    usuario = banco.consultar('SELECT id, email FROM usuarios WHERE LOWER(email) = LOWER(%s)', (email,), um=True)
    if usuario:
        cfg = current_app.config
        token = novo_token()
        # só o link mais recente vale
        banco.executar('UPDATE tokens_recuperacao_senha SET usado_em = LOCALTIMESTAMP '
                       'WHERE usuario_id = %s AND usado_em IS NULL', (usuario['id'],))
        banco.executar('INSERT INTO tokens_recuperacao_senha (usuario_id, token_hash, expira_em) '
                       'VALUES (%s, %s, LOCALTIMESTAMP + make_interval(mins => %s))',
                       (usuario['id'], hash_token(token), cfg['MINUTOS_VALIDADE_LINK']))
        link = f"{cfg['URL_SITE']}/redefinir/redefinir.html?token={token}"
        emails.enviar_em_segundo_plano(
            emails.configuracao_email(cfg), usuario['email'], 'AquaSmart - redefinição de senha',
            f"Recebemos um pedido para redefinir a senha da sua conta no AquaSmart.\n\n"
            f"Abra o link abaixo (vale por {cfg['MINUTOS_VALIDADE_LINK']} minutos e só pode ser usado uma vez):\n{link}\n\n"
            f"Se não foi você, ignore este e-mail: sua senha continua a mesma.")
    return jsonify({'mensagem': MENSAGEM_RECUPERACAO})


@bp.get('/redefinir-senha/verificar')
def verificar_token_recuperacao():
    token = request.args.get('token', '')
    valido = False
    if token:
        linha = banco.consultar(
            'SELECT 1 AS ok FROM tokens_recuperacao_senha '
            'WHERE token_hash = %s AND usado_em IS NULL AND expira_em > LOCALTIMESTAMP',
            (hash_token(token),), um=True)
        valido = linha is not None
    return jsonify({'valido': valido})


@bp.post('/redefinir-senha')
def redefinir_senha():
    dados = v.corpo_json()
    nova = v.senha_nova(dados, 'nova_senha')
    token = dados.get('token')
    if not isinstance(token, str) or not token:
        raise ErroApi('Este link é inválido ou expirou. Peça um novo link de redefinição.', 400)
    # "Gasta" o token numa única operação: se dois pedidos chegarem juntos, só um consegue.
    linha = banco.executar(
        'UPDATE tokens_recuperacao_senha SET usado_em = LOCALTIMESTAMP '
        'WHERE token_hash = %s AND usado_em IS NULL AND expira_em > LOCALTIMESTAMP RETURNING usuario_id',
        (hash_token(token),), retornar=True)
    if linha is None:
        raise ErroApi('Este link é inválido ou expirou. Peça um novo link de redefinição.', 400)
    banco.executar('UPDATE usuarios SET senha_hash = %s, senha_alterada_em = LOCALTIMESTAMP WHERE id = %s',
                   (gerar_hash_senha(nova), linha['usuario_id']))
    return jsonify({'mensagem': 'Senha alterada com sucesso.'})
