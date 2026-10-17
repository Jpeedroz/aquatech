"""
NOME: erros.py
FUNÇÃO: Define o erro padrão da API (ErroApi) e centraliza o tratamento de erros.
        Toda resposta de erro tem o formato que o front-end espera (api.js):
            { "mensagem": "texto para o usuário", "campo": "email" }   (campo é opcional)
"""
from flask import jsonify, request
from werkzeug.exceptions import HTTPException

import banco


class ErroApi(Exception):
    """Erro previsto (validação, permissão, não encontrado...). Vira JSON com o status HTTP."""

    def __init__(self, mensagem, status=400, campo=None):
        super().__init__(mensagem)
        self.mensagem = mensagem
        self.status = status
        self.campo = campo


def resposta_erro(mensagem, status, campo=None):
    corpo = {'mensagem': mensagem}
    if campo:
        corpo['campo'] = campo
    return jsonify(corpo), status


MENSAGENS_HTTP = {
    400: 'Requisição inválida.',
    404: 'Rota não encontrada.',
    405: 'Método não permitido para esta rota.',
    413: 'A requisição é grande demais.',
    500: 'Erro interno do servidor. Tente novamente em instantes.',
}


def registrar_tratadores(app):
    @app.errorhandler(ErroApi)
    def erro_previsto(e):
        return resposta_erro(e.mensagem, e.status, e.campo)

    @app.errorhandler(banco.ErroBanco)
    def erro_de_banco(e):
        return resposta_erro('Banco de dados indisponível no momento. Tente novamente em instantes.', 503)

    @app.errorhandler(HTTPException)
    def erro_http(e):
        if request.path.startswith('/api/'):
            return resposta_erro(MENSAGENS_HTTP.get(e.code, e.name), e.code)
        return e            # fora da API (ex.: arquivo do front-end inexistente) mantém a resposta padrão

    @app.errorhandler(Exception)
    def erro_inesperado(e):
        # O detalhe técnico vai só para o log do servidor; o usuário recebe uma mensagem genérica.
        app.logger.exception('Erro inesperado: %s', e)
        return resposta_erro(MENSAGENS_HTTP[500], 500)
