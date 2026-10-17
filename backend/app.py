"""
NOME: app.py
FUNÇÃO: Ponto de entrada do back-end do AquaSmart (Flask).
        - cria o aplicativo e registra as rotas da pasta rotas/;
        - serve também os arquivos do front-end (pasta ../frontend), assim a tela e a API ficam
          no mesmo endereço e o cookie de login funciona sem configuração extra;
        - controla o commit/rollback do banco ao fim de cada requisição.
COMO RODAR:  python app.py   (dentro da pasta backend, com o ambiente virtual ativo)
"""
from datetime import date, datetime, timedelta
from decimal import Decimal

from flask import Flask, jsonify, redirect, request

import banco
import config
from erros import registrar_tratadores
from rotas import autenticacao, conta, dispositivo, painel


def _converter_para_json(valor):
    """Como o Flask escreve em JSON os tipos que o PostgreSQL devolve.
    Decimal -> número (o front compara e calcula com eles).
    Datas/horas -> texto AAAA-MM-DDTHH:MM:SS SEM fuso, o formato que as telas esperam;
    o formato padrão do Flask (GMT) deslocaria os horários em 3 horas no navegador."""
    if isinstance(valor, Decimal):
        return float(valor)
    if isinstance(valor, datetime):
        return valor.isoformat(timespec='seconds')
    if isinstance(valor, date):
        return valor.isoformat()
    raise TypeError(f'Tipo não suportado em JSON: {type(valor).__name__}')


def create_app(config_extra=None):
    cfg = config.carregar_config()
    if config_extra:
        cfg.update(config_extra)
    config.validar_config(cfg)

    app = Flask(__name__, static_folder=str(config.PASTA_FRONTEND), static_url_path='')
    app.config.update(cfg)
    app.config.update(
        SESSION_COOKIE_NAME='aquasmart_sessao',
        SESSION_COOKIE_HTTPONLY=True,          # o JavaScript da página não consegue ler o cookie
        SESSION_COOKIE_SAMESITE='Lax',         # outros sites não conseguem usá-lo (proteção contra CSRF)
        SESSION_COOKIE_SECURE=cfg['COOKIE_SEGURO'],
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=64 * 1024,          # nenhuma requisição da API precisa de mais que isso
    )
    app.json.default = _converter_para_json
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    registrar_tratadores(app)
    for modulo in (autenticacao, conta, painel, dispositivo):
        app.register_blueprint(modulo.bp)

    @app.after_request
    def fechar_requisicao(resposta):
        # Uma requisição = uma transação: tudo é gravado junto, ou nada (erro HTTP >= 400 = rollback).
        banco.finalizar(resposta.status_code < 400)
        return resposta

    @app.teardown_appcontext
    def garantir_fechamento(_erro):
        banco.finalizar(False)                 # só age se algo escapou (exceção): desfaz e fecha

    @app.after_request
    def liberar_cors(resposta):
        # Só é necessário se o front-end for aberto em OUTRO endereço (ex.: Live Server, porta 5500).
        origem = request.headers.get('Origin')
        if origem and origem in app.config['CORS_ORIGENS']:
            resposta.headers['Access-Control-Allow-Origin'] = origem
            resposta.headers['Access-Control-Allow-Credentials'] = 'true'
            resposta.vary.add('Origin')
            if request.method == 'OPTIONS':
                resposta.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, OPTIONS'
                resposta.headers['Access-Control-Allow-Headers'] = 'Content-Type'
                resposta.headers['Access-Control-Max-Age'] = '600'
        return resposta

    @app.get('/api/saude')
    def saude():
        """Confere se a API está no ar e se o PostgreSQL responde."""
        banco.consultar('SELECT 1 AS ok')
        return jsonify({'status': 'ok', 'banco': 'conectado'})

    @app.get('/')
    def inicio():
        return redirect('/login/login.html')

    return app


if __name__ == '__main__':
    aplicativo = create_app()
    aplicativo.run(host=aplicativo.config['FLASK_HOST'], port=aplicativo.config['FLASK_PORT'],
                   debug=aplicativo.config['FLASK_DEBUG'])
