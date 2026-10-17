"""
NOME: scripts/criar_usuario_demo.py
FUNÇÃO: Cria (uma única vez) o usuário de DEMONSTRAÇÃO no PostgreSQL, com a senha guardada como HASH
        (o mesmo hash do backend; a senha em texto nunca é gravada no banco).
        E-mail: usuario@exemplo.com   Senha: 123456
USO:    python scripts/criar_usuario_demo.py                    (cria se não existir; se já existe, não mexe)
        python scripts/criar_usuario_demo.py --redefinir-senha  (volta a senha do usuário existente para 123456)
Pode ser rodado quantas vezes quiser: nunca cria duplicatas.
ATENÇÃO: credencial só para desenvolvimento/demonstração. Em produção NÃO rode este script
         (ou apague o usuário). Ele não cria propriedade, dispositivo nem leituras: o banco real
         não recebe dados simulados.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config                                        # noqa: E402
from banco import abrir_conexao                      # noqa: E402
from seguranca import gerar_hash_senha               # noqa: E402

EMAIL = 'usuario@exemplo.com'
SENHA = '123456'
NOME = 'Usuário'


def garantir_usuario(cursor, redefinir_senha=False):
    """Devolve 'criado', 'ja_existia' ou 'senha_redefinida'. `cursor` já está dentro de uma transação."""
    cursor.execute('SELECT id FROM usuarios WHERE LOWER(email) = %s', (EMAIL,))
    linha = cursor.fetchone()
    if linha is None:
        cursor.execute('INSERT INTO usuarios (nome, email, senha_hash) VALUES (%s, %s, %s)',
                       (NOME, EMAIL, gerar_hash_senha(SENHA)))
        return 'criado'
    if redefinir_senha:
        cursor.execute('UPDATE usuarios SET senha_hash = %s, senha_alterada_em = LOCALTIMESTAMP WHERE id = %s',
                       (gerar_hash_senha(SENHA), linha[0]))
        return 'senha_redefinida'
    return 'ja_existia'


def main():
    ap = argparse.ArgumentParser(description='Cria o usuário de demonstração do AquaSmart.')
    ap.add_argument('--redefinir-senha', action='store_true')
    args = ap.parse_args()
    try:
        conexao = abrir_conexao(config.carregar_config())
    except Exception as e:
        sys.exit(f'Não foi possível conectar ao PostgreSQL: {e}')
    with conexao, conexao.cursor() as cursor:            # uma transação: ou grava tudo ou nada
        resultado = garantir_usuario(cursor, args.redefinir_senha)
    conexao.close()
    print({'criado': f'Usuário {EMAIL} criado.',
           'ja_existia': f'Usuário {EMAIL} já existia: nada foi alterado.',
           'senha_redefinida': f'Senha de {EMAIL} redefinida.'}[resultado])


if __name__ == '__main__':
    main()
