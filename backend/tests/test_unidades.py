"""
NOME: tests/test_unidades.py
FUNÇÃO: Testes das peças isoladas (validações, regras, segurança, configuração e JSON).
        Não precisam de PostgreSQL.   Rodar:  python -m unittest discover -s tests -t .
"""
import unittest
from datetime import date, datetime
from decimal import Decimal

from tests import auxiliar                      # noqa: F401  (ajusta o caminho de importação)

import config
import regras
import seguranca
import validacoes as v
from app import _converter_para_json, create_app
from erros import ErroApi


class TestValidacoes(unittest.TestCase):
    def test_telefone_com_e_sem_mascara(self):
        self.assertEqual(v.telefone({'telefone': '88999999999'}), '(88) 99999-9999')
        self.assertEqual(v.telefone({'telefone': '(88) 3571-1234'}), '(88) 3571-1234')
        self.assertIsNone(v.telefone({'telefone': ''}))
        with self.assertRaises(ErroApi):
            v.telefone({'telefone': '12345'})
        with self.assertRaises(ErroApi):
            v.telefone({}, obrigatorio=True)

    def test_numero_recusa_texto_booleano_e_nan(self):
        for ruim in ('12', True, float('nan'), float('inf'), [1]):
            with self.assertRaises(ErroApi, msg=repr(ruim)):
                v.numero({'x': ruim}, 'x', 'x')
        self.assertEqual(v.numero({'x': 5}, 'x', 'x', 0, 10), 5.0)
        with self.assertRaises(ErroApi):
            v.numero({'x': 11}, 'x', 'x', 0, 10)
        with self.assertRaises(ErroApi):
            v.numero({'x': 0}, 'x', 'x', 0, minimo_exclusivo=True)
        self.assertIsNone(v.numero({}, 'x', 'x', obrigatorio=False))

    def test_email_e_senha(self):
        self.assertEqual(v.email({'email': '  a@b.com '}), 'a@b.com')
        for ruim in ('semarroba', 'a@b', '', None, 5):
            with self.assertRaises(ErroApi, msg=repr(ruim)):
                v.email({'email': ruim})
        with self.assertRaises(ErroApi):
            v.senha_nova({'senha': '12345'})
        with self.assertRaises(ErroApi):
            v.senha_nova({'senha': 'x' * 129})
        self.assertEqual(v.senha_nova({'senha': ' 123456 '}), ' 123456 ')      # espaços fazem parte da senha

    def test_periodo(self):
        app = create_app(auxiliar.CONFIG_TESTE)
        with app.test_request_context('/?inicio=2026-10-01&fim=2026-10-15'):
            self.assertEqual(v.periodo_da_requisicao(), (date(2026, 10, 1), date(2026, 10, 15)))
        for consulta in ('inicio=2026-10-15&fim=2026-10-01', 'inicio=x&fim=2026-10-01', 'fim=2026-10-01',
                         'inicio=2020-01-01&fim=2026-10-01'):
            with app.test_request_context('/?' + consulta):
                with self.assertRaises(ErroApi, msg=consulta):
                    v.periodo_da_requisicao()

    def test_horario_local_recusa_fuso(self):
        self.assertEqual(v.horario_local({'h': '2026-10-15T14:30:00'}, 'h'), datetime(2026, 10, 15, 14, 30))
        self.assertIsNone(v.horario_local({}, 'h'))
        for ruim in ('2026-10-15T14:30:00Z', '2026-10-15T14:30:00-03:00', 'ontem', 5):
            with self.assertRaises(ErroApi, msg=repr(ruim)):
                v.horario_local({'h': ruim}, 'h')


class TestRegras(unittest.TestCase):
    def test_volume_por_vazao_trapezio(self):
        # 10 min a 1,5 L/min constante = 15 L ; depois 10 min indo de 1,5 a 0 L/min = 7,5 L
        pontos = [(datetime(2026, 10, 15, 9, 0), 1.5), (datetime(2026, 10, 15, 9, 10), 1.5),
                  (datetime(2026, 10, 15, 9, 20), 0)]
        self.assertEqual(regras.volume_por_vazao(pontos), 22.5)

    def test_volume_sem_leituras_suficientes_nao_inventa(self):
        self.assertIsNone(regras.volume_por_vazao([]))
        self.assertIsNone(regras.volume_por_vazao([(datetime(2026, 10, 15, 9, 0), 1.5)]))


