"""
NOME: tests/test_rotas.py
FUNÇÃO: Testa as rotas da API com um banco FALSO (BancoFalso). Confere validações, login,
        proteção das rotas, formato do JSON e regras do ESP32. NÃO valida o SQL no PostgreSQL.
"""
import logging
import unittest
from datetime import date, datetime
from decimal import Decimal
from unittest import mock

from tests import auxiliar
from tests.auxiliar import criar_ambiente, entrar

import banco
import seguranca
from werkzeug.security import generate_password_hash

HASH = generate_password_hash('segredo1', method='pbkdf2:sha256')
USUARIO_LOGIN = {'id': 1, 'nome': 'João Teste', 'email': 'joao@example.com', 'senha_hash': HASH, 'senha_alterada_em': None}


class Base(unittest.TestCase):
    def setUp(self):
        criar_ambiente(self)
        logging.disable(logging.CRITICAL)
        self.addCleanup(logging.disable, logging.NOTSET)

    def json(self, resposta):
        return resposta.get_json()


class TestLogin(Base):
    def post(self, **corpo):
        return self.cliente.post('/api/login', json=corpo)

    def test_conta_inexistente(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', [])
        r = self.post(email='x@y.com', senha='123456')
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.json(r)['campo'], 'email')

    def test_senha_errada(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', [USUARIO_LOGIN])
        r = self.post(email='joao@example.com', senha='errada1')
        self.assertEqual(r.status_code, 401)
        self.assertNotIn('campo', self.json(r))

    def test_sucesso_cria_sessao_e_libera_rotas(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', [USUARIO_LOGIN])
        self.banco.quando('SELECT id FROM propriedades', [{'id': 5}])
        r = self.post(email='JOAO@example.com', senha='segredo1')
        self.assertEqual(r.status_code, 200)
        corpo = self.json(r)
        self.assertEqual((corpo['usuario_id'], corpo['propriedade_id']), (1, 5))
        self.assertNotIn('token', corpo)
        self.assertNotIn('senha_hash', corpo)
        cookie = r.headers.get('Set-Cookie', '')
        self.assertIn('aquasmart_sessao', cookie)
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.banco.quando('FROM usuarios WHERE id = %s', [{'id': 1, 'nome': 'João', 'email': 'joao@example.com',
                                                           'telefone': None, 'senha_alterada_em': None}])
        self.assertEqual(self.cliente.get('/api/usuario').status_code, 200)

    def test_sem_propriedade_devolve_token_e_nao_cria_sessao(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', [USUARIO_LOGIN])
        self.banco.quando('SELECT id FROM propriedades', [])
        r = self.post(email='joao@example.com', senha='segredo1')
        corpo = self.json(r)
        self.assertIsNone(corpo['propriedade_id'])
        with self.app.app_context():
            self.assertEqual(seguranca.ler_token_cadastro(corpo['token']), 1)
        self.assertNotIn('Set-Cookie', r.headers)
        self.assertEqual(self.cliente.get('/api/usuario').status_code, 401)

    def test_bloqueia_apos_5_falhas(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', [USUARIO_LOGIN])
        for _ in range(5):
            self.assertEqual(self.post(email='joao@example.com', senha='errada1').status_code, 401)
        self.assertEqual(self.post(email='joao@example.com', senha='segredo1').status_code, 429)

    def test_validacao_e_corpo_invalido(self):
        self.assertEqual(self.post(email='sem-arroba', senha='x').status_code, 400)
        self.assertEqual(self.post(email='a@b.com').status_code, 400)
        r = self.cliente.post('/api/login', data='nao e json', content_type='text/plain')
        self.assertEqual(r.status_code, 400)


class TestCadastro(Base):
    CORPO = {'nome': 'Maria', 'email': 'maria@x.com', 'telefone': '88988887777', 'senha': 'senha123'}

    def test_sucesso(self):
        self.banco.quando('INSERT INTO usuarios', {'id': 9, 'nome': 'Maria', 'email': 'maria@x.com'})
        r = self.cliente.post('/api/usuarios', json=self.CORPO)
        self.assertEqual(r.status_code, 201)
        corpo = self.json(r)
        self.assertEqual((corpo['usuario_id'], corpo['propriedade_id']), (9, None))
        sql, params = self.banco.chamadas_com('INSERT INTO usuarios')[0]
        self.assertEqual(params[2], '(88) 98888-7777')
        self.assertNotIn('senha123', params)
        self.assertTrue(params[3].startswith('pbkdf2:sha256'))
        self.assertNotIn('Set-Cookie', r.headers)          # cadastro não faz login

    def test_email_duplicado(self):
        self.banco.quando('INSERT INTO usuarios', banco.ErroUnicidade())
        r = self.cliente.post('/api/usuarios', json=self.CORPO)
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.json(r)['campo'], 'email')
        self.assertEqual(self.banco.finalizacoes[0], False)          # rollback

    def test_validacoes(self):
        for troca in ({'senha': '123'}, {'telefone': ''}, {'nome': ' '}, {'email': 'x'}):
            r = self.cliente.post('/api/usuarios', json={**self.CORPO, **troca})
            self.assertEqual(r.status_code, 400, troca)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])


class TestProtecao(Base):
    def test_rotas_privadas_exigem_login(self):
        rotas = [('get', '/api/usuario'), ('put', '/api/usuario'), ('put', '/api/usuario/senha'),
                 ('post', '/api/usuario/email'), ('get', '/api/propriedade'), ('put', '/api/propriedade'),
                 ('get', '/api/dashboard'), ('get', '/api/historico?inicio=2026-10-01&fim=2026-10-02'),
                 ('get', '/api/irrigacoes?inicio=2026-10-01&fim=2026-10-02'),
                 ('get', '/api/consumo?inicio=2026-10-01&fim=2026-10-02'), ('get', '/api/consumo/resumo')]
        for metodo, caminho in rotas:
            r = getattr(self.cliente, metodo)(caminho, json={})
            self.assertEqual(r.status_code, 401, caminho)

    def test_sessao_invalida_apos_troca_de_senha(self):
        entrar(self, senha_alterada_em=datetime(2026, 10, 15, 8, 0, 0))     # banco mudou; cookie tem versão ''
        r = self.cliente.get('/api/usuario')
        self.assertEqual(r.status_code, 401)

    def test_usuario_vem_da_sessao_e_nao_do_corpo(self):
        entrar(self, usuario_id=1)
        self.banco.quando('UPDATE usuarios SET nome', {'id': 1, 'nome': 'Novo', 'email': 'joao@example.com', 'telefone': None})
        r = self.cliente.put('/api/usuario', json={'nome': 'Novo', 'telefone': '', 'id': 999, 'usuario_id': 999, 'email': 'outro@x.com'})
        self.assertEqual(r.status_code, 200)
        sql, params = self.banco.chamadas_com('UPDATE usuarios SET nome')[0]
        self.assertEqual(params[-1], 1)
        self.assertNotIn('outro@x.com', params)

    def test_logout_encerra_sessao(self):
        entrar(self)
        self.assertEqual(self.cliente.post('/api/logout', json={}).status_code, 200)
        self.assertEqual(self.cliente.get('/api/usuario').status_code, 401)


class TestPropriedade(Base):
    CORPO = {'nome': 'Sítio', 'localizacao': 'Juazeiro', 'area_hectares': 2, 'cultura': 'Cebola',
             'metodo_irrigacao': "Bomba d'água"}

    def token(self, uid):
        with self.app.app_context():
            return seguranca.gerar_token_cadastro(uid)

    def test_cadastro_exige_token_valido_do_mesmo_usuario(self):
        r = self.cliente.post('/api/propriedades', json={**self.CORPO, 'usuario_id': 1, 'token_cadastro': 'lixo'})
        self.assertEqual(r.status_code, 403)
        r = self.cliente.post('/api/propriedades', json={**self.CORPO, 'usuario_id': 2, 'token_cadastro': self.token(1)})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])

    def test_cadastro_ok_e_duplicado(self):
        self.banco.quando('INSERT INTO propriedades', {'id': 3, 'usuario_id': 1, 'nome': 'Sítio'})
        r = self.cliente.post('/api/propriedades', json={**self.CORPO, 'usuario_id': 1, 'token_cadastro': self.token(1)})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.banco.chamadas_com('INSERT INTO propriedades')[0][1][0], 1)
        self.banco.quando('INSERT INTO propriedades', banco.ErroUnicidade())
        r = self.cliente.post('/api/propriedades', json={**self.CORPO, 'token_cadastro': self.token(1)})
        self.assertEqual(r.status_code, 409)

    def test_atualizar_valida_campos(self):
        entrar(self)
        for troca in ({'area_hectares': 0}, {'area_hectares': '2'}, {'metodo_irrigacao': 'Aspersão'}, {'nome': ''}):
            r = self.cliente.put('/api/propriedade', json={**self.CORPO, **troca})
            self.assertEqual(r.status_code, 400, troca)
        self.banco.quando('UPDATE propriedades SET', {'id': 3, 'nome': 'Sítio'})
        self.assertEqual(self.cliente.put('/api/propriedade', json=self.CORPO).status_code, 200)
        self.assertEqual(self.banco.chamadas_com('UPDATE propriedades')[0][1][-1], 1)

    def test_sem_propriedade_404(self):
        entrar(self)
        self.banco.quando('FROM propriedades WHERE usuario_id', [])
        self.assertEqual(self.cliente.get('/api/propriedade').status_code, 404)


