/* Testes no NAVEGADOR do MODO API (usuário real): períodos incompletos, sem medições, dispositivo recente,
   lacunas, limites de data/hora e separação dos dados de demonstração.

   O Flask não sobe aqui: o navegador conversa com um "servidor de mentira" (page.route) que segue as MESMAS regras
   do backend (painel.py): só devolve o dono dos dados, o intervalo pedido [inicio, fim] inclusive e nada posterior
   ao momento da consulta. Assim o que se testa é o FRONT-END com respostas reais do formato da API.
   (O SQL do backend é testado à parte: backend/tests, inclusive contra PostgreSQL real.)

   Uso (raiz do projeto):  NODE_PATH=<pasta do playwright> node frontend/tests/e2e_real.js [pasta-das-capturas]
   Relógio do navegador: 16/10/2026 14:05 em Fortaleza (17:05 UTC); fuso do navegador: Japão (de propósito). */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = process.argv[2] || path.join(__dirname, 'capturas');
fs.mkdirSync(SAIDA, { recursive: true });
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const estatico = http.createServer((req, res) => {
  const arq = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('nao encontrado'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});

const AGORA_UTC = Date.parse('2026-10-16T17:05:00Z');
const AGORA_LOCAL = '2026-10-16T14:05:00';           // horário de Fortaleza
const HOJE = '2026-10-16';
const dois = n => String(n).padStart(2, '0');
const lista = (a, b) => { const r = []; for (let d = Date.parse(a + 'T00:00:00Z'); d <= Date.parse(b + 'T00:00:00Z'); d += 86400000) r.push(new Date(d).toISOString().slice(0, 10)); return r; };
const num = t => Number(String(t).replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));

