"""
NOME: clima.py
FUNÇÃO: Temperatura atual e previsão de chuva da região da propriedade, consultadas na API
        pública Open-Meteo (https://open-meteo.com): gratuita e sem chave de acesso.
        - A temperatura aparece no Dashboard ("Temperatura em <cidade>").
        - A previsão de chuva vai para o ESP32 na rota /configuracao: com chuva prevista,
          o ESP32 adia a irrigação (a não ser que o solo esteja criticamente seco).
IMPORTANTE: é dado de PREVISÃO METEOROLÓGICA da cidade, não leitura de sensor da propriedade.
            Por isso não é gravado em leituras_sensores.
CACHE: a resposta é guardada por alguns minutos (a API atualiza a cada 15 min). Se a consulta
       falhar (sem internet), a falha também é guardada por pouco tempo, para nenhuma tela
       ficar esperando o tempo limite a cada requisição.
"""
import json
import threading
import time
import urllib.parse
import urllib.request

URL_API = 'https://api.open-meteo.com/v1/forecast'
TEMPO_LIMITE_S = 4
CACHE_OK_S = 10 * 60
CACHE_FALHA_S = 2 * 60
HORAS_PREVISAO = 3

_cache = {}
_trava = threading.Lock()


def _buscar(latitude, longitude):
    parametros = urllib.parse.urlencode({
        'latitude': latitude,
        'longitude': longitude,
        'current': 'temperature_2m,precipitation',
        'hourly': 'precipitation,precipitation_probability',
        'forecast_hours': HORAS_PREVISAO,
        'timezone': 'auto',
    })
    with urllib.request.urlopen(f'{URL_API}?{parametros}', timeout=TEMPO_LIMITE_S) as resposta:
        return json.loads(resposta.read().decode('utf-8'))


def interpretar(dados, cfg):
    """Transforma a resposta do Open-Meteo no resumo usado pelo sistema."""
    atual = dados.get('current') or {}
    horas = dados.get('hourly') or {}
    temperatura = atual.get('temperature_2m')
    if temperatura is None:
        raise ValueError('resposta sem temperatura')
    chuva_agora = float(atual.get('precipitation') or 0)
    chuva_proximas = round(sum(float(v or 0) for v in (horas.get('precipitation') or [])), 1)
    probabilidades = [v for v in (horas.get('precipitation_probability') or []) if v is not None]
    probabilidade = max(probabilidades) if probabilidades else None
    chovendo = chuva_agora >= cfg['CLIMA_CHUVA_AGORA_MM']
    chuva_prevista = chovendo or chuva_proximas >= cfg['CLIMA_CHUVA_PREVISTA_MM']
    if chovendo:
        situacao = 'Chovendo agora'
    elif chuva_prevista:
        situacao = f'Chuva prevista nas próximas {HORAS_PREVISAO} horas'
    else:
        situacao = 'Sem chuva prevista'
    return {
        'disponivel': True,
        'local': cfg['CLIMA_LOCAL'],
        'temperatura': round(float(temperatura), 1),
        'chuva_agora_mm': round(chuva_agora, 1),
        'chuva_proximas_horas_mm': chuva_proximas,
        'probabilidade_chuva': probabilidade,
        'horas_previsao': HORAS_PREVISAO,
        'chovendo': chovendo,
        'chuva_prevista': chuva_prevista,
        'situacao': situacao,
        'atualizado_em': atual.get('time'),         # hora local da cidade (timezone=auto)
        'fonte': 'Open-Meteo',
    }


def _indisponivel(cfg, motivo):
    return {
        'disponivel': False, 'local': cfg['CLIMA_LOCAL'], 'temperatura': None,
        'chuva_agora_mm': None, 'chuva_proximas_horas_mm': None, 'probabilidade_chuva': None,
        'horas_previsao': HORAS_PREVISAO, 'chovendo': False, 'chuva_prevista': False,
        'situacao': motivo, 'atualizado_em': None, 'fonte': 'Open-Meteo',
    }


def clima_atual(cfg, buscar=None):
    """Resumo do clima da região configurada. Nunca lança erro: sem dados, devolve disponivel=False
    e chuva_prevista=False (sem previsão, a irrigação segue normal pela umidade do solo)."""
    if not cfg.get('CLIMA_ATIVO', True):
        return _indisponivel(cfg, 'Consulta de clima desativada')
    chave = (cfg['CLIMA_LATITUDE'], cfg['CLIMA_LONGITUDE'])
    agora = time.monotonic()
    with _trava:
        guardado = _cache.get(chave)
        if guardado and guardado[0] > agora:
            return guardado[1]
    try:
        resultado = interpretar((buscar or _buscar)(*chave), cfg)
        validade = CACHE_OK_S
    except Exception:                                   # sem internet, API fora do ar, resposta inesperada
        resultado = _indisponivel(cfg, 'Previsão do tempo indisponível no momento')
        validade = CACHE_FALHA_S
    with _trava:
        _cache[chave] = (agora + validade, resultado)
    return resultado


def limpar_cache():
    with _trava:
        _cache.clear()
