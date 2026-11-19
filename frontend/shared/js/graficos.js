/* ============================================================
   graficos.js — gráficos em SVG puro (sem biblioteca).

   graficoUmidade  linha de umidade de UM dia, com horários reais, limites,
                   faixa de irrigação e tooltip (mouse e teclado).
   graficoConsumo  barras de consumo por dia (ou por evento, se o período
                   tiver 1 dia), escala adaptável e tooltip.

   Acessibilidade: o gráfico recebe foco (Tab); ← → percorrem os pontos,
   Home/End vão ao primeiro/último e Esc esconde o balão. Uma região
   aria-live lê o ponto selecionado.
   ============================================================ */
const SVG_NS = 'http://www.w3.org/2000/svg';
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Cria o invólucro com balão e liga mouse/teclado.
   itens: [{ x, y, linhas:[texto...], titulo, destaque? }] em coordenadas do SVG (viewBox). */
function ligarInteracao(wrap, svg, itens, { largura, altura, rotulo, aoClicar, inicial = -1 }) {
  const balao = document.createElement('div');
  balao.className = 'balao'; balao.hidden = true; balao.setAttribute('role', 'tooltip');
  const fala = document.createElement('div');
  fala.className = 'so-leitor'; fala.setAttribute('aria-live', 'polite');
  const guia = document.createElementNS(SVG_NS, 'line');
  guia.setAttribute('class', 'guia'); guia.setAttribute('visibility', 'hidden');
  const marca = document.createElementNS(SVG_NS, 'circle');
  marca.setAttribute('class', 'marca'); marca.setAttribute('r', MQ_CELULAR.matches ? 11 : 6); marca.setAttribute('visibility', 'hidden');
  svg.appendChild(guia); svg.appendChild(marca);
  wrap.appendChild(balao); wrap.appendChild(fala);
  wrap.tabIndex = 0;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', `${rotulo}. Use as setas para percorrer os valores.`);
  let atual = -1;

  function mostrar(i) {
    if (i < 0 || i >= itens.length) return;
    atual = i;
    const it = itens[i], caixa = svg.getBoundingClientRect(), escala = caixa.width / largura;
    guia.setAttribute('x1', it.x); guia.setAttribute('x2', it.x);
    guia.setAttribute('y1', it.guiaDe == null ? 0 : it.guiaDe); guia.setAttribute('y2', it.guiaAte == null ? altura : it.guiaAte);
    guia.setAttribute('visibility', it.semGuia ? 'hidden' : 'visible');
    marca.setAttribute('cx', it.x); marca.setAttribute('cy', it.y);
    marca.setAttribute('visibility', it.semMarca ? 'hidden' : 'visible');
    wrap.classList.add('tem-balao');
    balao.innerHTML = `<strong>${esc(it.titulo)}</strong>${it.linhas.map(l => `<span>${esc(l)}</span>`).join('')}`;
    balao.hidden = false;
    if (MQ_CELULAR.matches) {                           // celular: o balão vira um cartão fixo acima do gráfico e não cobre os pontos
      balao.classList.add('fixo'); balao.style.left = ''; balao.style.top = '';
      fala.textContent = [it.titulo, ...it.linhas].join('. ');
      return;
    }
    balao.classList.remove('fixo');
    const w = balao.offsetWidth, px = it.x * escala, py = it.y * escala;
    let esq = px + 14;
    if (esq + w > caixa.width) esq = px - w - 14;     // vira para a esquerda perto da borda
    balao.style.left = `${Math.max(0, esq)}px`;
    balao.style.top = `${Math.max(0, Math.min(py - balao.offsetHeight / 2, caixa.height - balao.offsetHeight))}px`;
    fala.textContent = [it.titulo, ...it.linhas].join('. ');
  }
  function esconder() {
    balao.hidden = true; atual = -1; wrap.classList.remove('tem-balao'); guia.setAttribute('visibility', 'hidden'); marca.setAttribute('visibility', 'hidden'); fala.textContent = '';
  }
  function maisProximo(ev) {
    const caixa = svg.getBoundingClientRect(), x = (ev.clientX - caixa.left) * (largura / caixa.width);
    let melhor = -1, dist = Infinity;                 // busca binária não é necessária: até ~100 itens
    itens.forEach((it, i) => { const d = Math.abs(it.x - x); if (d < dist) { dist = d; melhor = i; } });
    return melhor;
  }
  /* Mouse: o balão acompanha o ponteiro. Toque: tocar OU arrastar o dedo na horizontal escolhe a medição mais próxima
     (não precisa acertar a bolinha); a rolagem vertical da página continua livre (touch-action: pan-y no CSS). */
  let tocando = false, arrastou = false;
  svg.addEventListener('pointerdown', ev => { if (ev.pointerType !== 'mouse') { tocando = true; arrastou = false; mostrar(maisProximo(ev)); } });
  svg.addEventListener('pointermove', ev => { if (ev.pointerType === 'mouse' || tocando) { if (tocando) arrastou = true; mostrar(maisProximo(ev)); } });
  const soltar = () => {                              // ao soltar depois de arrastar, a medição final fica selecionada (um toque simples já seleciona pelo clique)
    if (tocando && arrastou && aoClicar && atual >= 0) aoClicar(itens[atual], atual);
    tocando = false;
  };
  svg.addEventListener('pointerup', soltar); svg.addEventListener('pointercancel', soltar);
  svg.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse' && document.activeElement !== wrap) esconder(); });
  const fora = ev => {                                // tocar fora do gráfico fecha o balão
    if (!wrap.isConnected) { document.removeEventListener('pointerdown', fora); return; }
    if (!wrap.contains(ev.target) && document.activeElement !== wrap) esconder();
  };
  document.addEventListener('pointerdown', fora);
  if (aoClicar) svg.addEventListener('click', ev => { const i = maisProximo(ev); if (i >= 0) aoClicar(itens[i], i); });
  if (inicial >= 0 && MQ_CELULAR.matches) mostrar(inicial);   // no celular, depois de tocar o balão continua visível (o gráfico é redesenhado)
  wrap.addEventListener('focus', () => { if (atual < 0) mostrar(itens.length - 1); });
  wrap.addEventListener('blur', esconder);
  wrap.addEventListener('keydown', ev => {
    if (!itens.length) return;
    const k = ev.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { ev.preventDefault(); mostrar(Math.min(itens.length - 1, atual + 1)); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { ev.preventDefault(); mostrar(Math.max(0, atual < 0 ? itens.length - 1 : atual - 1)); }
    else if (k === 'Home') { ev.preventDefault(); mostrar(0); }
    else if (k === 'End') { ev.preventDefault(); mostrar(itens.length - 1); }
    else if (k === 'Escape') esconder();
    else if ((k === 'Enter' || k === ' ') && aoClicar && atual >= 0) { ev.preventDefault(); aoClicar(itens[atual], atual); }
  });
}

/* No celular e no tablet (até 1024px) o gráfico é desenhado na largura real da tela, com letras maiores e menos rótulos:
   assim cabe sem rolagem lateral e continua legível. Em telas maiores, o desenho de 900 de largura é mantido. */
const MQ_CELULAR = typeof matchMedia === 'function' ? matchMedia('(max-width: 1024px), (max-height: 500px)') : { matches: false };
function medidaGrafico(el) {
  const compacto = MQ_CELULAR.matches;
  return { compacto, L: compacto ? Math.max(240, Math.round(el._largura || el.getBoundingClientRect().width || 340)) : 900,
           baixo: compacto && window.innerHeight < 500 };                       // celular deitado: gráfico mais baixo
}
function conferirLargura(el, wrap, L, desenhar) {     // se o espaço real diferir do medido, redesenha uma vez com o valor certo
  const real = Math.round(wrap.getBoundingClientRect().width);
  if (MQ_CELULAR.matches && real && Math.abs(real - L) > 2 && !el._largura) { el._largura = real; desenhar(); }
  else el._largura = null;
}
function redesenharAoGirar(el, desenhar) {            // girar o celular ou mudar a janela redesenha com a nova largura
  el._redesenhar = desenhar;
  if (redesenharAoGirar.ligado) return;
  redesenharAoGirar.ligado = true;
  let t = 0, ultimo = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === ultimo) return;
    ultimo = window.innerWidth; clearTimeout(t);
    t = setTimeout(() => document.querySelectorAll('#grafico').forEach(e => e._redesenhar && e._redesenhar()), 150);
  });
}

