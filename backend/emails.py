"""
NOME: emails.py
FUNÇÃO: Envio de e-mails (link de recuperação de senha e confirmação de troca de e-mail).
        EMAIL_MODO=console -> não envia: mostra o e-mail no terminal do servidor (desenvolvimento).
        EMAIL_MODO=smtp    -> envia de verdade pelo servidor SMTP configurado no .env.
"""
import logging
import smtplib
import threading
from email.message import EmailMessage

log = logging.getLogger('aquasmart.email')

CHAVES_EMAIL = ('EMAIL_MODO', 'SMTP_HOST', 'SMTP_PORTA', 'SMTP_USUARIO', 'SMTP_SENHA',
                'SMTP_REMETENTE', 'SMTP_SEGURANCA')


def configuracao_email(cfg):
    """Separa só o que o envio precisa (permite enviar numa thread sem o contexto do Flask)."""
    return {chave: cfg[chave] for chave in CHAVES_EMAIL}


def enviar_email(cfg_email, destino, assunto, corpo):
    """Envia (ou mostra no terminal). Devolve 'smtp' ou 'console'. Lança exceção se o SMTP falhar."""
    if cfg_email['EMAIL_MODO'] != 'smtp':
        print('\n========== E-MAIL (modo desenvolvimento: NADA foi enviado) ==========\n'
              f'Para: {destino}\nAssunto: {assunto}\n\n{corpo}\n'
              '=====================================================================\n', flush=True)
        return 'console'

    mensagem = EmailMessage()
    mensagem['From'] = cfg_email['SMTP_REMETENTE']
    mensagem['To'] = destino
    mensagem['Subject'] = assunto
    mensagem.set_content(corpo)

    if cfg_email['SMTP_SEGURANCA'] == 'ssl':
        servidor = smtplib.SMTP_SSL(cfg_email['SMTP_HOST'], cfg_email['SMTP_PORTA'], timeout=15)
    else:
        servidor = smtplib.SMTP(cfg_email['SMTP_HOST'], cfg_email['SMTP_PORTA'], timeout=15)
    with servidor:
        if cfg_email['SMTP_SEGURANCA'] != 'ssl':
            servidor.starttls()
        if cfg_email['SMTP_USUARIO']:
            servidor.login(cfg_email['SMTP_USUARIO'], cfg_email['SMTP_SENHA'])
        servidor.send_message(mensagem)
    return 'smtp'


def enviar_em_segundo_plano(cfg_email, destino, assunto, corpo):
    """Envia sem fazer o usuário esperar (e sem a resposta demorar mais quando o e-mail existe)."""
    def tarefa():
        try:
            enviar_email(cfg_email, destino, assunto, corpo)
        except Exception:
            log.exception('Falha ao enviar e-mail')

    threading.Thread(target=tarefa, daemon=True).start()
