/* ============================================================
   session.js — contexto do usuário autenticado no navegador.

   Guarda SOMENTE: usuario_id, propriedade_id, nome, e-mail e um
   token (quando a API o devolve). NUNCA guarda senha ou senha_hash.

   ATENÇÃO: isto é conveniência de interface, NÃO segurança.
   A proteção real das telas e dos dados é feita no Flask
   (validando o token/cookie em cada requisição à API).
   ============================================================ */

const CHAVE_SESSAO = 'aquasmart_sessao';

function salvarSessao(dados) {
  const sessao = {                       // lista fixa de campos permitidos
    usuario_id: dados.usuario_id,
    propriedade_id: dados.propriedade_id ?? null,
    nome: dados.nome,
    email: dados.email,
    token: dados.token ?? null
  };
  sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(sessao));
}

function getSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO)); }
  catch (e) { return null; }
}

function atualizarSessao(parcial) {
  const atual = getSessao();
  if (atual) salvarSessao({ ...atual, ...parcial });
}

function limparSessao() { sessionStorage.removeItem(CHAVE_SESSAO); }

// Chamada no início das telas protegidas. Sem sessão → volta ao login.
function exigirLogin() {
  if (!getSessao()) { window.location.replace('../login/login.html'); return false; }
  return true;
}

/* ---------- cadastro em andamento (usuário criado, propriedade ainda não) ---------- */
// Entre a etapa 1 e a etapa 2 o usuário AINDA NÃO está logado: guardamos só o id (e o
// token temporário de cadastro, se o Flask devolver um). Nunca senha.
const CHAVE_CADASTRO = 'aquasmart_cadastro_pendente';
function salvarCadastroPendente(d) { sessionStorage.setItem(CHAVE_CADASTRO, JSON.stringify({ usuario_id: d.usuario_id, token: d.token ?? null })); }
function getCadastroPendente() { try { return JSON.parse(sessionStorage.getItem(CHAVE_CADASTRO)); } catch (e) { return null; } }
function limparCadastroPendente() { sessionStorage.removeItem(CHAVE_CADASTRO); }

/* ---------- aviso para a próxima tela (lido uma única vez) ---------- */
const CHAVE_AVISO = 'aquasmart_aviso';
function definirAviso(texto) { sessionStorage.setItem(CHAVE_AVISO, texto); }
function lerAviso() { const t = sessionStorage.getItem(CHAVE_AVISO); sessionStorage.removeItem(CHAVE_AVISO); return t; }
