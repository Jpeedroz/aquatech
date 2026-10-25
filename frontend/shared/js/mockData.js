/* ============================================================
   mockData.js — ARQUIVO CENTRAL DOS DADOS DE DEMONSTRAÇÃO (modo demo).

   Os nomes de tabelas e colunas são os do arquivo SQL (usuarios,
   propriedades, dispositivos, sensores, leituras_sensores,
   eventos_irrigacao). Este arquivo só existe no MODO DEMO (ver
   config.js); no modo API quem responde é o Flask/PostgreSQL.

   As leituras e eventos vêm de demo.js: uma única série determinística
   (01/08/2026 a 26/10/2026, uma leitura por hora das 06h às 18h; cenário ilustrativo de período seco e quente, FICTÍCIO) lida
   por TODAS as telas. Nada é guardado no navegador, então qualquer edição
   neste arquivo aparece em todas as páginas assim que você recarrega.

   >>> PARA ADICIONAR OU ALTERAR MEDIÇÕES DE TESTE, EDITE MOCK_AJUSTES <<<
   ============================================================ */

/* ---------- 0) AJUSTES MANUAIS (edite aqui) ---------- */
const MOCK_AJUSTES = {
  /* Troca ou cria leituras. Cada item vale para UM horário; só os campos que você
     informar são alterados (os outros sensores do mesmo horário ficam como estão).
       { hora: '2026-10-16T10:00', umidade: 27.4, temperatura: 30.8, vazao: 0 }
     umidade 0–100 (%), temperatura -40–85 (°C), vazao >= 0 (L/min). */
  leituras: [
    // { hora: '2026-10-16T10:00', umidade: 27.4, temperatura: 30.8 },

    /* DIA DA APRESENTAÇÃO (19/10/2026): curva ondulada com DUAS irrigações, coerentes com as regras da bomba
       (liga na medição abaixo de 18% e desliga na medição em que chega a 30% ou mais).
       1ª irrigação: liga 08:00 (17,3%) e desliga 10:00 (31,2%). 2ª: liga 15:00 (17,1%) e desliga 17:00 (30,4%).
       A vazão medida é a da bomba enquanto ela está ligada e 0 nas demais horas. */
    { hora: '2026-10-19T06:00', umidade: 21.4 }, { hora: '2026-10-19T07:00', umidade: 19.6 },
    { hora: '2026-10-19T08:00', umidade: 17.3, vazao: 3.4 }, { hora: '2026-10-19T09:00', umidade: 24.8, vazao: 3.4 },
    { hora: '2026-10-19T10:00', umidade: 31.2, vazao: 0 }, { hora: '2026-10-19T11:00', umidade: 28.9 },
    { hora: '2026-10-19T12:00', umidade: 26.1, vazao: 0 }, { hora: '2026-10-19T13:00', umidade: 23.7, vazao: 0 },
    { hora: '2026-10-19T14:00', umidade: 20.8, vazao: 0 },
    { hora: '2026-10-19T15:00', umidade: 17.1, vazao: 3.3 }, { hora: '2026-10-19T16:00', umidade: 23.5, vazao: 3.3 },
    { hora: '2026-10-19T17:00', umidade: 30.4, vazao: 0 }, { hora: '2026-10-19T18:00', umidade: 28.6, vazao: 0 },

    /* DIA ATUAL DO DEMO (26/10/2026): mesma ideia do dia anterior, com valores próprios.
       1ª irrigação: liga 08:00 (17,8%) e desliga 10:00 (31,6%). 2ª: liga 15:00 (17,5%) e desliga 17:00 (30,8%). */
    { hora: '2026-10-26T06:00', umidade: 22.0 }, { hora: '2026-10-26T07:00', umidade: 20.1 },
    { hora: '2026-10-26T08:00', umidade: 17.8, vazao: 3.4 }, { hora: '2026-10-26T09:00', umidade: 25.3, vazao: 3.4 },
    { hora: '2026-10-26T10:00', umidade: 31.6, vazao: 0 }, { hora: '2026-10-26T11:00', umidade: 29.2, vazao: 0 },
    { hora: '2026-10-26T12:00', umidade: 26.4, vazao: 0 }, { hora: '2026-10-26T13:00', umidade: 24.0, vazao: 0 },
    { hora: '2026-10-26T14:00', umidade: 21.2, vazao: 0 },
    { hora: '2026-10-26T15:00', umidade: 17.5, vazao: 3.3 }, { hora: '2026-10-26T16:00', umidade: 24.1, vazao: 3.3 },
    { hora: '2026-10-26T17:00', umidade: 30.8, vazao: 0 }, { hora: '2026-10-26T18:00', umidade: 29.0, vazao: 0 },

    /* 18/10/2026: manhã com solo CRÍTICO (< 12%) logo na 1ª medição, para a semana mostrar os quatro estados do solo
       (crítico, seco, adequado e úmido). A bomba liga na 1ª medição e desliga em 30,4% (09:00). */
    { hora: '2026-10-18T06:00', umidade: 10.8, vazao: 3 }, { hora: '2026-10-18T07:00', umidade: 17.6, vazao: 3 },
    { hora: '2026-10-18T08:00', umidade: 24.0, vazao: 3 }, { hora: '2026-10-18T09:00', umidade: 30.4, vazao: 0 },
  ],

  /* Cria eventos de irrigação. O volume é calculado: vazao_lmin × duração (em minutos).
       { inicio: '2026-10-16T14:00', fim: '2026-10-16T14:40', vazao_lmin: 3.5 }
     Opcionais: umidade_antes, umidade_depois, estimado: true (marca o volume como estimado). */
  eventos: [
    // { inicio: '2026-10-16T14:00', fim: '2026-10-16T14:40', vazao_lmin: 3.5 },

    // as duas irrigações do dia 19/10 (volume = vazão × duração: 3,4 × 120 = 408 L e 3,3 × 120 = 396 L)
    { inicio: '2026-10-19T08:00', fim: '2026-10-19T10:00', vazao_lmin: 3.4, umidade_antes: 17.3, umidade_depois: 31.2 },
    { inicio: '2026-10-19T15:00', fim: '2026-10-19T17:00', vazao_lmin: 3.3, umidade_antes: 17.1, umidade_depois: 30.4 },
    { inicio: '2026-10-18T06:00', fim: '2026-10-18T09:00', vazao_lmin: 3, umidade_antes: 10.8, umidade_depois: 30.4 },   // 18/10: começa com solo crítico
    // as duas irrigações do dia 26/10 (3,4 × 120 = 408 L e 3,3 × 120 = 396 L)
    { inicio: '2026-10-26T08:00', fim: '2026-10-26T10:00', vazao_lmin: 3.4, umidade_antes: 17.8, umidade_depois: 31.6 },
    { inicio: '2026-10-26T15:00', fim: '2026-10-26T17:00', vazao_lmin: 3.3, umidade_antes: 17.5, umidade_depois: 30.8 },
  ],

  /* Apaga eventos gerados, pelo horário de início exato:
       '2026-10-12T09:07:00' */
  remover_eventos: [
    // '2026-10-12T09:07:00',
    '2026-10-19T12:00:00',     // irrigação automática do dia 19/10, trocada pelas duas acima
    '2026-10-18T06:00:00',     // irrigação automática do dia 18/10 (06:00–09:00), trocada pela de 18/10 acima (começa com solo crítico)
    '2026-10-26T06:00:00'      // irrigação automática do dia 26/10, trocada pelas duas acima
  ]
};

