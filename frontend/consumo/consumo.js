/* consumo.js — consumo de água por dia (view consumo_diario). */
document.addEventListener('DOMContentLoaded', async () => {
  if (!exigirLogin()) return;
  montarLayout('consumo');
  definirTopo('Consumo de água', 'Indicadores de eficiência hídrica');
  [['r1', 'drop', 'Hoje'], ['r2', 'drop', 'Últimos 7 dias'], ['r3', 'drop', 'Últimos 30 dias'], ['r4', 'history', 'Total registrado']]
    .forEach(([id, ic, txt]) => { document.getElementById(id).innerHTML = icone(ic, 14) + `<span>${txt}</span>`; });
  try {                                            // cartões do topo: períodos fixos
    const r = await getConsumoResumo();            // GET /api/consumo/resumo
    const mostra = (id, v) => { document.getElementById(id).innerHTML = `${formatarNumero(v)} <small>L</small>`; };
    mostra('cHoje', r.hoje); mostra('c7', r.ultimos_7_dias); mostra('c30', r.ultimos_30_dias); mostra('cTotal', r.total);
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
  criarFiltroPeriodo(document.getElementById('filtro'), carregar, 'pills');   // gráfico e indicadores: já carrega "Hoje"
});

async function carregar(periodo) {
  try {
    const { dias } = await getConsumoData(paraISO(periodo.inicio), paraISO(periodo.fim));  // GET /api/consumo
    renderizar(dias, periodo);
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
}

function renderizar(dias, periodo) {
  document.getElementById('subGrafico').textContent = `Consumo registrado ${descreverPeriodo(periodo)}`;
  const valores = dias.map(d => Number(d.agua_utilizada_litros));
  const set = (id, txt) => { document.getElementById(id).textContent = txt; };
  if (!valores.length) {
    ['maiorDia', 'menorDia', 'mediaDiaria'].forEach(id => set(id, '—'));
    ['maiorLitros', 'menorLitros', 'mediaTexto'].forEach(id => set(id, ''));
    document.getElementById('grafico').innerHTML = '<p class="vazio">Nenhum registro encontrado para o período selecionado.</p>';
    return;
  }
  const max = Math.max(...valores), min = Math.min(...valores);
  const iMax = valores.indexOf(max), iMin = valores.indexOf(min);
  set('maiorDia', diaMesExtenso(dataISOparaDate(dias[iMax].data_consumo))); set('maiorLitros', formatarLitros(max));
  set('menorDia', diaMesExtenso(dataISOparaDate(dias[iMin].data_consumo))); set('menorLitros', formatarLitros(min));
  set('mediaDiaria', `≈ ${formatarLitros(media(valores))}`); set('mediaTexto', descreverPeriodo(periodo));
  desenharGraficoConsumo(document.getElementById('grafico'), dias, iMax, iMin);
}

/* Gráfico de barras em SVG puro: uma barra por dia existente no período.
   Maior consumo = azul escuro, menor = azul claro. */
function desenharGraficoConsumo(el, dias, iMax, iMin) {
  const L = 900, A = 270, m = { e: 54, d: 14, t: 26, b: 30 };
  const w = L - m.e - m.d, h = A - m.t - m.b, n = dias.length;
  const valores = dias.map(d => Number(d.agua_utilizada_litros));
  const topo = Math.max(100, Math.ceil(Math.max(...valores) / 100) * 100);
  const Y = v => m.t + h - (v / topo) * h;
  const passo = w / n, largura = Math.min(passo * 0.6, 90);
  let s = `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Consumo de água por dia">`;
  for (let v = 0; v <= topo; v += 100) {
    s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e8edf2"/>
          <text x="${m.e - 8}" y="${Y(v) + 3}" font-size="10" fill="#8a96a8" text-anchor="end">${v} L</text>`;
  }
  const cadaQuantos = Math.ceil(n / 8);                    // evita rótulos amontoados em 30 dias
  dias.forEach((d, i) => {
    const cx = m.e + passo * i + passo / 2, v = valores[i];
    const cor = i === iMax ? '#0b3d66' : i === iMin ? '#a9d4ef' : '#3a9bd5';
    s += `<rect x="${cx - largura / 2}" y="${Y(v)}" width="${largura}" height="${Y(0) - Y(v)}" rx="4" fill="${cor}"/>`;
    if (i === iMax || i === iMin) s += `<text x="${cx}" y="${Y(v) - 6}" font-size="11" font-weight="700" text-anchor="middle" fill="#14213d">${formatarNumero(v)} L</text>`;
    if (i % cadaQuantos === 0) s += `<text x="${cx}" y="${A - 10}" font-size="10" fill="#8a96a8" text-anchor="middle">${diaMesCurto(dataISOparaDate(d.data_consumo))}</text>`;
  });
  el.innerHTML = s + '</svg>';
}
