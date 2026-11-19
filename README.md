# AquaTech

Sistema de irrigação inteligente para monitoramento da umidade do solo, acompanhamento das irrigações e controle do consumo de água.

## Funcionamento

O sistema recebe dados dos sensores, envia as informações para a API e armazena os registros no PostgreSQL. A aplicação web consulta esses dados e apresenta indicadores, gráficos e históricos para acompanhar a umidade do solo e o consumo de água.

**Fluxo do sistema:**

```text
Sensores → ESP32 → Wi-Fi → API → PostgreSQL → Dashboard
```

## Tecnologias

* Python (Flask)
* PostgreSQL
* Docker Compose
* HTML, CSS e JavaScript

## Requisitos

- Git
- Docker Desktop
- Python instalado (para gerar as chaves)

## Regras

* Liga a bomba: umidade abaixo de 18%.
* Desliga a bomba: umidade a partir de 30%.
* Estado do solo: crítico (< 12%), seco (< 18%), adequado (< 30%), úmido (≥ 30%).
* Chuva prevista: com chuva acontecendo ou prevista para as próximas 3 horas, o ESP32 adia a irrigação, a não ser que a umidade caia abaixo de 8%.

## Clima da região

O back-end consulta a API pública [Open-Meteo](https://open-meteo.com) (gratuita, sem chave) e guarda a resposta por 10 minutos:

* **Dashboard:** cartão com a temperatura atual da cidade e a situação de chuva (`GET /api/clima`).
* **ESP32:** a rota `GET /api/dispositivos/<codigo>/configuracao` devolve `chuva_prevista` e `umidade_critica`.
* Considera "chuva prevista" quando há 0,1 mm ou mais de chuva agora, ou 1 mm ou mais somados nas próximas 3 horas.
* É **previsão meteorológica da cidade**, não leitura de sensor da propriedade. Sem internet, o cartão mostra "indisponível" e a irrigação segue normal pela umidade do solo.
* **Demonstração:** com `CLIMA_SIMULAR_CHUVA=true` a chuva é forçada (o dashboard mostra "Chuva simulada" e o ESP32 adia a irrigação). No PowerShell: `$env:CLIMA_SIMULAR_CHUVA="true"; docker compose up -d`. Para voltar: `$env:CLIMA_SIMULAR_CHUVA="false"; docker compose up -d`.
* A cidade é configurada no `.env`: `CLIMA_LOCAL`, `CLIMA_LATITUDE` e `CLIMA_LONGITUDE` (padrão: Juazeiro do Norte - CE).

## Execução:

## 1. Clonar o projeto

```bash
git clone URL_DO_REPOSITORIO
cd NOME_DA_PASTA
```

Substitua `URL_DO_REPOSITORIO` pelo endereço do repositório e `NOME_DA_PASTA` pelo nome da pasta criada.

## 2. Configurar o ambiente

Copie o arquivo de exemplo para criar o `.env`:

```bash
cp .env.docker.example .env
```

Gere uma chave aleatória para `SECRET_KEY`:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Execute o mesmo comando novamente para gerar outra chave para `CHAVE_DISPOSITIVOS`.

Abra o arquivo `.env` e configure as variáveis:

```env
DB_PASSWORD=sua_senha_do_postgresql
DB_NAME=aquatech
DB_USER=postgres
SECRET_KEY=cole_a_primeira_chave
CHAVE_DISPOSITIVOS=cole_a_segunda_chave
```

Substitua os valores de exemplo pelos valores correspondentes ao seu ambiente. A senha deve corresponder à configuração do PostgreSQL.

**Importante:** use chaves diferentes e não envie o arquivo `.env` para o GitHub.

## 3. Iniciar o projeto

```bash
docker compose up -d --build
```

Verifique os serviços:

```bash
docker compose ps
```

Consulte os logs da aplicação:

```bash
docker compose logs -f app
```

Consulte os logs do banco de dados:

```bash
docker compose logs -f db
```

Para sair da visualização dos logs, pressione `Ctrl + C`. Isso não encerra os contêineres.

## 4. Acessar a aplicação

- **API:** http://localhost:5000/api/saude
- **Demonstração:** http://localhost:5000/login/login.html?modo=demo
- **Aplicação com API:** http://localhost:5000/login/login.html?modo=api

## 5. Parar o projeto

```bash
docker compose down
```

Esse comando para e remove os contêineres e a rede do projeto, sem solicitar a exclusão do volume do banco de dados.

## Observações

- O arquivo `.env` deve ficar na raiz do projeto.
- O arquivo `.env.docker.example` é apenas um modelo de configuração.
- Cada pessoa deve configurar seu próprio `.env`.
- Não compartilhe senhas ou chaves secretas.
- Não use `docker compose down -v` se quiser preservar os dados armazenados no volume do banco.
