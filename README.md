# AquaSmart / AquaTech

Sistema de irrigação inteligente: **ESP32** (sensores e bomba) → **API Flask** → **PostgreSQL** → **front-end web** (HTML, CSS e JavaScript puro, sem build).

```
Sensores → ESP32 → Wi-Fi → Backend (Flask) → PostgreSQL → Front-end
Controle:  ESP32 → Relé → Bomba d'água
```

Este é o **único README do projeto**. As pastas `backend/`, `frontend/`, `database/` e `esp32/` não têm README próprio.

## Estrutura

| Pasta | Conteúdo |
|---|---|
| `frontend/` | Telas (login, cadastro, propriedade, Dashboard, Histórico, Irrigações, Consumo de água, Configurações) e `shared/js` (lógica compartilhada) |
| `backend/` | API Flask (`app.py`, `rotas/`), scripts (`scripts/`) e testes (`tests/`) |
| `database/` | `aquatech_database.sql` (esquema + dados de exemplo antigos) |
| `esp32/` | Código do ESP32 (Wi-Fi, sensores de umidade, temperatura e vazão, relé da bomba) |

## Tecnologias e versões

| O quê | Versão |
|---|---|
| Python | 3.9 ou mais novo (testado com 3.13) |
| Flask / psycopg2 / python-dotenv | `Flask>=3.0,<4`, `psycopg2-binary>=2.9`, `python-dotenv>=1.0` (ver `backend/requirements.txt`) |
| PostgreSQL | testado com 16 |
| Front-end | HTML/CSS/JS puro; gráficos em SVG escrito à mão (nenhuma biblioteca) |
| Testes do front | Node.js 18+ (testado com 22) e Playwright + Chromium (só para o teste de navegador) |

## Dois modos de dados: demonstração e API

O front-end funciona em dois modos **separados**, que nunca se misturam. Não há botão de modo nas telas: o modo é escolhido pelo endereço (`?modo=demo` ou `?modo=api`, ele fica lembrado) e trocar de modo encerra a sessão.

| | Demonstração (padrão) | API real |
|---|---|---|
| Como ativar | abrir qualquer tela com `?modo=demo` (ou nada, é o padrão) | abrir qualquer tela com `?modo=api` |
| Fonte dos dados | `frontend/shared/js/mockData.js` + `demo.js` (simulados, gerados no navegador) | Flask + PostgreSQL |
| Precisa de back-end? | Não: dá para abrir os arquivos direto ou com qualquer servidor estático | Sim (`python app.py`) |
| Grava no PostgreSQL? | **Nunca** | Sim, é o banco real |
| Login | conta de demonstração (abaixo) ou contas criadas no próprio navegador | usuários do PostgreSQL (senha com hash no banco) |

A escolha fica em `localStorage` (`aquasmart_modo`). No modo API o front fala com `/api` (se aberto pelo Flask, porta 5000) ou com `http://<host>:5000/api`.

### Credenciais de demonstração

- **E-mail:** `usuario@exemplo.com`  **Senha:** `123456`
- **Modo demonstração:** já existe, é a conta com a propriedade "Sítio Boa Vista" e o dispositivo simulado. A senha é conferida pelo SHA-256 guardado em `mockData.js` (o texto `123456` não está no código). **Isto não é a autenticação do backend**: só vale neste navegador.
- **Modo API / PostgreSQL:** o usuário **não existe até você criá-lo**: `python scripts/criar_usuario_demo.py` (dentro de `backend/`). O script é idempotente (rodar de novo não duplica), grava só o **hash** da senha e **não** cria propriedade, dispositivo nem leituras (o banco real não recebe dados simulados). `--redefinir-senha` volta a senha para `123456`.
- São credenciais **só de desenvolvimento/demonstração**. Em produção, não rode o script (ou apague o usuário).

## Como rodar

### Só o front-end, em modo demonstração (sem back-end)

```bash
cd frontend
python -m http.server 8080        # qualquer servidor estático serve
```
Abra `http://localhost:8080/login/login.html` e entre com `usuario@exemplo.com` / `123456`.

### Sistema completo (Flask + PostgreSQL)

Dentro da pasta `backend`:

