/* historico.js — medições dos sensores no período escolhido.
   Os KPIs usam o período inteiro. A tabela mostra UM dia por vez ("Anterior / Próximo"):
   é a única paginação (não há paginação por linhas). O estado da irrigação e o consumo acumulado vêm dos MESMOS
   eventos exibidos em Irrigações e Consumo. */
let periodoAtual = null, dados = null, linhasDoDia = [], controle, pagDias;
const carregarPeriodo = criarCarregador();
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if (!exigirLogin()) return;
  montarLayout('historico');
  definirTopo('Histórico', 'Medições dos sensores');
  [['r1', 'drop', 'Umidade média'], ['r2', 'thermo', 'Temperatura média'], ['r3', 'bars', 'Menor umidade'], ['r4', 'history', 'Maior temperatura']]
    .forEach(([id, ic, txt]) => { $(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; });
  pagDias = criarPaginacaoDias($('paginacaoDias'), dia => mostrarDia(dia));
  Estado.carregando($('tabela'));
  controle = criarControlePeriodo($('filtro'), {
    fonte: 'leituras',
    aoMudar: ({ periodo }) => carregar(periodo),
    aoErro: e => Estado.erro($('tabela'), e.message, () => window.location.reload())
  });
});

async function carregar(periodo, manterDia) {
  periodoAtual = periodo;
  const manter = manterDia ? pagDias.dia : null;
  Estado.carregando($('tabela'));
  pagDias.esconder();
  try {
    const r = await carregarPeriodo(sinal => getHistoricoData(periodo.inicio, periodo.fim, { signal: sinal }));
    if (!r) return;
    const eventos = Analise.eventosOrdenados(r.dados.eventos);
    const linhas = Analise.linhasHistorico(r.dados.leituras, eventos);
    dados = { periodo, eventos, linhas, grupos: Analise.pontosDeMedicao(Analise.agruparLeituras(r.dados.leituras)) };
  } catch (e) { Estado.erro($('tabela'), e.message, () => carregar(periodo)); return; }

  renderizarKpis();
  const dias = Tempo.diasComDados(periodo, new Set(dados.linhas.map(l => l.dia)));
  const dia = pagDias.definir(dias, periodo, manter, 'Medições');
  mostrarDia(dia);
}

function renderizarKpis() {
  const { periodo, grupos } = dados;
  const i = Analise.indicadoresLeituras(grupos);
  const f = (v, un) => v == null ? '—' : `${formatarNumero(v, 0, 1)}${un}`;
  const quando = reg => reg ? (periodo.dias > 1 ? `${Tempo.dataCurta(reg.dia)} às ${Tempo.horaDe(reg.hora)}` : `às ${Tempo.horaDe(reg.hora)}`) : '';
  const rotulo = Tempo.rotuloCurtoPeriodo(periodo);
  $('kUmidMedia').textContent = f(i.umidadeMedia, '%'); $('nUmidMedia').textContent = i.quantidade ? `${i.quantidade} leituras · ${rotulo}` : '';
  $('kTempMedia').textContent = f(i.temperaturaMedia, '°C'); $('nTempMedia').textContent = i.quantidade ? rotulo : '';
  $('kUmidMin').textContent = i.umidadeMin ? f(i.umidadeMin.umidade, '%') : '—'; $('nUmidMin').textContent = quando(i.umidadeMin);
  $('kTempMax').textContent = i.temperaturaMax ? f(i.temperaturaMax.temperatura, '°C') : '—'; $('nTempMax').textContent = quando(i.temperaturaMax);
  ['t1', 't2', 't3', 't4'].forEach(id => { $(id).textContent = rotulo; });
}

function mostrarDia(dia) {
  const { periodo, linhas, eventos } = dados;
  if (!dia) {
    $('tituloMedicoes').textContent = 'Medições'; $('contagem').textContent = ''; $('resumoDia').textContent = '';
    Estado.vazio($('tabela'), Tempo.mensagemSemRegistros(periodo, 'medicao'), `Período: ${Tempo.descreverPeriodo(periodo)}.`);
    return;
  }
  linhasDoDia = linhas.filter(l => l.dia === dia);
  const doDia = eventos.filter(e => e.dia === dia);
  const ind = Analise.indicadoresIrrigacao(doDia);
  const ligadas = linhasDoDia.filter(l => l.ligada).length;
  $('tituloMedicoes').textContent = `Medições — ${Tempo.rotuloDia(dia)}`;
  $('contagem').textContent = `${linhasDoDia.length} ${linhasDoDia.length === 1 ? 'registro' : 'registros'} neste dia.`;
  let resumo = doDia.length
    ? `${ind.quantidade} ${ind.quantidade === 1 ? 'irrigação' : 'irrigações'} no dia · irrigação ligada em ${ligadas} ${ligadas === 1 ? 'registro' : 'registros'} · consumo do dia: ${formatarLitros(ind.litros)}`
    : 'Nenhuma irrigação neste dia · consumo do dia: 0 L';
  if (ind.abertos) resumo += ' · irrigação em andamento (volume ainda não somado)';
  if (ind.estimados) resumo += ` · ${ind.estimados} ${ind.estimados === 1 ? 'volume estimado' : 'volumes estimados'}`;
  $('resumoDia').textContent = resumo;
  desenharTabela();
}

function desenharTabela() {
  const area = $('tabela');
  const fmt = (v, un) => v == null ? '—' : `${formatarNumero(v, 0, 1)}${un}`;
  const tabela = document.createElement('table');
  tabela.innerHTML = `<thead><tr><th>HORÁRIO</th><th>UMIDADE</th><th>TEMPERATURA</th><th>IRRIGAÇÃO</th><th class="num-dir" title="Soma da água dos eventos do dia até este horário">CONSUMO ACUMULADO NO DIA</th></tr></thead><tbody></tbody>`;
  linhasDoDia.forEach(r => {
    const tr = document.createElement('tr');
    const celula = (texto, classe) => { const td = document.createElement('td'); td.textContent = texto; if (classe) td.className = classe; tr.appendChild(td); return td; };
    celula(Tempo.horaDe(r.hora) + (r.hora.slice(17, 19) !== '00' && r.hora.length > 16 ? r.hora.slice(16, 19) : ''));
    celula(fmt(r.umidade, '%'), 'num' + (r.ligada ? ' em-irrigacao' : ''));
    celula(fmt(r.temperatura, '°C'));
    const tdIrr = document.createElement('td');
    const selo = document.createElement('span');
    selo.className = 'selo' + (r.ligada ? ' ligada' : ''); selo.textContent = r.ligada ? 'Ligada' : 'Desligada';
    tdIrr.appendChild(selo); tr.appendChild(tdIrr);
    const td = celula((r.acumuladoEstimado ? '≈ ' : '') + formatarLitros(r.acumulado), 'num-dir');
    if (r.acumuladoEstimado) td.title = 'Valor estimado: não há leituras de vazão suficientes para este instante.';
    tabela.querySelector('tbody').appendChild(tr);
  });
  area.innerHTML = ''; area.appendChild(tabela);
}
