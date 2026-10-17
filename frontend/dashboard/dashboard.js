/* dashboard.js — situação atual da propriedade + umidade do solo no período escolhido.
   - Os 3 primeiros cartões mostram o estado ATUAL (não mudam com o filtro; têm o selo "agora").
   - O 4º cartão e o resumo abaixo do gráfico são recalculados para o período.
   - O gráfico mostra UM dia por vez; com período > 1 dia, use "Anterior / Próximo". */
let resumo = null, dadosPeriodo = null, periodoAtual = null, controle, paginacao;
let selecionada = null;                                // medição clicada no gráfico { hora, umidade } (null = mostra a leitura atual)
const carregarResumo = criarCarregador();
const carregarPeriodo = criarCarregador();
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  if (!exigirLogin()) return;
  montarLayout('dashboard');
  definirTopo(`${saudacao()}, ${primeiroNome(getSessao().nome)}!`, 'Carregando propriedade...');
  paginacao = criarPaginacaoDias($('paginacaoDias'), dia => { selecionada = null; renderizarSolo(); desenharDia(dia); });
  $('soloVoltar').addEventListener('click', () => { selecionada = null; renderizarSolo(); if (paginacao.dia) desenharDia(paginacao.dia); });
  Estado.carregando($('grafico'));
  const okResumo = await atualizarResumo();
  if (!okResumo) return;
  controle = criarControlePeriodo($('filtro'), {
    fonte: 'leituras',
    aoMudar: ({ periodo }) => carregarDoPeriodo(periodo),
    aoErro: e => Estado.erro($('grafico'), e.message, () => window.location.reload())
  });
});

async function atualizarResumo() {
  try {
    const r = await carregarResumo(sinal => getResumoPainel({ signal: sinal }));
    if (!r) return false;
    resumo = r.dados;
  } catch (e) { Estado.erro($('grafico'), e.message, () => window.location.reload()); return false; }
  // usuário logado sem propriedade → termina o cadastro (etapa 2)
  if (resumo.propriedade_id == null) { window.location.replace('../propriedade/propriedade.html'); return false; }
  definirTopo(`${saudacao()}, ${primeiroNome(resumo.nome_usuario)}!`,
              `Propriedade: ${resumo.nome_propriedade} - Cultura: ${resumo.cultura || 'não informada'}`);
  renderizarAtual();
  return true;
}

function renderizarAtual() {
  renderizarSolo();
  const ligada = resumo.irrigacao_ligada === true;
  $('pontoIrrig').classList.toggle('ligada', ligada);
  $('irrigStatus').textContent = resumo.dispositivo_id == null ? 'Sem dispositivo' : ligada ? 'Ligada' : 'Desligada';
  $('irrigNota').textContent = resumo.dispositivo_id == null ? 'Cadastre um dispositivo'
    : ligada ? 'Irrigação em andamento' : resumo.online === false ? 'Sem medições recentes' : 'Irrigação não necessária';
  $('temperatura').textContent = resumo.temperatura_atual == null ? '—' : `${formatarNumero(resumo.temperatura_atual, 0, 1)}°C`;
}

/* Cartão "Umidade do solo atual": cor e texto conforme o estado do solo (crítico, seco, adequado, úmido).
   Mostra a leitura atual; ao clicar em um ponto do gráfico, mostra aquela medição (com botão para voltar). Só visual: nada é gravado. */
function renderizarSolo() {
  const card = $('cardSolo');
  const usandoSel = selecionada != null;
  const umid = usandoSel ? selecionada.umidade : resumo.umidade_atual;
  const semLeitura = umid == null;
  $('umidade').textContent = semLeitura ? '—' : `${formatarNumero(umid, 0, 1)}%`;
  const est = Analise.estadoSolo(umid, resumo.limite_umidade, resumo.limite_umidade_desliga);
  ['critico', 'seco', 'adequado', 'umido'].forEach(c => card.classList.toggle(c, !!est && est.chave === c));
  if (!est) card.classList.add('adequado');
  $('soloStatus').textContent = resumo.dispositivo_id == null ? 'Sem dispositivo' : semLeitura ? 'Sem leituras' : est.rotulo;
  const horaLeitura = usandoSel ? selecionada.hora : (resumo.hora_umidade_atual || resumo.ultimo_sinal);
  const quando = horaLeitura ? `${Tempo.horaDe(horaLeitura)} de ${Tempo.dataCurta(horaLeitura.slice(0, 10))}` : '';
  // selecionada no gráfico: "Umidade do solo às 08:00 de 19/10"; senão: "Umidade do solo atual" + hora da última leitura
  $('soloRotulo').textContent = usandoSel ? `Umidade do solo às ${quando}` : 'Umidade do solo atual';
  $('soloHora').textContent = semLeitura || !horaLeitura ? '' : usandoSel ? 'Medição escolhida no gráfico' : `Leitura de ${Tempo.horaDe(horaLeitura)} em ${Tempo.dataCurta(horaLeitura.slice(0, 10))}`;
  $('soloTag').hidden = usandoSel;
  $('soloVoltar').style.visibility = usandoSel ? 'visible' : 'hidden';   // reserva o espaço: o cartão não muda de altura ao selecionar
  const barra = $('soloBarra');
  barra.hidden = semLeitura;
  if (!semLeitura) {
    const topo = Math.max(40, Math.ceil(Math.max(umid, resumo.limite_umidade_desliga || 0) / 10) * 10);
    $('soloBarraPreench').style.width = `${Math.min(100, Math.max(0, umid / topo * 100))}%`;
    const marca = (id, v) => { const el = $(id); el.hidden = v == null; if (v != null) el.style.left = `${v / topo * 100}%`; };
    marca('soloMarcaLiga', resumo.limite_umidade); marca('soloMarcaDesliga', resumo.limite_umidade_desliga);
  }
}

