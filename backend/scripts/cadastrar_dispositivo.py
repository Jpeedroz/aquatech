"""
NOME: scripts/cadastrar_dispositivo.py
FUNÇÃO: Cadastra um ESP32 na propriedade de um usuário (dispositivo + 3 sensores) e mostra a CHAVE
        que o ESP32 deve enviar no cabeçalho X-Chave-Dispositivo. Se o dispositivo já existe,
        apenas mostra a chave de novo. A chave não fica no banco: é calculada a partir de
        CHAVE_DISPOSITIVOS (do .env) e do código. Trocar CHAVE_DISPOSITIVOS invalida TODAS as chaves.
USO:    python scripts/cadastrar_dispositivo.py --email usuario@exemplo.com --codigo ESP32-001
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config                                                    # noqa: E402
from banco import abrir_conexao                                  # noqa: E402
from seguranca import gerar_chave_dispositivo                    # noqa: E402

SENSORES = (('umidade_solo', 'Sensor de Umidade', '%'),
            ('temperatura', 'Sensor de Temperatura', '°C'),
            ('vazao_agua', 'Sensor de Vazão', 'L/min'))


def main():
    ap = argparse.ArgumentParser(description='Cadastra um ESP32 na propriedade de um usuário.')
    ap.add_argument('--email', required=True, help='e-mail do dono da propriedade')
    ap.add_argument('--codigo', required=True, help='código do dispositivo (ex.: ESP32-001)')
    ap.add_argument('--nome', default='ESP32 AquaSmart')
    args = ap.parse_args()

    cfg = config.carregar_config()
    config.validar_config(cfg, campos=['CHAVE_DISPOSITIVOS'])
    try:
        conexao = abrir_conexao(cfg)
    except Exception as e:
        sys.exit(f'Não foi possível conectar ao PostgreSQL: {e}')

    with conexao, conexao.cursor() as cursor:
        cursor.execute('SELECT p.id FROM propriedades p JOIN usuarios u ON u.id = p.usuario_id '
                       'WHERE LOWER(u.email) = LOWER(%s)', (args.email,))
        propriedade = cursor.fetchone()
        if propriedade is None:
            sys.exit('Não há propriedade cadastrada para esse e-mail (o usuário precisa concluir o cadastro).')
        cursor.execute('SELECT id, propriedade_id FROM dispositivos WHERE codigo_dispositivo = %s', (args.codigo,))
        existente = cursor.fetchone()
        if existente and existente[1] != propriedade[0]:
            sys.exit('Este código de dispositivo já pertence a outra propriedade.')
        if existente:
            dispositivo_id = existente[0]
            print(f'Dispositivo {args.codigo} já cadastrado.')
        else:
            cursor.execute('INSERT INTO dispositivos (propriedade_id, codigo_dispositivo, nome) '
                           'VALUES (%s, %s, %s) RETURNING id', (propriedade[0], args.codigo, args.nome))
            dispositivo_id = cursor.fetchone()[0]
            print(f'Dispositivo {args.codigo} cadastrado.')
        for tipo, nome, unidade in SENSORES:
            cursor.execute('INSERT INTO sensores (dispositivo_id, tipo, nome, unidade) VALUES (%s, %s, %s, %s) '
                           'ON CONFLICT (dispositivo_id, tipo) DO NOTHING', (dispositivo_id, tipo, nome, unidade))
    conexao.close()

    print('\nCódigo :', args.codigo)
    print('Chave  :', gerar_chave_dispositivo(args.codigo, cfg['CHAVE_DISPOSITIVOS']))
    print('\nO ESP32 envia a chave no cabeçalho  X-Chave-Dispositivo.  Não publique a chave no GitHub.')


if __name__ == '__main__':
    main()
