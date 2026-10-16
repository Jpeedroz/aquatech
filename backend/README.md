# Backend - AquaSmart

API em **Python + Flask** que liga o front-end e o ESP32 ao banco **PostgreSQL**.

```
Front-end (navegador) ──► API Flask ──► PostgreSQL
ESP32 ────────────────► API Flask ──► PostgreSQL
```

O front-end e o ESP32 **nunca** acessam o banco: só falam com a API (HTTP + JSON). O Flask também serve as
telas da pasta `frontend/`, então tela e API ficam no mesmo endereço: `http://localhost:5000`.

## Estrutura

```
backend/
├── app.py              cria o Flask, registra as rotas, serve o front-end, commit/rollback por requisição
├── config.py           lê o .env
├── banco.py            conexão e comandos SQL (sempre com parâmetros %s)
├── seguranca.py        hash de senha, sessão, tokens, chave do ESP32, limite de tentativas
├── validacoes.py       validação dos dados recebidos
├── regras.py           cálculo do volume de água pela vazão
├── emails.py           envio de e-mail (console ou SMTP)
├── erros.py            erro padrão da API: {"mensagem": "...", "campo": "..."}
├── rotas/              autenticacao.py · conta.py · painel.py · dispositivo.py
├── scripts/            init_db.py · cadastrar_dispositivo.py
├── tests/              testes automáticos
├── requisicoes.http    exemplos de requisições (extensão REST Client do VS Code)
├── requirements.txt    Flask, psycopg2-binary, python-dotenv
└── .env.example        modelo das configurações
```

## Como executar (VS Code)

Pré-requisitos: **Python 3.9+** e **PostgreSQL** instalados e ligados (Windows: instalador oficial, que inclui o pgAdmin).

1. **Ambiente virtual** (terminal do VS Code, dentro da pasta `backend`):
   ```powershell
   python -m venv venv
   venv\Scripts\Activate.ps1          # Linux/Mac: source venv/bin/activate
   ```
   Se o PowerShell bloquear: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Depois, no VS Code, escolha o
   interpretador `venv` (Ctrl+Shift+P → *Python: Select Interpreter*).
2. **Dependências:** `pip install -r requirements.txt`
3. **Configuração:** `copy .env.example .env` (Linux/Mac: `cp`) e edite o `.env`:
   - `DB_PASSWORD` = senha do seu usuário do PostgreSQL;
   - `SECRET_KEY` e `CHAVE_DISPOSITIVOS` = dois valores diferentes, gerados com
     `python -c "import secrets; print(secrets.token_hex(32))"`.
   O servidor **não inicia** se esses segredos continuarem com o texto de exemplo.
4. **Banco:** `python scripts/init_db.py --criar-banco`
   Cria o banco (se faltar) e executa `database/aquatech_database.sql`, que inclui **dados de teste** (usuário
   `joao@example.com`, propriedade, ESP32-001 e 30 dias de leituras/irrigações).
   > O SQL começa com `DROP TABLE`. Por isso o script **recusa** rodar se as tabelas já existirem; só `--recriar`
   > (com confirmação) apaga tudo.
5. **Senha do usuário de teste (opcional):** `python scripts/init_db.py --definir-senha-teste`
   (o SQL traz um hash de mentira; sem isto não dá para entrar como `joao@example.com`). Ou simplesmente cadastre
   uma conta nova pela tela.
6. **Iniciar:** `python app.py`
7. **Abrir:** http://localhost:5000 (vai para o login). Confira a API em http://localhost:5000/api/saude.

Se abrir o front-end pelo **Live Server** (porta 5500), também funciona (`CORS_ORIGENS` no `.env` e a detecção em
`frontend/shared/js/api.js`), mas use `localhost` nos dois lados, nunca um com `localhost` e outro com `127.0.0.1`.

### Testes
```
python -m unittest discover -s tests -t .
```
- `test_unidades.py` e `test_rotas.py` **não precisam de PostgreSQL** (usam um banco falso: validam rotas,
  segurança e formato do JSON, mas **não** o SQL).
- `test_postgres.py` valida o SQL de verdade e só roda com um banco **exclusivo de testes** (nome terminando em
  `_teste`, pois ele apaga e recria as tabelas):
  `python scripts/init_db.py --criar-banco` com `DB_NAME=aquatech_teste`, depois
  `$env:DB_NAME="aquatech_teste"; python -m unittest tests.test_postgres -v`.