class TestSenhaEEmail(Base):
    def test_alterar_senha(self):
        entrar(self)
        self.banco.quando('SELECT senha_hash FROM usuarios', [{'senha_hash': HASH}])
        self.banco.quando('UPDATE usuarios SET senha_hash', {'id': 1, 'nome': 'J', 'email': 'j@x.com',
                                                             'senha_alterada_em': datetime(2026, 10, 15, 10, 0, 0, 5)})
        self.banco.quando('UPDATE tokens_recuperacao_senha', 0)
        r = self.cliente.put('/api/usuario/senha', json={'senha_atual': 'errada1', 'nova_senha': 'novasenha'})
        self.assertEqual((r.status_code, self.json(r)['campo']), (400, 'senha_atual'))      # 400, não 401
        r = self.cliente.put('/api/usuario/senha', json={'senha_atual': 'segredo1', 'nova_senha': 'segredo1'})
        self.assertEqual(r.status_code, 400)
        r = self.cliente.put('/api/usuario/senha', json={'senha_atual': 'segredo1', 'nova_senha': 'novasenha'})
        self.assertEqual(r.status_code, 200)
        params = self.banco.chamadas_com('UPDATE usuarios SET senha_hash')[0][1]
        self.assertTrue(params[0].startswith('pbkdf2:sha256'))
        with self.cliente.session_transaction() as s:             # sessão renovada com a nova versão
            self.assertEqual(s['versao_senha'], '2026-10-15 10:00:00.000005')

    def test_troca_de_email(self):
        entrar(self)
        self.banco.quando('SELECT senha_hash FROM usuarios', [{'senha_hash': HASH}])
        self.banco.quando('SELECT 1 AS ok FROM usuarios', [])
        self.banco.quando('UPDATE solicitacoes_troca_email', 0)
        self.banco.quando('INSERT INTO solicitacoes_troca_email', 1)
        r = self.cliente.post('/api/usuario/email', json={'novo_email': 'joao@example.com', 'senha_atual': 'segredo1'})
        self.assertEqual(r.status_code, 400)                       # mesmo e-mail
        r = self.cliente.post('/api/usuario/email', json={'novo_email': 'novo@x.com', 'senha_atual': 'errada1'})
        self.assertEqual(r.status_code, 400)
        with mock.patch('emails.enviar_email', return_value='console') as envio:
            r = self.cliente.post('/api/usuario/email', json={'novo_email': 'novo@x.com', 'senha_atual': 'segredo1'})
        self.assertEqual(r.status_code, 200)
        self.assertIn('desenvolvimento', self.json(r)['mensagem'])
        link = envio.call_args[0][3]
        token = link.split('token=')[1].split()[0]
        guardado = self.banco.chamadas_com('INSERT INTO solicitacoes_troca_email')[0][1]
        self.assertEqual(guardado[2], seguranca.hash_token(token))     # no banco só o hash
        self.assertNotIn(token, guardado)

    def test_email_em_uso_e_falha_de_envio(self):
        entrar(self)
        self.banco.quando('SELECT senha_hash FROM usuarios', [{'senha_hash': HASH}])
        self.banco.quando('SELECT 1 AS ok FROM usuarios', [{'ok': 1}])
        r = self.cliente.post('/api/usuario/email', json={'novo_email': 'outro@x.com', 'senha_atual': 'segredo1'})
        self.assertEqual(r.status_code, 409)
        self.banco.quando('SELECT 1 AS ok FROM usuarios', [])
        self.banco.quando('UPDATE solicitacoes_troca_email', 0)
        self.banco.quando('INSERT INTO solicitacoes_troca_email', 1)
        with mock.patch('emails.enviar_email', side_effect=OSError('smtp caiu')):
            r = self.cliente.post('/api/usuario/email', json={'novo_email': 'novo@x.com', 'senha_atual': 'segredo1'})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(self.banco.finalizacoes[0], False)          # pedido não fica gravado

    def test_confirmar_troca(self):
        self.banco.quando('UPDATE solicitacoes_troca_email SET confirmado_em', {'usuario_id': 1, 'novo_email': 'novo@x.com'})
        self.banco.quando('UPDATE usuarios SET email', 1)
        r = self.cliente.get('/api/usuario/email/confirmar?token=abc')
        self.assertEqual(r.status_code, 200)
        self.assertIn('text/html', r.content_type)
        self.banco.quando('UPDATE solicitacoes_troca_email SET confirmado_em', None)
        self.assertEqual(self.cliente.get('/api/usuario/email/confirmar?token=abc').status_code, 400)
        self.assertEqual(self.cliente.get('/api/usuario/email/confirmar').status_code, 400)


