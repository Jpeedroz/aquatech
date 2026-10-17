/* ============================================================
   api.js — ÚNICO ponto de acesso a dados do front-end.

   As telas chamam estas funções (getHistoricoData, login...).
   Modo DEMO (config.js): respostas vêm de mockData.js e demo.js.
   Modo API (config.js): o mesmo código usa fetch() na API Flask.
   Assim as telas NÃO precisam ser refeitas.

   O front-end nunca acessa o PostgreSQL: só conversa com a API.
   Em produção o usuário é identificado pelo token/cookie da sessão
   no Flask (por isso as rotas não recebem usuario_id na URL).
   ============================================================ */

// USAR_MOCK vem de config.js: true = modo DEMO (mockData.js/demo.js), false = modo API (fetch).
// Os dois modos nunca se misturam e nenhum deles é "desligado" para o outro funcionar.
const API_BASE = window.location.port === '5000' ? '/api' : `http://${window.location.hostname}:5000/api`;

async function requisicao(caminho, opcoes = {}) {
  let resposta;
  try {
    resposta = await fetch(API_BASE + caminho, {
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',                       // envia o cookie de sessão do Flask
      ...opcoes
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;           // pedido cancelado de propósito (filtro trocado)
    throw new Error('Não foi possível conectar ao servidor. Verifique se o back-end está em execução.');
  }
  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && caminho !== '/login') {           // sessão vencida: volta ao login
      limparSessao();
      window.location.replace('../login/login.html');
    }
    const e = new Error(erro.mensagem || 'Erro na comunicação com o servidor.');
    e.campo = erro.campo || null;               // 'email' ou 'senha' quando o Flask indicar o campo com problema
    e.status = resposta.status;
    throw e;
  }
  return resposta.json();
}
const post = (caminho, corpo) => requisicao(caminho, { method: 'POST', body: JSON.stringify(corpo) });
const put = (caminho, corpo) => requisicao(caminho, { method: 'PUT', body: JSON.stringify(corpo) });
const idUsuario = () => getSessao().usuario_id;
const idPropriedade = () => mockPropriedadeDoUsuario(idUsuario())?.id;   // só usado no mock

/* Troca entre modo demo e modo API. Encerra a sessão para NÃO misturar dados de um modo no outro. */
function trocarModoDados(novo) {
  try { localStorage.setItem(MODO_CHAVE, novo); } catch (e) { /* ignora */ }
  limparSessao();
  window.location.replace('../login/login.html');
}

/* ---------- autenticação e cadastro ---------- */
// Envia email e senha. Resposta esperada: { usuario_id, propriedade_id, nome, email, token }
async function login(email, senha) {
  return USAR_MOCK ? mockLogin(email, senha) : post('/login', { email, senha });
}
// O HASH da senha é gerado pelo Back-end, nunca aqui.
async function cadastrarUsuario({ nome, email, telefone, senha }) {
  return USAR_MOCK ? mockCadastrarUsuario({ nome, email, telefone, senha }) : post('/usuarios', { nome, email, telefone, senha });
}
// Etapa 2 do cadastro: ainda não há login, então usa o usuário criado na etapa 1.
// O Flask deve validar o token de cadastro devolvido pela etapa 1.
async function cadastrarPropriedade(dados) {
  const pendente = getCadastroPendente();
  if (!pendente) throw new Error('Sua sessão de cadastro expirou. Comece o cadastro novamente.');
  return USAR_MOCK ? mockCadastrarPropriedade(pendente.usuario_id, dados)
                   : post('/propriedades', { ...dados, usuario_id: pendente.usuario_id, token_cadastro: pendente.token });
}
// Sair: avisa a API (modo real), limpa a sessão e volta ao login.
// A proteção REAL das telas é feita no Flask; limpar a sessão aqui é só interface.
async function sair() {
  try { if (!USAR_MOCK) await post('/logout', {}); } catch (e) { /* segue mesmo assim */ }
  limparSessao();
  window.location.replace('../login/login.html');
}

/* ---------- conta e propriedade ---------- */
async function getUsuario() {
  return USAR_MOCK ? { ...mockEstado.usuarios.find(u => u.id === idUsuario()) } : requisicao('/usuario');
}
async function getPropriedade() {
  return USAR_MOCK ? { ...mockPropriedadeDoUsuario(idUsuario()) } : requisicao('/propriedade');
}
async function atualizarUsuario({ nome, telefone }) {                         // PUT /api/usuario
  return USAR_MOCK ? mockAtualizarUsuario(idUsuario(), { nome, telefone }) : put('/usuario', { nome, telefone });
}
async function atualizarPropriedade(dados) {                                  // PUT /api/propriedade
  return USAR_MOCK ? mockAtualizarPropriedade(idUsuario(), dados) : put('/propriedade', dados);
}
// O Back-end deve: validar a senha atual, gerar novo senha_hash, invalidar sessões antigas.
async function alterarSenha(senhaAtual, novaSenha) {                          // PUT /api/usuario/senha
  if (USAR_MOCK) return { mensagem: 'MOCK: nada foi alterado. O Flask validará a senha atual e gravará o novo hash.' };
  return put('/usuario/senha', { senha_atual: senhaAtual, nova_senha: novaSenha });
}
// O Back-end deve: exigir autenticação, checar se o e-mail é de outro usuário,
// enviar confirmação ao novo e-mail e só então trocar (e atualizar a sessão).
async function solicitarTrocaEmail(novoEmail, senhaAtual) {                   // POST /api/usuario/email
  if (USAR_MOCK) return { mensagem: 'MOCK: o e-mail NÃO foi alterado. Em produção, um link de confirmação será enviado ao novo endereço.' };
  return post('/usuario/email', { novo_email: novoEmail, senha_atual: senhaAtual });
}