## Segurança em resumo
- **Senha:** só o hash (PBKDF2-SHA256) vai para o banco. Mínimo 6 caracteres (regra dos formulários).
- **Login:** cookie de sessão assinado, `HttpOnly`, `SameSite=Lax`, 8 h. A sessão guarda o id do usuário e a
  "versão da senha"; ao trocar a senha, as outras sessões deixam de valer (`usuarios.senha_alterada_em`).
- **Acesso aos dados:** nenhuma rota recebe id de usuário/propriedade; tudo parte do usuário da sessão.
- **Cadastro em 2 etapas:** a etapa 1 devolve um token assinado (1 h) que a etapa 2 exige; o `usuario_id` enviado
  pelo front é ignorado.
- **Links de e-mail** (recuperar senha / trocar e-mail): token aleatório, guardado só como hash, uso único, 30 min.
- **Tentativas:** 5 falhas de login em 15 min (por IP + e-mail) bloqueiam temporariamente (em memória; zera ao
  reiniciar).
- **Erros:** o usuário recebe mensagem genérica; o detalhe técnico fica só no log do servidor.
- **ESP32:** veja abaixo.

## Como o ESP32 se autentica
Cada ESP32 tem uma **chave** = `HMAC-SHA256(CHAVE_DISPOSITIVOS, código do dispositivo)`. Ela não fica no banco:
o servidor refaz a conta a cada requisição e compara. O ESP32 envia o código na URL e a chave no cabeçalho:

```
POST /api/dispositivos/ESP32-001/leituras
X-Chave-Dispositivo: <chave>
Content-Type: application/json
```
1. Cadastre o aparelho: `python scripts/cadastrar_dispositivo.py --email dono@exemplo.com --codigo ESP32-001`
   (cria o dispositivo e os 3 sensores e **mostra a chave**).
2. Grave a chave no firmware (fora do GitHub).
Cada aparelho só vale para o **seu** código. Para invalidar uma chave sozinha é preciso trocar o código do
dispositivo; trocar `CHAVE_DISPOSITIVOS` invalida todas. Em rede real use **HTTPS**, pois em HTTP a chave
trafega sem criptografia.

## Endpoints
Erros têm sempre o formato `{"mensagem": "texto", "campo": "email"}` (`campo` é opcional).
Datas das telas: `AAAA-MM-DD`. Horários nas respostas: `AAAA-MM-DDTHH:MM:SS` (horário de Fortaleza, sem fuso).

### Acesso (públicos)
| Método e rota | Corpo / parâmetros | Resposta |
|---|---|---|
| `POST /api/usuarios` | `nome, email, telefone, senha` | `201 {usuario_id, propriedade_id: null, nome, email, token}`; `409` e-mail já cadastrado |
| `POST /api/login` | `email, senha` | `200 {usuario_id, propriedade_id, nome, email}` e cookie de sessão. Se a propriedade ainda não foi cadastrada: `propriedade_id: null` + `token` (sem sessão). `401` (campo `email` se a conta não existe), `429` |
| `POST /api/logout` | `{}` | `200` |
| `POST /api/propriedades` | `token_cadastro, nome, localizacao, area_hectares, cultura, metodo_irrigacao` | `201` propriedade; `403` token inválido; `409` já possui |
| `POST /api/recuperar-senha` | `email` | `200` sempre a mesma mensagem |
| `GET /api/redefinir-senha/verificar?token=` | | `{valido: true/false}` |
| `POST /api/redefinir-senha` | `token, nova_senha` | `200`; `400` link inválido/expirado |

### Conta e propriedade (exigem login)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /api/usuario` | | `{id, nome, email, telefone}` |
| `PUT /api/usuario` | `nome, telefone` | dados atualizados |
| `PUT /api/usuario/senha` | `senha_atual, nova_senha` | `200`; `400` (campo `senha_atual`) se a atual estiver errada |
| `POST /api/usuario/email` | `novo_email, senha_atual` | `200` mensagem; o e-mail só muda após clicar no link enviado |
| `GET /api/usuario/email/confirmar?token=` | | página HTML de confirmação |
| `GET /api/propriedade` | | `{id, nome, localizacao, area_hectares, cultura, metodo_irrigacao, limite_umidade, limite_umidade_desliga}` |
| `PUT /api/propriedade` | `nome, localizacao, area_hectares, cultura, metodo_irrigacao` | propriedade atualizada |