class TestRecuperacao(Base):
    def test_resposta_igual_existindo_ou_nao_e_token_so_como_hash(self):
        with mock.patch('emails.enviar_em_segundo_plano') as envio:
            self.banco.quando('SELECT id, email FROM usuarios', [])
            r1 = self.cliente.post('/api/recuperar-senha', json={'email': 'nao@existe.com'})
            self.assertFalse(envio.called)
            self.banco.quando('SELECT id, email FROM usuarios', [{'id': 1, 'email': 'joao@example.com'}])
            self.banco.quando('UPDATE tokens_recuperacao_senha', 0)
            self.banco.quando('INSERT INTO tokens_recuperacao_senha', 1)
            r2 = self.cliente.post('/api/recuperar-senha', json={'email': 'joao@example.com'})
        self.assertEqual((r1.status_code, r2.status_code), (200, 200))
        self.assertEqual(self.json(r1), self.json(r2))
        link = envio.call_args[0][3]
        token = link.split('token=')[1].split()[0]
        self.assertIn('/redefinir/redefinir.html?token=', link)
        params = self.banco.chamadas_com('INSERT INTO tokens_recuperacao_senha')[0][1]
        self.assertEqual(params[1], seguranca.hash_token(token))
        self.assertNotIn(token, params)

    def test_limite_de_pedidos(self):
        self.banco.quando('SELECT id, email FROM usuarios', [])
        with mock.patch('emails.enviar_em_segundo_plano'):
            codigos = [self.cliente.post('/api/recuperar-senha', json={'email': 'a@b.com'}).status_code for _ in range(4)]
        self.assertEqual(codigos, [200, 200, 200, 429])

    def test_verificar_e_redefinir(self):
        self.banco.quando('SELECT 1 AS ok FROM tokens_recuperacao_senha', [])
        self.assertFalse(self.json(self.cliente.get('/api/redefinir-senha/verificar?token=x'))['valido'])
        self.assertFalse(self.json(self.cliente.get('/api/redefinir-senha/verificar'))['valido'])
        self.banco.quando('SELECT 1 AS ok FROM tokens_recuperacao_senha', [{'ok': 1}])
        self.assertTrue(self.json(self.cliente.get('/api/redefinir-senha/verificar?token=x'))['valido'])

        self.banco.quando('UPDATE tokens_recuperacao_senha SET usado_em', None)
        r = self.cliente.post('/api/redefinir-senha', json={'token': 'x', 'nova_senha': 'novasenha'})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.cliente.post('/api/redefinir-senha', json={'token': 'x', 'nova_senha': '123'}).status_code, 400)
        self.banco.quando('UPDATE tokens_recuperacao_senha SET usado_em', {'usuario_id': 4})
        self.banco.quando('UPDATE usuarios SET senha_hash', 1)
        r = self.cliente.post('/api/redefinir-senha', json={'token': 'x', 'nova_senha': 'novasenha'})
        self.assertEqual(r.status_code, 200)
        params = self.banco.chamadas_com('UPDATE usuarios SET senha_hash')[0][1]
        self.assertEqual(params[1], 4)
        self.assertNotIn('novasenha', params)


