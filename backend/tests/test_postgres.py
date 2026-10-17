"""
NOME: tests/test_postgres.py
FUNÇÃO: Testes de ponta a ponta contra um PostgreSQL REAL (valida o SQL, as views e as restrições).
COMO:   Crie um banco SÓ para testes e rode apontando para ele (o teste recusa bancos cujo nome
        não termine em _teste, porque ele APAGA e recria as tabelas):
            PowerShell:  $env:DB_NAME="aquatech_teste"; python -m unittest tests.test_postgres -v
            Linux/Mac:   DB_NAME=aquatech_teste python -m unittest tests.test_postgres -v
        Sem isso, os testes são ignorados.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config                                                    # noqa: E402

CFG = config.carregar_config()
try:
    import psycopg2                                              # noqa: F401
    PRONTO = CFG['DB_NAME'].endswith('_teste')
except ImportError:
    PRONTO = False


def _colunas(linha):
    """Linha como lista de valores (psycopg2 devolve tupla; o driver substituto usado em alguns ambientes, dict)."""
    return list(linha.values()) if isinstance(linha, dict) else list(linha)


@unittest.skipUnless(PRONTO, 'defina DB_NAME terminando em _teste (e instale psycopg2) para rodar')
class TestPostgres(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app import create_app
        from banco import abrir_conexao
        from seguranca import gerar_chave_dispositivo, gerar_hash_senha, limite_login
        limite_login.zerar()
        conexao = abrir_conexao(CFG)
        with conexao, conexao.cursor() as cursor:
            cursor.execute(config.ARQUIVO_SQL.read_text(encoding='utf-8'))
            cursor.execute("UPDATE usuarios SET senha_hash = %s WHERE email = 'joao@example.com'",
                           (gerar_hash_senha('segredo1'),))
        conexao.close()
        cls.app = create_app({'SECRET_KEY': 's' * 40, 'CHAVE_DISPOSITIVOS': 'c' * 40})
        cls.chave = {'X-Chave-Dispositivo': gerar_chave_dispositivo('ESP32-001', 'c' * 40)}

    def _contar(self, sql):
        from banco import abrir_conexao
        con = abrir_conexao(CFG)
        with con, con.cursor() as cur:
            cur.execute(sql, ())
            n = _colunas(cur.fetchone())[0]
        con.close()
        return n

    def novo_cliente(self):
        return self.app.test_client()

    def entrar_como_joao(self):
        c = self.novo_cliente()
        r = c.post('/api/login', json={'email': 'joao@example.com', 'senha': 'segredo1'})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        return c

    def test_01_saude(self):
        self.assertEqual(self.novo_cliente().get('/api/saude').status_code, 200)

    def test_02_dados_de_teste_do_sql(self):
        """Valores descritos nos comentários do SQL: hoje 270 L; 7 dias 1.260 L."""
        c = self.entrar_como_joao()
        resumo = c.get('/api/consumo/resumo').get_json()
        self.assertEqual((resumo['hoje'], resumo['ultimos_7_dias']), (270.0, 1260.0))
        painel = c.get('/api/dashboard').get_json()
        self.assertEqual(painel['resumo']['consumo_agua_hoje'], 270.0)
        self.assertEqual(painel['resumo']['nome_propriedade'], 'Sítio Boa Vista')
        # os dados de teste de "hoje" têm horários fixos (até ~14h); só aparece o que já aconteceu (<= agora), então
        # a expectativa depende da hora em que o teste roda: contamos direto no banco o que já "aconteceu".
        self.assertEqual(len(painel['eventos']), self._contar("SELECT count(*) FROM eventos_irrigacao WHERE iniciado_em::date = CURRENT_DATE AND iniciado_em <= LOCALTIMESTAMP"))
        self.assertEqual(len(painel['leituras_umidade']), self._contar("SELECT count(*) FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id WHERE s.tipo = 'umidade_solo' AND l.hora_leitura::date = CURRENT_DATE AND l.hora_leitura <= LOCALTIMESTAMP"))
        if painel['eventos']:
            self.assertRegex(painel['eventos'][0]['iniciado_em'], r'^\d{4}-\d\d-\d\dT09:00:00$')

    def test_03_historico_irrigacoes_consumo(self):
        c = self.entrar_como_joao()
        periodo = 'inicio=2000-01-01&fim=2100-01-01'
        self.assertEqual(c.get('/api/historico?' + periodo).status_code, 400)          # > 366 dias
        h = c.get('/api/historico?inicio=2026-01-01&fim=2026-12-31').get_json()
        self.assertEqual(c.get('/api/irrigacoes?inicio=2026-01-01&fim=2026-12-31').status_code, 200)
        self.assertEqual(c.get('/api/consumo?inicio=2026-01-01&fim=2026-12-31').status_code, 200)
        self.assertTrue(all(l['tipo'] in ('umidade_solo', 'temperatura', 'vazao_agua') for l in h['leituras']))   # vazão acompanha
        self.assertEqual(any(l['tipo'] == 'vazao_agua' for l in h['leituras']),
                         self._contar("SELECT count(*) FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id WHERE s.tipo = 'vazao_agua' AND l.hora_leitura <= LOCALTIMESTAMP") > 0)

    def test_04_cadastro_completo_e_isolamento_entre_usuarios(self):
        c = self.novo_cliente()
        r = c.post('/api/usuarios', json={'nome': 'Maria', 'email': 'MARIA@teste.com', 'telefone': '88988887777', 'senha': 'senha123'})
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        token = r.get_json()['token']
        self.assertEqual(c.post('/api/usuarios', json={'nome': 'Outra', 'email': 'maria@TESTE.com', 'telefone': '88988887777',
                                                       'senha': 'senha123'}).status_code, 409)       # e-mail único sem diferenciar caixa
        prop = {'nome': 'Sítio da Maria', 'localizacao': 'Crato - CE', 'area_hectares': 1.5, 'cultura': 'Milho',
                'metodo_irrigacao': 'Gravidade', 'token_cadastro': token}
        self.assertEqual(c.post('/api/propriedades', json=prop).status_code, 201)
        self.assertEqual(c.post('/api/propriedades', json=prop).status_code, 409)
        r = c.post('/api/login', json={'email': 'maria@teste.com', 'senha': 'senha123'})
        self.assertIsNotNone(r.get_json()['propriedade_id'])
        painel = c.get('/api/dashboard').get_json()
        self.assertEqual(painel['resumo']['nome_propriedade'], 'Sítio da Maria')
        self.assertIsNone(painel['resumo']['umidade_atual'])                  # sem leituras: nulo, nada inventado
        self.assertEqual((painel['eventos'], painel['leituras_umidade']), ([], []))
        self.assertEqual(c.get('/api/consumo/resumo').get_json()['total'], 0)  # nada dos dados do João
        self.assertEqual(c.put('/api/propriedade', json={'nome': 'Novo nome', 'localizacao': '', 'area_hectares': 2,
                                                         'cultura': 'Milho', 'metodo_irrigacao': 'Gravidade'}).status_code, 200)

    def test_05_troca_de_senha_derruba_outras_sessoes(self):
        c1, c2 = self.entrar_como_joao(), self.entrar_como_joao()
        r = c1.put('/api/usuario/senha', json={'senha_atual': 'segredo1', 'nova_senha': 'segredo2'})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertEqual(c1.get('/api/usuario').status_code, 200)             # quem trocou continua logado
        self.assertEqual(c2.get('/api/usuario').status_code, 401)             # a outra sessão caiu
        c1.put('/api/usuario/senha', json={'senha_atual': 'segredo2', 'nova_senha': 'segredo1'})

    def test_06_esp32_leituras_e_irrigacao(self):
        c = self.novo_cliente()
        base = '/api/dispositivos/ESP32-001'
        r = c.post(base + '/leituras', json={'umidade_solo': 16.5, 'temperatura': 31, 'vazao_agua': 0}, headers=self.chave)
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        r = c.put(base + '/irrigacao', json={'ligada': True}, headers=self.chave)
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        self.assertEqual(c.put(base + '/irrigacao', json={'ligada': True}, headers=self.chave).status_code, 200)   # repetido
        painel = self.entrar_como_joao().get('/api/dashboard').get_json()
        self.assertIs(painel['resumo']['irrigacao_ligada'], True)
        self.assertIs(painel['resumo']['online'], True)
        c.post(base + '/leituras', json={'vazao_agua': 1.5}, headers=self.chave)
        r = c.put(base + '/irrigacao', json={'ligada': False, 'umidade': 30}, headers=self.chave)
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        evento = r.get_json()['evento']
        self.assertIsNotNone(evento['encerrado_em'])
        self.assertIn('aviso', r.get_json())                                  # só 1 leitura de vazão no intervalo: não mediu
        self.assertEqual(self.entrar_como_joao().get('/api/dashboard').get_json()['resumo']['irrigacao_ligada'], False)

    def test_07_esp32_sem_chave(self):
        r = self.novo_cliente().post('/api/dispositivos/ESP32-001/leituras', json={'umidade_solo': 20})
        self.assertEqual(r.status_code, 401)

    def test_08_recuperacao_de_senha(self):
        from unittest import mock
        c = self.novo_cliente()
        with mock.patch('emails.enviar_em_segundo_plano') as envio:
            self.assertEqual(c.post('/api/recuperar-senha', json={'email': 'joao@example.com'}).status_code, 200)
        token = envio.call_args[0][3].split('token=')[1].split()[0]
        self.assertTrue(c.get('/api/redefinir-senha/verificar?token=' + token).get_json()['valido'])
        self.assertEqual(c.post('/api/redefinir-senha', json={'token': token, 'nova_senha': 'segredo1'}).status_code, 200)
        self.assertFalse(c.get('/api/redefinir-senha/verificar?token=' + token).get_json()['valido'])   # uso único
        self.assertEqual(c.post('/api/redefinir-senha', json={'token': token, 'nova_senha': 'segredo1'}).status_code, 400)


    def test_09_dias_disponiveis_para_os_calendarios(self):
        c = self.entrar_como_joao()
        leituras = c.get('/api/dias-disponiveis?fonte=leituras').get_json()['dias']
        eventos = c.get('/api/dias-disponiveis?fonte=eventos').get_json()['dias']
        consumo = c.get('/api/dias-disponiveis?fonte=consumo').get_json()['dias']
        self.assertEqual(len(leituras), 30)                                    # o SQL de teste cobre 30 dias
        self.assertEqual(leituras, sorted(set(leituras)))                      # ordenados, sem repetir
        self.assertRegex(leituras[0], r'^\d{4}-\d\d-\d\d$')
        self.assertEqual(eventos, consumo)                                     # consumo = dias com evento (view consumo_diario)
        self.assertTrue(set(eventos) <= set(leituras))
        self.assertEqual(c.get('/api/dias-disponiveis?fonte=x').status_code, 400)
        # outro usuário não enxerga os dias do João
        outro = self.novo_cliente()
        token = outro.post('/api/usuarios', json={'nome': 'Ana', 'email': 'ana@teste.com', 'telefone': '88977776666', 'senha': 'senha123'}).get_json()['token']
        outro.post('/api/propriedades', json={'nome': 'Sítio Ana', 'localizacao': 'Crato - CE', 'area_hectares': 1, 'cultura': 'Milho',
                                              'metodo_irrigacao': 'Gravidade', 'token_cadastro': token})
        outro.post('/api/login', json={'email': 'ana@teste.com', 'senha': 'senha123'})
        for fonte in ('leituras', 'eventos', 'consumo'):
            self.assertEqual(outro.get('/api/dias-disponiveis?fonte=' + fonte).get_json()['dias'], [])

    def test_10_usuario_demo_idempotente_e_com_hash(self):
        from banco import abrir_conexao
        from scripts import criar_usuario_demo as demo
        resultados = []
        for _ in range(2):                                                   # rodar duas vezes não pode duplicar
            con = abrir_conexao(CFG)
            with con, con.cursor() as cur:
                resultados.append(demo.garantir_usuario(cur))
            con.close()
        self.assertEqual(resultados, ['criado', 'ja_existia'])
        con = abrir_conexao(CFG)
        with con, con.cursor() as cur:
            cur.execute("SELECT count(*), max(senha_hash) FROM usuarios WHERE LOWER(email) = 'usuario@exemplo.com'", ())
            qtd, hash_ = _colunas(cur.fetchone())
        con.close()
        self.assertEqual(qtd, 1)
        self.assertNotIn('123456', hash_)                                    # nunca texto puro
        r = self.novo_cliente().post('/api/login', json={'email': 'usuario@exemplo.com', 'senha': '123456'})
        self.assertEqual(r.status_code, 200, r.get_data(as_text=True))
        self.assertNotIn('senha_hash', r.get_data(as_text=True))             # o hash não sai pela API
        self.assertEqual(self.novo_cliente().post('/api/login', json={'email': 'usuario@exemplo.com', 'senha': 'errada1'}).status_code, 401)

    def test_11_dados_reais_persistem_apos_reiniciar_o_backend_e_novo_login(self):
        from app import create_app
        c = self.entrar_como_joao()
        antes = (c.get('/api/consumo/resumo').get_json(), c.get('/api/historico?inicio=2026-01-01&fim=2026-12-31').get_json(),
                 c.get('/api/irrigacoes?inicio=2026-01-01&fim=2026-12-31').get_json())
        # ESP32 grava uma leitura real; depois "reinicia" o backend (nova aplicação) e entra de novo
        r = self.novo_cliente().post('/api/dispositivos/ESP32-001/leituras', headers=self.chave,
                                     json={'umidade_solo': 23.4, 'temperatura': 30.1})
        self.assertEqual(r.status_code, 201, r.get_data(as_text=True))
        app2 = create_app({'SECRET_KEY': 's' * 40, 'CHAVE_DISPOSITIVOS': 'c' * 40})
        c2 = app2.test_client()
        self.assertEqual(c2.post('/api/login', json={'email': 'joao@example.com', 'senha': 'segredo1'}).status_code, 200)
        h = c2.get('/api/historico?inicio=2026-01-01&fim=2026-12-31').get_json()
        self.assertEqual(len(h['leituras']), len(antes[1]['leituras']) + 2)           # as 2 leituras novas estão lá
        self.assertEqual(c2.get('/api/irrigacoes?inicio=2026-01-01&fim=2026-12-31').get_json(), antes[2])   # eventos intactos
        self.assertEqual(c2.get('/api/consumo/resumo').get_json(), antes[0])         # leitura de sensor não cria consumo
        self.assertEqual(c2.get('/api/dashboard').get_json()['resumo']['umidade_atual'], 23.4)

    def test_13_nada_do_futuro_e_sem_dados_nao_inventa(self):
        """O histórico só devolve o que já foi registrado até agora; conta sem leituras recebe listas vazias."""
        from banco import abrir_conexao
        con = abrir_conexao(CFG)
        with con, con.cursor() as cur:
            cur.execute("SELECT id FROM sensores WHERE tipo = 'umidade_solo' ORDER BY id LIMIT 1", ())
            sensor = _colunas(cur.fetchone())[0]
            cur.execute("INSERT INTO leituras_sensores (sensor_id, valor, hora_leitura) VALUES (%s, 11.1, LOCALTIMESTAMP + interval '3 hours')", (sensor,))
            cur.execute("INSERT INTO leituras_sensores (sensor_id, valor, hora_leitura) VALUES (%s, 22.2, LOCALTIMESTAMP - interval '1 minute')", (sensor,))
        con.close()
        c = self.entrar_como_joao()
        h = c.get('/api/historico?inicio=2026-01-01&fim=2026-12-31').get_json()
        valores = [l['valor'] for l in h['leituras'] if l['tipo'] == 'umidade_solo']
        self.assertIn(22.2, valores, 'a leitura recente aparece')
        self.assertNotIn(11.1, valores, 'a leitura de daqui a 3 horas NÃO aparece')
        agora = max(l['hora_leitura'] for l in h['leituras'])
        from datetime import datetime
        self.assertLessEqual(datetime.fromisoformat(agora), datetime.now(), 'nenhuma leitura posterior ao momento da consulta')
        dias = c.get('/api/dias-disponiveis?fonte=leituras').get_json()['dias']
        self.assertTrue(all(d <= datetime.now().strftime('%Y-%m-%d') for d in dias))
        # conta sem dispositivo: listas vazias (nada de dados de outra conta nem de demonstração)
        c2 = self.novo_cliente()
        t = c2.post('/api/usuarios', json={'nome': 'Sem Dados', 'email': 'semdados@teste.com', 'telefone': '88988887777', 'senha': 'senha123'}).get_json()['token']
        c2.post('/api/propriedades', json={'nome': 'Sítio Vazio', 'localizacao': 'Crato - CE', 'area_hectares': 1, 'cultura': 'Milho',
                                           'metodo_irrigacao': 'Gravidade', 'token_cadastro': t})
        c2.post('/api/login', json={'email': 'semdados@teste.com', 'senha': 'senha123'})
        self.assertEqual(c2.get('/api/historico?inicio=2026-01-01&fim=2026-12-31').get_json(), {'leituras': [], 'eventos': []})
        self.assertEqual(c2.get('/api/irrigacoes?inicio=2026-01-01&fim=2026-12-31').get_json(), {'eventos': []})
        self.assertEqual(c2.get('/api/dias-disponiveis?fonte=leituras').get_json(), {'dias': []})

    def test_12_integridade_relacional(self):
        from banco import abrir_conexao
        con = abrir_conexao(CFG)
        with con, con.cursor() as cur:
            checagens = {
                'propriedade sem usuário': 'SELECT count(*) FROM propriedades p LEFT JOIN usuarios u ON u.id = p.usuario_id WHERE u.id IS NULL',
                'dispositivo sem propriedade': 'SELECT count(*) FROM dispositivos d LEFT JOIN propriedades p ON p.id = d.propriedade_id WHERE p.id IS NULL',
                'sensor sem dispositivo': 'SELECT count(*) FROM sensores s LEFT JOIN dispositivos d ON d.id = s.dispositivo_id WHERE d.id IS NULL',
                'leitura sem sensor': 'SELECT count(*) FROM leituras_sensores l LEFT JOIN sensores s ON s.id = l.sensor_id WHERE s.id IS NULL',
                'evento sem dispositivo': 'SELECT count(*) FROM eventos_irrigacao e LEFT JOIN dispositivos d ON d.id = e.dispositivo_id WHERE d.id IS NULL',
                'umidade fora de 0-100': "SELECT count(*) FROM leituras_sensores l JOIN sensores s ON s.id = l.sensor_id WHERE s.tipo = 'umidade_solo' AND (l.valor < 0 OR l.valor > 100)",
                'evento com fim antes do início': 'SELECT count(*) FROM eventos_irrigacao WHERE encerrado_em IS NOT NULL AND encerrado_em < iniciado_em',
            }
            for nome, sql in checagens.items():
                cur.execute(sql, ())
                self.assertEqual(_colunas(cur.fetchone())[0], 0, nome)
            # as chaves estrangeiras existem de fato (apagar o usuário não pode deixar órfãos silenciosos)
            cur.execute("SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'", ())
            self.assertGreaterEqual(_colunas(cur.fetchone())[0], 5)
        con.close()


if __name__ == '__main__':
    unittest.main()
