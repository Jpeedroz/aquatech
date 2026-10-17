"""
NOME: seguranca.py
FUNÇÃO: Tudo que protege o sistema:
        - hash de senhas (nunca guardamos a senha, só o hash);
        - sessão de login (cookie assinado pelo Flask) e o decorador @login_obrigatorio;
        - token temporário do cadastro em 2 etapas;
        - tokens de e-mail (recuperação de senha / troca de e-mail), guardados só como hash;
        - chave de cada ESP32 e o decorador @dispositivo_obrigatorio;
        - limite de tentativas (contra tentativa e erro de senhas).
"""
import hashlib
import hmac
import secrets
import threading
import time
from functools import wraps

from flask import current_app, g, request, session
from itsdangerous import BadSignature, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

import banco
from erros import ErroApi


# ---------------------------------------------------------------- senhas
def gerar_hash_senha(senha):
    # pbkdf2:sha256 funciona em qualquer instalação do Python (o padrão scrypt nem sempre).
    return generate_password_hash(senha, method='pbkdf2:sha256')


def conferir_senha(senha_hash, senha):
    return check_password_hash(senha_hash, senha)       # devolve False (sem erro) se o hash for inválido


# ---------------------------------------------------------------- sessão de login
# O Flask guarda no cookie (assinado com SECRET_KEY, HttpOnly) o id do usuário e uma
# "versão da senha" = valor de usuarios.senha_alterada_em. Se a senha mudar, a versão do banco
# deixa de bater com a do cookie e todas as sessões antigas são recusadas.
def iniciar_sessao(usuario):
    session.clear()
    session['usuario_id'] = usuario['id']
    session['versao_senha'] = str(usuario['senha_alterada_em'] or '')
    session.permanent = True


def login_obrigatorio(funcao):
    @wraps(funcao)
    def interna(*args, **kwargs):
        usuario_id = session.get('usuario_id')
        if usuario_id is None:
            raise ErroApi('Faça login para continuar.', 401)
        usuario = banco.consultar(
            'SELECT id, nome, email, telefone, senha_alterada_em FROM usuarios WHERE id = %s',
            (usuario_id,), um=True)
        if usuario is None or str(usuario['senha_alterada_em'] or '') != session.get('versao_senha'):
            session.clear()
            raise ErroApi('Sua sessão expirou. Entre novamente.', 401)
        g.usuario = usuario            # as rotas usam SEMPRE este usuário, nunca um id enviado pelo cliente
        return funcao(*args, **kwargs)
    return interna


# ---------------------------------------------------------------- cadastro em 2 etapas
def _serializador(sal):
    return URLSafeTimedSerializer(current_app.config['SECRET_KEY'], salt=sal)


def gerar_token_cadastro(usuario_id):
    return _serializador('cadastro-propriedade').dumps({'usuario_id': usuario_id})


def ler_token_cadastro(token, validade_segundos=3600):
    """Confere o token devolvido na etapa 1 do cadastro e devolve o id do usuário dono dele."""
    try:
        dados = _serializador('cadastro-propriedade').loads(token, max_age=validade_segundos)
        return int(dados['usuario_id'])
    except (BadSignature, KeyError, TypeError, ValueError, AttributeError):
        raise ErroApi('Sua sessão de cadastro expirou. Comece o cadastro novamente.', 403)


# ---------------------------------------------------------------- tokens de e-mail
def novo_token():
    return secrets.token_urlsafe(32)


def hash_token(token):
    """No banco fica só o hash: quem ler o banco não consegue usar os links."""
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


# ---------------------------------------------------------------- ESP32
# A chave de cada dispositivo é derivada do segredo do servidor (CHAVE_DISPOSITIVOS) e do
# código do dispositivo:  chave = HMAC-SHA256(segredo, codigo). Assim cada ESP32 tem a sua
# chave, sem precisar guardar nada novo no banco. O ESP32 envia a chave no cabeçalho
# X-Chave-Dispositivo e o servidor refaz a conta para conferir.
def gerar_chave_dispositivo(codigo, segredo):
    return hmac.new(segredo.encode('utf-8'), codigo.encode('utf-8'), hashlib.sha256).hexdigest()


def dispositivo_obrigatorio(funcao):
    @wraps(funcao)
    def interna(codigo, *args, **kwargs):
        enviada = request.headers.get('X-Chave-Dispositivo', '')
        esperada = gerar_chave_dispositivo(codigo, current_app.config['CHAVE_DISPOSITIVOS'])
        if not hmac.compare_digest(enviada.encode('utf-8'), esperada.encode('utf-8')):
            raise ErroApi('Dispositivo não autorizado.', 401)
        dispositivo = banco.consultar(
            'SELECT id, propriedade_id, codigo_dispositivo, nome, irrigacao_ligada '
            'FROM dispositivos WHERE codigo_dispositivo = %s', (codigo,), um=True)
        if dispositivo is None:
            raise ErroApi('Dispositivo não cadastrado.', 404)
        g.dispositivo = dispositivo
        return funcao(codigo, *args, **kwargs)
    return interna


# ---------------------------------------------------------------- limite de tentativas
class LimitadorTentativas:
    """Conta tentativas por chave (ex.: IP + e-mail) numa janela de tempo.
    Fica na memória: zera quando o servidor reinicia e vale por processo (suficiente para
    este projeto; em produção com vários processos use Redis ou o próprio banco)."""

    def __init__(self, maximo, janela_segundos):
        self.maximo = maximo
        self.janela = janela_segundos
        self._tentativas = {}
        self._trava = threading.Lock()

    def _recentes(self, chave, agora):
        return [t for t in self._tentativas.get(chave, []) if agora - t < self.janela]

    def verificar(self, chave):
        with self._trava:
            if len(self._recentes(chave, time.monotonic())) >= self.maximo:
                raise ErroApi('Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429)

    def registrar(self, chave):
        agora = time.monotonic()
        with self._trava:
            self._tentativas[chave] = self._recentes(chave, agora) + [agora]
            if len(self._tentativas) > 5000:                      # evita crescer sem limite
                self._tentativas = {k: v for k, v in self._tentativas.items() if self._recentes(k, agora)}

    def limpar(self, chave):
        with self._trava:
            self._tentativas.pop(chave, None)

    def zerar(self):
        with self._trava:
            self._tentativas.clear()


limite_login = LimitadorTentativas(maximo=5, janela_segundos=15 * 60)
limite_recuperacao = LimitadorTentativas(maximo=3, janela_segundos=15 * 60)
limite_senha_atual = LimitadorTentativas(maximo=5, janela_segundos=15 * 60)
