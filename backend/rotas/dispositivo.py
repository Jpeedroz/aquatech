"""
NOME: rotas/dispositivo.py
FUNÇÃO: Rotas usadas pelo ESP32 (não pelo navegador). Cada ESP32 se identifica pelo código
        na URL e prova quem é com a chave no cabeçalho X-Chave-Dispositivo (veja seguranca.py).
ROTAS:  POST /api/dispositivos/<codigo>/leituras       envia umidade, temperatura e/ou vazão
        GET  /api/dispositivos/<codigo>/configuracao   limites de umidade e modo de irrigação
        PUT  /api/dispositivos/<codigo>/irrigacao      informa que a irrigação ligou ou desligou
IMPORTANTE: o backend NÃO liga a bomba. Quem decide e aciona o relé é o ESP32; ele apenas
            REGISTRA aqui o que fez. Os horários de início/fim são os do servidor.
"""
from datetime import timedelta

from flask import Blueprint, current_app, g, jsonify

import banco
import validacoes as v
from erros import ErroApi
from regras import volume_por_vazao
from seguranca import dispositivo_obrigatorio

bp = Blueprint('dispositivo', __name__, url_prefix='/api')

# Faixas aceitas para cada sensor (valores fora disso são erro de leitura, não dado real).
LIMITES_SENSORES = {
    'umidade_solo': ('umidade do solo', 0, 100),
    'temperatura': ('temperatura', -40, 85),
    'vazao_agua': ('vazão', 0, 500),
}
TOLERANCIA_FUTURO = timedelta(minutes=5)
MINUTOS_UMIDADE_RECENTE = 15
COLUNAS_EVENTO = ('id, dispositivo_id, iniciado_em, encerrado_em, duracao_minutos, '
                  'agua_utilizada_litros, umidade_antes, umidade_depois')


def _agora():
    return banco.consultar('SELECT LOCALTIMESTAMP AS agora', um=True)['agora']


@bp.post('/dispositivos/<codigo>/leituras')
@dispositivo_obrigatorio
def registrar_leituras(codigo):
    """Corpo: {"umidade_solo": 23.5, "temperatura": 28.1, "vazao_agua": 1.5, "hora_leitura": "..."}
    Todos os campos são opcionais, mas é preciso enviar ao menos uma leitura. Sem hora_leitura,
    vale a hora em que o servidor recebeu. Todas as leituras do mesmo envio ficam com a MESMA hora
    (a tela de Histórico junta umidade e temperatura pela hora)."""
    dados = v.corpo_json()
    valores = {}
    for tipo, (rotulo, minimo, maximo) in LIMITES_SENSORES.items():
        valor = v.numero(dados, tipo, rotulo, minimo, maximo, obrigatorio=False)
        if valor is not None:
            valores[tipo] = valor
    if not valores:
        raise ErroApi('Envie ao menos uma leitura: umidade_solo, temperatura ou vazao_agua.', 400)

    agora = _agora()
    hora = v.horario_local(dados, 'hora_leitura') or agora
    if hora > agora + TOLERANCIA_FUTURO:
        raise ErroApi('hora_leitura está no futuro.', 400, 'hora_leitura')

    sensores = banco.consultar('SELECT id, tipo FROM sensores WHERE dispositivo_id = %s', (g.dispositivo['id'],))
    sensor_por_tipo = {s['tipo']: s['id'] for s in sensores}
    sem_sensor = [t for t in valores if t not in sensor_por_tipo]
    if sem_sensor:
        raise ErroApi('Este dispositivo não tem sensor cadastrado para: ' + ', '.join(sem_sensor) + '.', 400)

    for tipo, valor in valores.items():
        banco.executar('INSERT INTO leituras_sensores (sensor_id, valor, hora_leitura) VALUES (%s, %s, %s)',
                       (sensor_por_tipo[tipo], valor, hora))
    banco.executar('UPDATE dispositivos SET online = TRUE, ultimo_sinal = %s WHERE id = %s',
                   (agora, g.dispositivo['id']))
    return jsonify({'mensagem': 'Leituras registradas.', 'hora_leitura': hora, 'quantidade': len(valores)}), 201


@bp.get('/dispositivos/<codigo>/configuracao')
@dispositivo_obrigatorio
def configuracao(codigo):
    """O ESP32 consulta aqui quando liga (e de tempos em tempos) as regras da propriedade."""
    propriedade = banco.consultar(
        'SELECT metodo_irrigacao, limite_umidade, limite_umidade_desliga '
        'FROM propriedades WHERE id = %s', (g.dispositivo['propriedade_id'],), um=True)
    return jsonify({
        'codigo_dispositivo': g.dispositivo['codigo_dispositivo'],
        'metodo_irrigacao': propriedade['metodo_irrigacao'],
        'limite_umidade': propriedade['limite_umidade'],                  # abaixo disto a irrigação LIGA
        'limite_umidade_desliga': propriedade['limite_umidade_desliga'],  # ao chegar aqui ela DESLIGA
        'irrigacao_ligada': g.dispositivo['irrigacao_ligada'],            # o que o servidor tem registrado
    })


