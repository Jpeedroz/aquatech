"""
NOME: scripts/init_db.py
FUNÇÃO: Prepara o banco PostgreSQL executando database/aquatech_database.sql.
USO:    python scripts/init_db.py                          (banco já existe, ainda sem tabelas)
        python scripts/init_db.py --criar-banco            (cria o banco DB_NAME antes, se faltar)
        python scripts/init_db.py --definir-senha-teste    (define a senha do usuário de teste joao@example.com)
        python scripts/init_db.py --recriar                (APAGA tudo e recria: pede confirmação)
        python scripts/init_db.py --se-faltar              (usado pelo Docker: cria só se ainda não existir; se existir, não faz nada e sai sem erro)
ATENÇÃO: o SQL do projeto começa com DROP TABLE: rodá-lo de novo APAGA todos os dados.
         Por isso o script se recusa a rodar se as tabelas já existirem (a não ser com --recriar).
"""
import argparse
import getpass
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config                                        # noqa: E402
from banco import abrir_conexao                      # noqa: E402
from seguranca import gerar_hash_senha               # noqa: E402

EMAIL_TESTE = 'joao@example.com'


def criar_banco_se_faltar(cfg):
    import psycopg2
    from psycopg2 import sql
    if not re.fullmatch(r'[A-Za-z0-9_]+', cfg['DB_NAME']):
        sys.exit('DB_NAME deve ter apenas letras, números e "_".')
    conexao = abrir_conexao({**cfg, 'DB_NAME': 'postgres'})
    conexao.autocommit = True
    with conexao.cursor() as cursor:
        cursor.execute('SELECT 1 FROM pg_database WHERE datname = %s', (cfg['DB_NAME'],))
        if cursor.fetchone():
            print(f'Banco "{cfg["DB_NAME"]}" já existe.')
        else:
            cursor.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(cfg['DB_NAME'])))
            print(f'Banco "{cfg["DB_NAME"]}" criado.')
    conexao.close()


def pedir_senha_teste():
    senha = getpass.getpass(f'Nova senha para {EMAIL_TESTE} (mínimo 6 caracteres): ')
    if len(senha) < 6 or senha != getpass.getpass('Repita a senha: '):
        sys.exit('Senha muito curta ou diferente da repetição. Nada foi alterado.')
    return senha


def main():
    ap = argparse.ArgumentParser(description='Cria a estrutura do banco do AquaSmart.')
    ap.add_argument('--criar-banco', action='store_true')
    ap.add_argument('--recriar', action='store_true', help='apaga e recria as tabelas')
    ap.add_argument('--definir-senha-teste', action='store_true')
    ap.add_argument('--se-faltar', action='store_true', help='cria a estrutura só se ainda não existir (nunca apaga nada)')
    args = ap.parse_args()

    cfg = config.carregar_config()
    try:
        if args.criar_banco:
            criar_banco_se_faltar(cfg)
        conexao = abrir_conexao(cfg)
    except Exception as e:
        sys.exit(f'Não foi possível conectar ao PostgreSQL: {e}\n'
                 'Confira o PostgreSQL ligado e os valores DB_* do arquivo backend/.env '
                 '(se o banco não existe, use --criar-banco).')

    with conexao, conexao.cursor() as cursor:
        cursor.execute("SELECT to_regclass('public.usuarios')")
        existe = cursor.fetchone()[0] is not None
        if existe and not args.recriar:
            if args.se_faltar:
                print('O banco já tem as tabelas: nada a fazer (dados preservados).')
            elif args.definir_senha_teste:
                print('As tabelas já existem: o SQL não será executado de novo.')
            else:
                sys.exit('As tabelas já existem. Rodar o SQL de novo APAGARIA todos os dados.\n'
                         'Se é isso mesmo que você quer, use --recriar.')
        else:
            if existe:
                if input(f'Isto APAGA todas as tabelas do banco "{cfg["DB_NAME"]}". Digite APAGAR para continuar: ') != 'APAGAR':
                    sys.exit('Cancelado. Nada foi alterado.')
            cursor.execute(config.ARQUIVO_SQL.read_text(encoding='utf-8'))
            print('Estrutura do banco criada (com os dados de teste do arquivo SQL).')

        if args.definir_senha_teste:
            cursor.execute('UPDATE usuarios SET senha_hash = %s, senha_alterada_em = LOCALTIMESTAMP '
                           'WHERE LOWER(email) = %s', (gerar_hash_senha(pedir_senha_teste()), EMAIL_TESTE))
            print('Senha do usuário de teste definida.' if cursor.rowcount else f'Usuário {EMAIL_TESTE} não encontrado.')
    conexao.close()
    print('Pronto.')


if __name__ == '__main__':
    main()