/* DATA DE REFERÊNCIA DO DEMO ("hoje" na apresentação). É o ÚNICO lugar onde ela é definida.
   - '2026-10-26': o sistema se comporta como se hoje fosse 26/10/2026, mesmo que o computador
     tenha outra data. Hoje = 26/10; 7 dias = 20/10 a 26/10; 1 mês = 27/09 a 26/10. Todos os dados
     do dia 26/10 (13 leituras, 06h–18h) já estão disponíveis.
   - null: usa a data e hora reais (America/Fortaleza); só aparece o que já aconteceu.
   Só vale no MODO DEMO (no modo API o relógio é sempre o normal) e não altera o relógio do computador. */
const MOCK_DATA_REFERENCIA = '2026-10-26';

/* ---------- 1) Contas do demo (ficam salvas no navegador) ---------- */
// Conta de demonstração: usuario@exemplo.com / 123456 (SÓ para desenvolvimento).
// Só o SHA-256 da senha fica aqui, nunca o texto. O modo demo NÃO é autenticação do backend.
const MOCK_CHAVE = 'aquasmart_mock_v3';
const MOCK_ESTADO_INICIAL = {
  usuarios: [
    { id: 1, nome: 'Usuário', email: 'usuario@exemplo.com', telefone: '(88) 99999-9999',
      senha_sha256: '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92' }
  ],
  propriedades: [
    { id: 1, usuario_id: 1, nome: 'Sítio Boa Vista', localizacao: 'Juazeiro do Norte - CE',
      area_hectares: 2.00, cultura: 'Cebola', metodo_irrigacao: "Bomba d'água",
      limite_umidade: 18.00, limite_umidade_desliga: 30.00 }
  ],
  proximoUsuarioId: 2,
  proximaPropriedadeId: 2
};
let mockEstado = (function () {
  try { const s = JSON.parse(localStorage.getItem(MOCK_CHAVE)); if (s && s.usuarios) return s; } catch (e) {}
  return JSON.parse(JSON.stringify(MOCK_ESTADO_INICIAL));
})();
// a conta de demonstração salva por versões antigas pode ter outro nome (ex.: "Demonstração"): o nome dela é sempre "Usuário"
mockEstado.usuarios.forEach(u => { if (u.email && u.email.toLowerCase() === 'usuario@exemplo.com') u.nome = 'Usuário'; });
function mockSalvar() { try { localStorage.setItem(MOCK_CHAVE, JSON.stringify(mockEstado)); } catch (e) {} }
try { ['aquasmart_demo_v3', 'aquasmart_mock_v2'].forEach(k => localStorage.removeItem(k)); } catch (e) {}   // sobras das versões antigas
if (typeof USAR_MOCK !== 'undefined' && USAR_MOCK && typeof Tempo !== 'undefined') Tempo.definirReferencia(MOCK_DATA_REFERENCIA);