/* ---------- "banco" de cada cenário e o servidor de mentira ---------- */
let cenario = null;                                    // { leituras:[[tipo,valor,'AAAA-MM-DDTHH:MM:SS']], eventos:[{...}], dispositivo:true }
function leiturasHorarias(dias, h0 = 6, h1 = 18, base = 20) {
  const r = [];
  dias.forEach((d, i) => { for (let h = h0; h <= h1; h++) { r.push(['umidade_solo', base + ((i * 3 + h) % 9), `${d}T${dois(h)}:00:00`], ['temperatura', 28 + (h % 5), `${d}T${dois(h)}:00:00`]); } });
  return r;
}
function evento(id, dia, hIni, hFim, litros) {
  return { id, dispositivo_id: 1, iniciado_em: `${dia}T${dois(hIni)}:00:00`, encerrado_em: `${dia}T${dois(hFim)}:00:00`, duracao_minutos: (hFim - hIni) * 60, agua_utilizada_litros: litros, umidade_antes: 17, umidade_depois: 31 };
}
const noIntervalo = (ts, ini, fim) => ts >= ini + 'T00:00:00' && ts < lista(fim, fim).map(() => new Date(Date.parse(fim + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10))[0] + 'T00:00:00' && ts <= AGORA_LOCAL;
function responder(url) {
  const u = new URL(url), rota = u.pathname.replace(/^\/api/, ''), q = u.searchParams;
  const leituras = () => cenario.leituras.filter(([, , ts]) => noIntervalo(ts, q.get('inicio'), q.get('fim')))
    .sort((a, b) => a[2] < b[2] ? -1 : 1).map(([tipo, valor, ts]) => ({ sensor_id: { umidade_solo: 1, temperatura: 2, vazao_agua: 3 }[tipo], tipo, valor, hora_leitura: ts }));
  const eventos = () => cenario.eventos.filter(e => noIntervalo(e.iniciado_em, q.get('inicio'), q.get('fim')));
  if (rota === '/dashboard') {
    const passadas = cenario.leituras.filter(([, , ts]) => ts <= AGORA_LOCAL), ult = t => passadas.filter(l => l[0] === t).sort((a, b) => a[2] < b[2] ? 1 : -1)[0];
    const um = ult('umidade_solo'), te = ult('temperatura');
    return { resumo: { usuario_id: 7, nome_usuario: 'Maria Real', propriedade_id: 3, nome_propriedade: 'Sítio Real', cultura: 'Milho', limite_umidade: 18, limite_umidade_desliga: 30,
      dispositivo_id: cenario.dispositivo ? 1 : null, online: cenario.dispositivo ? false : null, irrigacao_ligada: false, umidade_atual: um ? um[1] : null, temperatura_atual: te ? te[1] : null,
      hora_umidade_atual: um ? um[2] : null, ultimo_sinal: um ? um[2] : null } };
  }
  if (rota === '/historico') return { leituras: leituras(), eventos: eventos() };
  if (rota === '/irrigacoes') return { eventos: eventos() };
  if (rota === '/consumo/resumo') return { hoje: 0, ultimos_7_dias: 0, ultimos_30_dias: 0, total: 0 };
  if (rota === '/dias-disponiveis') {
    const f = q.get('fonte');
    const dias = f === 'leituras' ? cenario.leituras.filter(l => l[0] !== 'vazao_agua' && l[2] <= AGORA_LOCAL).map(l => l[2].slice(0, 10)) : cenario.eventos.filter(e => e.iniciado_em <= AGORA_LOCAL).map(e => e.iniciado_em.slice(0, 10));
    return { dias: [...new Set(dias)].sort() };
  }
  return {};
}

const resultados = [], errosConsole = [];
let page, base;
async function teste(nome, fn) {
  try { await fn(); resultados.push({ nome, ok: true }); console.log('  OK   ' + nome); }
  catch (e) { resultados.push({ nome, ok: false }); console.log('  FALHA ' + nome + '\n        ' + e.message.split('\n').slice(0, 7).join('\n        ')); try { await page.screenshot({ path: path.join(SAIDA, 'FALHA-real-' + nome.slice(0, 12).replace(/\W+/g, '_') + '.png') }); } catch (x) { /* ignora */ } }
}
const textoDe = sel => page.locator(sel).first().innerText();
const esperaFim = sel => page.waitForFunction(s => { const e = document.querySelector(s); return e && !e.querySelector('.spinner') && e.children.length > 0; }, sel, { timeout: 8000 });
const ALVO = { dashboard: '#grafico', historico: '#tabela', irrigacoes: '#eventos', consumo: '#grafico' };
async function irPara(pg, dados) {
  if (dados) cenario = dados;
  await page.goto(`${base}/${pg}/${pg}.html`); await esperaFim(ALVO[pg]);
}
async function periodo(v) { await page.click(`.periodo-opcoes button[data-valor="${v}"]`); await page.waitForTimeout(250); }
async function escolherData(campo, iso) {
  await page.click(`.data-btn[data-campo=${campo}]`); await page.waitForSelector('.calendario');
  for (let i = 0; i < 30; i++) {
    const alvo = page.locator(`.calendario [data-dia="${iso}"]`);
    if (await alvo.count()) { await alvo.click(); return; }
    const mes = await page.$eval('.calendario .cal-topo strong', e => e.textContent);
    await page.click('.calendario [data-nav="-1"]'); await page.waitForTimeout(20);
    if (mes === await page.$eval('.calendario .cal-topo strong', e => e.textContent)) throw new Error('data fora do calendário: ' + iso);
  }
  throw new Error('data não encontrada: ' + iso);
}
async function personalizado(ini, fim) {
  await page.click('.periodo-opcoes button[data-valor="personalizado"]');
  await escolherData('ini', ini); await escolherData('fim', fim); await page.click('.f-aplicar'); await page.waitForTimeout(300);
}
const diasDaPaginacao = async () => {            // percorre a paginação diária (do mais recente ao mais antigo)
  const r = [];
  while (true) {
    if (!(await page.locator('#paginacaoDias').isVisible())) break;
    r.push(await page.evaluate(() => (typeof pagDias !== 'undefined' ? pagDias : paginacao).dia));
    if (await page.locator('[data-a=ant]').isDisabled()) break;
    await page.click('[data-a=ant]'); await page.waitForTimeout(60);
  }
  return r.reverse();
};
const SEM = { dispositivo: true, leituras: [], eventos: [] };

(async () => {
  await new Promise(r => estatico.listen(0, r));
  base = `http://localhost:${estatico.address().port}`;
  const nav = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'pt-BR' });
  await ctx.addInitScript(agora => {
    Date.now = () => agora;
    try { localStorage.setItem('aquasmart_modo', 'api'); if (!sessionStorage.getItem('aquasmart_sessao')) sessionStorage.setItem('aquasmart_sessao', JSON.stringify({ usuario_id: 7, propriedade_id: 3, nome: 'Maria Real', email: 'maria@real.com', token: null })); } catch (e) { /* ignora */ }
  }, AGORA_UTC);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await ctx.route('http://localhost:5000/api/**', route => {
    const h = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    return route.fulfill({ status: 200, headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify(responder(route.request().url())) });
  });
  page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|fonts\.g|favicon|Failed to load resource/.test(m.text())) errosConsole.push(m.text()); });
  page.on('pageerror', e => errosConsole.push('PAGEERROR ' + e.message));
  console.log(`Modo API (servidor simulado) | relógio: ${AGORA_LOCAL} Fortaleza | fuso do navegador: Asia/Tokyo\n`);

  const ultimos7 = lista('2026-10-10', '2026-10-16');
  const completo = { dispositivo: true, eventos: [evento(1, '2026-10-12', 9, 11, 300), evento(2, '2026-10-15', 10, 12, 420)],
    leituras: leiturasHorarias(ultimos7.slice(0, -1)).concat(leiturasHorarias(['2026-10-16'], 6, 14)) };

  /* 1, 2) Hoje só até o momento da consulta; 7 dias com registros em todos os dias */
  await teste('R1 Hoje: só medições até 14:05 (nada do futuro); 7 dias com registros em todos os dias', async () => {
    await irPara('historico', { ...completo, leituras: completo.leituras.concat([['umidade_solo', 11.1, '2026-10-16T16:00:00']]) });   // medição "futura" que o servidor corta
    await periodo('hoje');
    const horas = await page.$$eval('#tabela tbody tr td:first-child', t => t.map(x => x.textContent.trim()));
    assert.deepEqual(horas, ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00']);
    assert.doesNotMatch(await textoDe('#tabela'), /16:00|11,1/);
    await periodo('7dias');
    assert.deepEqual(await diasDaPaginacao(), ultimos7, 'os 7 dias corridos (hoje + 6 anteriores)');
    assert.doesNotMatch(await textoDe('.pag-dias-info span'), /registradas em/, 'todos os dias com registro: sem aviso de lacuna');
    await periodo('1mes');
    assert.deepEqual(await diasDaPaginacao(), ultimos7, '1 mês: só os dias que existem (instalação há 7 dias), sem inventar anteriores');
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 7 de 30 dias/);
  });

  /* 3, 5, 11, 12) Registros em apenas alguns dias */
  const alguns = { dispositivo: true, eventos: [evento(1, '2026-10-12', 9, 11, 300)], leituras: leiturasHorarias(['2026-10-12', '2026-10-14']).concat(leiturasHorarias(['2026-10-16'], 6, 14)) };
  await teste('R3/R5/R11/R12 Alguns dias com registro (semana e mês): mostra o que existe, aponta a cobertura, sem zeros nem dias inventados', async () => {
    await irPara('historico', alguns); await periodo('7dias');
    assert.deepEqual(await diasDaPaginacao(), ['2026-10-12', '2026-10-14', '2026-10-16']);
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 3 de 7 dias/);
    // indicadores só com as medições existentes (3 dias; 13 + 13 + 9 = 35 leituras)
    const esperado = alguns.leituras.filter(l => l[0] === 'umidade_solo');
    const media = esperado.reduce((a, l) => a + l[1], 0) / esperado.length;
    assert.equal(num(await textoDe('#kUmidMedia')), Math.round(media * 10) / 10);
    assert.match(await textoDe('#nUmidMedia'), new RegExp(`${esperado.length} leituras`));
    assert.equal(num(await textoDe('#kUmidMin')), Math.min(...esperado.map(l => l[1])));
    await periodo('1mes');
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 3 de 30 dias/);
    assert.deepEqual(await diasDaPaginacao(), ['2026-10-12', '2026-10-14', '2026-10-16']);
    // Dashboard: dia sem registro nunca vira linha/ponto; o dia mostrado tem só seus pontos
    await irPara('dashboard', alguns); await periodo('7dias');
    assert.equal(await page.locator('#grafico circle.ponto').count(), 9, 'hoje (16/10) tem 9 medições, nada além disso');
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 3 de 7 dias/);
    const resumo = await page.$$eval('#resumoUmidade .resumo strong', t => t.map(x => x.textContent));
    assert.ok(resumo.every(t => !/^0([,.]0)?%$/.test(t)), 'nenhum indicador de umidade igual a 0%: ' + resumo.join(' | '));
    // Consumo: dias sem irrigação não viram barra de 0 L; só marca vazia
    await irPara('consumo', alguns); await periodo('7dias');
    assert.equal(await page.locator('#grafico rect.barra').count(), 1, 'uma barra (12/10); os outros 6 dias só marca vazia');
    assert.equal(await page.locator('#grafico line[stroke="#c9d3de"]').count(), 6);
    assert.match(await textoDe('#cobertura'), /Irrigações registradas em 1 de 7 dias/);
    assert.match(await textoDe('#maiorLitros'), /300/);
  });

  /* 4, 6) Sem nenhuma medição: mensagens e indicadores "—" */
  await teste('R4/R6/R10 Sem nenhuma medição: mensagens claras (hoje, semana, mês, personalizado) e indicadores "—", nunca zero', async () => {
    await irPara('historico', SEM);
    for (const [f, rx] of [['hoje', /Nenhuma medição registrada hoje até o momento/], ['7dias', /Nenhuma medição registrada na semana/], ['1mes', /Nenhuma medição registrada no mês/]]) {
      await periodo(f); assert.match(await textoDe('#tabela'), rx, f);
      for (const id of ['kUmidMedia', 'kTempMedia', 'kUmidMin', 'kTempMax']) assert.equal(await textoDe('#' + id), '—', f + ' ' + id);
    }
    await personalizado('2026-10-01', '2026-10-05');
    assert.match(await textoDe('#tabela'), /Nenhuma medição registrada no período selecionado/);
    await irPara('dashboard', SEM);
    for (const [f, rx] of [['hoje', /Nenhuma medição registrada hoje até o momento/], ['7dias', /Nenhuma medição registrada na semana/], ['1mes', /Nenhuma medição registrada no mês/]]) { await periodo(f); assert.match(await textoDe('#grafico'), rx, 'dashboard ' + f); }
    assert.equal(await page.locator('#resumoUmidade').isVisible(), false, 'sem medições: nada de máxima/mínima/média');
    assert.equal(await textoDe('#umidade'), '—', 'umidade atual: "—", não 0%');
    await irPara('irrigacoes', SEM); assert.match(await textoDe('#eventos'), /Nenhuma irrigação registrada hoje até o momento/);
    await periodo('7dias'); assert.match(await textoDe('#eventos'), /Nenhuma irrigação registrada na semana/);
    await irPara('consumo', SEM); await periodo('1mes');
    assert.match(await textoDe('#grafico'), /Nenhuma irrigação registrada no mês/);
    assert.equal(await textoDe('#maiorLitros'), '—'); assert.equal(await textoDe('#mediaDiaria'), '—');
    assert.equal(await page.locator('#grafico rect.barra').count(), 0);
    assert.equal(await page.locator('#paginacaoDias').isVisible(), false, 'sem dados não há paginação');
  });

  /* 8, 10) Dispositivo instalado há dias, mas sem leitura nova hoje */
  const semHoje = { dispositivo: true, eventos: [evento(1, '2026-10-14', 9, 11, 350)], leituras: leiturasHorarias(['2026-10-12', '2026-10-13', '2026-10-14']) };
  await teste('R8/R10 Instalado há dias, sem leitura hoje: aviso de hoje + histórico disponível + última medição real (sem afirmar desconexão)', async () => {
    await irPara('dashboard', semHoje); await periodo('hoje');
    assert.match(await textoDe('#grafico'), /Nenhuma medição registrada hoje até o momento/);
    assert.match(await textoDe('#grafico'), /Última medição registrada: 14\/10\/2026 às 18:00/);
    assert.match(await textoDe('#soloHora'), /Leitura de 18:00 em 14\/10/, 'o horário mostrado é o da medição real');
    assert.doesNotMatch(await page.locator('body').innerText(), /desconectad|offline/i, 'não afirma que o dispositivo está desconectado');
    assert.match(await textoDe('#irrigNota'), /Sem medições recentes/);
    await periodo('7dias');
    assert.deepEqual(await diasDaPaginacao(), ['2026-10-12', '2026-10-13', '2026-10-14'], 'o histórico existente aparece normalmente');
    assert.equal(await page.locator('#grafico circle.ponto').count(), 13);
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 3 de 7 dias/);
    await irPara('historico', semHoje); await periodo('hoje');
    assert.match(await textoDe('#tabela'), /Nenhuma medição registrada hoje até o momento/);
    assert.doesNotMatch(await textoDe('#tabela'), /14\/10|18:00/, 'Hoje não mistura registros de dias anteriores');
  });

  /* 9) Instalado recentemente */
  const recente = { dispositivo: true, eventos: [], leituras: leiturasHorarias(['2026-10-15'], 10, 18).concat(leiturasHorarias(['2026-10-16'], 6, 14)) };
  await teste('R9 Instalado ontem: 1 mês mostra só o histórico existente (2 dias), sem dados fictícios anteriores', async () => {
    await irPara('historico', recente); await periodo('1mes');
    assert.deepEqual(await diasDaPaginacao(), ['2026-10-15', '2026-10-16']);
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 2 de 30 dias/);
    assert.equal(await page.evaluate(() => USAR_MOCK), false, 'modo API: nada de dados simulados');
    assert.equal(await page.evaluate(() => typeof Demo === 'undefined' || !Tempo.temReferencia()), true, 'a data de referência do demo não vale no modo real');
    assert.doesNotMatch(await page.locator('body').innerText(), /Sítio Boa Vista|Usuário Demonstração/);
    await irPara('consumo', recente); await periodo('1mes');
    assert.match(await textoDe('#grafico'), /Nenhuma irrigação registrada no mês/, 'há medições, mas nenhuma irrigação: não vira "0 L" medido');
  });

  /* gráfico com lacuna */
  const lacuna = { dispositivo: true, eventos: [], leituras: [['umidade_solo', 22, '2026-10-14T06:00:00'], ['umidade_solo', 23, '2026-10-14T07:00:00'], ['umidade_solo', 24, '2026-10-14T08:00:00'],
    ['umidade_solo', 25, '2026-10-14T12:00:00'], ['umidade_solo', 26, '2026-10-14T13:00:00'], ['umidade_solo', 27, '2026-10-14T20:30:00']] };
  await teste('R11b Lacunas no gráfico: linha interrompida, legenda "sem medições", pontos só onde houve medição, escala amplia para medição fora de 06–18h', async () => {
    await irPara('dashboard', lacuna); await periodo('7dias');
    assert.equal(await page.locator('#grafico circle.ponto').count(), 6, 'um ponto por medição, nenhum inventado');
    assert.equal(await page.locator('#grafico polyline').count(), 2, 'duas linhas: 06–08h e 12–13h; a lacuna 08→12 e 13→20:30 não é ligada');
    assert.equal(await page.locator('#grafico .legenda-lacuna').count(), 2);
    assert.match(await page.$eval('#grafico .legenda-lacuna', e => e.textContent), /sem medições/);
    const rotulos = await page.$$eval('#grafico .rotulo-hora', t => t.map(x => x.textContent));
    assert.equal(rotulos[rotulos.length - 1], '20:00', 'a medição das 20:30 não é escondida: a escala vai até 21h → último rótulo 20:00');
    assert.equal(await textoDe('#subGrafico'), '6 leituras', 'a contagem bate com os pontos desenhados');
  });

  /* semana (bloco) sem nenhum registro, com registros em outras semanas */
  await teste('R4b Consumo: semana sem nenhum registro mostra "Nenhuma irrigação registrada na semana" e as outras semanas continuam navegáveis', async () => {
    const esparso = { dispositivo: true, leituras: [], eventos: [evento(1, '2026-10-14', 9, 11, 310), evento(2, '2026-09-22', 9, 11, 280)] };
    await irPara('consumo', esparso); await periodo('1mes');       // 17/09–16/10 → semanas de 17–23/09, 24–30/09, 01–07/10, 08–14/10, 15–16/10
    assert.match(await textoDe('.pag-dias-info strong'), /^Semana 5 de 5/);
    assert.match(await textoDe('#grafico'), /Nenhuma irrigação registrada na semana/, 'semana 5 (15–16/10): sem registro');
    await page.click('[data-a=ant]'); await page.waitForTimeout(100);
    assert.equal(await page.locator('#grafico rect.barra').count(), 1, 'semana 4 (08–14/10) tem a irrigação de 14/10');
    await page.click('[data-a=ant]'); await page.waitForTimeout(100);
    assert.match(await textoDe('#grafico'), /Nenhuma irrigação registrada na semana/, 'semana 3: sem registro');
    assert.match(await textoDe('.resumo-consumo'), /310/, 'indicadores seguem o período inteiro, mesmo numa semana vazia');
    assert.match(await textoDe('#cobertura'), /Irrigações registradas em 2 de 30 dias/);
  });

  /* 7, 16) Personalizado: limites exatos e meia-noite */
  const limites = { dispositivo: true, eventos: [], leituras: [['umidade_solo', 21, '2026-10-09T23:59:00'], ['umidade_solo', 22, '2026-10-10T00:00:00'], ['umidade_solo', 23, '2026-10-12T23:59:59'], ['umidade_solo', 24, '2026-10-13T00:00:00']] };
  await teste('R7/R16 Personalizado respeita exatamente as datas (meia-noite incluída); fuso do navegador (Japão) não desloca os dias', async () => {
    await irPara('historico', limites); await personalizado('2026-10-10', '2026-10-12');
    assert.deepEqual(await diasDaPaginacao(), ['2026-10-10', '2026-10-12']);
    const vals = [];
    for (const d of ['2026-10-12', '2026-10-10']) { await page.evaluate(x => { pagDias.selecionar(x); mostrarDia(x); }, d); vals.push(await page.$$eval('#tabela tbody tr', t => t.map(x => x.innerText.replace(/\s+/g, ' ').trim()))); }
    assert.match(vals[0].join('|'), /23:59:59 23%/); assert.match(vals[1].join('|'), /00:00 22%/);
    assert.doesNotMatch(vals.flat().join('|'), /21%|24%/, 'nada de 09/10 23:59 nem de 13/10 00:00');
    assert.equal(await page.evaluate(() => periodoAtual.inicio + '|' + periodoAtual.fim), '2026-10-10|2026-10-12');
    // intervalo sem registros dentro do período aceito: aviso (e a data de hoje continua sendo a de Fortaleza)
    assert.equal(await page.evaluate(() => Tempo.hoje()), HOJE);
  });

  /* 14) consistência entre telas */
  await teste('R14 Mesmo intervalo, mesmos registros em Dashboard, Histórico, Irrigações e Consumo', async () => {
    const dias = {};
    for (const [pg, rot] of [['dashboard', '#paginacaoDias'], ['historico', '#paginacaoDias'], ['irrigacoes', '#paginacaoDias']]) {
      await irPara(pg, alguns); await periodo('7dias'); dias[pg] = await diasDaPaginacao();
    }
    assert.deepEqual(dias.dashboard, dias.historico, 'Dashboard = Histórico');
    assert.deepEqual(dias.irrigacoes, ['2026-10-12'], 'Irrigações: só o dia com evento');
    await irPara('historico', alguns); await periodo('7dias');
    const totalHist = (await page.evaluate(() => dados.grupos.filter(g => g.umidade != null).length));
    await irPara('dashboard', alguns); await periodo('7dias');
    assert.equal(await page.evaluate(() => dadosPeriodo.grupos.filter(g => g.umidade != null).length), totalHist, 'mesma contagem de leituras');
    await irPara('irrigacoes', alguns); await periodo('7dias');
    const litrosIrr = num(await textoDe('#kAgua'));
    await irPara('consumo', alguns); await periodo('7dias');
    assert.equal(await page.evaluate(() => Analise.estatisticaConsumo(dados.porDia).total), litrosIrr, 'Irrigações = Consumo');
  });

  await teste('R0 Console do navegador sem erros', async () => { assert.deepEqual(errosConsole, []); });

  await nav.close(); estatico.close();
  const falhas = resultados.filter(r => !r.ok);
  console.log(`\n${resultados.length - falhas.length}/${resultados.length} testes do modo real passaram`);
  process.exit(falhas.length ? 1 : 0);
})();
