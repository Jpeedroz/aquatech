/* ============================================================
   componentes.js — peças de tela reutilizadas por Dashboard, Histórico,
   Irrigações e Consumo:

   - Estado            carregando / erro (com "tentar novamente") / vazio
   - criarCarregador   evita que uma resposta ANTIGA sobrescreva a nova
   - criarControlePeriodo   Hoje | 7 dias | 1 mês | Personalizado + calendário
   - abrirCalendario   calendário acessível que só deixa escolher dias com dados
   - criarPaginacaoDias     "← Anterior  Dia 3 de 7 — 19/10/2026  Próximo →"
                            (única paginação do sistema; fica FORA e ABAIXO da caixa principal)
   ============================================================ */

/* ---------- estados da tela ---------- */
const Estado = {
  carregando(el, texto) {
    el.innerHTML = '<div class="estado" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span></span></div>';
    el.querySelector('span:last-child').textContent = texto || 'Carregando dados...';
  },
  erro(el, mensagem, aoTentar) {
    el.innerHTML = '<div class="estado estado-erro" role="alert"><strong>Não foi possível carregar os dados.</strong><span></span></div>';
    el.querySelector('span').textContent = mensagem;
    if (aoTentar) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn btn-contorno btn-pequeno'; b.textContent = 'Tentar novamente';
      b.addEventListener('click', aoTentar);
      el.firstElementChild.appendChild(b);
    }
  },
  vazio(el, mensagem, dica) {
    el.innerHTML = '<div class="estado estado-vazio"><strong></strong><span></span></div>';
    el.querySelector('strong').textContent = mensagem;
    el.querySelector('span').textContent = dica || '';
  }
};

/* ---------- só a resposta mais recente vale ----------
   const carregar = criarCarregador();
   const r = await carregar(sinal => getHistoricoData(a, b, { signal: sinal }));
   if (!r) return;            // chegou uma resposta velha (ou foi cancelada): ignora
   usar(r.dados);                                                              */
function criarCarregador() {
  let contador = 0, controle = null;
  return async function (buscar) {
    const meu = ++contador;
    if (controle) controle.abort();                 // cancela o pedido anterior ainda em andamento
    controle = new AbortController();
    try {
      const dados = await buscar(controle.signal);
      return meu === contador ? { dados } : null;
    } catch (e) {
      if (e.name === 'AbortError' || meu !== contador) return null;
      throw e;
    }
  };
}

/* ---------- calendário acessível ----------
   Mostra um mês; só dias com dados (e dentro de min..max) podem ser escolhidos.
   Setas movem entre os dias, PageUp/PageDown trocam o mês, Esc fecha. */
