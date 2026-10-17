"""
NOME: tests/auxiliar.py
FUNÇÃO: Ferramentas dos testes que NÃO usam PostgreSQL.
        BancoFalso responde às consultas SQL com dados combinados em cada teste. Assim dá para
        testar rotas, validações, segurança e formato das respostas; o SQL em si só é
        validado pelos testes de tests/test_postgres.py (que precisam de um PostgreSQL real).
"""
import os
import sys
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import banco                                    # noqa: E402
from app import create_app                      # noqa: E402
from seguranca import (limite_login, limite_recuperacao, limite_senha_atual)   # noqa: E402

CONFIG_TESTE = {
    'SECRET_KEY': 'k' * 40,
    'CHAVE_DISPOSITIVOS': 'd' * 40,
    'CORS_ORIGENS': ['http://localhost:5500'],
    'EMAIL_MODO': 'console',
    'URL_SITE': 'http://localhost:5000',
}


class BancoFalso:
    def __init__(self):
        self.respostas = []        # (trecho do SQL, resposta)
        self.chamadas = []         # (SQL normalizado, parâmetros)
        self.finalizacoes = []     # True = commit, False = rollback

    def quando(self, trecho, resposta):
        """Se o SQL contiver 'trecho', devolve 'resposta' (valor, função(params) ou exceção a lançar).
        Regras registradas depois têm prioridade."""
        self.respostas.append((trecho, resposta))

    def _responder(self, sql, params):
        sql_normalizado = ' '.join(sql.split())
        self.chamadas.append((sql_normalizado, params))
        for trecho, resposta in reversed(self.respostas):
            if trecho in sql_normalizado:
                if isinstance(resposta, BaseException):
                    raise resposta
                return resposta(params) if callable(resposta) else resposta
        raise AssertionError('SQL sem resposta combinada no teste: ' + sql_normalizado)

    def consultar(self, sql, params=(), um=False):
        resposta = self._responder(sql, params)
        if um and isinstance(resposta, list):
            return resposta[0] if resposta else None
        return resposta

    def executar(self, sql, params=(), retornar=False):
        return self._responder(sql, params)

    def finalizar(self, confirmar):
        self.finalizacoes.append(confirmar)

    def chamadas_com(self, trecho):
        return [(sql, params) for sql, params in self.chamadas if trecho in sql]


def criar_ambiente(teste):
    """Cria app + cliente + banco falso para um teste (e desfaz tudo ao final)."""
    for limite in (limite_login, limite_recuperacao, limite_senha_atual):
        limite.zerar()
    teste.banco = BancoFalso()
    patch = mock.patch.multiple(banco, consultar=teste.banco.consultar, executar=teste.banco.executar,
                                finalizar=teste.banco.finalizar)
    patch.start()
    teste.addCleanup(patch.stop)
    teste.app = create_app(CONFIG_TESTE)
    teste.cliente = teste.app.test_client()


def entrar(teste, usuario_id=1, senha_alterada_em=None):
    """Deixa o cliente de teste logado (sem passar pela rota de login)."""
    usuario = {'id': usuario_id, 'nome': 'João Teste', 'email': 'joao@example.com',
               'telefone': '(88) 99999-9999', 'senha_alterada_em': senha_alterada_em}
    teste.banco.quando('FROM usuarios WHERE id = %s', [usuario])
    with teste.cliente.session_transaction() as sessao:
        sessao['usuario_id'] = usuario_id
        sessao['versao_senha'] = ''
    return usuario
