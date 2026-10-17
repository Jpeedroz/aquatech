# AquaTech (AquaSmart)

Sistema de irrigação inteligente: o ESP32 mede umidade do solo, temperatura e vazão, envia os dados para uma API Flask, que grava no PostgreSQL e mostra tudo em um painel web. Liga e desliga a bomba automaticamente.

```
Sensores → ESP32 → Wi-Fi → Flask → PostgreSQL → Painel web
Controle: ESP32 → Relé → Bomba d'água
```

## Tecnologias

* Python 3.13 + Flask 3
* PostgreSQL 16
* Docker Compose
* HTML, CSS e JavaScript puros (sem framework)
* ESP32 (hardware com sensores e relé; o código do microcontrolador não está neste repositório)

**Precisa baixar:** só o **Docker Desktop** (inclui o Docker Compose v2). Python, PostgreSQL e as bibliotecas (Flask, psycopg2-binary, python-dotenv, Gunicorn) já vêm dentro das imagens.
**Opcional:** Node.js 18+ e Playwright (só para os testes do navegador).

## Regras do sistema

* **Liga a bomba:** na medição de umidade abaixo de **18%**.
* **Desliga a bomba:** na medição de umidade igual ou acima de **30%**.
* **Estados do solo** (só visual, nada é gravado no banco):
  * `CRÍTICO`: abaixo de 12% (2/3 do limite de ligar)
  * `SECO`: de 12% até menos de 18%
  * `ADEQUADO`: de 18% até menos de 30%
  * `ÚMIDO`: 30% ou mais
* **Consumo de água** = vazão (L/min) × duração da irrigação.

## Estrutura do projeto

* `frontend/`: telas (login, cadastro, propriedade, Dashboard, Histórico, Irrigações, Consumo, Configurações) e `shared/js` (lógica comum).
* `backend/`: API Flask (`app.py`, `rotas/`), `scripts/` (banco, usuário demo, dispositivo) e `tests/`.
* `database/aquatech_database.sql`: tabelas, views e gatilhos do PostgreSQL.
* `docker-compose.yml`: sobe o PostgreSQL e o sistema.
* `backend/Dockerfile` e `backend/docker-entrypoint.sh`: imagem do sistema; cria as tabelas se faltarem e inicia o servidor.
* `.env.docker.example`: modelo das variáveis (copie para `.env`).

## Funcionamento

O ESP32 consulta os limites da propriedade em `GET /api/dispositivos/<codigo>/configuracao`, aciona o relé da bomba e envia as leituras para `POST /api/dispositivos/<codigo>/leituras` com o cabeçalho `X-Chave-Dispositivo`. A API grava tudo no PostgreSQL e o painel mostra umidade, status da irrigação, temperatura e consumo. No gráfico de umidade, clicar em uma medição mostra o estado do solo naquele horário.

## Como executar

1. Instale o **Docker Desktop** e deixe-o aberto.
2. Baixe o projeto e abra o terminal na pasta raiz (onde está o `docker-compose.yml`).
3. Crie o arquivo de variáveis:

```
cp .env.docker.example .env
```

No Windows (cmd): `copy .env.docker.example .env`

4. Edite o `.env`: troque `DB_PASSWORD` e gere dois segredos diferentes para `SECRET_KEY` e `CHAVE_DISPOSITIVOS`:

```
python -c "import secrets; print(secrets.token_hex(32))"
```

5. Suba tudo (cria o banco, as tabelas e o usuário de demonstração):

```
docker compose up --build
```

6. Confira a API e o banco: http://localhost:5000/api/saude
7. Abra o sistema:
   * Demonstração (dados simulados, sem banco): http://localhost:5000/login/login.html?modo=demo
   * Real (PostgreSQL): http://localhost:5000/login/login.html?modo=api
   * Login: `usuario@exemplo.com` / `123456`
8. Cadastre o ESP32 (depois de cadastrar a propriedade pela tela) e copie a chave exibida:

```
docker compose exec app python scripts/cadastrar_dispositivo.py --email usuario@exemplo.com --codigo ESP32-001
```

9. Ver logs (os e-mails de recuperação de senha aparecem aqui): `docker compose logs -f app`
10. Parar: `docker compose down`. Apagar o banco e recomeçar: `docker compose down -v`

**Problemas comuns:** porta 5000 ocupada (feche o programa que a usa); erro de senha do banco depois de mudar `DB_PASSWORD` (rode `docker compose down -v` e suba de novo); mensagem "defina no arquivo .env" (o `.env` não está na pasta raiz ou está sem os valores).

## Modo demonstração

Dados simulados de 01/08 a 19/10/2026 (13 leituras por dia, das 06h às 18h), gerados no navegador por `frontend/shared/js/demo.js`. O modo demo **nunca** grava no PostgreSQL e o modo API nunca usa dados simulados. O modo é escolhido pelo endereço (`?modo=demo` ou `?modo=api`) e trocar encerra a sessão.

* Conta de demonstração no modo demo: `usuario@exemplo.com` / `123456` (conferida por SHA-256 em `mockData.js`).
* No modo API essa conta não existe até ser criada: `docker compose exec app python scripts/criar_usuario_demo.py` (o Docker já faz isso quando `CRIAR_USUARIO_DEMO=true`). O script é idempotente e grava só o hash da senha.
* **Editar medições de teste:** altere `MOCK_AJUSTES` em `frontend/shared/js/mockData.js` (leituras, eventos de irrigação e eventos removidos). Os exemplos estão comentados no próprio arquivo.
* O dia 19/10/2026 tem duas irrigações (08h e 15h) e o dia 18/10 começa com solo crítico, para mostrar os quatro estados na semana.

## Dados persistidos e simulados

* **Persistidos (PostgreSQL):** usuários (senha com hash), propriedades, dispositivos, sensores, leituras e eventos de irrigação.
* **Simulados (só no modo demo):** leituras, eventos e contas do navegador.
* **Migrations:** esta versão não altera o esquema do banco (`database/aquatech_database.sql`), então não há migration a aplicar.

## Filtros do painel

Hoje, 7 dias, 1 mês e Personalizado, sempre no horário de Fortaleza (UTC-3). Períodos com mais de um dia têm paginação por dia (Consumo, por semana). Dados que ainda não existem nunca são inventados: dias sem registro mostram aviso e o futuro não aparece.

## Testes

```
# Lógica do front (Node 18+)
node --test frontend/tests/logica.test.js frontend/tests/estrutura.test.js

# Back-end com banco simulado (dentro de backend/)
python -m unittest discover -s tests -t .

# Back-end contra PostgreSQL real (dentro de backend/; APAGA as tabelas: use um banco com nome terminando em _teste)
DB_NAME=aquatech_teste python -m unittest tests.test_postgres -v

# Navegador (Playwright + Chromium; nenhum servidor na porta 5000)
node frontend/tests/e2e.js <pasta-das-capturas>
node frontend/tests/e2e_real.js <pasta-das-capturas>
```

## Sem Docker (opcional)

Precisa de Python 3.9+ e PostgreSQL 16 instalados. Dentro de `backend/`:

```
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env                                  # edite DB_PASSWORD, SECRET_KEY e CHAVE_DISPOSITIVOS
python scripts/init_db.py --criar-banco
python scripts/criar_usuario_demo.py
python app.py
```

Abra http://localhost:5000/login/login.html?modo=api. Só o front-end, em modo demo e sem back-end: `cd frontend && python -m http.server 8080`.
