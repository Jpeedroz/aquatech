"""
NOME: config.py
FUNÇÃO: Lê as configurações do arquivo backend/.env (ou das variáveis de ambiente)
        e as entrega num único lugar. Nenhuma senha fica escrita no código.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

PASTA_BACKEND = Path(__file__).resolve().parent
RAIZ_PROJETO = PASTA_BACKEND.parent
PASTA_FRONTEND = RAIZ_PROJETO / 'frontend'
ARQUIVO_SQL = RAIZ_PROJETO / 'database' / 'aquatech_database.sql'

# Variáveis já definidas no sistema têm prioridade sobre o arquivo .env
load_dotenv(PASTA_BACKEND / '.env')


def _texto(nome, padrao=''):
    return os.getenv(nome, padrao).strip()


def _inteiro(nome, padrao):
    try:
        return int(_texto(nome, str(padrao)))
    except ValueError:
        return padrao


def _verdadeiro(nome, padrao=False):
    valor = os.getenv(nome)
    if valor is None:
        return padrao
    return valor.strip().lower() in ('1', 'true', 'sim', 'yes')


def carregar_config():
    """Devolve um dicionário com todas as configurações do sistema."""
    return {
        # segurança
        'SECRET_KEY': _texto('SECRET_KEY'),
        'CHAVE_DISPOSITIVOS': _texto('CHAVE_DISPOSITIVOS'),
        # banco de dados
        'DB_HOST': _texto('DB_HOST', 'localhost'),
        'DB_PORT': _inteiro('DB_PORT', 5432),
        'DB_NAME': _texto('DB_NAME', 'aquatech'),
        'DB_USER': _texto('DB_USER', 'postgres'),
        'DB_PASSWORD': _texto('DB_PASSWORD'),
        'DB_FUSO': 'America/Fortaleza',          # o SQL pede esse fuso em cada conexão
        # servidor
        'FLASK_HOST': _texto('FLASK_HOST', '127.0.0.1'),
        'FLASK_PORT': _inteiro('FLASK_PORT', 5000),
        'FLASK_DEBUG': _verdadeiro('FLASK_DEBUG'),
        'URL_SITE': _texto('URL_SITE', 'http://localhost:5000').rstrip('/'),
        'CORS_ORIGENS': [o.strip() for o in _texto('CORS_ORIGENS').split(',') if o.strip()],
        'COOKIE_SEGURO': _verdadeiro('COOKIE_SEGURO'),
        # e-mail
        'EMAIL_MODO': _texto('EMAIL_MODO', 'console').lower(),
        'SMTP_HOST': _texto('SMTP_HOST'),
        'SMTP_PORTA': _inteiro('SMTP_PORTA', 587),
        'SMTP_USUARIO': _texto('SMTP_USUARIO'),
        'SMTP_SENHA': _texto('SMTP_SENHA'),
        'SMTP_REMETENTE': _texto('SMTP_REMETENTE'),
        'SMTP_SEGURANCA': _texto('SMTP_SEGURANCA', 'starttls').lower(),
        # regras do sistema
        'MINUTOS_DISPOSITIVO_ONLINE': 5,         # sem sinal há mais que isso = offline
        'MINUTOS_VALIDADE_LINK': 30,             # validade dos links enviados por e-mail
    }


def validar_config(cfg, campos=None):
    """Recusa iniciar com configuração faltando ou ainda com os valores de exemplo."""
    problemas = []
    for nome in ('SECRET_KEY', 'CHAVE_DISPOSITIVOS'):
        if campos and nome not in campos:
            continue
        valor = cfg.get(nome, '')
        if len(valor) < 32 or 'troque' in valor.lower():
            problemas.append(f'{nome}: defina um valor secreto com pelo menos 32 caracteres '
                             f'(não use o texto de exemplo do .env.example).')
    if not campos:
        if not cfg.get('DB_NAME') or not cfg.get('DB_USER'):
            problemas.append('DB_NAME e DB_USER são obrigatórios.')
        if cfg.get('EMAIL_MODO') not in ('console', 'smtp'):
            problemas.append('EMAIL_MODO deve ser "console" ou "smtp".')
        if cfg.get('EMAIL_MODO') == 'smtp' and not (cfg.get('SMTP_HOST') and cfg.get('SMTP_REMETENTE')):
            problemas.append('EMAIL_MODO=smtp exige SMTP_HOST e SMTP_REMETENTE.')
    if problemas:
        raise RuntimeError('Configuração incompleta no arquivo backend/.env:\n  - ' + '\n  - '.join(problemas))