/* SHA-256 em JavaScript puro (sem depender de HTTPS/crypto.subtle). Só para a conta do demo. */
function mockSha256(texto) {
  const bytes = Array.from(new TextEncoder().encode(texto));
  const K = []; for (let i = 2, n = 0; n < 64; i++) { let p = true; for (let j = 2; j * j <= i; j++) if (i % j === 0) { p = false; break; } if (p) { K[n++] = (Math.pow(i, 1 / 3) % 1) * 4294967296 | 0; } }
  const H = []; for (let i = 2, n = 0; n < 8; i++) { let p = true; for (let j = 2; j * j <= i; j++) if (i % j === 0) { p = false; break; } if (p) { H[n++] = (Math.pow(i, 0.5) % 1) * 4294967296 | 0; } }
  const l = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (l >>> (i * 8)) & 255);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < bytes.length; o += 64) {
    const w = []; for (let i = 0; i < 16; i++) w[i] = (bytes[o + 4 * i] << 24) | (bytes[o + 4 * i + 1] << 16) | (bytes[o + 4 * i + 2] << 8) | bytes[o + 4 * i + 3];
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, h].forEach((v, i) => { H[i] = (H[i] + v) | 0; });
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

/* ---------- 2) Dispositivo e sensores do demo ---------- */
// Só a propriedade 1 tem dispositivo. Quem cadastra uma propriedade nova NÃO vê dados
// (sem dispositivo = telas vazias), como no sistema real antes de instalar o ESP32.
const MOCK_DISPOSITIVOS = [
  { id: 1, propriedade_id: 1, codigo_dispositivo: 'ESP32-001', nome: 'ESP32 AquaSmart' }
];
const MOCK_SENSORES = [
  { id: 1, dispositivo_id: 1, tipo: 'umidade_solo', nome: 'Sensor de Umidade', unidade: '%' },
  { id: 2, dispositivo_id: 1, tipo: 'temperatura', nome: 'Sensor de Temperatura', unidade: '°C' },
  { id: 3, dispositivo_id: 1, tipo: 'vazao_agua', nome: 'Sensor de Vazão', unidade: 'L/min' }
];

/* ---------- 3) Consultas (equivalem a SELECTs do banco) ---------- */
function mockPropriedadeDoUsuario(uid) { return mockEstado.propriedades.find(p => p.usuario_id === uid) || null; }
function mockDispositivosDaPropriedade(pid) { return MOCK_DISPOSITIVOS.filter(d => d.propriedade_id === pid); }
// Série da propriedade (ou null se ela não tem dispositivo). Os limites vêm da propriedade.
function mockSerie(pid) {
  if (!mockDispositivosDaPropriedade(pid).length) return null;
  const p = mockEstado.propriedades.find(x => x.id === pid);
  return Demo.estado(p ? { liga: p.limite_umidade, desliga: p.limite_umidade_desliga } : null, MOCK_AJUSTES,
                     p ? { area_hectares: p.area_hectares } : null);
}