class TestPainel(Base):
    def test_dashboard_formato_json(self):
        entrar(self)
        self.banco.quando('SELECT CURRENT_DATE', [{'hoje': date(2026, 10, 15)}])
        self.banco.quando('FROM resumo_dashboard', [{
            'usuario_id': 1, 'nome_usuario': 'João', 'propriedade_id': 1, 'nome_propriedade': 'Sítio', 'cultura': 'Cebola',
            'limite_umidade': Decimal('18.00'), 'limite_umidade_desliga': Decimal('30.00'), 'dispositivo_id': 1,
            'online': True, 'irrigacao_ligada': False, 'ultimo_sinal': datetime(2026, 10, 15, 14, 0, 0),
            'umidade_atual': Decimal('9.00'), 'temperatura_atual': Decimal('28.00'), 'vazao_atual': None,
            'consumo_agua_hoje': Decimal('270.00'), 'conectado': False}])
        self.banco.quando('FROM leituras_sensores', [{'sensor_id': 1, 'tipo': 'umidade_solo', 'valor': Decimal('25.00'),
                                                       'hora_leitura': datetime(2026, 10, 15, 7, 0, 0)}])
        self.banco.quando('FROM eventos_irrigacao', [{'id': 1, 'iniciado_em': datetime(2026, 10, 15, 9, 0),
                                                       'encerrado_em': None, 'agua_utilizada_litros': Decimal('0')}])
        r = self.cliente.get('/api/dashboard')
        self.assertEqual(r.status_code, 200)
        c = self.json(r)
        # a leitura ATUAL vem da última medição já registrada (<= agora), não do valor guardado na view (9,0)
        self.assertEqual(c['resumo']['umidade_atual'], 25.0)
        self.assertIsNone(c['resumo']['temperatura_atual'])               # sem medição de temperatura registrada: nulo, não inventado
        self.assertIsInstance(c['resumo']['umidade_atual'], float)        # número, não texto
        self.assertIs(c['resumo']['online'], False)
        self.assertNotIn('conectado', c['resumo'])
        self.assertEqual(c['leituras_umidade'][0]['hora_leitura'], '2026-10-15T07:00:00')
        self.assertIsNone(c['eventos'][0]['encerrado_em'])

    def test_dashboard_usuario_sem_propriedade_nem_dispositivo(self):
        entrar(self)
        self.banco.quando('SELECT CURRENT_DATE', [{'hoje': date(2026, 10, 15)}])
        self.banco.quando('FROM resumo_dashboard', [{'usuario_id': 1, 'nome_usuario': 'João', 'propriedade_id': None,
                                                      'dispositivo_id': None, 'online': None, 'conectado': None}])
        self.banco.quando('FROM leituras_sensores', [])
        self.banco.quando('FROM eventos_irrigacao', [])
        c = self.json(self.cliente.get('/api/dashboard'))
        self.assertIsNone(c['resumo']['propriedade_id'])
        self.assertIsNone(c['resumo']['online'])
        self.assertEqual((c['leituras_umidade'], c['eventos']), ([], []))

    def test_historico_periodo_e_limite(self):
        entrar(self)
        self.assertEqual(self.cliente.get('/api/historico?inicio=2026-10-15&fim=2026-10-01').status_code, 400)
        self.assertEqual(self.cliente.get('/api/historico').status_code, 400)
        self.banco.quando('FROM leituras_sensores', [{'sensor_id': 1}] * 20001)
        r = self.cliente.get('/api/historico?inicio=2026-10-01&fim=2026-10-02')
        self.assertEqual(r.status_code, 400)
        self.banco.quando('FROM leituras_sensores', [{'sensor_id': 1, 'tipo': 'temperatura', 'valor': Decimal('28'),
                                                       'hora_leitura': datetime(2026, 10, 1, 7)}])
        self.banco.quando('FROM eventos_irrigacao', [])
        r = self.cliente.get('/api/historico?inicio=2026-10-01&fim=2026-10-02')
        self.assertEqual(self.json(r)['leituras'][0]['valor'], 28.0)
        sql, params = self.banco.chamadas_com('FROM leituras_sensores')[-1]
        self.assertEqual(params[0], 1)
        self.assertEqual(params[1], ['umidade_solo', 'temperatura', 'vazao_agua'])   # vazão acompanha (consumo acumulado)

    def test_consumo(self):
        entrar(self)
        self.banco.quando('FROM consumo_diario', [{'propriedade_id': 1, 'data_consumo': date(2026, 10, 15),
                                                    'agua_utilizada_litros': Decimal('270.00')}])
        c = self.json(self.cliente.get('/api/consumo?inicio=2026-10-15&fim=2026-10-15'))
        self.assertEqual(c['dias'], [{'propriedade_id': 1, 'data_consumo': '2026-10-15', 'agua_utilizada_litros': 270.0}])
        self.banco.quando('SUM(c.agua_utilizada_litros) FILTER', [{'hoje': Decimal('270'), 'ultimos_7_dias': Decimal('1260'),
                                                                    'ultimos_30_dias': Decimal('3000'), 'total': Decimal('3000')}])
        r = self.json(self.cliente.get('/api/consumo/resumo'))
        self.assertEqual((r['hoje'], r['ultimos_7_dias']), (270.0, 1260.0))
        self.banco.quando('FROM eventos_irrigacao', [])
        self.assertEqual(self.json(self.cliente.get('/api/irrigacoes?inicio=2026-10-15&fim=2026-10-15')), {'eventos': []})


