/* irrigacoes.js — eventos de irrigação (tabela eventos_irrigacao).
   Os KPIs usam o período inteiro; a lista mostra UM dia por vez. Os eventos são
   os MESMOS que aparecem no Histórico (estado da irrigação) e no Consumo (volume). */
let periodoAtual = null, dados = null, eventosDoDia = [], controle, pagDias;
const carregarPeriodo = criarCarregador();
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if (!exigirLogin()) return;
  montarLayout('irrigacoes');
  definirTopo('Irrigações', 'Veja quando e por quanto tempo sua propriedade foi irrigada.');
  [['r1', 'drop', 'Irrigações'], ['r2', 'history', 'Tempo irrigando'], ['r3', 'drop', 'Água utilizada'], ['r4', 'waves', 'Vazão média']]
    .forEach(([id, ic, txt]) => { $(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; });
  pagDias = criarPaginacaoDias($('paginacaoDias'), dia => mostrarDia(dia));
  Estado.carregando($('eventos'));
  controle = criarControlePeriodo($('filtro'), {
    fonte: 'eventos',
    aoMudar: ({ periodo }) => carregar(periodo),
    aoErro: e => Estado.erro($('eventos'), e.message, () => window.location.reload())
  });
});

async function carregar(periodo, manterDia) {
  periodoAtual = periodo;
  const manter = manterDia ? pagDias.dia : null;
  Estado.carregando($('eventos')); $('tagsDia').innerHTML = '';
  pagDias.esconder();
  try {
    const r = await carregarPeriodo(sinal => getIrrigacoesData(periodo.inicio, periodo.fim, { signal: sinal }));
    if (!r) return;
    dados = { periodo, eventos: Analise.eventosOrdenados(r.dados.eventos) };
  } catch (e) { Estado.erro($('eventos'), e.message, () => carregar(periodo)); return; }
  renderizarKpis();
  $('subEventos').textContent = Tempo.subtituloPeriodo(periodo, 'irrigacoes');   // só a descrição do filtro
  const dia = pagDias.definir(Tempo.diasComDados(periodo, new Set(dados.eventos.map(e => e.dia))), periodo, manter, 'Irrigações');
  mostrarDia(dia);
}

function renderizarKpis() {
  const { periodo, eventos } = dados;
  const ind = Analise.indicadoresIrrigacao(eventos);
  const rotulo = Tempo.rotuloCurtoPeriodo(periodo);
  ['t1', 't2', 't3', 't4'].forEach(id => { $(id).textContent = rotulo; });
  $('kQtd').textContent = ind.quantidade;
  $('nQtd').textContent = ind.abertos ? `${ind.abertos} em andamento` : '';
  $('kTempo').textContent = ind.quantidade ? formatarDuracao(ind.minutos) : '—';
  $('nTempo').textContent = ind.abertos ? 'sem contar a irrigação em andamento' : '';
  $('kAgua').textContent = formatarLitros(ind.litros);
  $('nAgua').textContent = [ind.estimados ? `${ind.estimados} estimado${ind.estimados > 1 ? 's' : ''}` : '', ind.semMedicao ? `${ind.semMedicao} sem medição` : ''].filter(Boolean).join(' · ');
  $('kVazao').innerHTML = ind.vazaoMedia == null ? '—' : `${formatarNumero(ind.vazaoMedia, 1)}<small>L/min</small>`;
}

function mostrarDia(dia) {
  const { periodo, eventos } = dados;
  const lista = $('eventos');
  if (!dia) {
    $('tagsDia').innerHTML = '';
    Estado.vazio(lista, Tempo.mensagemSemRegistros(periodo, 'irrigacao'), `Período: ${Tempo.descreverPeriodo(periodo)}.`);
    return;
  }
  eventosDoDia = eventos.filter(e => e.dia === dia).sort((a, b) => a.ini < b.ini ? 1 : a.ini > b.ini ? -1 : 0);   // do mais recente para o mais antigo (cópia: a fonte não muda)
  const ind = Analise.indicadoresIrrigacao(eventosDoDia);
  desenharLista();
  desenharTags(dia, ind);
}

