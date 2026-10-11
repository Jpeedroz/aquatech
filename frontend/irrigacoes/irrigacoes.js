/* irrigacoes.js — eventos de irrigação (tabela eventos_irrigacao) por período. */
document.addEventListener('DOMContentLoaded', () => {
  if (!exigirLogin()) return;
  montarLayout('irrigacoes');
  definirTopo('Irrigações', 'Veja quando e por quanto tempo sua propriedade foi irrigada.');
  criarFiltroPeriodo(document.getElementById('filtro'), carregar, 'select');   // já carrega "Hoje"
});

async function carregar(periodo) {
  try {
    const { eventos } = await getIrrigacoesData(paraISO(periodo.inicio), paraISO(periodo.fim));  // GET /api/irrigacoes
    renderizar(eventos, periodo);
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
}

function renderizar(eventos, periodo) {
  // Indicadores recalculados com os eventos do período escolhido
  const qtd = eventos.length;
  const minutos = eventos.reduce((t, e) => t + (e.duracao_minutos || 0), 0);   // SUM(duracao_minutos)
  const litros = eventos.reduce((t, e) => t + Number(e.agua_utilizada_litros), 0);  // SUM(agua_utilizada_litros)
  const vazao = minutos > 0 ? litros / minutos : null;                          // litros ÷ minutos
  const rotulo = (id, ic, txt) => { document.getElementById(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; };
  rotulo('r1', 'drop', periodo.tipo === 'hoje' ? 'Irrigações hoje' : 'Irrigações no período');
  rotulo('r2', 'history', 'Tempo irrigando');
  rotulo('r3', 'drop', 'Água utilizada');
  rotulo('r4', 'waves', 'Vazão');
  document.getElementById('kQtd').textContent = qtd;
  document.getElementById('kTempo').textContent = qtd ? formatarDuracao(minutos) : '—';
  document.getElementById('kAgua').textContent = formatarLitros(litros);
  document.getElementById('kVazao').innerHTML = vazao == null ? '—' : `${formatarNumero(vazao, 1)}<small>L/min</small>`;

  // Lista de eventos (Hoje: ordem do dia; demais períodos: mais recentes primeiro)
  const lista = document.getElementById('eventos');
  lista.innerHTML = '';
  if (!qtd) { lista.innerHTML = '<p class="vazio">Nenhum registro encontrado para o período selecionado.</p>'; return; }
  const ordenados = [...eventos].sort((a, b) => a.iniciado_em.localeCompare(b.iniciado_em));
  if (periodo.tipo !== 'hoje') ordenados.reverse();
  ordenados.forEach(e => {
    const ini = new Date(e.iniciado_em), fim = e.encerrado_em ? new Date(e.encerrado_em) : null;
    const card = document.createElement('article');
    card.className = 'card evento';
    const antes = e.umidade_antes == null ? '—' : `${formatarNumero(e.umidade_antes)}%`;
    const depois = e.umidade_depois == null ? '—' : `${formatarNumero(e.umidade_depois)}%`;
    card.innerHTML = `<div class="evento-data"></div>
      <div class="evento-dados">
        <div><small>Duração</small><strong class="d"></strong></div>
        <div><small>Água utilizada</small><strong class="azul a"></strong></div>
        <div><small>Umidade</small><strong class="verde u"></strong></div></div>`;
    card.querySelector('.evento-data').textContent = `${diaMesAbrev(ini)} • ${horaCurta(ini)} - ${fim ? horaCurta(fim) : 'em andamento'}`;
    card.querySelector('.d').textContent = formatarDuracao(e.duracao_minutos);
    card.querySelector('.a').textContent = formatarLitros(e.agua_utilizada_litros);
    card.querySelector('.u').textContent = `${antes} → ${depois}`;
    lista.appendChild(card);
  });
  const fimLista = document.createElement('p');
  fimLista.className = 'fim-lista'; fimLista.textContent = 'Sem mais irrigações registradas no período.';
  lista.appendChild(fimLista);
}