class TestPainelNovo(Base):
    """Rotas de apoio às telas: dias com dados (calendários), hora da leitura atual e vazão no histórico."""

    def test_dashboard_traz_hora_da_umidade_atual(self):
        entrar(self)
        self.banco.quando('SELECT CURRENT_DATE', [{'hoje': date(2026, 10, 15)}])
        self.banco.quando('FROM resumo_dashboard', [{'usuario_id': 1, 'propriedade_id': 1, 'dispositivo_id': 1, 'online': True,
                                                      'conectado': True, 'umidade_atual': Decimal('22.5')}])
        self.banco.quando('FROM eventos_irrigacao', [])
        self.banco.quando('FROM leituras_sensores', [{'sensor_id': 1, 'tipo': 'umidade_solo', 'valor': Decimal('22.5'),
                                                       'hora_leitura': datetime(2026, 10, 15, 14, 30)}])
        r = self.json(self.cliente.get('/api/dashboard'))['resumo']
        self.assertEqual(r['hora_umidade_atual'], '2026-10-15T14:30:00')
        self.assertNotIn('leitura_de_teste', r)

    def test_historico_inclui_vazao(self):
        entrar(self)
        self.banco.quando('FROM leituras_sensores', [{'sensor_id': 3, 'tipo': 'vazao_agua', 'valor': Decimal('3.2'),
                                                       'hora_leitura': datetime(2026, 10, 1, 9, 0)}])
        self.banco.quando('FROM eventos_irrigacao', [])
        r = self.json(self.cliente.get('/api/historico?inicio=2026-10-01&fim=2026-10-01'))
        self.assertEqual(r['leituras'][0]['tipo'], 'vazao_agua')

    def test_historico_e_irrigacoes_nao_devolvem_futuro_e_filtram_o_dono(self):
        entrar(self)
        self.banco.quando('FROM leituras_sensores', [])
        self.banco.quando('FROM eventos_irrigacao', [])
        for url in ('/api/historico?inicio=2026-10-15&fim=2026-10-15', '/api/irrigacoes?inicio=2026-10-15&fim=2026-10-15'):
            r = self.json(self.cliente.get(url))
            self.assertTrue(all(v == [] for v in r.values()), 'sem dados: listas vazias, nada inventado')
        for trecho, coluna in (('FROM leituras_sensores', 'l.hora_leitura <= LOCALTIMESTAMP'), ('FROM eventos_irrigacao', 'e.iniciado_em <= LOCALTIMESTAMP')):
            sql, params = self.banco.chamadas_com(trecho)[-1]
            self.assertIn(coluna, sql, 'o SQL descarta registros posteriores ao momento da consulta')
            self.assertIn('p.usuario_id = %s', sql); self.assertEqual(params[0], 1)       # só a propriedade do usuário logado
        self.banco.quando('hora_leitura::date', [])
        self.assertEqual(self.json(self.cliente.get('/api/dias-disponiveis?fonte=leituras')), {'dias': []})
        sql, _ = self.banco.chamadas_com('hora_leitura::date')[-1]
        self.assertIn('l.hora_leitura <= LOCALTIMESTAMP', sql)

    def test_dias_disponiveis(self):
        entrar(self)
        self.banco.quando('hora_leitura::date', [{'dia': date(2026, 10, 14)}, {'dia': date(2026, 10, 12)}])
        r = self.json(self.cliente.get('/api/dias-disponiveis?fonte=leituras'))
        self.assertEqual(r, {'dias': ['2026-10-12', '2026-10-14']})                 # em ordem crescente, como texto
        sql, params = self.banco.chamadas_com('hora_leitura::date')[-1]
        self.assertEqual(params[0], 1); self.assertEqual(params[1], ['umidade_solo', 'temperatura'])   # só do usuário logado
        self.banco.quando('iniciado_em::date', [{'dia': date(2026, 10, 10)}])
        self.assertEqual(self.json(self.cliente.get('/api/dias-disponiveis?fonte=eventos'))['dias'], ['2026-10-10'])
        self.banco.quando('FROM consumo_diario', [{'dia': date(2026, 10, 10)}])
        self.assertEqual(self.json(self.cliente.get('/api/dias-disponiveis?fonte=consumo'))['dias'], ['2026-10-10'])
        for ruim in ('', '?fonte=', '?fonte=usuarios', '?fonte=leituras;DROP'):
            r = self.cliente.get('/api/dias-disponiveis' + ruim)
            self.assertEqual(r.status_code, 400)

    def test_dias_disponiveis_exige_login(self):
        self.assertEqual(self.cliente.get('/api/dias-disponiveis?fonte=leituras').status_code, 401)

    def test_nao_existe_rota_de_insercao_manual_de_leitura(self):
        entrar(self)
        self.assertIn(self.cliente.post('/api/leituras-teste', json={'umidade': 20, 'temperatura': 25}).status_code, (404, 405))