let calendarioAberto = null;
function fecharCalendario() {
  if (!calendarioAberto) return;
  const { el, aoFechar } = calendarioAberto;
  document.removeEventListener('mousedown', calendarioAberto.fora, true);
  document.removeEventListener('keydown', calendarioAberto.tecla, true);
  el.remove(); calendarioAberto = null;
  if (aoFechar) aoFechar();
}
function abrirCalendario({ ancora, valor, disponiveis, min, max, titulo, aoEscolher }) {
  fecharCalendario();
  const dias = disponiveis instanceof Set ? disponiveis : new Set(disponiveis);
  const lista = [...dias].filter(d => (!min || d >= min) && (!max || d <= max)).sort();
  const ultimo = max || (lista.length ? lista[lista.length - 1] : Tempo.hoje());
  const limiteAntigo = Tempo.somarDias(ultimo, -365);                              // períodos têm no máximo 366 dias
  const primeiro = limiteAntigo;                                                   // qualquer dia até hoje pode ser escolhido; sem registros → a tela avisa
  const podeEscolher = d => (!min || d >= min) && (!max || d <= max) && d >= limiteAntigo;
  let ano = +(valor || ultimo).slice(0, 4), mes = +(valor || ultimo).slice(5, 7) - 1;
  const el = document.createElement('div');
  el.className = 'calendario card'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', titulo || 'Escolher data');

  function desenhar(focoDia) {
    const nomeMes = Tempo.mesNome(mes);
    const deslocamento = Tempo.diaDaSemana(`${ano}-${Tempo.dois(mes + 1)}-01`);
    const total = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
    const mesAnteriorOk = `${ano}-${Tempo.dois(mes + 1)}` > primeiro.slice(0, 7);
    const proximoOk = `${ano}-${Tempo.dois(mes + 1)}` < ultimo.slice(0, 7);
    el.innerHTML = `<div class="cal-topo">
        <button type="button" class="cal-nav" data-nav="-1" aria-label="Mês anterior" ${mesAnteriorOk ? '' : 'disabled'}>‹</button>
        <strong aria-live="polite">${nomeMes} de ${ano}</strong>
        <button type="button" class="cal-nav" data-nav="1" aria-label="Próximo mês" ${proximoOk ? '' : 'disabled'}>›</button></div>
      <div class="cal-grade" role="grid">${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => `<span class="cal-sem" aria-hidden="true" title="${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][i]}">${d}</span>`).join('')}</div>
      <p class="cal-rodape"></p>`;
    const grade = el.querySelector('.cal-grade');
    for (let i = 0; i < deslocamento; i++) grade.appendChild(document.createElement('span'));
    for (let d = 1; d <= total; d++) {
      const iso = `${ano}-${Tempo.dois(mes + 1)}-${Tempo.dois(d)}`;
      const ok = podeEscolher(iso), temDados = dias.has(iso);
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = d; b.dataset.dia = iso;
      b.className = 'cal-dia' + (iso === valor ? ' escolhido' : '') + (iso === Tempo.hoje() ? ' hoje' : '') + (ok && !temDados ? ' sem-dados' : '');
      b.disabled = !ok;
      b.setAttribute('aria-label', `${Tempo.diaMesExtenso(iso)} de ${ano}${ok && temDados ? '' : ok ? ', sem registros' : ', indisponível'}`);
      if (iso === valor) b.setAttribute('aria-pressed', 'true');
      grade.appendChild(b);
    }
    el.querySelector('.cal-rodape').textContent = lista.length
      ? 'Dias em cinza claro não têm registros (você pode escolhê-los).' : 'Ainda não há dados registrados.';
    const alvo = (focoDia && el.querySelector(`[data-dia="${focoDia}"]:not(:disabled)`)) ||
      el.querySelector('.cal-dia.escolhido:not(:disabled)') || el.querySelector('.cal-dia:not(:disabled)') || el.querySelector('.cal-nav:not(:disabled)');
    if (alvo) alvo.focus();
  }
  function mudarMes(n, foco) { mes += n; if (mes < 0) { mes = 11; ano--; } if (mes > 11) { mes = 0; ano++; } desenhar(foco); }

  el.addEventListener('click', ev => {
    const nav = ev.target.closest('[data-nav]');
    if (nav) { mudarMes(+nav.dataset.nav); return; }
    const dia = ev.target.closest('.cal-dia');
    if (dia && !dia.disabled) { const d = dia.dataset.dia; fecharCalendario(); aoEscolher(d); }
  });
  const tecla = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); fecharCalendario(); ancora.focus(); return; }
    const atual = document.activeElement;
    if (!atual || !atual.classList.contains('cal-dia')) return;
    const passo = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    if (passo) {                                    // vai ao próximo dia habilitado naquela direção
      ev.preventDefault();
      let d = atual.dataset.dia;
      for (let i = 0; i < 400; i++) {
        d = Tempo.somarDias(d, passo);
        if (podeEscolher(d)) {
          if (+d.slice(0, 4) !== ano || +d.slice(5, 7) - 1 !== mes) { ano = +d.slice(0, 4); mes = +d.slice(5, 7) - 1; desenhar(d); }
          else el.querySelector(`[data-dia="${d}"]`).focus();
          return;
        }
        if ((passo < 0 && d < primeiro) || (passo > 0 && d > ultimo)) return;
      }
    } else if (ev.key === 'PageUp' || ev.key === 'PageDown') { ev.preventDefault(); mudarMes(ev.key === 'PageUp' ? -1 : 1); }
  };
  const fora = ev => { if (!el.contains(ev.target) && ev.target !== ancora) fecharCalendario(); };
  document.body.appendChild(el);
  const r = ancora.getBoundingClientRect();
  el.style.top = `${r.bottom + window.scrollY + 6}px`;
  el.style.left = `${Math.max(8, Math.min(r.left + window.scrollX, window.innerWidth - 300))}px`;
  document.addEventListener('mousedown', fora, true);
  document.addEventListener('keydown', tecla, true);
  calendarioAberto = { el, fora, tecla, aoFechar: null };
  desenhar(valor);
}

/* ---------- controle de período ----------
   container recebe: Hoje | 7 dias | 1 mês | Personalizado.
   fonte: de onde vêm os dias com dados para o calendário ('leituras' | 'eventos' | 'consumo').
   aoMudar({ periodo, disponiveis })  → disponiveis é um Set com os dias que têm dados.
   aoErro(erro)                       → quando não for possível carregar a lista de dias. */
