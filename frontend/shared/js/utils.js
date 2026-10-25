/* ============================================================
   utils.js — funções gerais usadas por várias telas.
   (números, ícones, menu lateral, mensagens e janela modal;
   datas e períodos ficam em tempo.js, filtros em componentes.js)
   ============================================================ */

// Listas usadas no cadastro da propriedade e em Configurações
const CULTURAS = ['Cebola','Milho','Feijão','Tomate','Mandioca','Pimentão','Banana','Capim','Outra'];
const METODOS_IRRIGACAO = [
  { valor: "Bomba d'água", titulo: "Bomba d'água", descricao: 'Irrigação motorizada' },
  { valor: 'Gravidade',    titulo: 'Gravidade',    descricao: 'Irrigação por gravidade' }
];

/* ---------- datas ----------
   Toda a lógica de data/período fica em tempo.js (fuso America/Fortaleza). */
function dois(n) { return String(n).padStart(2, '0'); }

/* ---------- números e textos ---------- */
function formatarNumero(n, casas = 0, maxCasas = casas) { return Number(n).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: Math.max(casas, maxCasas) }); }
// litros: mostra até 1 casa decimal (150,5 L), para que as somas das telas fechem exatamente
function formatarLitros(n) { return formatarNumero(n, 0, 1) + ' L'; }
function formatarDuracao(min) {
  if (min == null) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}h ${m}min`;
  return h ? `${h}h` : `${m}min`;
}
function media(lista) { return lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null; }
function primeiroNome(nome) { return (nome || '').trim().split(/\s+/)[0]; }
function saudacao() { const h = +Tempo.agora().slice(11, 13); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }   // hora de Fortaleza
function validarEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

function aplicarMascaraTelefone(input) {
  input.addEventListener('input', () => {
    let v = input.value.replace(/\D/g, '').slice(0, 11);
    const corte = v.length > 10 ? 7 : 6;
    if (v.length > 6) v = `(${v.slice(0, 2)}) ${v.slice(2, corte)}-${v.slice(corte)}`;
    else if (v.length > 2) v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
    input.value = v;
  });
}

/* ---------- ícones (SVG inline, traço simples) ---------- */
const ICONES = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  waves: '<path d="M3 9c3-2 6 2 9 0s6 2 9 0M3 14c3-2 6 2 9 0s6 2 9 0M3 19c3-2 6 2 9 0s6 2 9 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14 3h-4l-.6 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2L10 21h4l.6-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  thermo: '<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/>',
  bars: '<path d="M5 20V12M12 20V6M19 20v-8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12l5 5 9-10"/>'
};
function icone(nome, tamanho = 18) {
  return `<svg class="icone" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome]}</svg>`;
}

/* ---------- layout das telas internas (menu lateral + topo) ---------- */
function montarLayout(paginaAtual) {
  const sessao = getSessao();
  const itens = [
    ['dashboard', 'Dashboard', 'home'],
    ['historico', 'Histórico', 'history'],
    ['irrigacoes', 'Irrigações', 'drop'],
    ['consumo', 'Consumo de água', 'waves', 'Consumo'],
    ['configuracoes', 'Configurações', 'gear', 'Config.']
  ];
  document.getElementById('sidebar').innerHTML = `
    <img class="sidebar-logo" src="../assets/logos/logo-sidebar.png" alt="AquaSmart">
    <nav class="menu">
      ${itens.map(([id, texto, ic, curto]) =>
        `<a class="menu-item ${id === paginaAtual ? 'ativo' : ''}" href="../${id}/${id}.html">${icone(ic)}<span class="rot-longo">${texto}</span><span class="rot-curto">${curto || texto}</span></a>`).join('')}
    </nav>
    <div class="sidebar-rodape">
      <a class="usuario ${paginaAtual === 'configuracoes' ? 'ativo' : ''}" id="menuPerfil" href="../configuracoes/configuracoes.html" title="Abrir configurações" aria-label="Abrir configurações do perfil"><span class="avatar" id="menuAvatar"></span>
        <div><strong id="menuNome"></strong><small>Proprietário</small></div></a>
      <button class="btn-sair" id="btnSair" type="button">${icone('logout')}<span>Sair</span></button>
    </div>`;
  atualizarUsuarioNoMenu(sessao.nome);
  document.getElementById('btnSair').addEventListener('click', sair);   // sair() está em api.js
}
function atualizarUsuarioNoMenu(nome) {
  if (!nome || /^demonstra/i.test(nome.trim())) nome = 'Usuário';       // sessões antigas guardavam "Demonstração"
  document.getElementById('menuNome').textContent = nome;               // textContent evita injeção de HTML
  document.getElementById('menuAvatar').textContent = (nome || '?')[0].toUpperCase();
}
function definirTopo(titulo, subtitulo) {
  document.getElementById('tituloPagina').textContent = titulo;
  document.getElementById('subtituloPagina').textContent = subtitulo;
}

/* ---------- mensagens (toast) ---------- */
function mostrarMensagem(texto, tipo = 'sucesso') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/* ---------- janela modal genérica (usada em senha e e-mail) ---------- */
function abrirModal({ titulo, texto, campos, textoConfirmar, aoConfirmar }) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  fundo.innerHTML = `<div class="modal"><h3></h3><p class="modal-texto"></p><div class="modal-campos"></div>
    <p class="erro-texto"></p>
    <div class="modal-botoes"><button type="button" class="btn btn-claro" data-acao="cancelar">Cancelar</button>
    <button type="button" class="btn btn-azul" data-acao="ok"></button></div></div>`;
  fundo.querySelector('h3').textContent = titulo;
  fundo.querySelector('.modal-texto').textContent = texto || '';
  fundo.querySelector('[data-acao=ok]').textContent = textoConfirmar;
  const areaCampos = fundo.querySelector('.modal-campos');
  campos.forEach(c => {
    const l = document.createElement('label');
    l.className = 'campo';
    l.innerHTML = '<span></span><input autocomplete="off">';
    l.querySelector('span').textContent = c.label;
    const inp = l.querySelector('input');
    inp.type = c.tipo || 'text'; inp.id = 'modal_' + c.id;
    Object.entries(c.atributos || {}).forEach(([k, v]) => inp.setAttribute(k, v));   // ex.: min, max, step, inputmode
    if (c.valor != null) inp.value = c.valor;
    areaCampos.appendChild(l);
  });
  const erro = fundo.querySelector('.erro-texto');
  const aoTeclar = ev => { if (ev.key === 'Escape') fundo.remove(); };
  document.addEventListener('keydown', aoTeclar);
  new MutationObserver((_, obs) => { if (!fundo.isConnected) { document.removeEventListener('keydown', aoTeclar); obs.disconnect(); } })
    .observe(document.body, { childList: true });
  fundo.querySelector('[data-acao=cancelar]').onclick = () => fundo.remove();
  fundo.querySelector('[data-acao=ok]').onclick = async () => {
    const valores = {};
    campos.forEach(c => { valores[c.id] = fundo.querySelector('#modal_' + c.id).value; });
    try {
      const msg = await aoConfirmar(valores);
      fundo.remove();
      if (msg) mostrarMensagem(msg, 'sucesso');
    } catch (e) { erro.textContent = e.message; }
  };
  document.body.appendChild(fundo);
}
