"""
NOME: banco.py
FUNÇÃO: Acesso ao PostgreSQL. Abre UMA conexão por requisição, executa os comandos SQL
        e, no fim da requisição, confirma (commit) se deu certo ou desfaz (rollback) se deu erro.
        As rotas nunca montam SQL com texto do usuário: sempre usam parâmetros (%s).
"""
import logging

from flask import current_app, g

log = logging.getLogger('aquasmart.banco')


class ErroBanco(Exception):
    """Não foi possível falar com o PostgreSQL."""


class ErroUnicidade(Exception):
    """Violou uma restrição UNIQUE (ex.: e-mail já cadastrado)."""


class ErroReferencia(Exception):
    """Violou uma chave estrangeira (ex.: usuário que não existe)."""


def abrir_conexao(cfg):
    """Abre uma conexão nova. Também é usada pelos scripts da pasta scripts/."""
    import psycopg2        # importado aqui para os testes sem banco rodarem mesmo sem a biblioteca
    return psycopg2.connect(
        host=cfg['DB_HOST'], port=cfg['DB_PORT'], dbname=cfg['DB_NAME'],
        user=cfg['DB_USER'], password=cfg['DB_PASSWORD'], connect_timeout=5,
        options='-c timezone=' + cfg['DB_FUSO'],       # o SQL do projeto pede este fuso
    )


def conexao():
    """Conexão da requisição atual (criada na primeira vez que alguém pede)."""
    if 'conexao' not in g:
        try:
            g.conexao = abrir_conexao(current_app.config)
        except Exception as e:
            log.error('Falha ao conectar no PostgreSQL: %s', e)
            raise ErroBanco('Banco de dados indisponível.') from e
    return g.conexao


def _traduzir(e):
    codigo = getattr(e, 'pgcode', None)
    if codigo == '23505':          # unique_violation
        return ErroUnicidade()
    if codigo == '23503':          # foreign_key_violation
        return ErroReferencia()
    return e


def consultar(sql, params=(), um=False):
    """SELECT. Devolve uma lista de dicionários; com um=True devolve só a primeira linha (ou None)."""
    ligacao = conexao()                      # primeiro conecta: falta de biblioteca/banco vira ErroBanco (503)
    from psycopg2.extras import RealDictCursor
    cursor = ligacao.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(sql, params)
        linhas = cursor.fetchall()
    except Exception as e:
        traduzido = _traduzir(e)
        if traduzido is e:
            raise
        raise traduzido from e
    finally:
        cursor.close()
    if um:
        return linhas[0] if linhas else None
    return linhas


def executar(sql, params=(), retornar=False):
    """INSERT/UPDATE/DELETE. Com retornar=True (use RETURNING no SQL) devolve a linha afetada
    como dicionário (ou None); sem retornar, devolve quantas linhas foram afetadas."""
    ligacao = conexao()                      # primeiro conecta: falta de biblioteca/banco vira ErroBanco (503)
    from psycopg2.extras import RealDictCursor
    cursor = ligacao.cursor(cursor_factory=RealDictCursor)
    try:
        cursor.execute(sql, params)
        return cursor.fetchone() if retornar else cursor.rowcount
    except Exception as e:
        traduzido = _traduzir(e)
        if traduzido is e:
            raise
        raise traduzido from e
    finally:
        cursor.close()


def finalizar(confirmar):
    """Fecha a conexão da requisição: commit se confirmar=True, senão rollback."""
    aberta = g.pop('conexao', None)
    if aberta is None:
        return
    try:
        if confirmar:
            aberta.commit()
        else:
            aberta.rollback()
    finally:
        aberta.close()