function desenharLista() {
  const lista = $('eventos');
  lista.innerHTML = '';
  eventosDoDia.forEach(e => {
    const card = document.createElement('article');
    card.className = 'card evento' + (e.aberto ? ' aberto' : '');
    card.innerHTML = `<div class="evento-data"><small class="data"></small><span class="hora"></span><span class="selos"></span></div>
      <div class="evento-dados">
        <div><small>Duração</small><strong class="d"></strong></div>
        <div><small>Água utilizada</small><strong class="azul a"></strong></div>
        <div><small>Vazão média</small><strong class="v"></strong></div>
        <div class="antes-depois">
          <div><small>Antes</small><strong class="verde ua"></strong></div>
          <div><small>Depois</small><strong class="verde ud"></strong></div></div></div>`;
    card.querySelector('.data').textContent = Tempo.dataBR(e.dia);
    card.querySelector('.hora').textContent = `${Tempo.horaCurta(e.ini)} – ${e.fim ? Tempo.horaCurta(e.fim) + (e.fim.slice(0, 10) !== e.dia ? ' (dia seguinte)' : '') : 'em andamento'}`;
    const selos = card.querySelector('.selos');
    const selo = (txt, cls, dica) => { const s = document.createElement('span'); s.className = 'chip ' + cls; s.textContent = txt; if (dica) s.title = dica; selos.appendChild(s); };
    if (e.aberto) selo('Em andamento', 'chip-aberto', 'Ainda irrigando: duração e volume serão fechados quando a irrigação terminar.');
    if (e.estimado) selo('Volume estimado', 'chip-estimado', 'Sem leituras de vazão: volume calculado pela vazão nominal × tempo.');
    if (e.semMedicao) selo('Volume não medido', 'chip-estimado', 'O dispositivo não enviou vazão nem volume: 0 L registrado, mas NÃO medido.');
    card.querySelector('.d').textContent = e.aberto ? '—' : formatarDuracao(e.duracao);
    card.querySelector('.a').textContent = e.aberto ? '—' : formatarLitros(e.litros);
    card.querySelector('.v').textContent = e.vazaoMedia == null ? '—' : `${formatarNumero(e.vazaoMedia, 1)} L/min`;
    const pct = v => v == null ? '—' : formatarNumero(v, 0, 1) + '%';
    card.querySelector('.ua').textContent = pct(e.antes);
    card.querySelector('.ud').textContent = pct(e.depois);
    lista.appendChild(card);
  });
  const fim = document.createElement('p');
  fim.className = 'fim-lista'; fim.textContent = 'Sem mais irrigações neste dia.';
  lista.appendChild(fim);
}

/* Tags abaixo da lista: água e tempo do DIA exibido (a lista mostra um dia por vez). */
function desenharTags(dia, ind) {
  const el = $('tagsDia');
  el.innerHTML = '';
  const qtd = ind.quantidade;
  [['QTD', 'Irrigações', String(qtd), 'maior'],
   ['AGUA', 'Água utilizada', formatarLitros(ind.litros), 'menor'],
   ['TEMPO', 'Tempo irrigando', formatarDuracao(ind.minutos), 'media']].forEach(([, nome, valor, cor]) => {
    const t = document.createElement('article');
    t.className = 'resumo tag-resumo ' + cor;
    t.title = `${nome} em ${Tempo.dataBR(dia)}`;
    t.innerHTML = '<small></small><strong></strong><span></span>';
    t.children[0].textContent = nome.toUpperCase(); t.children[1].textContent = valor; t.children[2].textContent = `dia ${Tempo.dataCurta(dia)}`;
    el.appendChild(t);
  });
}