DISPOSITIVO = {'id': 1, 'propriedade_id': 1, 'codigo_dispositivo': 'ESP32-001', 'nome': 'ESP', 'irrigacao_ligada': False}
AGORA = datetime(2026, 10, 15, 11, 0, 0)


class TestDispositivo(Base):
    def chave(self, codigo='ESP32-001'):
        return {'X-Chave-Dispositivo': seguranca.gerar_chave_dispositivo(codigo, auxiliar.CONFIG_TESTE['CHAVE_DISPOSITIVOS'])}

    def setUp(self):
        super().setUp()
        self.banco.quando('FROM dispositivos WHERE codigo_dispositivo', [DISPOSITIVO])
        self.banco.quando('SELECT LOCALTIMESTAMP', [{'agora': AGORA}])

    def leituras(self, corpo, headers=None):
        return self.cliente.post('/api/dispositivos/ESP32-001/leituras', json=corpo,
                                 headers=self.chave() if headers is None else headers)

    def test_autenticacao_do_dispositivo(self):
        self.assertEqual(self.leituras({'umidade_solo': 20}, headers={}).status_code, 401)
        self.assertEqual(self.leituras({'umidade_solo': 20}, headers={'X-Chave-Dispositivo': 'errada'}).status_code, 401)
        # chave de OUTRO dispositivo não vale para este
        self.assertEqual(self.leituras({'umidade_solo': 20}, headers=self.chave('ESP32-002')).status_code, 401)
        self.banco.quando('FROM dispositivos WHERE codigo_dispositivo', [])
        self.assertEqual(self.leituras({'umidade_solo': 20}).status_code, 404)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])

    def test_leituras_validas(self):
        self.banco.quando('SELECT id, tipo FROM sensores', [{'id': 1, 'tipo': 'umidade_solo'}, {'id': 2, 'tipo': 'temperatura'},
                                                             {'id': 3, 'tipo': 'vazao_agua'}])
        self.banco.quando('INSERT INTO leituras_sensores', 1)
        self.banco.quando('UPDATE dispositivos SET online', 1)
        r = self.leituras({'umidade_solo': 23.456, 'temperatura': 28.1})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.json(r)['quantidade'], 2)
        inserts = [p for _, p in self.banco.chamadas_com('INSERT INTO leituras_sensores')]
        self.assertEqual([i[0] for i in inserts], [1, 2])                 # sensor de umidade e de temperatura
        self.assertEqual({i[2] for i in inserts}, {AGORA})                # mesma hora nas duas leituras
        self.assertEqual(self.banco.finalizacoes[0], True)

    def test_leituras_invalidas(self):
        for corpo in ({}, {'umidade_solo': 150}, {'umidade_solo': True}, {'temperatura': '28'}, {'vazao_agua': -1},
                      {'umidade_solo': 20, 'hora_leitura': '2026-10-15T12:00:00'},      # futuro
                      {'umidade_solo': 20, 'hora_leitura': '2026-10-15T10:00:00Z'}):
            self.assertEqual(self.leituras(corpo).status_code, 400, corpo)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])

    def test_sensor_nao_cadastrado(self):
        self.banco.quando('SELECT id, tipo FROM sensores', [{'id': 1, 'tipo': 'umidade_solo'}])
        r = self.leituras({'umidade_solo': 20, 'vazao_agua': 1})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])

    def test_configuracao(self):
        self.banco.quando('FROM propriedades WHERE id', [{'metodo_irrigacao': 'Gravidade', 'limite_umidade': Decimal('18.00'),
                                                          'limite_umidade_desliga': Decimal('30.00')}])
        r = self.cliente.get('/api/dispositivos/ESP32-001/configuracao', headers=self.chave())
        self.assertEqual(self.json(r)['limite_umidade_desliga'], 30.0)

    def irrigacao(self, corpo):
        return self.cliente.put('/api/dispositivos/ESP32-001/irrigacao', json=corpo, headers=self.chave())

    def test_ligar_irrigacao(self):
        self.banco.quando('FROM eventos_irrigacao WHERE dispositivo_id', [])
        self.banco.quando('INSERT INTO eventos_irrigacao', {'id': 7, 'iniciado_em': AGORA, 'encerrado_em': None})
        self.banco.quando('UPDATE dispositivos SET irrigacao_ligada = TRUE', 1)
        self.assertEqual(self.irrigacao({'ligada': 'sim'}).status_code, 400)
        r = self.irrigacao({'ligada': True, 'umidade': 17.5})
        self.assertEqual(r.status_code, 201)
        self.assertEqual(self.banco.chamadas_com('INSERT INTO eventos_irrigacao')[0][1], (1, 17.5))

    def test_ligar_de_novo_nao_duplica(self):
        self.banco.quando('FROM eventos_irrigacao WHERE dispositivo_id', [{'id': 7, 'iniciado_em': AGORA}])
        r = self.irrigacao({'ligada': True})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.banco.chamadas_com('INSERT'), [])

    def test_ligar_corrida_vira_409(self):
        self.banco.quando('FROM eventos_irrigacao WHERE dispositivo_id', [])
        self.banco.quando('SELECT l.valor', [])
        self.banco.quando('INSERT INTO eventos_irrigacao', banco.ErroUnicidade())
        self.assertEqual(self.irrigacao({'ligada': True}).status_code, 409)

    def desligar(self, corpo, pontos):
        inicio = datetime(2026, 10, 15, 10, 0, 0)
        self.banco.quando('FROM eventos_irrigacao WHERE dispositivo_id', [{'id': 7, 'iniciado_em': inicio}])
        self.banco.quando("s.tipo = 'vazao_agua'", pontos)
        self.banco.quando("s.tipo = 'umidade_solo'", [{'valor': Decimal('30.00')}])
        self.banco.quando('UPDATE dispositivos SET irrigacao_ligada = FALSE', 1)
        self.banco.quando('UPDATE eventos_irrigacao SET encerrado_em', {'id': 7})
        return self.irrigacao(corpo)

    def test_desligar_calcula_volume_pela_vazao(self):
        pontos = [{'hora_leitura': datetime(2026, 10, 15, 10, 0), 'valor': Decimal('1.50')},
                  {'hora_leitura': datetime(2026, 10, 15, 10, 30), 'valor': Decimal('1.50')},
                  {'hora_leitura': datetime(2026, 10, 15, 11, 0), 'valor': Decimal('1.50')}]
        r = self.desligar({'ligada': False}, pontos)
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('aviso', self.json(r))
        fim, minutos, litros, umidade, evento_id = self.banco.chamadas_com('UPDATE eventos_irrigacao SET encerrado_em')[0][1]
        self.assertEqual((fim, minutos, litros, evento_id), (AGORA, 60, 90.0, 7))
        self.assertEqual(umidade, Decimal('30.00'))        # última umidade recente (ESP32 não informou)

    def test_desligar_sem_leituras_avisa_que_nao_mediu(self):
        r = self.desligar({'ligada': False}, [])
        self.assertIn('NÃO foi medido', self.json(r)['aviso'])
        self.assertEqual(self.banco.chamadas_com('UPDATE eventos_irrigacao SET encerrado_em')[0][1][2], 0)

    def test_desligar_com_volume_informado(self):
        r = self.desligar({'ligada': False, 'agua_utilizada_litros': 180.5, 'umidade': 29}, [])
        self.assertNotIn('aviso', self.json(r))
        params = self.banco.chamadas_com('UPDATE eventos_irrigacao SET encerrado_em')[0][1]
        self.assertEqual((params[2], params[3]), (180.5, 29.0))

    def test_desligar_sem_irrigacao_aberta(self):
        self.banco.quando('FROM eventos_irrigacao WHERE dispositivo_id', [])
        self.banco.quando('UPDATE dispositivos SET irrigacao_ligada = FALSE', 1)
        r = self.irrigacao({'ligada': False})
        self.assertEqual((r.status_code, self.json(r)['evento']), (200, None))


