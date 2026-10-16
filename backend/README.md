# AquaSmart — como rodar o sistema

Sistema de irrigação inteligente: **front-end** (HTML/CSS/JS) + **API Flask** + **PostgreSQL**.
O Flask serve as telas e a API no mesmo endereço.

## Você precisa ter instalado
- Python 3.9 ou mais novo
- PostgreSQL (ligado)
- VS Code

## Passo a passo

Abra o terminal do VS Code **dentro da pasta `backend`**.

**1. Criar e ativar o ambiente virtual**
```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```
(Linux/Mac: `source venv/bin/activate`.
Se o PowerShell bloquear: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`)

**2. Instalar as dependências**
```powershell
pip install -r requirements.txt
```

**3. Criar o arquivo `.env`**
```powershell
copy .env.example .env
```
Abra o `.env` e troque:
- `DB_PASSWORD` → a senha do seu PostgreSQL
- `SECRET_KEY` e `CHAVE_DISPOSITIVOS` → dois valores diferentes, gerados com:
  ```powershell
  python -c "import secrets; print(secrets.token_hex(32))"
  ```

**4. Criar o banco**
```powershell
python scripts/init_db.py --criar-banco
```
> Atenção: o SQL apaga as tabelas. Se elas já existirem, o script se recusa a rodar (só com `--recriar`).

**5. (Opcional) Senha do usuário de teste `joao@example.com`**
```powershell
python scripts/init_db.py --definir-senha-teste
```
Ou apenas cadastre uma conta nova pela tela.

**6. Iniciar o servidor**
```powershell
python app.py
```

**7. Abrir no navegador**
http://localhost:5000

Para conferir se a API e o banco estão no ar: http://localhost:5000/api/saude

## Problemas comuns
| Mensagem | O que fazer |
|---|---|
| "Configuração incompleta" ao iniciar | Troque `SECRET_KEY` e `CHAVE_DISPOSITIVOS` no `.env` |
| "Não foi possível conectar ao PostgreSQL" | Veja se o PostgreSQL está ligado e se os `DB_*` do `.env` estão certos |
| "Não foi possível conectar ao servidor" na tela | O `python app.py` não está rodando |
| Recuperar senha / trocar e-mail "não envia" | Normal: no modo `console` o link aparece no **terminal** do servidor |

## Testes (opcional)
```powershell
python -m unittest discover -s tests -t .
```