`metodo_irrigacao`: `"Bomba d'água"` ou `"Gravidade"`.

### Painel (exigem login)
| Método e rota | Resposta |
|---|---|
| `GET /api/dashboard` | `{resumo, leituras_umidade (hoje), eventos (hoje)}`; `resumo` = view `resumo_dashboard` + `online` recalculado (sinal nos últimos 5 min) |
| `GET /api/historico?inicio=&fim=` | `{leituras: [{sensor_id, tipo, valor, hora_leitura}], eventos}` (umidade e temperatura; máx. 20.000 leituras) |
| `GET /api/irrigacoes?inicio=&fim=` | `{eventos: [...]}` |
| `GET /api/consumo?inicio=&fim=` | `{dias: [{propriedade_id, data_consumo, agua_utilizada_litros}]}` (só dias com irrigação) |
| `GET /api/consumo/resumo` | `{hoje, ultimos_7_dias, ultimos_30_dias, total}` em litros |

Período máximo: 366 dias. Sem dados: listas vazias / `null` (nada é inventado).

### ESP32 (cabeçalho `X-Chave-Dispositivo`)
| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /api/dispositivos/<codigo>/leituras` | `umidade_solo` (0–100), `temperatura` (−40 a 85), `vazao_agua` (0–500 L/min), `hora_leitura` opcional (local, sem fuso). Ao menos um campo | `201 {mensagem, hora_leitura, quantidade}` |
| `GET /api/dispositivos/<codigo>/configuracao` | | `{metodo_irrigacao, limite_umidade, limite_umidade_desliga, irrigacao_ligada}` |
| `PUT /api/dispositivos/<codigo>/irrigacao` | ligar: `{"ligada": true, "umidade": 17.5}` · desligar: `{"ligada": false, "umidade": 30, "agua_utilizada_litros": 180.5}` | `{mensagem, evento, aviso?}` |

`PUT .../irrigacao` é **idempotente** (repetir por falha de Wi-Fi não duplica). Início e fim usam a hora do servidor.
Ao desligar, o volume vem de `agua_utilizada_litros` (se o ESP32 medir) ou, senão, da integração das leituras de
vazão entre o início e o fim (regra do trapézio, mínimo 2 leituras). Sem nenhuma das duas, grava 0 L e devolve
`aviso` dizendo que **não foi medido**.

## O que funciona e o que depende de outras partes

**Implementado no backend** (validado pelos testes com banco falso; o SQL precisa do `test_postgres.py` rodando no
seu PostgreSQL): cadastro em 2 etapas, login/logout/sessão, conta, troca de senha, recuperação de senha, troca de
e-mail com confirmação, propriedade, dashboard, histórico, irrigações, consumo, recebimento de leituras e registro
de irrigação pelo ESP32.

**Depende do ESP32 / hardware:** nada aparece de leituras reais, irrigação ou consumo até o firmware enviar dados.
O backend **não liga a bomba**: o ESP32 decide pelos limites de `configuracao` e apenas informa o que fez.
Enquanto isso, o painel de um usuário novo mostra "Sem leituras" / "Sem dispositivo". Os dados do usuário
`joao@example.com` são **de teste** (vêm do SQL), não de sensores físicos.

**Limitações conhecidas**
- **E-mail:** com `EMAIL_MODO=console` nada é enviado; o link aparece no terminal do servidor. O modo `smtp` está
  implementado, mas não foi testado contra um servidor real.
- Uma propriedade por usuário e um dispositivo exibido no painel (como o banco e as telas foram desenhados).
- Os limites de umidade (liga/desliga) não têm tela de edição: ficam como no banco (18% / 30%).
- O banco não tem coluna para marcar "dados de teste" nem para consumo "não medido": uma irrigação sem medição
  fica com 0 L (a API avisa ao ESP32, mas a tela mostra 0 L). Uma irrigação em andamento mostra 0 L até terminar.
- O dashboard mostra a última leitura existente, mesmo que antiga; `online` indica se o dispositivo está com sinal.
- Intervalo de envio sugerido ao ESP32: a cada 5 min ou mais (o histórico de 1 mês tem limite de 20.000 leituras).
- Limite de tentativas em memória (um processo). Para produção: servidor WSGI (gunicorn/waitress), HTTPS e
  `COOKIE_SEGURO=true`.
