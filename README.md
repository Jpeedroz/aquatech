# AquaTech

Sistema de irrigação inteligente: o ESP32 mede o solo, a API Flask guarda no PostgreSQL e o painel web mostra tudo.

## Tecnologias

* Python (Flask)
* PostgreSQL
* Docker Compose
* HTML, CSS e JavaScript

**Precisa instalar:** somente o **Docker Desktop**. O resto (Python, PostgreSQL) vem dentro do Docker.

## Regras

* Liga a bomba: umidade abaixo de 18%.
* Desliga a bomba: umidade a partir de 30%.
* Estado do solo: crítico (< 12%), seco (< 18%), adequado (< 30%), úmido (≥ 30%).

## Como executar

1. Instale o Docker Desktop e abra-o (espere aparecer "running").
2. Extraia o ZIP do projeto e abra o terminal dentro da pasta extraída (a que tem o `docker-compose.yml`). Jeito mais fácil: abra a pasta no VS Code (`Arquivo > Abrir Pasta`) e use `Terminal > Novo Terminal`. Ou no Explorador de Arquivos, entre na pasta, clique na barra de endereço, digite `cmd` e tecle Enter.
3. Rode:

```
docker compose up --build
```

4. Espere aparecer `iniciando o servidor na porta 5000` (na primeira vez demora alguns minutos).
5. Abra no navegador:

```
http://localhost:5000/login/login.html?modo=demo
```

6. Entre com `usuario@exemplo.com` e a senha `123456`.

Para parar: `Ctrl+C`. Para apagar o banco e recomeçar: `docker compose down -v`.

## Dois modos

* `?modo=demo`: dados de teste simulados (01/08 a 19/10/2026). Não usa o banco. Use este na apresentação.
* `?modo=api`: dados reais do PostgreSQL. Começa vazio: cadastre a propriedade na tela e os dados chegam do ESP32.

## Trocar a senha do banco (sem perder dados)

O PostgreSQL só lê `DB_PASSWORD` na primeira vez que cria o banco. Com o banco já criado, a senha tem de ser trocada dentro dele e no `.env`. Os dados e o volume `pgdata` não são tocados.

1. Na pasta do projeto, abra o banco (serviço `db`; com `DB_USER` diferente de `postgres`, troque o nome):

```
docker compose exec db psql -U postgres -d aquatech
```

2. Digite `\password postgres`, escreva a senha nova duas vezes (não aparece na tela) e saia com `\q`.
3. Coloque a mesma senha em `DB_PASSWORD=` no arquivo `.env` da raiz (se não existir: `copy .env.docker.example .env`; no Linux/Mac, `cp`). Use só letras e números, sem `$` nem `#`. O `.env` não vai para o GitHub.
4. Reinicie o app, sem apagar nada:

```
docker compose up -d --force-recreate app
```

5. Teste: `docker compose logs app` deve mostrar `iniciando o servidor` e abrir `http://localhost:5000/login/login.html?modo=api` deve funcionar.

Sem `.env`, a senha em uso é a de desenvolvimento do `docker-compose.yml`, que é pública. Faça este passo a passo antes de expor o banco.

## Se der erro

* **Porta 5000 ocupada:** feche o programa que a usa.
* **Erro de senha do banco** (`password authentication failed`): a senha do `.env` não é a que o banco guardou. Veja "Trocar a senha do banco" abaixo. Não use `down -v`, isso apaga os dados.
* **Docker não encontrado:** abra o Docker Desktop e tente de novo.

## Mais detalhes

* Editar dados de teste (modo demo): `MOCK_AJUSTES` em `frontend/shared/js/mockData.js`.
* Dados persistidos no PostgreSQL: usuários, propriedades, dispositivos, leituras e irrigações. Migrations: nenhuma, o esquema (`database/aquatech_database.sql`) não mudou.
* Senhas e segredos: copie `.env.docker.example` para `.env` e edite. Num banco que já existe, mudar `DB_PASSWORD` no `.env` não troca a senha dele; use o passo a passo abaixo.
* Criar o usuário de demonstração no modo real: `docker compose exec app python scripts/criar_usuario_demo.py` (o Docker já faz isso sozinho).
* Cadastrar o ESP32: `docker compose exec app python scripts/cadastrar_dispositivo.py --email usuario@exemplo.com --codigo ESP32-001`.
* Sem Docker: `cd backend`, `pip install -r requirements.txt`, copie `.env.example` para `.env`, `python scripts/init_db.py --criar-banco` e `python app.py` (precisa de Python 3.9+ e PostgreSQL 16).

## Testes

```
node --test frontend/tests/logica.test.js frontend/tests/estrutura.test.js
cd backend && python -m unittest discover -s tests -t .
```

(Testes de navegador: `node frontend/tests/e2e.js` e `e2e_real.js`, com Playwright. Testes no PostgreSQL real: `DB_NAME=aquatech_teste python -m unittest tests.test_postgres`, que apaga as tabelas.)