1. **Ambiente virtual e dependências**
   ```powershell
   python -m venv venv
   venv\Scripts\Activate.ps1          # Linux/Mac: source venv/bin/activate
   pip install -r requirements.txt
   ```
   (Se o PowerShell bloquear: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.)
2. **Configuração**: `copy .env.example .env` (Linux/Mac: `cp`) e edite o `.env`:
   - `DB_PASSWORD` → senha do seu PostgreSQL (e `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` se forem diferentes);
   - `SECRET_KEY` e `CHAVE_DISPOSITIVOS` → dois valores diferentes e longos: `python -c "import secrets; print(secrets.token_hex(32))"`.
   - O `.env` nunca vai para o Git (está no `.gitignore`).
3. **Criar o banco e as tabelas**
   ```powershell
   python scripts/init_db.py --criar-banco
   ```
   O SQL do projeto começa com `DROP TABLE`: se as tabelas já existirem, o script **se recusa** a rodar (só com `--recriar`, que pede confirmação e **apaga tudo**).
4. **Usuários**
   - Usuário de demonstração: `python scripts/criar_usuario_demo.py` (veja acima).
   - Usuário do SQL de exemplo `joao@example.com`: `python scripts/init_db.py --definir-senha-teste` (pede uma senha). Ou apenas cadastre uma conta pela tela.
5. **Iniciar**: `python app.py`
6. **Abrir**: `http://localhost:5000/login/login.html?modo=api`. Conferir API e banco: `http://localhost:5000/api/saude`.

Cadastrar um dispositivo ESP32: `python scripts/cadastrar_dispositivo.py` (veja `--help`). O ESP32 envia leituras para `POST /api/dispositivos/<codigo>/leituras` com o cabeçalho `X-Chave-Dispositivo`.

### Migrations

Nesta versão **não há alteração no esquema do banco**: `database/aquatech_database.sql` é o mesmo do original, então não existe migration para aplicar. (Se um dia houver, ficará em `database/migracoes/`, com instruções aqui.)

## Dados: o que é persistido e o que é simulado

| Dado | Onde fica | Persiste? |
|---|---|---|
| Usuários, propriedades, dispositivos, sensores, leituras, eventos de irrigação, consumo (view `consumo_diario`) — **modo API** | PostgreSQL | Sim (sobrevive a recarregar a página, reiniciar o backend e novo login) |
| Leituras e eventos do **modo demonstração** | gerados na hora a partir de `mockData.js` + `demo.js` | **Não são guardados**: nascem de novo, idênticos (determinísticos, sem `Math.random`), a cada carregamento |
| Contas criadas no modo demonstração | `localStorage` (`aquasmart_mock_v3`) | Só naquele navegador |
| Sessão, modo (demo/API) | `sessionStorage` / `localStorage` | Só no navegador |

Dados do SQL de exemplo (`database/aquatech_database.sql`, seção de dados de teste) são o conjunto **antigo e fixo** (poucas leituras por dia, 07h–14h). Os dados variados de 01/08 a 21/10/2026 existem **somente** no modo demonstração.

### Os dados simulados (modo demonstração)

