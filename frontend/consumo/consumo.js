/* consumo.js — consumo de água por dia.
   O consumo de um dia é a SOMA dos eventos de irrigação que começaram nele: são os mesmos
   eventos (mesmo volume) listados em Irrigações. Os 4 cartões do topo têm período FIXO
   (selo "fixo"); o gráfico e os indicadores abaixo seguem o filtro. */
let periodoAtual = null, dados = null, controle, pagSem;
const carregarPeriodo = criarCarregador();
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  if (!exigirLogin()) return;
  montarLayout('consumo');
  definirTopo('Consumo de água', 'Indicadores de eficiência hídrica');
  [['r1', 'drop', 'Hoje'], ['r2', 'drop', 'Últimos 7 dias'], ['r3', 'drop', 'Últimos 30 dias'], ['r4', 'history', 'Total registrado']]
    .forEach(([id, ic, txt]) => { $(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; });
  pagSem = criarPaginacaoSemanas($('paginacaoDias'), bloco => mostrarGrafico(bloco));   // navegação SEMANAL (só com mais de 7 dias)
  carregarFixos();
  Estado.carregando($('grafico'));
  controle = criarControlePeriodo($('filtro'), {
    fonte: 'consumo',
    aoMudar: ({ periodo }) => carregar(periodo),
    aoErro: e => Estado.erro($('grafico'), e.message, () => window.location.reload())
  });
});

async function carregarFixos() {
  try {
    const r = await getConsumoResumo();                       // GET /api/consumo/resumo
    const mostra = (id, v) => { $(id).innerHTML = `${formatarNumero(v, 0, 1)} <small>L</small>`; };
    mostra('cHoje', r.hoje); mostra('c7', r.ultimos_7_dias); mostra('c30', r.ultimos_30_dias); mostra('cTotal', r.total);
  } catch (e) { ['cHoje', 'c7', 'c30', 'cTotal'].forEach(id => { $(id).textContent = '—'; }); mostrarMensagem(e.message, 'erro'); }
}

async function carregar(periodo) {
  periodoAtual = periodo;
  Estado.carregando($('grafico'));
  pagSem.esconder();
  try {
    const r = await carregarPeriodo(sinal => getIrrigacoesData(periodo.inicio, periodo.fim, { signal: sinal }));
    if (!r) return;
    const eventos = Analise.eventosOrdenados(r.dados.eventos);
    dados = { periodo, eventos, porDia: Analise.consumoPorDia(eventos) };
  } catch (e) { Estado.erro($('grafico'), e.message, () => carregar(periodo)); return; }
  renderizarIndicadores();
  mostrarGrafico(dados.porDia.length ? pagSem.definir(periodo) : null);   // bloco da semana mais recente; null = até 7 dias (tudo num gráfico só) ou sem dados (sem paginação)
}

function renderizarIndicadores() {
  const { periodo, porDia } = dados;
  const est = Analise.estatisticaConsumo(porDia);
  const set = (id, txt) => { $(id).textContent = txt; };
  $('subGrafico').textContent = Tempo.subtituloPeriodo(periodo, 'consumo');   // só a descrição do filtro; os valores ficam nos indicadores
  if (!est.diasComConsumo) {
    ['maiorLitros', 'menorLitros', 'mediaDiaria'].forEach(id => set(id, '—'));
    ['maiorDia', 'menorDia', 'mediaTexto'].forEach(id => set(id, ''));
    return;
  }
  set('maiorLitros', formatarLitros(est.maior.litros)); set('maiorDia', Tempo.diaMesExtenso(est.maior.dia));     // nome → VALOR → data
  set('menorLitros', formatarLitros(est.menor.litros)); set('menorDia', Tempo.diaMesExtenso(est.menor.dia));
  set('mediaDiaria', `≈ ${formatarLitros(Analise.r1(est.mediaDiaria))}`);
  set('mediaTexto', `${formatarLitros(est.total)} ÷ ${est.diasComConsumo} ${est.diasComConsumo === 1 ? 'dia' : 'dias'}`);
}

/* bloco = semana exibida ({inicio, fim, dias}); null = período de até 7 dias, sem paginação.
   O gráfico mostra SÓ os dias do bloco; os indicadores (maior/menor/média) seguem o filtro inteiro. */
function mostrarGrafico(bloco) {
  const { periodo, porDia } = dados;
  const alvo = $('grafico');
  if (!porDia.length) {
    $('cobertura').textContent = '';
    Estado.vazio(alvo, Tempo.mensagemSemRegistros(periodo, 'irrigacao'), `Período: ${Tempo.descreverPeriodo(periodo)}.`);
    return;
  }
  $('cobertura').textContent = Tempo.coberturaDias(periodo, porDia.map(d => d.dia), 'Irrigações');   // ex.: "Irrigações registradas em 3 de 7 dias"
  const mapaDias = new Set(porDia.map(d => d.dia));
  if (bloco && !bloco.dias.some(d => mapaDias.has(d))) {      // semana sem nenhum registro (há registros em outras semanas)
    Estado.vazio(alvo, Tempo.mensagemSemRegistros({ tipo: '7dias' }, 'irrigacao'), `Semana de ${Tempo.dataBR(bloco.inicio)} a ${Tempo.dataBR(bloco.fim)}. Use as setas para ver outras semanas.`);
    return;
  }
  let itens;
  if (periodo.dias === 1) {                                   // 1 dia: uma barra por irrigação
    const doDia = (porDia.find(d => d.dia === periodo.inicio) || { eventos: [] }).eventos;
    itens = doDia.map(e => ({
      chave: periodo.inicio, rotulo: Tempo.horaCurta(e.ini), litros: e.litros, selecionado: false,
      rotuloLongo: `Irrigação das ${Tempo.horaDe(e.ini)}${e.fim ? ' às ' + Tempo.horaDe(e.fim) : ' (em andamento)'}`,
      linhas: [e.aberto ? 'Em andamento: volume ainda não contabilizado' : formatarLitros(e.litros) + (e.estimado ? ' (estimado)' : e.semMedicao ? ' (não medido)' : ''),
               e.aberto ? '' : `Duração ${formatarDuracao(e.duracao)}`].filter(Boolean)
    }));
  } else {                                                    // vários dias: uma barra por dia (da semana, quando há paginação)
    const mapa = new Map(porDia.map(d => [d.dia, d]));
    const dias = bloco ? bloco.dias : Tempo.listaDias(periodo.inicio, periodo.fim);
    itens = dias.map(d => {
      const x = mapa.get(d);
      const linhas = !x ? ['Nenhuma irrigação registrada neste dia'] : [
        `${formatarLitros(x.litros)} em ${x.eventos.length} ${x.eventos.length === 1 ? 'irrigação' : 'irrigações'}`,
        ...(x.abertos ? ['1 em andamento (não somada)'] : []), ...(x.estimados ? [`${x.estimados} com volume estimado`] : []), ...(x.semMedicao ? [`${x.semMedicao} sem medição`] : [])];
      return { chave: d, rotulo: Tempo.dataCurta(d), rotuloLongo: Tempo.rotuloDia(d), litros: x ? x.litros : 0, selecionado: false, linhas };   // nenhum dia é "o selecionado"
    });
  }
  graficoConsumo(alvo, { itens });
}
