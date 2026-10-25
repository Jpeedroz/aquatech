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
  const pts = grupos.filter(g => g.umidade != null && g.dia === dia);          // TODAS as medições do dia, nos horários reais
  el.innerHTML = '';
  if (!pts.length) { Estado.vazio(el, 'Sem leituras de umidade neste dia.', 'Escolha outro dia ou período.'); return; }
  const { compacto, L, baixo } = medidaGrafico(el);
  const A = baixo ? 230 : compacto ? 300 : 310, m = compacto ? { e: 44, d: 12, t: 14, b: 40 } : { e: 50, d: 18, t: 16, b: 36 };
  const F = compacto ? 12.5 : 10;                                                // tamanho das letras do gráfico
  redesenharAoGirar(el, () => graficoUmidade(el, { dia, grupos, eventos, liga, desliga, aoSelecionar, selecionada }));
  const w = L - m.e - m.d, h = A - m.t - m.b;
  const minDia = ts => T_minDia(ts);
  const vmax = Math.max(40, Math.ceil(Math.max(...pts.map(p => p.umidade), desliga || 0) / 10) * 10);
  // escala padrão 06h–18h (medições horárias); se houver medição fora dessa faixa, a escala se amplia — nenhuma medição é escondida
  const minimo = Math.min(...pts.map(p => T_minDia(p.hora))), maximo = Math.max(...pts.map(p => T_minDia(p.hora)));
  const MIN0 = Math.min(6 * 60, Math.floor(minimo / 60) * 60), MIN1 = Math.max(18 * 60, Math.ceil(maximo / 60) * 60);
  const PAD = compacto ? 14 : 22;                                     // folga lateral: o ponto das 06h/18h não encosta no eixo
  const X = min => m.e + PAD + ((Math.min(MIN1, Math.max(MIN0, min)) - MIN0) / (MIN1 - MIN0)) * (w - 2 * PAD);
  const Y = v => m.t + h - (v / vmax) * h;
  const agora = Tempo.agora();
  const fimLinha = pts[pts.length - 1].hora;

  const wrap = document.createElement('div'); wrap.className = 'grafico-wrap';
  let s = '';
  for (let v = 0; v <= vmax; v += 10) {
    s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e8edf2"/>
          <text x="${m.e - 8}" y="${Y(v) + 3}" font-size="${F}" fill="#5b6778" text-anchor="end">${v}%</text>`;
  }
  const H0 = MIN0 / 60, H1 = MIN1 / 60;
  const porHora = (w - 2 * PAD) / (H1 - H0), passoH = [1, 2, 3, 4, 6, 12].find(k => porHora * k >= (compacto ? 50 : 0)) || 12;
  for (let hh = H0; hh <= H1; hh++) {                 // linhas de grade em todas as horas; RÓTULOS só de tempos em tempos (2h; no celular, o que couber)
    s += `<line x1="${X(hh * 60)}" x2="${X(hh * 60)}" y1="${m.t}" y2="${m.t + h}" stroke="#f1f4f7"/>`;
    if ((hh - H0) % (compacto ? passoH : 2) === 0) s += `<text class="rotulo-hora" x="${X(hh * 60)}" y="${A - 14}" font-size="${F}" fill="#5b6778" text-anchor="middle">${Tempo.dois(hh)}${compacto ? 'h' : ':00'}</text>`;
  }
  // faixa de irrigação (evento aberto vai até a última leitura/agora)
  eventos.forEach(e => {
    const ini = e.ini.slice(0, 10) < dia ? 0 : minDia(e.ini);
    let fim = e.fim ? (e.fim.slice(0, 10) > dia ? 1440 : minDia(e.fim)) : minDia(dia === agora.slice(0, 10) ? agora : fimLinha);
    if (e.ini.slice(0, 10) > dia || (e.fim && e.fim.slice(0, 10) < dia)) return;
    if (Math.min(fim, MIN1) > Math.max(ini, MIN0)) s += `<rect class="faixa-irrig" x="${X(ini)}" y="${m.t}" width="${Math.max(2, X(fim) - X(ini))}" height="${h}" fill="#c9f2c7" opacity=".85"/>`;
  });
  if (desliga != null) s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(desliga)}" y2="${Y(desliga)}" stroke="#1c8a4a" stroke-dasharray="5 4"/>
    <text x="${L - m.d - 4}" y="${Y(desliga) - 5}" font-size="${F}" font-weight="600" fill="#1c6b3a" text-anchor="end">${compacto ? 'Desliga' : 'Desliga irrigação —'} ${formatarNumero(desliga)}%</text>`;
  if (liga != null) s += `<line x1="${m.e}" x2="${L - m.d}" y1="${Y(liga)}" y2="${Y(liga)}" stroke="#9aa5b3" stroke-dasharray="5 4"/>
    <text x="${L - m.d - 4}" y="${Y(liga) + F + 3}" font-size="${F}" font-weight="600" fill="#c4570c" text-anchor="end">${compacto ? 'Liga' : 'Liga irrigação —'} ${formatarNumero(liga)}%</text>`;

  // a linha NÃO atravessa lacunas: se faltar uma medição (intervalo > 1,5× o intervalo típico entre medições), os pontos ficam separados
  // e a lacuna recebe a legenda "sem medições". Nada é inventado entre dois pontos distantes.
  const difs = pts.slice(1).map((p, i) => Tempo.minutosTs(p.hora) - Tempo.minutosTs(pts[i].hora)).sort((a, b) => a - b);
  const tipico = difs.length ? difs[Math.floor(difs.length / 2)] : 60;
  const limiteLacuna = Math.max(tipico * 1.5, 45);
  let seg = [];
  const linhas = [];
  pts.forEach((p, i) => {
    if (i) {
      const ant = pts[i - 1], dif = Tempo.minutosTs(p.hora) - Tempo.minutosTs(ant.hora);
      if (dif > limiteLacuna) {
        linhas.push(seg); seg = [];
        if (dif >= 120) s += `<text class="legenda-lacuna" x="${((X(minDia(ant.hora)) + X(minDia(p.hora))) / 2).toFixed(1)}" y="${m.t + h - 6}" font-size="${F}" font-style="italic" fill="#5b6778" text-anchor="middle">sem medições</text>`;
      }
    }
    seg.push(p);
  });
  linhas.push(seg);
  /* Curva suave ("minhoca"): spline cúbica monótona (Fritsch–Carlson). Passa EXATAMENTE por cada medição e nunca
     ultrapassa o valor de dois pontos vizinhos (sem picos inventados). Lacunas continuam sem ligação. */
  linhas.forEach(sg => {
    if (sg.length < 2) return;
    const P = sg.map(p => [X(minDia(p.hora)), Y(p.umidade)]);
    s += `<polyline class="linha-base" fill="none" stroke="none" points="${P.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')}"/>`;
    s += `<path class="linha-umidade" fill="none" stroke="#0b86d1" stroke-width="${compacto ? 3.4 : 2.6}" stroke-linecap="round" stroke-linejoin="round" d="${caminhoSuave(P)}"/>`;
  });

  const itens = pts.map(p => {
    const x = X(minDia(p.hora)), y = Y(p.umidade);
    const ligada = eventos.some(e => e.ini <= p.hora && (!e.fim || e.fim > p.hora));
    const sel = selecionada && selecionada === p.hora;
    if (sel) s += `<circle class="ponto-selecionado" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${compacto ? 10 : 8}" fill="none" stroke="#14213d" stroke-width="2"/>`;
    s += `<circle class="ponto ${ligada ? 'irrig-ligada' : 'irrig-desligada'}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${compacto ? 5 : 3.5}" fill="${ligada ? '#15803d' : '#e0141e'}"/>`;
    const estado = Analise.estadoSolo(p.umidade, liga, desliga);
    return {
      hora: p.hora, umidade: p.umidade,
      x, y, guiaDe: m.t, guiaAte: m.t + h,
      titulo: `${Tempo.dataBR(p.dia)} · ${Tempo.horaDe(p.hora)}`,
      linhas: [`Umidade: ${formatarNumero(p.umidade, 1)}%`,
               ...(estado ? [`Solo: ${estado.rotulo.replace('Solo ', '')}`] : []),
               p.temperatura != null ? `Temperatura: ${formatarNumero(p.temperatura, 1)} °C` : 'Temperatura: sem leitura',
               `Irrigação: ${ligada ? 'ligada' : 'desligada'}`]
    };
  });
  wrap.innerHTML = `<svg viewBox="0 0 ${L} ${A}" role="img" aria-label="Umidade do solo em ${Tempo.dataBR(dia)}">${s}</svg>`;
  el.appendChild(wrap);
  conferirLargura(el, wrap, L, el._redesenhar);
  if (el._largura && el._largura !== L) return;                                 // foi redesenhado com a largura certa
  ligarInteracao(wrap, wrap.querySelector('svg'), itens, { largura: L, altura: A, rotulo: `Gráfico de umidade do solo em ${Tempo.dataBR(dia)}, ${pts.length} leituras`, inicial: selecionada ? pts.findIndex(p => p.hora === selecionada) : -1,
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
