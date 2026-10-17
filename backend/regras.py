"""
NOME: regras.py
FUNÇÃO: Regras de negócio que não dependem do Flask nem do banco (assim ficam fáceis de testar).
"""


def volume_por_vazao(pontos):
    """Calcula os litros usados numa irrigação a partir das leituras do sensor de vazão.

    pontos: lista de (horário, vazão em L/min) em ordem de horário, só com as leituras
            feitas ENTRE o início e o fim da irrigação.

    Método: para cada par de leituras seguidas, usa a vazão média do intervalo vezes os
    minutos que passaram (regra do trapézio). Não inventa nada fora das leituras reais:
    com menos de 2 leituras NÃO dá para calcular e devolve None.
    """
    if len(pontos) < 2:
        return None
    litros = 0.0
    for (hora1, vazao1), (hora2, vazao2) in zip(pontos, pontos[1:]):
        minutos = (hora2 - hora1).total_seconds() / 60
        litros += (float(vazao1) + float(vazao2)) / 2 * minutos
    return round(litros, 2)
