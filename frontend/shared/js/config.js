/* ============================================================
   config.js — MODO DE DADOS do front-end: "demo" ou "api".

   demo → dados simulados, gerados neste navegador (demo.js e
          mockData.js). Nada é enviado ao servidor.
   api  → tudo vem da API Flask / PostgreSQL (api.js usa fetch).

   Os dois modos NUNCA se misturam: ao trocar de modo a sessão é
   encerrada e o usuário volta ao login.

   Como escolher:
   - padrão: demo (funciona abrindo os arquivos, sem back-end);
   - abrir qualquer tela com ?modo=api ou ?modo=demo troca e LEMBRA;
   - não há botão na tela: o modo só muda pelo endereço (?modo=...), e trocar encerra a sessão.
   ============================================================ */
const MODO_CHAVE = 'aquasmart_modo';
const MODO_PADRAO = 'demo';

function modoDados() {
  let modo = null;
  try { modo = new URLSearchParams(window.location.search).get('modo'); } catch (e) { /* sem URL */ }
  if (modo === 'api' || modo === 'demo') {
    try {
      if (localStorage.getItem(MODO_CHAVE) !== modo) sessionStorage.removeItem('aquasmart_sessao');   // trocar de modo encerra a sessão (os modos não se misturam)
      localStorage.setItem(MODO_CHAVE, modo);
    } catch (e) { /* ignora */ }
    return modo;
  }
  try { const salvo = localStorage.getItem(MODO_CHAVE); if (salvo === 'api' || salvo === 'demo') return salvo; } catch (e) { /* ignora */ }
  return MODO_PADRAO;
}
const MODO_DADOS = modoDados();
const USAR_MOCK = MODO_DADOS === 'demo';