- **Período:** 01/08/2026 a 21/10/2026, inclusive (82 dias).
- **Medições:** uma por hora, das 06h às 18h (13 por dia) para umidade, temperatura e vazão: no máximo 1.066 por sensor. Alguns dias não têm nenhuma leitura (ESP32 desligado) e alguns têm horas faltando; os 5 últimos dias (17 a 21/10) são completos.
- **Cenário ilustrativo de período seco e quente (fictício; não são medições reais nem previsão do tempo):** máxima diária de ~33 a ~39 °C (manhã ~23–29 °C), quase sem chuva e evaporação alta; só em raros dias nublados e mais frescos a irrigação pode não ser necessária.
- **Irrigação:** em média ~1,7 por dia (1 a 3), nunca contínua. A umidade cai sem irrigação e sobe durante ela (sempre entre 6 e 98%). A irrigação liga abaixo do limite de ligar (18%) e desliga ao atingir o de desligar (30%). Início, fim, duração, vazão e quantidade por dia variam. **Volume = vazão × duração.** A vazão da bomba vem da área da propriedade (Sítio Boa Vista: 2 ha → 3,2 L/min) e cresce com a **raiz** da área: uma área maior gasta mais água no total, mas não de forma linear. Cultura, método e limites de umidade (18% / 30%) são os da própria propriedade; não há outros parâmetros agronômicos. Se nenhuma leitura de vazão caiu dentro do evento, o volume é marcado como **estimado**.
- **Uma fonte só:** Dashboard, Histórico, Irrigações e Consumo leem a mesma série; o consumo de um dia é a soma dos eventos que **começaram** naquele dia.
- **Data de referência da apresentação (21/10/2026):** definida em um único lugar, `MOCK_DATA_REFERENCIA` em `mockData.js`. No modo demonstração, "hoje" é 21/10/2026 mesmo que o computador tenha outra data (o relógio do computador não é alterado e o modo API nunca usa isso). Hoje = 21/10; 7 dias = 15/10 a 21/10; 1 mês = 22/09 a 21/10; calendários, rótulos, paginação e indicadores usam a mesma referência. Todo o dia 21/10 (13 leituras, 06h–18h) já está disponível. Com `MOCK_DATA_REFERENCIA = null` volta a valer a data real: só aparece o que já aconteceu e uma irrigação em andamento aparece **em andamento**, com volume 0.
- **"Online" no demo:** a última leitura é a da medição programada mais recente (o ESP32 só mede das 06h às 18h).

### Como editar o mock para adicionar ou modificar medições de teste

Abra `frontend/shared/js/mockData.js` e edite o bloco **`MOCK_AJUSTES`** (no topo). Salve e recarregue a página: a mudança aparece em **todas** as telas, porque todas leem esta mesma fonte (nada fica em cache no navegador).

```js
const MOCK_AJUSTES = {
  leituras: [   // troca/cria a leitura DAQUELE horário (só os campos informados)
    { hora: '2026-10-16T10:00', umidade: 27.4, temperatura: 30.8, vazao: 0 },
  ],
  eventos: [    // cria uma irrigação; volume = vazao_lmin × duração
    { inicio: '2026-10-16T14:00', fim: '2026-10-16T14:40', vazao_lmin: 3.5 },
  ],
  remover_eventos: [ '2026-10-12T09:07:00' ]   // apaga um evento gerado, pelo início exato
};
```

Limites: umidade 0–100, temperatura -40–85, vazão ≥ 0. Valor inválido mostra uma mensagem clara na tela. A data de "hoje" do demo é `MOCK_DATA_REFERENCIA` (ver acima). **Não existe tela, formulário ou endpoint para inserir leituras manualmente.**

## Filtros, paginação e calendários (todas as telas de dados)

- **Fuso:** sempre `America/Fortaleza` (`shared/js/tempo.js`); o fuso do navegador nunca é usado.
- **Filtros:** Hoje; 7 dias (hoje + 6 anteriores); 1 mês (30 dias corridos, incluindo hoje); Personalizado (datas validadas: sem futuro, sem inverter, no máximo 366 dias, só dias com dados). Cartões marcados "fixo" ou "agora" não mudam com o filtro.
- **Posição na tela:** filtros no canto superior direito da caixa principal, ao lado do título (Dashboard, Histórico e Consumo de água), ou acima dos indicadores (Irrigações; não há botão Atualizar) → indicadores → caixa principal (gráfico, tabela ou lista do dia) → paginação centralizada **fora e abaixo** da caixa. Em Consumo de água, o filtro continua no cartão do gráfico e a paginação fica abaixo de Maior/Menor/Média.
- **Paginação diária (a única):** `← Anterior · Dia 7 de 7 — 21/10/2026 · Próximo →`, só quando o período tem mais de 1 dia (oculta em Hoje), começando no dia mais recente com dados, desabilitada nos limites e reiniciada ao trocar o filtro. Não recarrega a página. Cada tela mostra gráfico/tabela/lista de **um dia**; os indicadores usam o **período inteiro**. Não existe paginação por linhas.
- **Calendários por fonte:** Dashboard e Histórico = dias com leituras; Irrigações = dias com eventos; Consumo = dias com consumo. Dias sem registro e dias futuros ficam desabilitados.
- **Gráfico de umidade (Dashboard):** eixo de 06h a 18h com rótulos de 2 em 2 horas (06, 08, …, 18); os 13 pontos horários ligados; tooltip em todos os pontos (mouse e teclado: setas, Home, End, Esc) com data/hora, umidade, temperatura e estado da irrigação; linhas tracejadas dos limites de irrigação e faixas verdes de irrigação ativa.
- **Gráfico de consumo:** barras proporcionais ao volume, escala adaptável, tooltip em litros; maior, menor e média consideram o **período todo**. Média diária = total ÷ dias **com** consumo.

