/* historico.js — medições dos sensores filtradas por período. */
document.addEventListener('DOMContentLoaded', () => {
  if (!exigirLogin()) return;
  montarLayout('historico');
  definirTopo('Histórico', 'Medições dos sensores');
  [['r1', 'drop', 'Umidade média'], ['r2', 'thermo', 'Temperatura média'], ['r3', 'bars', 'Menor umidade'], ['r4', 'history', 'Maior temperatura']]
    .forEach(([id, ic, txt]) => { document.getElementById(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; });
  criarFiltroPeriodo(document.getElementById('filtro'), carregar, 'select');   // já carrega "Hoje"
});

async function carregar(periodo) {
  try {
    const dados = await getHistoricoData(paraISO(periodo.inicio), paraISO(periodo.fim));  // GET /api/historico
    renderizar(montarLinhas(dados.leituras, dados.eventos), periodo);
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
}

function montarLinhas(leituras, eventos) {
  const mapa = new Map();
  leituras.forEach(l => {
    const reg = mapa.get(l.hora_leitura) || { hora: new Date(l.hora_leitura) };
    if (l.tipo === 'umidade_solo') reg.umidade = Number(l.valor);
    if (l.tipo === 'temperatura') reg.temperatura = Number(l.valor);
    mapa.set(l.hora_leitura, reg);
  });
  const evs = eventos.map(e => ({ ini: new Date(e.iniciado_em), fim: e.encerrado_em ? new Date(e.encerrado_em) : null, litros: Number(e.agua_utilizada_litros) }));
  return [...mapa.values()].filter(r => r.umidade != null || r.temperatura != null).sort((a, b) => a.hora - b.hora).map(r => {
    const ligada = evs.some(e => r.hora >= e.ini && (!e.fim || r.hora < e.fim));
    const ev = evs.find(e => e.fim && r.hora > e.ini && r.hora <= e.fim);        // irrigação em curso
    const acumulado = ev ? ev.litros * ((r.hora - ev.ini) / (ev.fim - ev.ini)) : 0;
    return { ...r, ligada, acumulado };
  });
}

function renderizar(linhas, periodo) {
  const um = linhas.map(r => r.umidade).filter(v => v != null);
  const te = linhas.map(r => r.temperatura).filter(v => v != null);
  const fmt = (v, un) => v == null ? '—' : `${formatarNumero(v)}${un}`;
  document.getElementById('kUmidMedia').textContent = fmt(media(um), '%');
  document.getElementById('kTempMedia').textContent = fmt(media(te), '°C');
  document.getElementById('kUmidMin').textContent = um.length ? fmt(Math.min(...um), '%') : '—';
  document.getElementById('kTempMax').textContent = te.length ? fmt(Math.max(...te), '°C') : '—';

  document.getElementById('contagem').textContent = `${linhas.length} ${linhas.length === 1 ? 'registro exibido' : 'registros exibidos'}.`;
  document.getElementById('rotuloPeriodo').textContent = periodo.tipo === 'hoje' ? dataBR(periodo.inicio) : `${dataBR(periodo.inicio)} – ${dataBR(periodo.fim)}`;

  const area = document.getElementById('tabela');
  if (!linhas.length) { area.innerHTML = '<p class="vazio">Nenhum registro encontrado para o período selecionado.</p>'; return; }
  const multiplosDias = periodo.tipo !== 'hoje';
  const tabela = document.createElement('table');
  tabela.innerHTML = '<thead><tr><th>HORÁRIO</th><th>UMIDADE</th><th>TEMPERATURA</th><th>IRRIGAÇÃO</th><th>CONSUMO ACUMULADO</th></tr></thead><tbody></tbody>';
  linhas.forEach(r => {
    const tr = document.createElement('tr');
    const celula = (texto, classe) => { const td = document.createElement('td'); td.textContent = texto; if (classe) td.className = classe; tr.appendChild(td); return td; };
    celula(multiplosDias ? `${dois(r.hora.getDate())}/${dois(r.hora.getMonth() + 1)} ${horaBR(r.hora)}` : horaBR(r.hora));
    celula(fmt(r.umidade, '%'), 'num' + (r.ligada ? ' em-irrigacao' : ''));
    celula(fmt(r.temperatura, '°C'));
    const tdIrr = document.createElement('td');
    const selo = document.createElement('span');
    selo.className = 'selo' + (r.ligada ? ' ligada' : ''); selo.textContent = r.ligada ? 'Ligada' : 'Desligada';
    tdIrr.appendChild(selo); tr.appendChild(tdIrr);
    celula(formatarLitros(r.acumulado));
    tabela.querySelector('tbody').appendChild(tr);
  });
  area.innerHTML = ''; area.appendChild(tabela);
}