async function carregarDoPeriodo(periodo, manterDia) {
  periodoAtual = periodo;
  selecionada = null; renderizarSolo();
  const manter = manterDia ? paginacao.dia : null;
  Estado.carregando($('grafico')); $('resumoUmidade').hidden = true;
  paginacao.esconder();
  try {
    const r = await carregarPeriodo(sinal => getHistoricoData(periodo.inicio, periodo.fim, { signal: sinal }));
    if (!r) return;                                  // resposta antiga: ignora
    const grupos = Analise.agruparLeituras(r.dados.leituras);
    dadosPeriodo = { periodo, grupos, medicoes: Analise.pontosDeMedicao(grupos), eventos: Analise.eventosOrdenados(r.dados.eventos) };
  } catch (e) { Estado.erro($('grafico'), e.message, () => carregarDoPeriodo(periodo)); return; }

  const diasUmidade = new Set(dadosPeriodo.grupos.filter(g => g.umidade != null).map(g => g.dia));
  const dias = Tempo.diasComDados(periodo, diasUmidade);
  renderizarConsumo();
  renderizarResumoUmidade();
  const dia = paginacao.definir(dias, periodo, manter, 'Medições');
  desenharDia(dia);
}

function renderizarConsumo() {
  const { periodo, eventos } = dadosPeriodo;
  const ind = Analise.indicadoresIrrigacao(eventos);
  $('rotuloConsumo').textContent = periodo.tipo === 'hoje' ? 'Consumo hoje' : `Consumo — ${Tempo.rotuloCurtoPeriodo(periodo)}`;
  $('consumoHoje').textContent = formatarLitros(ind.litros);
  let nota = `${ind.quantidade} ${ind.quantidade === 1 ? 'irrigação' : 'irrigações'} ${Tempo.descreverPeriodo(periodo)}`;
  if (ind.abertos) nota += ` · ${ind.abertos} em andamento (ainda não somada)`;
  if (ind.estimados) nota += ` · ${ind.estimados} com volume estimado`;
  $('notaConsumo').textContent = ind.quantidade ? nota : `Nenhuma irrigação ${Tempo.descreverPeriodo(periodo)}`;
}

/* Umidade máxima / mínima / média de TODAS as leituras do período (não só do dia visível). */
function renderizarResumoUmidade() {
  const { medicoes } = dadosPeriodo;
  const i = Analise.indicadoresLeituras(medicoes);
  const caixa = $('resumoUmidade');
  caixa.hidden = !i.umidadeMin;
  if (!i.umidadeMin) return;
  const f = v => `${formatarNumero(v, 0, 1)}%`;
  const quando = r => `${Tempo.diaMesExtenso(r.dia)} às ${Tempo.horaDe(r.hora)}`;
  const n = medicoes.filter(m => m.umidade != null).length;
  const set = (id, txt) => { $(id).textContent = txt; };
  set('umMaxQuando', quando(i.umidadeMax)); set('umMaxValor', f(i.umidadeMax.umidade));
  set('umMinQuando', quando(i.umidadeMin)); set('umMinValor', f(i.umidadeMin.umidade));
  set('umMedValor', `≈ ${f(i.umidadeMedia)}`); set('umMedTexto', `${n} ${n === 1 ? 'leitura' : 'leituras'} no período`);
}

function desenharDia(dia) {
  const { periodo, grupos, eventos } = dadosPeriodo;
  const el = $('grafico');
  if (resumo.dispositivo_id == null) {
    $('subGrafico').textContent = ''; $('resumoUmidade').hidden = true;
    Estado.vazio(el, 'Nenhum dispositivo cadastrado nesta propriedade.', 'Quando o ESP32 for instalado, as leituras aparecerão aqui.'); return;
  }
  if (!dia) {
    $('tituloGrafico').textContent = 'Umidade do solo';
    $('subGrafico').textContent = Tempo.descreverPeriodo(periodo).replace(/^./, c => c.toUpperCase());
    // última medição REAL conhecida (nunca inventada): mostra que existe histórico anterior, sem afirmar que o dispositivo está desconectado
    const ultima = resumo.hora_umidade_atual;
    Estado.vazio(el, Tempo.mensagemSemRegistros(periodo, 'medicao'),
      ultima ? `Última medição registrada: ${Tempo.dataBR(ultima.slice(0, 10))} às ${Tempo.horaDe(ultima)}. Escolha outro período para ver o histórico.` : 'Escolha outro período ou verifique se o dispositivo está enviando dados.');
    return;
  }
  const doDia = grupos.filter(g => g.dia === dia && g.umidade != null);
  $('tituloGrafico').textContent = dia === Tempo.hoje() ? 'Umidade do solo hoje' : `Umidade do solo — ${Tempo.rotuloDia(dia)}`;
  $('subGrafico').textContent = `${doDia.length} ${doDia.length === 1 ? 'leitura' : 'leituras'}`;
  graficoUmidade(el, { dia, grupos, eventos, liga: resumo.limite_umidade, desliga: resumo.limite_umidade_desliga,
    selecionada: selecionada ? selecionada.hora : null,
    aoSelecionar: m => { selecionada = m; renderizarSolo(); desenharDia(dia); } });
}