/* ---------- umidade do solo em um dia ----------
   dados: { dia, grupos (leituras agrupadas por horário), eventos (normalizados), liga, desliga, agora } */
function graficoUmidade(el, { dia, grupos, eventos, liga, desliga, aoSelecionar, selecionada }) {
  const brutos = grupos.filter(g => g.umidade != null && g.dia === dia);       // TODAS as medições do dia, nos horários reais
  el.innerHTML = '';
  if (!brutos.length) { Estado.vazio(el, 'Sem leituras de umidade neste dia.', 'Escolha outro dia ou período.'); return; }
  const { compacto, L, baixo } = medidaGrafico(el);
  const A = baixo ? 240 : compacto ? 300 : 330, m = compacto ? { e: 40, d: 14, t: 18, b: 36 } : { e: 46, d: 20, t: 22, b: 34 };
  const F = compacto ? 12.5 : 10.5;
  redesenharAoGirar(el, () => graficoUmidade(el, { dia, grupos, eventos, liga, desliga, aoSelecionar, selecionada }));
  const w = L - m.e - m.d, h = A - m.t - m.b;
  const minDia = ts => T_minDia(ts);
  const agora = Tempo.agora(), ehHoje = dia === agora.slice(0, 10);

  /* Eixo do tempo AJUSTADO aos dados: o ESP32 mede a cada poucos segundos, então uma escala fixa de 06h a 18h
     espremeria tudo numa faixa estreita. O eixo vai da primeira à última medição (no dia de hoje, até agora). */
  const t0 = minDia(brutos[0].hora), tUlt = minDia(brutos[brutos.length - 1].hora);
  let t1 = ehHoje ? Math.max(tUlt, Math.min(minDia(agora), tUlt + 30)) : tUlt;
  let MIN0 = t0, MIN1 = Math.max(t1, t0 + 30);
  const folga = (MIN1 - MIN0) * 0.03; MIN0 = Math.max(0, MIN0 - folga); MIN1 = Math.min(1440, MIN1 + folga);
  const X = min => m.e + ((Math.min(MIN1, Math.max(MIN0, min)) - MIN0) / (MIN1 - MIN0)) * w;

  /* Muitas medições (uma a cada 10 s) viram a MÉDIA por fatia de ~3 px: a curva fica limpa e cada fatia
     mostra no balão quantas leituras representa. Nenhum valor é inventado; lacunas sem medição continuam vazias. */
  const difs = brutos.slice(1).map((p, i) => Tempo.minutosTs(p.hora) - Tempo.minutosTs(brutos[i].hora)).sort((a, b) => a - b);
  const tipico = difs.length ? difs[Math.floor(difs.length / 2)] : 60;
  const limiteLacuna = Math.max(tipico * 6, 10);
  const fatia = (MIN1 - MIN0) / (w / 3);
  const segmentos = [];
  let seg = [], balde = null;
  const fecharBalde = () => { if (balde) { seg.push({ ...balde, umidade: balde.soma / balde.n, minuto: balde.somaMin / balde.n }); balde = null; } };
  brutos.forEach((p, i) => {
    const mn = minDia(p.hora);
    if (i && Tempo.minutosTs(p.hora) - Tempo.minutosTs(brutos[i - 1].hora) > limiteLacuna) { fecharBalde(); segmentos.push(seg); seg = []; }
    const chave = Math.floor((mn - MIN0) / fatia);
    if (balde && balde.chave !== chave) fecharBalde();
    if (!balde) balde = { chave, soma: 0, somaMin: 0, n: 0, min: Infinity, max: -Infinity };
    balde.soma += p.umidade; balde.somaMin += mn; balde.n++; balde.hora = p.hora; balde.dia = p.dia;
    balde.min = Math.min(balde.min, p.umidade); balde.max = Math.max(balde.max, p.umidade);
    if (p.temperatura != null) balde.temperatura = p.temperatura;
  });
  fecharBalde(); segmentos.push(seg);
  const pts = segmentos.flat();

  const vmaxDado = Math.max(...brutos.map(p => p.umidade), desliga || 0);
  const vmax = vmaxDado > 60 ? 100 : Math.max(40, Math.ceil((vmaxDado + 5) / 10) * 10);
  const Y = v => m.t + h - (v / vmax) * h;

  let s = `<defs>
    <linearGradient id="gradUmidade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b86d1" stop-opacity=".26"/><stop offset="1" stop-color="#0b86d1" stop-opacity="0"/></linearGradient>
    <clipPath id="recorteGrafico"><rect x="${m.e}" y="${m.t - 2}" width="${w}" height="${h + 4}"/></clipPath></defs>`;
  // faixa "ideal" entre os limites (o objetivo do sistema é manter o solo aqui)
  if (liga != null && desliga != null && desliga > liga)
    s += `<rect x="${m.e}" y="${Y(desliga)}" width="${w}" height="${Y(liga) - Y(desliga)}" fill="#16a34a" opacity=".045"/>`;
  const passoY = vmax > 60 ? 20 : 10;
  for (let v = 0; v <= vmax; v += passoY) {
    s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v ? '#eef2f6' : '#d5dce4'}"/>
          <text x="${m.e - 8}" y="${Y(v) + 3.5}" font-size="${F}" fill="#7b8794" text-anchor="end">${v}%</text>`;
  }
  // rótulos de hora: passo escolhido para caber (5 min a 4 h), sempre em horários "redondos"
  const maxRotulos = compacto ? 4 : Math.max(4, Math.floor(w / 110));
  const passoT = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 240].find(k => (MIN1 - MIN0) / k <= maxRotulos) || 240;
  for (let t = Math.ceil(MIN0 / passoT) * passoT; t <= MIN1; t += passoT) {
    const x = X(t), hh = Math.floor(t / 60), mm = Math.round(t % 60);
    s += `<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + h}" stroke="#f3f5f8"/>
          <line x1="${x}" x2="${x}" y1="${m.t + h}" y2="${m.t + h + 4}" stroke="#c5ced8"/>
          <text x="${x}" y="${A - 12}" font-size="${F}" fill="#7b8794" text-anchor="middle">${Tempo.dois(hh)}:${Tempo.dois(mm)}</text>`;
  }
  // períodos com a irrigação ligada: faixa verde suave com uma tarja no topo
  const faixas = [];
  eventos.forEach(e => {
    if (e.ini.slice(0, 10) > dia || (e.fim && e.fim.slice(0, 10) < dia)) return;
    const ini = e.ini.slice(0, 10) < dia ? 0 : minDia(e.ini);
    const fim = e.fim ? (e.fim.slice(0, 10) > dia ? 1440 : minDia(e.fim)) : minDia(ehHoje ? agora : brutos[brutos.length - 1].hora);
    if (Math.min(fim, MIN1) <= Math.max(ini, MIN0)) return;
    const x1 = X(ini), x2 = Math.max(X(fim), x1 + 2);
    faixas.push({ x1, x2, aberto: !e.fim });
    s += `<rect class="faixa-irrig" x="${x1.toFixed(1)}" y="${m.t}" width="${(x2 - x1).toFixed(1)}" height="${h}" fill="#22c55e" opacity=".10"/>
          <rect x="${x1.toFixed(1)}" y="${m.t}" width="${(x2 - x1).toFixed(1)}" height="3" fill="#16a34a" opacity=".75"/>`;
  });
  // limites de irrigação (o texto tem contorno branco para continuar legível sobre a curva)
  let textosLimite = '';                                                 // desenhados por último, acima da curva
  const rotuloLimite = (v, cor, texto, acima) => {
    textosLimite += `<text x="${L - m.d - 6}" y="${acima ? Y(v) - 6 : Y(v) + F + 4}" font-size="${F}" font-weight="600" fill="${cor}" text-anchor="end" stroke="#fff" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${texto}</text>`;
    return `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="${cor}" stroke-width="1.2" stroke-dasharray="6 5" opacity=".9"/>`;
  };
  if (desliga != null) s += rotuloLimite(desliga, '#15803d', `${compacto ? 'Desliga' : 'Desliga a irrigação em'} ${formatarNumero(desliga)}%`, true);
  if (liga != null) s += rotuloLimite(liga, '#c2570c', `${compacto ? 'Liga' : 'Liga a irrigação abaixo de'} ${formatarNumero(liga)}%`, false);

  // curva suave + área preenchida (cada trecho contínuo separado; lacunas sem medição ficam vazias)
  segmentos.forEach((sg, i) => {
    if (i) {
      const ant = segmentos[i - 1][segmentos[i - 1].length - 1], prox = sg[0];
      if (ant && prox && X(prox.minuto) - X(ant.minuto) > 70)
        s += `<text x="${((X(ant.minuto) + X(prox.minuto)) / 2).toFixed(1)}" y="${m.t + h - 8}" font-size="${F}" font-style="italic" fill="#9aa5b1" text-anchor="middle">sem medições</text>`;
    }
    if (!sg.length) return;
    const P = sg.map(p => [X(p.minuto), Y(p.umidade)]);
    if (P.length === 1) { s += `<circle cx="${P[0][0].toFixed(1)}" cy="${P[0][1].toFixed(1)}" r="3" fill="#0b86d1"/>`; return; }
    const d = caminhoSuave(P);
    s += `<path d="${d} L${P[P.length - 1][0].toFixed(1)},${Y(0)} L${P[0][0].toFixed(1)},${Y(0)} Z" fill="url(#gradUmidade)" clip-path="url(#recorteGrafico)"/>`;
    s += `<path class="linha-umidade" fill="none" stroke="#0b86d1" stroke-width="${compacto ? 3 : 2.4}" stroke-linecap="round" stroke-linejoin="round" d="${d}" clip-path="url(#recorteGrafico)"/>`;
  });
  // marcas de início da irrigação sobre a curva (só quando são poucas, para não poluir)
  if (faixas.length <= 24) faixas.forEach(f => {
    const p = pts.reduce((a, b) => Math.abs(X(b.minuto) - f.x1) < Math.abs(X(a.minuto) - f.x1) ? b : a);
    s += `<circle cx="${X(p.minuto).toFixed(1)}" cy="${Y(p.umidade).toFixed(1)}" r="${compacto ? 5 : 4}" fill="#16a34a" stroke="#fff" stroke-width="2"/>`;
  });
  s += textosLimite;
  // última medição em destaque (no dia de hoje, com um halo indicando "agora")
  const ult = pts[pts.length - 1];
  if (ehHoje) s += `<circle cx="${X(ult.minuto).toFixed(1)}" cy="${Y(ult.umidade).toFixed(1)}" r="10" fill="#0b86d1" opacity=".15"/>`;
  s += `<circle cx="${X(ult.minuto).toFixed(1)}" cy="${Y(ult.umidade).toFixed(1)}" r="${compacto ? 5.5 : 4.5}" fill="#0b86d1" stroke="#fff" stroke-width="2"/>`;

  const itens = pts.map(p => {
    const x = X(p.minuto), y = Y(p.umidade);
    const ligada = eventos.some(e => e.ini <= p.hora && (!e.fim || e.fim > p.hora));
    if (selecionada && selecionada === p.hora) s += `<circle class="ponto-selecionado" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${compacto ? 10 : 8}" fill="none" stroke="#14213d" stroke-width="2"/>`;
    const estado = Analise.estadoSolo(p.umidade, liga, desliga);
    const linhas = [`Umidade: ${formatarNumero(p.umidade, 1)}%`];
    if (p.n > 1) linhas.push(`Média de ${p.n} leituras (${formatarNumero(p.min, 0, 1)}% a ${formatarNumero(p.max, 0, 1)}%)`);
    if (estado) linhas.push(`Solo: ${estado.rotulo.replace('Solo ', '')}`);
    linhas.push(`Irrigação: ${ligada ? 'ligada' : 'desligada'}`);
    return { hora: p.hora, umidade: p.umidade, x, y, guiaDe: m.t, guiaAte: m.t + h, titulo: `${Tempo.dataBR(p.dia)} · ${Tempo.horaDe(p.hora)}`, linhas };
  });
  const wrap = document.createElement('div'); wrap.className = 'grafico-wrap';
  wrap.innerHTML = `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Umidade do solo em ${Tempo.dataBR(dia)}">${s}</svg>`;
  el.appendChild(wrap);
  conferirLargura(el, wrap, L, el._redesenhar);
  if (el._largura && el._largura !== L) return;                                 // foi redesenhado com a largura certa
  ligarInteracao(wrap, wrap.querySelector('svg'), itens, { largura: L, altura: A, rotulo: `Gráfico de umidade do solo em ${Tempo.dataBR(dia)}, ${brutos.length} leituras`, inicial: selecionada ? pts.findIndex(p => p.hora === selecionada) : -1,
    aoClicar: aoSelecionar ? it => aoSelecionar({ hora: it.hora, umidade: it.umidade }) : null });
  if (aoSelecionar) wrap.classList.add('clicavel');
}
function caminhoSuave(P) {
  const n = P.length, dx = [], m = [], t = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; m[i] = (P[i + 1][1] - P[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], k = a * a + b * b;
    if (k > 9) { const f = 3 / Math.sqrt(k); t[i] = f * a * m[i]; t[i + 1] = f * b * m[i]; }
  }
  let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${(P[i][0] + h).toFixed(1)},${(P[i][1] + t[i] * h).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)},${(P[i + 1][1] - t[i + 1] * h).toFixed(1)} ${P[i + 1][0].toFixed(1)},${P[i + 1][1].toFixed(1)}`;
  }
  return d;
}
function T_minDia(ts) { return (+ts.slice(11, 13)) * 60 + (+ts.slice(14, 16)) + (+ts.slice(17, 19) || 0) / 60; }

/* ---------- consumo ----------
   dados: { itens: [{ chave, rotulo, rotuloLongo, litros, linhas:[...], selecionado }], aoSelecionar(chave) }
   Cada item vira uma barra. Dias sem irrigação registrada aparecem só com uma marca (sem barra e sem valor): ausência de registro não é consumo zero medido. */
function graficoConsumo(el, { itens, aoSelecionar, unidade }) {
  el.innerHTML = '';
  if (!itens.length) { Estado.vazio(el, 'Nenhuma irrigação registrada no período selecionado.'); return; }
  const n = itens.length;
  const { compacto, L, baixo } = medidaGrafico(el);
  const A = baixo ? 230 : compacto ? 300 : 290, m = compacto ? { e: 56, d: 10, t: 32, b: 42 } : { e: 58, d: 16, t: 30, b: 40 };
  const F = compacto ? 12.5 : 10;
  redesenharAoGirar(el, () => graficoConsumo(el, { itens, aoSelecionar, unidade }));
  const w = L - m.e - m.d, h = A - m.t - m.b;
  const valores = itens.map(i => i.litros);
  const max = Math.max(...valores), com = valores.filter(v => v > 0);
  const { topo, passo } = Analise.escalaEixo(max);
  const Y = v => m.t + h - (v / topo) * h;
  const larguraSlot = w / n, largura = Math.max(2, Math.min(larguraSlot * 0.62, 84));
  const maxIdx = max > 0 ? valores.indexOf(max) : -1;
  const minV = com.length ? Math.min(...com) : null, minIdx = minV != null && com.length > 1 ? valores.indexOf(minV) : -1;
  const rotulos = new Set(Analise.indicesRotulos(n, compacto ? 5 : 10));
  itens.forEach((it, i) => { if (it.selecionado) rotulos.add(i); });

  let s = '';
  for (let v = 0; v <= topo + 1e-9; v += passo) {
    s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e8edf2"/>
          <text x="${m.e - 8}" y="${Y(v) + 3}" font-size="${F}" fill="#5b6778" text-anchor="end">${formatarNumero(v, 0, 1)} L</text>`;
  }
  const marcados = [];
  const dadosTooltip = itens.map((it, i) => {
    const cx = m.e + larguraSlot * i + larguraSlot / 2, v = it.litros;
    const cor = it.selecionado ? '#0b3d66' : i === maxIdx ? '#1d68a3' : i === minIdx ? '#a9d4ef' : '#3a9bd5';
    if (v > 0) s += `<rect class="barra${it.selecionado ? ' sel' : ''}" x="${(cx - largura / 2).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${largura.toFixed(1)}" height="${(Y(0) - Y(v)).toFixed(1)}" rx="3" fill="${cor}"/>`;
    else s += `<line x1="${cx - 3}" x2="${cx + 3}" y1="${Y(0) - 1}" y2="${Y(0) - 1}" stroke="#c9d3de" stroke-width="2"/>`;
    if (it.selecionado) s += `<rect x="${(cx - larguraSlot / 2 + 1).toFixed(1)}" y="${m.t - 6}" width="${(larguraSlot - 2).toFixed(1)}" height="${h + 6}" fill="none" stroke="#0b3d66" stroke-opacity=".35" rx="4"/>`;
    if (v > 0 && (i === maxIdx || i === minIdx || (it.selecionado && n <= 12))) {
      const dup = marcados.some(x => Math.abs(x - cx) < (compacto ? 64 : 46));          // evita rótulos de valor sobrepostos
      if (!dup) { marcados.push(cx); s += `<text x="${cx.toFixed(1)}" y="${(Y(v) - 6).toFixed(1)}" font-size="${compacto ? 13 : 11}" font-weight="700" text-anchor="middle" fill="#14213d">${formatarNumero(v, 0, 1)} L</text>`; }
    }
    if (rotulos.has(i)) s += `<text x="${cx.toFixed(1)}" y="${A - 16}" font-size="${F}" fill="${it.selecionado ? '#0b3d66' : '#5b6778'}" font-weight="${it.selecionado ? 700 : 400}" text-anchor="middle">${esc(it.rotulo)}</text>`;
    return { x: cx, y: Y(Math.max(v, 0)), titulo: it.rotuloLongo, linhas: it.linhas, chave: it.chave, guiaDe: m.t, guiaAte: m.t + h, semGuia: true, semMarca: true };
  });
  const wrap = document.createElement('div'); wrap.className = 'grafico-wrap';
  wrap.innerHTML = `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Consumo de água em ${unidade || 'litros'}">${s}</svg>`;
  el.appendChild(wrap);
  conferirLargura(el, wrap, L, el._redesenhar);
  if (el._largura && el._largura !== L) return;
  ligarInteracao(wrap, wrap.querySelector('svg'), dadosTooltip, {
    largura: L, altura: A, rotulo: `Gráfico de consumo de água, ${n} ${n === 1 ? 'barra' : 'barras'}`, inicial: itens.findIndex(i => i.selecionado),
    aoClicar: aoSelecionar ? it => aoSelecionar(it.chave) : null
  });
}