class TestSeguranca(unittest.TestCase):
    def test_token_de_cadastro(self):
        app = create_app(auxiliar.CONFIG_TESTE)
        with app.app_context():
            token = seguranca.gerar_token_cadastro(7)
            self.assertEqual(seguranca.ler_token_cadastro(token), 7)
            with self.assertRaises(ErroApi) as e:
                seguranca.ler_token_cadastro(token, validade_segundos=-1)          # expirado
            self.assertEqual(e.exception.status, 403)
            for ruim in (token + 'x', 'lixo', None, 123):
                with self.assertRaises(ErroApi, msg=repr(ruim)):
                    seguranca.ler_token_cadastro(ruim)

    def test_chave_do_dispositivo(self):
        a = seguranca.gerar_chave_dispositivo('ESP32-001', 's' * 40)
        self.assertEqual(a, seguranca.gerar_chave_dispositivo('ESP32-001', 's' * 40))
        self.assertNotEqual(a, seguranca.gerar_chave_dispositivo('ESP32-002', 's' * 40))
        self.assertNotEqual(a, seguranca.gerar_chave_dispositivo('ESP32-001', 't' * 40))

    def test_hash_de_senha(self):
        h = seguranca.gerar_hash_senha('minhasenha')
        self.assertNotIn('minhasenha', h)
        self.assertTrue(seguranca.conferir_senha(h, 'minhasenha'))
        self.assertFalse(seguranca.conferir_senha(h, 'outra'))
        self.assertFalse(seguranca.conferir_senha('senha_teste_hash', 'qualquer'))   # hash de exemplo do SQL

    def test_limitador(self):
        lim = seguranca.LimitadorTentativas(2, 60)
        lim.verificar('a'); lim.registrar('a'); lim.verificar('a'); lim.registrar('a')
        with self.assertRaises(ErroApi) as e:
            lim.verificar('a')
        self.assertEqual(e.exception.status, 429)
        lim.verificar('b')                      # outra chave não é afetada
        lim.limpar('a'); lim.verificar('a')


class TestConfiguracao(unittest.TestCase):
    BOA = {'SECRET_KEY': 'a' * 32, 'CHAVE_DISPOSITIVOS': 'b' * 32, 'DB_NAME': 'x', 'DB_USER': 'y', 'EMAIL_MODO': 'console'}

    def test_aceita_configuracao_boa(self):
        config.validar_config(self.BOA)

    def test_recusa_exemplo_do_env_example_e_valores_curtos(self):
        for campo, valor in (('SECRET_KEY', 'troque-por-uma-chave-longa-e-aleatoria-123456'),
                             ('SECRET_KEY', 'curta'), ('CHAVE_DISPOSITIVOS', '')):
            with self.assertRaises(RuntimeError, msg=campo + valor):
                config.validar_config({**self.BOA, campo: valor})

    def test_smtp_exige_servidor(self):
        with self.assertRaises(RuntimeError):
            config.validar_config({**self.BOA, 'EMAIL_MODO': 'smtp'})

    def test_o_app_nao_inicia_sem_segredos(self):
        with self.assertRaises(RuntimeError):
            create_app({**auxiliar.CONFIG_TESTE, 'SECRET_KEY': ''})


class TestJson(unittest.TestCase):
    def test_tipos_do_postgres(self):
        app = create_app(auxiliar.CONFIG_TESTE)
        texto = app.json.dumps({'n': Decimal('17.50'), 't': datetime(2026, 10, 15, 9, 5, 7, 123456),
                                'd': date(2026, 10, 15), 'a': 'ação'})
        self.assertEqual(app.json.loads(texto), {'n': 17.5, 't': '2026-10-15T09:05:07', 'd': '2026-10-15', 'a': 'ação'})
        with self.assertRaises(TypeError):
            _converter_para_json(object())


if __name__ == '__main__':
    unittest.main()