def _umidade_recente(dispositivo_id):
    """Última umidade lida há pouco tempo (ou None). Só é usada se o ESP32 não informar a umidade."""
    linha = banco.consultar(
        'SELECT l.valor FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id '
        "WHERE s.dispositivo_id = %s AND s.tipo = 'umidade_solo' "
        '  AND l.hora_leitura >= LOCALTIMESTAMP - make_interval(mins => %s) '
        'ORDER BY l.hora_leitura DESC LIMIT 1', (dispositivo_id, MINUTOS_UMIDADE_RECENTE), um=True)
    return linha['valor'] if linha else None


@bp.put('/dispositivos/<codigo>/irrigacao')
@dispositivo_obrigatorio
def definir_irrigacao(codigo):
    """Corpo ao LIGAR:    {"ligada": true,  "umidade": 17.5}
       Corpo ao DESLIGAR: {"ligada": false, "umidade": 30.0, "agua_utilizada_litros": 180.5}
    "umidade" e "agua_utilizada_litros" são opcionais. É seguro repetir o pedido (Wi-Fi instável):
    ligar com a irrigação já ligada, ou desligar com ela já desligada, não cria nem altera nada."""
    dados = v.corpo_json()
    ligada = dados.get('ligada')
    if not isinstance(ligada, bool):
        raise ErroApi('Informe "ligada" como true ou false.', 400, 'ligada')
    umidade = v.numero(dados, 'umidade', 'umidade', 0, 100, obrigatorio=False)
    dispositivo = g.dispositivo
    aberto = banco.consultar(
        'SELECT ' + COLUNAS_EVENTO + ' FROM eventos_irrigacao WHERE dispositivo_id = %s AND encerrado_em IS NULL',
        (dispositivo['id'],), um=True)

    # ------------------------------------------------------------ LIGAR
    if ligada:
        if aberto:
            return jsonify({'mensagem': 'A irrigação já estava ligada.', 'evento': aberto})
        if umidade is None:
            umidade = _umidade_recente(dispositivo['id'])
        try:
            evento = banco.executar(
                'INSERT INTO eventos_irrigacao (dispositivo_id, iniciado_em, umidade_antes) '
                'VALUES (%s, LOCALTIMESTAMP, %s) RETURNING ' + COLUNAS_EVENTO,
                (dispositivo['id'], umidade), retornar=True)
        except banco.ErroUnicidade:        # dois pedidos ao mesmo tempo
            raise ErroApi('Já existe uma irrigação em andamento para este dispositivo.', 409)
        banco.executar('UPDATE dispositivos SET irrigacao_ligada = TRUE, online = TRUE, ultimo_sinal = LOCALTIMESTAMP '
                       'WHERE id = %s', (dispositivo['id'],))
        return jsonify({'mensagem': 'Início da irrigação registrado.', 'evento': evento}), 201

    # ------------------------------------------------------------ DESLIGAR
    agua_informada = v.numero(dados, 'agua_utilizada_litros', 'água utilizada', 0, 1_000_000, obrigatorio=False)
    banco.executar('UPDATE dispositivos SET irrigacao_ligada = FALSE, online = TRUE, ultimo_sinal = LOCALTIMESTAMP '
                   'WHERE id = %s', (dispositivo['id'],))
    if aberto is None:
        return jsonify({'mensagem': 'Nenhuma irrigação em andamento.', 'evento': None})

    fim = _agora()
    aviso = None
    if agua_informada is not None:
        litros = agua_informada                      # o ESP32 mediu (ex.: contando pulsos do sensor de vazão)
    else:
        pontos = banco.consultar(
            'SELECT l.hora_leitura, l.valor FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id '
            "WHERE s.dispositivo_id = %s AND s.tipo = 'vazao_agua' AND l.hora_leitura BETWEEN %s AND %s "
            'ORDER BY l.hora_leitura', (dispositivo['id'], aberto['iniciado_em'], fim))
        litros = volume_por_vazao([(p['hora_leitura'], p['valor']) for p in pontos])
        if litros is None:
            litros = 0
            aviso = ('Sem leituras de vazão suficientes (mínimo 2) nem volume informado: o consumo ficou '
                     'registrado como 0 L, mas NÃO foi medido.')
    if umidade is None:
        umidade = _umidade_recente(dispositivo['id'])
    minutos = max(0, int(round((fim - aberto['iniciado_em']).total_seconds() / 60)))
    evento = banco.executar(
        'UPDATE eventos_irrigacao SET encerrado_em = %s, duracao_minutos = %s, agua_utilizada_litros = %s, '
        'umidade_depois = %s WHERE id = %s RETURNING ' + COLUNAS_EVENTO,
        (fim, minutos, litros, umidade, aberto['id']), retornar=True)
    resposta = {'mensagem': 'Fim da irrigação registrado.', 'evento': evento}
    if aviso:
        resposta['aviso'] = aviso
    return jsonify(resposta)
