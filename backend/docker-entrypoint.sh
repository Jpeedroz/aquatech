#!/bin/sh
# Roda dentro do contêiner "app": prepara o banco (sem nunca apagar dados) e inicia o servidor.
set -e
echo "[aquasmart] aguardando o PostgreSQL e criando as tabelas se faltarem..."
python scripts/init_db.py --se-faltar
if [ "${CRIAR_USUARIO_DEMO:-true}" = "true" ]; then
  python scripts/criar_usuario_demo.py
fi
echo "[aquasmart] iniciando o servidor na porta 5000"
exec gunicorn --bind 0.0.0.0:5000 --workers 2 --access-logfile - "app:create_app()"