function mockLeiturasPeriodo(pid, ini, fim, tipos) {
  const est = mockSerie(pid);
  return est ? Demo.leituras(est, ini, fim, tipos) : [];
}
function mockEventosPeriodo(pid, ini, fim) {
  const est = mockSerie(pid);
  return est ? Demo.eventos(est, ini, fim) : [];
}
function mockDiasDisponiveis(pid, fonte) {
  const est = mockSerie(pid);
  return est ? Demo.diasDisponiveis(est, fonte) : [];
}
// Equivale a GET /api/consumo/resumo: soma dos MESMOS eventos que a tela Irrigações lista
function mockResumoConsumo(pid) {
  return Analise.totaisFixos(mockEventosPeriodo(pid, '0000-01-01', '9999-12-31').map(Analise.normalizarEvento), Tempo.hoje());
}
// Equivale à view resumo_dashboard (mesmos nomes de coluna)
function mockResumoDashboard(uid) {
  const u = mockEstado.usuarios.find(x => x.id === uid);
  if (!u) throw new Error('Usuário não encontrado.');
  const p = mockPropriedadeDoUsuario(uid);
  const d = p ? mockDispositivosDaPropriedade(p.id)[0] : null;
  const est = p && d ? mockSerie(p.id) : null;
  const atual = est ? Demo.situacaoAtual(est) : null;
  const hoje = Tempo.hoje();
  return {
    usuario_id: u.id, nome_usuario: u.nome,
    propriedade_id: p ? p.id : null, nome_propriedade: p ? p.nome : null, localizacao: p ? p.localizacao : null,
    area_hectares: p ? p.area_hectares : null, cultura: p ? p.cultura : null,
    metodo_irrigacao: p ? p.metodo_irrigacao : null, limite_umidade: p ? p.limite_umidade : null,
    limite_umidade_desliga: p ? p.limite_umidade_desliga : null,
    dispositivo_id: d ? d.id : null, codigo_dispositivo: d ? d.codigo_dispositivo : null,
    // tudo isto é DERIVADO das leituras/eventos simulados (nada fixo no código)
    online: atual ? atual.online : null, irrigacao_ligada: atual ? atual.irrigacao_ligada : null,
    ultimo_sinal: atual ? atual.ultimo_sinal : null,
    hora_umidade_atual: atual ? atual.ultimo_sinal : null,
    umidade_atual: atual ? atual.umidade_atual : null, temperatura_atual: atual ? atual.temperatura_atual : null,
    consumo_agua_hoje: p ? Analise.soma(mockEventosPeriodo(p.id, hoje, hoje).map(e => Number(e.agua_utilizada_litros))) : 0
  };
}

/* ---------- 5) Cadastro, login e edição (simulam o Flask) ---------- */
// ATENÇÃO: isto NÃO é a autenticação do backend. No modo demo só existem as contas deste navegador:
// a conta de demonstração e as que você cadastrar aqui (senha conferida pelo SHA-256 guardado).
// A autenticação real (hash seguro, sessão) é a do Flask/PostgreSQL, no modo API.
function mockLogin(email, senha) {
  const u = mockEstado.usuarios.find(x => x.email.toLowerCase() === email.toLowerCase());
  if (!u) { const e = new Error('Não encontramos uma conta com este e-mail. Cadastre-se para criar a sua.'); e.campo = 'email'; throw e; }
  if (!senha) { const e = new Error('Informe sua senha.'); e.campo = 'senha'; throw e; }
  if (u.senha_sha256 && u.senha_sha256 !== mockSha256(senha)) { const e = new Error('E-mail ou senha incorretos.'); e.campo = 'senha'; throw e; }
  const p = mockPropriedadeDoUsuario(u.id);
  return { usuario_id: u.id, propriedade_id: p ? p.id : null, nome: u.nome, email: u.email, token: 'token-mock' };
}
function mockCadastrarUsuario({ nome, email, telefone, senha }) {      // guarda só o SHA-256 (nunca o texto) para o login do demo
  if (mockEstado.usuarios.some(x => x.email.toLowerCase() === email.toLowerCase())) throw new Error('Este e-mail já está cadastrado.');
  const u = { id: mockEstado.proximoUsuarioId++, nome, email, telefone, senha_sha256: senha ? mockSha256(senha) : null };
  mockEstado.usuarios.push(u); mockSalvar();
  return { usuario_id: u.id, propriedade_id: null, nome: u.nome, email: u.email, token: 'token-mock' };
}
function mockCadastrarPropriedade(uid, dados) {
  if (mockPropriedadeDoUsuario(uid)) throw new Error('Este usuário já possui uma propriedade cadastrada.');
  const p = { id: mockEstado.proximaPropriedadeId++, usuario_id: uid, ...dados, limite_umidade: 18.00, limite_umidade_desliga: 30.00 };
  mockEstado.propriedades.push(p); mockSalvar();
  return p;
}
function mockAtualizarUsuario(uid, { nome, telefone }) {
  const u = mockEstado.usuarios.find(x => x.id === uid);
  u.nome = nome; u.telefone = telefone; mockSalvar();
  return u;
}
function mockAtualizarPropriedade(uid, dados) {
  const p = mockPropriedadeDoUsuario(uid);
  Object.assign(p, dados); mockSalvar();
  return p;
}
