"""
NOME: rotas/painel.py
FUNÇÃO: Dados que alimentam as telas internas. Só leitura: tudo vem do que o ESP32 registrou.
ROTAS:  GET /api/dashboard                          situação atual + leituras e irrigações de hoje
        GET /api/historico?inicio=&fim=             leituras (umidade, temperatura e vazão) e eventos do período
        GET /api/irrigacoes?inicio=&fim=            eventos de irrigação do período
        GET /api/consumo?inicio=&fim=               consumo de água por dia (view consumo_diario)
        GET /api/consumo/resumo                     hoje, 7 dias, 30 dias e total
        GET /api/dias-disponiveis?fonte=            dias que têm dados (leituras | eventos | consumo): alimenta os calendários
TELAS:  Dashboard, Histórico, Irrigações, Consumo de água.
Sem dados, as rotas devolvem listas vazias / valores nulos (a tela mostra "Nenhuma medição registrada ..."):
nada é inventado e nada do futuro é devolvido (hora_leitura / iniciado_em <= agora, no fuso da propriedade).
"""
from flask import Blueprint, current_app, g, jsonify, request

import banco
import validacoes as v
from erros import ErroApi
from seguranca import login_obrigatorio

bp = Blueprint('painel', __name__, url_prefix='/api')

MAX_LEITURAS_HISTORICO = 20000
TIPOS_HISTORICO = ('umidade_solo', 'temperatura', 'vazao_agua')   # a vazão serve para o consumo acumulado
TIPOS_MEDICAO = ('umidade_solo', 'temperatura')
MAX_DIAS_DISPONIVEIS = 1000


def _eventos(usuario_id, inicio, fim):
    return banco.consultar(
        'SELECT e.id, e.dispositivo_id, e.iniciado_em, e.encerrado_em, e.duracao_minutos, '
        '       e.agua_utilizada_litros, e.umidade_antes, e.umidade_depois '
        'FROM eventos_irrigacao e '
        'JOIN dispositivos d ON d.id = e.dispositivo_id '
        'JOIN propriedades p ON p.id = d.propriedade_id '
        'WHERE p.usuario_id = %s AND e.iniciado_em >= %s AND e.iniciado_em < (%s::date + 1) '
        '  AND e.iniciado_em <= LOCALTIMESTAMP '                 # nada do futuro: só o que já aconteceu até agora
        'ORDER BY e.iniciado_em',
        (usuario_id, inicio, fim))


def _leituras(usuario_id, inicio, fim, tipos, limite):
    return banco.consultar(
        'SELECT l.sensor_id, s.tipo, l.valor, l.hora_leitura '
        'FROM leituras_sensores l '
        'JOIN sensores s ON s.id = l.sensor_id '
        'JOIN dispositivos d ON d.id = s.dispositivo_id '
        'JOIN propriedades p ON p.id = d.propriedade_id '
        'WHERE p.usuario_id = %s AND s.tipo = ANY(%s) '
        '  AND l.hora_leitura >= %s AND l.hora_leitura < (%s::date + 1) '
        '  AND l.hora_leitura <= LOCALTIMESTAMP '                 # nunca devolve medição "do futuro" (relógio errado do ESP32)
        'ORDER BY l.hora_leitura, s.tipo LIMIT %s',
        (usuario_id, list(tipos), inicio, fim, limite))


@bp.get('/dashboard')
@login_obrigatorio
def dashboard():
    usuario_id = g.usuario['id']
    hoje = banco.consultar('SELECT CURRENT_DATE AS hoje', um=True)['hoje']
    # resumo_dashboard (view do banco) tem uma linha por dispositivo; a tela mostra um só.
    # "online" é recalculado: o campo guardado só vira FALSE se alguém o alterar, então
    # o certo é considerar offline o dispositivo sem sinal recente.
    resumo = banco.consultar(
        'SELECT r.*, (r.ultimo_sinal IS NOT NULL '
        '             AND r.ultimo_sinal > LOCALTIMESTAMP - make_interval(mins => %s)) AS conectado '
        'FROM resumo_dashboard r WHERE r.usuario_id = %s ORDER BY r.dispositivo_id LIMIT 1',
        (current_app.config['MINUTOS_DISPOSITIVO_ONLINE'], usuario_id), um=True)
    if resumo is None:
        raise ErroApi('Usuário não encontrado.', 404)
    conectado = resumo.pop('conectado')
    resumo['online'] = bool(conectado) if resumo['dispositivo_id'] is not None else None
    # Leituras ATUAIS = as mais recentes JÁ REGISTRADAS (hora_leitura <= agora): nunca uma medição "do futuro",
    # e a hora mostrada é a hora real da medição (a view guarda só o último valor, sem esse corte).
    if resumo['dispositivo_id'] is not None:
        recentes = banco.consultar(
            'SELECT DISTINCT ON (s.tipo) s.tipo, l.valor, l.hora_leitura '
            'FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id '
            'WHERE s.dispositivo_id = %s AND s.tipo = ANY(%s) AND l.hora_leitura <= LOCALTIMESTAMP '
            'ORDER BY s.tipo, l.hora_leitura DESC',
            (resumo['dispositivo_id'], list(TIPOS_MEDICAO)))
        por_tipo = {r['tipo']: r for r in recentes}
        resumo['umidade_atual'] = por_tipo['umidade_solo']['valor'] if 'umidade_solo' in por_tipo else None
        resumo['temperatura_atual'] = por_tipo['temperatura']['valor'] if 'temperatura' in por_tipo else None
        resumo['hora_umidade_atual'] = por_tipo['umidade_solo']['hora_leitura'] if 'umidade_solo' in por_tipo else None
    else:
        resumo['hora_umidade_atual'] = None
    return jsonify({
        'resumo': resumo,
        'leituras_umidade': _leituras(usuario_id, hoje, hoje, ('umidade_solo',), MAX_LEITURAS_HISTORICO),
        'eventos': _eventos(usuario_id, hoje, hoje),
    })