/* ---------- dados das telas (datas no formato AAAA-MM-DD) ----------
   "opcoes.signal" (AbortSignal) cancela o pedido quando o usuário troca o filtro. */
// GET /api/dashboard → { resumo (colunas de resumo_dashboard), leituras_umidade (hoje), eventos (hoje) }
// Só o "resumo" é usado: leituras e eventos do período vêm de getHistoricoData (um único lugar).
async function getResumoPainel(opcoes = {}) {
  if (!USAR_MOCK) return (await requisicao('/dashboard', { signal: opcoes.signal })).resumo;
  return mockResumoDashboard(idUsuario());
}
// GET /api/historico?inicio=&fim= → { leituras: [{sensor_id,tipo,valor,hora_leitura,teste?}], eventos: [...] }
// As leituras incluem umidade, temperatura e vazão (a vazão serve para o consumo acumulado).
async function getHistoricoData(inicio, fim, opcoes = {}) {
  if (!USAR_MOCK) return requisicao(`/historico?inicio=${inicio}&fim=${fim}`, { signal: opcoes.signal });
  const pid = idPropriedade();
  return { leituras: pid ? mockLeiturasPeriodo(pid, inicio, fim) : [], eventos: pid ? mockEventosPeriodo(pid, inicio, fim) : [] };
}
// GET /api/irrigacoes?inicio=&fim= → { eventos: [linhas de eventos_irrigacao] }
// A tela Consumo usa ESTES MESMOS eventos para somar o consumo por dia.
async function getIrrigacoesData(inicio, fim, opcoes = {}) {
  if (!USAR_MOCK) return requisicao(`/irrigacoes?inicio=${inicio}&fim=${fim}`, { signal: opcoes.signal });
  const pid = idPropriedade();
  return { eventos: pid ? mockEventosPeriodo(pid, inicio, fim) : [] };
}
// GET /api/consumo/resumo → { hoje, ultimos_7_dias, ultimos_30_dias, total }
async function getConsumoResumo(opcoes = {}) {
  if (!USAR_MOCK) return requisicao('/consumo/resumo', { signal: opcoes.signal });
  const pid = idPropriedade();
  return pid ? mockResumoConsumo(pid) : { hoje: 0, ultimos_7_dias: 0, ultimos_30_dias: 0, total: 0 };
}
// GET /api/dias-disponiveis?fonte=leituras|eventos|consumo → { dias: ["AAAA-MM-DD", ...] }
// Alimenta os calendários: só dias que têm dado podem ser escolhidos.
async function getDiasDisponiveis(fonte, opcoes = {}) {
  if (!USAR_MOCK) return (await requisicao(`/dias-disponiveis?fonte=${fonte}`, { signal: opcoes.signal })).dias;
  const pid = idPropriedade();
  return pid ? mockDiasDisponiveis(pid, fonte) : [];
}

/* ---------- recuperação de senha ---------- */
// POST /api/recuperar-senha { email } → o Flask envia o link por e-mail.
// A resposta deve ser SEMPRE a mesma, exista o e-mail ou não (não revelar quem tem conta).
async function solicitarRecuperacaoSenha(email) {
  if (USAR_MOCK) return { mock: true, mensagem: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  return post('/recuperar-senha', { email });
}
// POST /api/redefinir-senha { token, nova_senha } → o Flask valida o token e grava o novo senha_hash.
async function redefinirSenha(token, novaSenha) {
  if (USAR_MOCK) return { mensagem: 'Senha alterada com sucesso.' };
  return post('/redefinir-senha', { token, nova_senha: novaSenha });
}
// GET /api/redefinir-senha/verificar?token=XXXX → { valido: true|false }
// O Flask confere se o token existe, não expirou e não foi usado. Roda ao abrir o link do e-mail.
async function verificarTokenRecuperacao(token) {
  if (USAR_MOCK) return { valido: token !== 'expirado' };    // mock: ?token=expirado simula link vencido
  if (!token) return { valido: false };
  return requisicao(`/redefinir-senha/verificar?token=${encodeURIComponent(token)}`);
}