class TestGeral(Base):
    def test_saude(self):
        self.banco.quando('SELECT 1 AS ok', [{'ok': 1}])
        self.assertEqual(self.json(self.cliente.get('/api/saude')), {'status': 'ok', 'banco': 'conectado'})
        self.banco.quando('SELECT 1 AS ok', banco.ErroBanco('caiu'))
        r = self.cliente.get('/api/saude')
        self.assertEqual(r.status_code, 503)
        self.assertNotIn('caiu', r.get_data(as_text=True))

    def test_erros_em_json(self):
        r = self.cliente.get('/api/nao-existe')
        self.assertEqual((r.status_code, r.content_type), (404, 'application/json'))
        self.assertIn('mensagem', self.json(r))
        self.assertEqual(self.cliente.get('/api/login').status_code, 404)    # sem rota GET (cai no front-end)

    def test_erro_interno_nao_vaza_detalhes(self):
        self.banco.quando('SELECT id, nome, email, senha_hash', RuntimeError('SEGREDO-INTERNO senha=abc'))
        r = self.cliente.post('/api/login', json={'email': 'a@b.com', 'senha': 'x'})
        self.assertEqual(r.status_code, 500)
        self.assertNotIn('SEGREDO', r.get_data(as_text=True))
        self.assertEqual(self.banco.finalizacoes[0], False)

    def test_corpo_grande_demais(self):
        r = self.cliente.post('/api/login', data='x' * 70000, content_type='application/json')
        self.assertEqual(r.status_code, 413)

    def test_cors(self):
        permitida = {'Origin': 'http://localhost:5500'}
        r = self.cliente.options('/api/login', headers={**permitida, 'Access-Control-Request-Method': 'POST'})
        self.assertEqual(r.headers['Access-Control-Allow-Origin'], 'http://localhost:5500')
        self.assertEqual(r.headers['Access-Control-Allow-Credentials'], 'true')
        self.assertIn('POST', r.headers['Access-Control-Allow-Methods'])
        r = self.cliente.options('/api/login', headers={'Origin': 'http://site-malicioso.com'})
        self.assertNotIn('Access-Control-Allow-Origin', r.headers)

    def test_front_end_servido_pelo_flask(self):
        self.assertEqual(self.cliente.get('/').status_code, 302)
        r = self.cliente.get('/login/login.html')
        self.assertEqual(r.status_code, 200)
        self.assertIn('AquaSmart', r.get_data(as_text=True))


if __name__ == '__main__':
    unittest.main()