@bp.get('/historico')
@login_obrigatorio
def historico():
    inicio, fim = v.periodo_da_requisicao()
    # Umidade e temperatura formam a tabela; a vazão acompanha para calcular o consumo acumulado
    # (a tela só mostra linhas de medição: vazão sozinha não vira linha).
    leituras = _leituras(g.usuario['id'], inicio, fim, TIPOS_HISTORICO, MAX_LEITURAS_HISTORICO + 1)
    if len(leituras) > MAX_LEITURAS_HISTORICO:
        raise ErroApi('Há leituras demais neste período para exibir. Escolha um intervalo menor.', 400)
    return jsonify({'leituras': leituras, 'eventos': _eventos(g.usuario['id'], inicio, fim)})


@bp.get('/irrigacoes')
@login_obrigatorio
def irrigacoes():
    inicio, fim = v.periodo_da_requisicao()
    return jsonify({'eventos': _eventos(g.usuario['id'], inicio, fim)})


@bp.get('/consumo')
@login_obrigatorio
def consumo():
    inicio, fim = v.periodo_da_requisicao()
    dias = banco.consultar(
        'SELECT c.propriedade_id, c.data_consumo, c.agua_utilizada_litros '
        'FROM consumo_diario c JOIN propriedades p ON p.id = c.propriedade_id '
        'WHERE p.usuario_id = %s AND c.data_consumo BETWEEN %s AND %s '
        'ORDER BY c.data_consumo',
        (g.usuario['id'], inicio, fim))
    return jsonify({'dias': dias})


@bp.get('/consumo/resumo')
@login_obrigatorio
def consumo_resumo():
    resumo = banco.consultar(
        'SELECT '
        '  COALESCE(SUM(c.agua_utilizada_litros) FILTER (WHERE c.data_consumo = CURRENT_DATE), 0) AS hoje, '
        '  COALESCE(SUM(c.agua_utilizada_litros) FILTER (WHERE c.data_consumo >= CURRENT_DATE - 6), 0) AS ultimos_7_dias, '
        '  COALESCE(SUM(c.agua_utilizada_litros) FILTER (WHERE c.data_consumo >= CURRENT_DATE - 29), 0) AS ultimos_30_dias, '
        '  COALESCE(SUM(c.agua_utilizada_litros), 0) AS total '
        'FROM consumo_diario c JOIN propriedades p ON p.id = c.propriedade_id '
        'WHERE p.usuario_id = %s',
        (g.usuario['id'],), um=True)
    return jsonify(resumo)


# Cada fonte devolve os dias (data) que têm dado, para o calendário só deixar escolher esses dias.
_FONTES_DIAS = {
    'leituras': ('SELECT DISTINCT l.hora_leitura::date AS dia FROM leituras_sensores l '
                 'JOIN sensores s ON s.id = l.sensor_id JOIN dispositivos d ON d.id = s.dispositivo_id '
                 'JOIN propriedades p ON p.id = d.propriedade_id '
                 'WHERE p.usuario_id = %s AND s.tipo = ANY(%s) AND l.hora_leitura <= LOCALTIMESTAMP ORDER BY dia DESC LIMIT %s', TIPOS_MEDICAO),
    'eventos': ('SELECT DISTINCT e.iniciado_em::date AS dia FROM eventos_irrigacao e '
                'JOIN dispositivos d ON d.id = e.dispositivo_id JOIN propriedades p ON p.id = d.propriedade_id '
                'WHERE p.usuario_id = %s AND %s IS NOT NULL ORDER BY dia DESC LIMIT %s', True),
    # igual à view consumo_diario: um dia por dia que teve evento de irrigação
    'consumo': ('SELECT DISTINCT c.data_consumo AS dia FROM consumo_diario c '
                'JOIN propriedades p ON p.id = c.propriedade_id '
                'WHERE p.usuario_id = %s AND %s IS NOT NULL ORDER BY dia DESC LIMIT %s', True),
}


@bp.get('/dias-disponiveis')
@login_obrigatorio
def dias_disponiveis():
    fonte = request.args.get('fonte', '')
    if fonte not in _FONTES_DIAS:
        raise ErroApi('Informe fonte=leituras, fonte=eventos ou fonte=consumo.', 400, 'fonte')
    sql, extra = _FONTES_DIAS[fonte]
    linhas = banco.consultar(sql, (g.usuario['id'], list(extra) if isinstance(extra, tuple) else extra, MAX_DIAS_DISPONIVEIS))
    return jsonify({'dias': sorted(l['dia'] for l in linhas)})