function criarControlePeriodo(container, { fonte, aoMudar, aoErro }) {
  const opcoes = [['hoje', 'Hoje'], ['7dias', '7 dias'], ['1mes', '1 mês'], ['personalizado', 'Personalizado']];
  let atual = 'hoje', disponiveis = new Set(), carregou = false;
  const escolha = { ini: null, fim: null };
  const carregarDias = criarCarregador();
  container.classList.add('periodo');
  container.innerHTML = `<div class="periodo-opcoes" role="group" aria-label="Período"></div>
    <div class="periodo-custom" hidden>
      <div class="data-campo"><span>De</span><button type="button" class="data-btn" data-campo="ini"></button></div>
      <div class="data-campo"><span>Até</span><button type="button" class="data-btn" data-campo="fim"></button></div>
      <button type="button" class="btn btn-azul btn-pequeno f-aplicar">Aplicar</button>
      <span class="erro-texto f-erro" role="alert"></span>
    </div>`;
  const area = container.querySelector('.periodo-opcoes');
  const custom = container.querySelector('.periodo-custom');
  const erro = container.querySelector('.f-erro');
  const botoes = opcoes.map(([v, t]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = t; b.dataset.valor = v;
    b.addEventListener('click', () => escolher(v));
    area.appendChild(b); return b;
  });
  const marcar = () => botoes.forEach(b => { const on = b.dataset.valor === atual; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', on); });
  const textoData = d => d ? Tempo.dataBR(d) : 'Escolher data';
  const pintarDatas = () => custom.querySelectorAll('.data-btn').forEach(b => { b.textContent = textoData(escolha[b.dataset.campo]); });

  custom.querySelectorAll('.data-btn').forEach(b => b.addEventListener('click', () => {
    const campo = b.dataset.campo;
    erro.textContent = '';
    abrirCalendario({
      ancora: b, valor: escolha[campo], disponiveis, max: Tempo.hoje(),
      titulo: campo === 'ini' ? 'Data inicial' : 'Data final',
      aoEscolher: d => { escolha[campo] = d; pintarDatas(); b.focus(); }
    });
  }));
  custom.querySelector('.f-aplicar').addEventListener('click', () => {
    const v = Tempo.validarPersonalizado(escolha.ini, escolha.fim, { disponiveis });
    erro.textContent = v.erro;
    if (!v.ok) return;
    aoMudar({ periodo: Tempo.resolverPeriodo('personalizado', escolha.ini, escolha.fim), disponiveis });
  });

  function escolher(tipo) {
    atual = tipo; marcar(); erro.textContent = ''; fecharCalendario();
    if (tipo === 'personalizado') {
      custom.hidden = false;
      if (!escolha.fim) {                           // sugestão: últimos dias com dados (só vale ao clicar em Aplicar)
        const lista = [...disponiveis].sort();
        if (lista.length) { escolha.fim = lista[lista.length - 1]; escolha.ini = lista.find(d => d >= Tempo.somarDias(escolha.fim, -6)) || escolha.fim; }
      }
      pintarDatas(); return;
    }
    custom.hidden = true;
    aoMudar({ periodo: Tempo.resolverPeriodo(tipo), disponiveis });
  }

  async function atualizarDias() {                  // (re)carrega a lista de dias com dados
    try {
      const r = await carregarDias(sinal => getDiasDisponiveis(fonte, { signal: sinal }));
      if (!r) return false;
      disponiveis = new Set(r.dados); carregou = true; return true;
    } catch (e) { if (aoErro) aoErro(e); return false; }
  }
  marcar(); pintarDatas();
  const pronto = atualizarDias().then(ok => { if (ok) escolher('hoje'); });
  return {
    pronto,
    get periodo() { return atual === 'personalizado' && escolha.ini ? Tempo.resolverPeriodo('personalizado', escolha.ini, escolha.fim) : Tempo.resolverPeriodo(atual === 'personalizado' ? 'hoje' : atual); },
    get disponiveis() { return disponiveis; },
    async recarregarDias() { const ok = await atualizarDias(); return ok ? disponiveis : null; }
  };
}

/* ---------- paginação por dia ----------
   Aparece só quando o período tem mais de 1 dia. Navega pelos dias QUE TÊM dados,
   começando pelo mais recente. Trocar o filtro reinicia a navegação. */
/* Paginação SEMANAL (só Consumo de água): blocos de até 7 dias a partir da data inicial do filtro.
   Só aparece quando o período tem mais de 7 dias; não seleciona um dia específico. */
function criarPaginacaoSemanas(container, aoMudar) {
  container.classList.add('pag-dias-area');
  container.hidden = true;
  let blocos = [], i = 0;
  const nav = document.createElement('nav');
  nav.className = 'pag-dias'; nav.setAttribute('aria-label', 'Navegar entre as semanas do período');
  nav.innerHTML = `<button type="button" class="btn btn-claro btn-pequeno" data-a="ant">← Semana anterior</button>
    <div class="pag-dias-info" aria-live="polite"><strong></strong><span></span></div>
    <button type="button" class="btn btn-claro btn-pequeno" data-a="prox">Próxima semana →</button>`;
  container.appendChild(nav);
  const ant = nav.querySelector('[data-a=ant]'), prox = nav.querySelector('[data-a=prox]');
  function pintar() {
    const b = blocos[i];
    container.hidden = !b;
    if (!b) return;
    nav.querySelector('strong').textContent = `Semana ${i + 1} de ${blocos.length} — ${Tempo.dataCurta(b.inicio)} a ${Tempo.dataCurta(b.fim)}`;
    nav.querySelector('span').textContent = `${b.dias.length} ${b.dias.length === 1 ? 'dia' : 'dias'}`;
    ant.disabled = i <= 0; prox.disabled = i >= blocos.length - 1;
  }
  const ir = novo => { if (novo < 0 || novo >= blocos.length) return; i = novo; pintar(); aoMudar(blocos[i]); };
  ant.addEventListener('click', () => ir(i - 1));
  prox.addEventListener('click', () => ir(i + 1));
  return {
    /* Divide o período em semanas. Devolve o bloco exibido (a semana mais recente) ou null quando o período tem até 7 dias (sem paginação). */
    definir(periodo) {
      blocos = periodo.dias > 7 ? Tempo.blocosSemanais(periodo.inicio, periodo.fim) : [];
      i = Math.max(0, blocos.length - 1);
      pintar(); return blocos[i] || null;
    },
    get bloco() { return blocos[i] || null; },
    get total() { return blocos.length; },
    get indice() { return i; },
    esconder() { blocos = []; i = 0; container.hidden = true; }
  };
}

function criarPaginacaoDias(container, aoMudar) {
  container.classList.add('pag-dias-area');
  container.hidden = true;
  let pag = null, diasPeriodo = 1, cobertura = '';
  const nav = document.createElement('nav');
  nav.className = 'pag-dias'; nav.setAttribute('aria-label', 'Navegar entre os dias do período');
  nav.innerHTML = `<button type="button" class="btn btn-claro btn-pequeno" data-a="ant">← Anterior</button>
    <div class="pag-dias-info" aria-live="polite"><strong></strong><span></span></div>
    <button type="button" class="btn btn-claro btn-pequeno" data-a="prox">Próximo →</button>`;
  container.appendChild(nav);
  const ant = nav.querySelector('[data-a=ant]'), prox = nav.querySelector('[data-a=prox]');
  function pintar() {
    const visivel = diasPeriodo > 1 && pag && pag.total > 0;
    container.hidden = !visivel;
    if (!visivel) return;
    nav.querySelector('strong').textContent = `Dia ${pag.posicao} de ${pag.total} — ${Tempo.dataBR(pag.dia)}`;
    nav.querySelector('span').textContent = Tempo.nomeSemana(pag.dia) + (cobertura ? ` · ${cobertura}` : '');
    ant.disabled = !pag.podeAnterior; prox.disabled = !pag.podeProximo;
  }
  ant.addEventListener('click', () => { if (pag.podeAnterior) { pag.anterior(); pintar(); aoMudar(pag.dia); } });
  prox.addEventListener('click', () => { if (pag.podeProximo) { pag.proximo(); pintar(); aoMudar(pag.dia); } });
  return {
    /* dias: lista de dias COM dados; periodo: o período escolhido. Devolve o dia exibido (ou null). */
    definir(dias, periodo, manterDia, rotulo) {
      pag = Tempo.criarPaginaDias(dias, manterDia);
      diasPeriodo = periodo.dias; cobertura = Tempo.coberturaDias(periodo, dias, rotulo);   // ex.: "Medições registradas em 3 de 7 dias"
      pintar(); return pag.dia;
    },
    selecionar(dia) { if (pag && pag.irPara(dia)) { pintar(); } return pag ? pag.dia : null; },
    get dia() { return pag ? pag.dia : null; },
    esconder() { pag = null; container.hidden = true; }
  };
}
