"""
NOME: validacoes.py
FUNÇÃO: Funções que conferem os dados recebidos pela API (texto, e-mail, senha, telefone,
        números e datas). Quando algo está errado, lançam ErroApi com a mensagem e o campo.
        O front-end também valida, mas a API NUNCA confia só nisso.
"""
import math
import re
from datetime import date, datetime

from flask import request

from erros import ErroApi

REGEX_EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')    # mesma regra do front-end (utils.js)
SENHA_MINIMO = 6                                           # mesma regra dos formulários
SENHA_MAXIMO = 128
LIMITE_DIAS_PERIODO = 366


def corpo_json():
    """Lê o corpo da requisição. Exige JSON (Content-Type: application/json)."""
    dados = request.get_json(silent=True)
    if not isinstance(dados, dict):
        raise ErroApi('Corpo da requisição inválido. Envie um JSON (Content-Type: application/json).', 400)
    return dados


def texto(dados, campo, rotulo, obrigatorio=True, maximo=100):
    valor = dados.get(campo)
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        if obrigatorio:
            raise ErroApi(f'O campo {rotulo} é obrigatório.', 400, campo)
        return None
    if not isinstance(valor, str):
        raise ErroApi(f'O campo {rotulo} é inválido.', 400, campo)
    valor = valor.strip()
    if len(valor) > maximo:
        raise ErroApi(f'O campo {rotulo} deve ter no máximo {maximo} caracteres.', 400, campo)
    return valor


def email(dados, campo='email'):
    valor = texto(dados, campo, 'e-mail', maximo=150)
    if not REGEX_EMAIL.match(valor):
        raise ErroApi('Informe um e-mail válido.', 400, campo)
    return valor


def senha_informada(dados, campo='senha', rotulo='senha'):
    """Senha digitada (não é alterada: espaços fazem parte da senha)."""
    valor = dados.get(campo)
    if not isinstance(valor, str) or not valor:
        raise ErroApi(f'Informe a {rotulo}.', 400, campo)
    return valor


def senha_nova(dados, campo='senha'):
    valor = senha_informada(dados, campo, 'nova senha' if campo != 'senha' else 'senha')
    if len(valor) < SENHA_MINIMO:
        raise ErroApi(f'A senha deve ter pelo menos {SENHA_MINIMO} caracteres.', 400, campo)
    if len(valor) > SENHA_MAXIMO:
        raise ErroApi(f'A senha deve ter no máximo {SENHA_MAXIMO} caracteres.', 400, campo)
    return valor


def telefone(dados, campo='telefone', obrigatorio=False):
    """Aceita com ou sem máscara e devolve no formato (88) 99999-9999 (o mesmo do front-end)."""
    valor = texto(dados, campo, 'telefone', obrigatorio, 20)
    if valor is None:
        return None
    digitos = re.sub(r'\D', '', valor)
    if len(digitos) not in (10, 11):
        raise ErroApi('Informe um telefone válido com DDD.', 400, campo)
    corte = 7 if len(digitos) == 11 else 6
    return f'({digitos[:2]}) {digitos[2:corte]}-{digitos[corte:]}'


def numero(dados, campo, rotulo, minimo=None, maximo=None, obrigatorio=True, minimo_exclusivo=False):
    """Número JSON (não aceita texto, true/false, NaN ou infinito)."""
    valor = dados.get(campo)
    if valor is None:
        if obrigatorio:
            raise ErroApi(f'O campo {rotulo} é obrigatório.', 400, campo)
        return None
    if isinstance(valor, bool) or not isinstance(valor, (int, float)) or not math.isfinite(valor):
        raise ErroApi(f'O campo {rotulo} deve ser um número.', 400, campo)
    if minimo is not None and (valor <= minimo if minimo_exclusivo else valor < minimo):
        raise ErroApi(f'O campo {rotulo} deve ser {"maior que" if minimo_exclusivo else "no mínimo"} {minimo}.', 400, campo)
    if maximo is not None and valor > maximo:
        raise ErroApi(f'O campo {rotulo} deve ser no máximo {maximo}.', 400, campo)
    return float(valor)


def data_iso(valor, campo):
    try:
        return date.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ErroApi(f'Data inválida em "{campo}". Use o formato AAAA-MM-DD.', 400, campo)


def periodo_da_requisicao():
    """Lê ?inicio=AAAA-MM-DD&fim=AAAA-MM-DD (os dois dias entram no período)."""
    inicio = data_iso(request.args.get('inicio'), 'inicio')
    fim = data_iso(request.args.get('fim'), 'fim')
    if inicio > fim:
        raise ErroApi('A data inicial deve ser anterior ou igual à data final.', 400)
    if (fim - inicio).days > LIMITE_DIAS_PERIODO:
        raise ErroApi(f'O período pode ter no máximo {LIMITE_DIAS_PERIODO} dias.', 400)
    return inicio, fim


def horario_local(dados, campo):
    """Horário opcional no formato 2026-10-15T14:30:00, SEM fuso (horário local de Fortaleza)."""
    valor = dados.get(campo)
    if valor is None:
        return None
    try:
        horario = datetime.fromisoformat(valor)
    except (TypeError, ValueError):
        raise ErroApi(f'O campo {campo} deve estar no formato AAAA-MM-DDTHH:MM:SS.', 400, campo)
    if horario.tzinfo is not None:
        raise ErroApi(f'Envie {campo} no horário local, sem fuso (ex.: 2026-10-15T14:30:00).', 400, campo)
    return horario