## Auditoria do PostgreSQL e da persistência

Resultado verificado nesta versão (testes em `backend/tests/test_postgres.py`, contra PostgreSQL 16):

- **Persistido no PostgreSQL:** usuários (senha só como hash), propriedades, dispositivos, sensores, leituras, eventos de irrigação e consumo (view `consumo_diario`). Cadastro, login, leituras do ESP32 e eventos sobrevivem a recarregar, reiniciar o backend e novo login.
- **Não persistido (somente front-end):** tudo do modo demonstração (leituras, eventos, contas do demo), a sessão e a escolha de modo.
- **Esquema:** nenhuma alteração foi necessária. A coluna `leituras_sensores.teste` e a migration `001`, que existiram numa versão intermediária, foram **removidas** (a inserção manual de leituras não faz parte dos requisitos).
- **Campos da interface × colunas:** todo campo exibido nas telas tem coluna e rota no backend (inclusive `telefone` e `limite_umidade_desliga`). O que existe só no front-end é a conta de demonstração com senha (`aquasmart_mock_v3`), que vive apenas no navegador.
- **Integridade:** os testes conferem ausência de órfãos (propriedade sem usuário, dispositivo sem propriedade, sensor sem dispositivo, leitura sem sensor, evento sem dispositivo), umidade entre 0 e 100, evento com fim depois do início e a existência das chaves estrangeiras.
- **Separação mock × real:** o modo demonstração não faz nenhuma requisição ao servidor e o modo API não lê `mockData.js`; o teste de navegador confirma que trocar o modo pelo endereço encerra a sessão.

## Testes

```bash
# 1) Lógica do front (Node, sem navegador)
node --test frontend/tests/logica.test.js frontend/tests/estrutura.test.js

# 2) Backend com banco simulado (sem PostgreSQL)  — dentro de backend/
python -m unittest discover -s tests -t .

# 3) Backend contra PostgreSQL REAL — dentro de backend/ (APAGA e recria as tabelas: use um banco só de testes, nome terminando em _teste)
DB_NAME=aquatech_teste python -m unittest tests.test_postgres -v        # PowerShell: $env:DB_NAME="aquatech_teste"; ...

# 4) Navegador (Chromium + Playwright), modo demonstração, relógio do computador fixo em 16/10/2026 14:05 (o demo deve mostrar 21/10 mesmo assim)
npm install playwright        # uma vez, em qualquer pasta; depois use NODE_PATH apontando para a node_modules
NODE_PATH=<node_modules> CHROMIUM=<caminho do chrome, opcional> node frontend/tests/e2e.js <pasta-das-capturas>
```

O teste de navegador roda o Chromium com fuso do Japão de propósito, para provar que as telas usam Fortaleza. Ele espera **nenhum servidor na porta 5000** (o teste do modo API depende disso).

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "Configuração incompleta" ao iniciar | Troque `SECRET_KEY` e `CHAVE_DISPOSITIVOS` no `.env` |
| "Não foi possível conectar ao PostgreSQL" | PostgreSQL ligado? Os `DB_*` do `.env` estão certos? |
| "Não foi possível conectar ao servidor" na tela | Está em `?modo=api` e o `python app.py` não está rodando (ou volte para `?modo=demo`) |
| Login recusado no modo API com `usuario@exemplo.com` | Rode `python scripts/criar_usuario_demo.py` |
| Recuperar senha / trocar e-mail "não envia" | Normal no modo `console`: o link aparece no **terminal** do servidor |

## Limitações conhecidas

- O modo API não foi testado com um ESP32 físico; os testes de PostgreSQL enviam as leituras pela rota do dispositivo.
- O SQL de exemplo continua com o conjunto antigo de dados (não foi regerado a partir do demo).
- O teste de navegador cobre o modo demonstração; o modo API foi validado no navegador manualmente (Flask + PostgreSQL), não por teste automatizado.
