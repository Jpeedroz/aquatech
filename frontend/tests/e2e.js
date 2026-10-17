/* Testes no NAVEGADOR (Chromium via Playwright) do MODO DEMO.
   Sobem um servidor estático local, entram no sistema e conferem as 4 telas.

   Uso (na raiz do projeto):
     NODE_PATH=<pasta onde está o playwright> node frontend/tests/e2e.js [pasta-das-capturas]
   Variáveis: CHROMIUM=/caminho/do/chrome (opcional)

   O navegador roda com fuso do Japão de propósito: as telas devem usar o fuso da propriedade
   (America/Fortaleza) e não o do navegador.                                                     */
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const RAIZ = path.resolve(__dirname, '..');
const SAIDA = process.argv[2] || path.join(__dirname, 'capturas');
fs.mkdirSync(SAIDA, { recursive: true });
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const servidor = http.createServer((req, res) => {
  const arq = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('nao encontrado'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  fs.createReadStream(arq).pipe(res);
});

const resultados = [];
const chamadasApiNoDemo = [];   // pedidos ao servidor feitos enquanto o modo demonstração está ativo (deve ficar vazio)
let apiPermitida = false;
const errosConsole = [];
let page, base;
const T_lista = (a, b) => { const r = []; for (let d = Date.parse(a + 'T00:00:00Z'); d <= Date.parse(b + 'T00:00:00Z'); d += 86400000) r.push(new Date(d).toISOString().slice(0, 10)); return r; };
const num = t => Number(String(t).replace(/\./g, '').replace(',', '.').replace(/[^\d.\-]/g, ''));
// Relógio do COMPUTADOR no teste: 16/10/2026 14:05 (fixo). O demo deve mostrar 19/10/2026 mesmo assim (MOCK_DATA_REFERENCIA).
const AGORA_E2E = Date.parse('2026-10-16T17:05:00Z');
const HOJE_DEMO = '2026-10-19';
const hojeFortaleza = () => '2026-10-19';   // data de REFERÊNCIA do demo (o relógio do teste fica em 16/10 de propósito)
const esperaFim = (sel) => page.waitForFunction(s => { const e = document.querySelector(s); return e && !e.querySelector('.spinner') && e.children.length > 0; }, sel, { timeout: 8000 });

async function teste(nome, fn) {
  const t0 = Date.now();
  try { await fn(); resultados.push({ nome, ok: true, ms: Date.now() - t0 }); console.log('  OK   ' + nome); }
  catch (e) { resultados.push({ nome, ok: false, erro: e.message.split('\n').slice(0, 6).join(' | ') }); console.log('  FALHA ' + nome + '\n        ' + e.message.split('\n').slice(0, 6).join('\n        ')); try { await page.screenshot({ path: path.join(SAIDA, 'FALHA-' + nome.slice(0, 20).replace(/\W+/g, '_') + '.png') }); } catch (x) { /* ignora */ } }
}

async function irPara(pagina) {
  await page.goto(`${base}/${pagina}/${pagina}.html`);
  const alvo = { dashboard: '#grafico', historico: '#tabela', irrigacoes: '#eventos', consumo: '#grafico' }[pagina];
  await esperaFim(alvo);
}
async function periodo(valor) {
  await page.click(`.periodo-opcoes button[data-valor="${valor}"]`);
  await page.waitForTimeout(80);
}
const textoDe = sel => page.locator(sel).first().innerText();
const pagInfo = async () => {
  const visivel = await page.locator('#paginacaoDias').isVisible();
  if (!visivel) return { visivel: false };
  const t = await textoDe('.pag-dias-info strong');
  const m = t.match(/^Dia (\d+) de (\d+) — (\d\d\/\d\d\/\d{4})$/);
  assert.ok(m, 'formato da paginação: "Dia N de M — dd/mm/aaaa": ' + t);
  return { visivel: true, pos: +m[1], total: +m[2], dataTxt: m[3], ant: await page.locator('[data-a=ant]').isDisabled(), prox: await page.locator('[data-a=prox]').isDisabled() };
};
async function percorrerDias(aoDia) {                       // do mais recente ao mais antigo
  let info = await pagInfo(); const lista = [];
  while (true) {
    await aoDia(info); lista.push(info);
    if (!info.visivel || info.ant) break;
    await page.click('[data-a=ant]'); await page.waitForTimeout(40); info = await pagInfo();
  }
  return lista;
}
async function entrar() {
  await page.goto(`${base}/login/login.html`);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${base}/login/login.html`);
  await page.fill('#email', 'usuario@exemplo.com'); await page.fill('#senha', '123456');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard/**');
  await esperaFim('#grafico');
}

/* abre o calendário do campo ("ini" ou "fim") e devolve os dias habilitados navegando mês a mês para trás */
async function diasHabilitadosDoCalendario() {
  await page.click('.periodo-opcoes button[data-valor="personalizado"]');
  await page.click('.data-btn[data-campo=ini]');
  await page.waitForSelector('.calendario');
  const dias = new Set(); const desabilitadosNoPassado = new Set(); let futuroHabilitado = 0;
  const hoje = hojeFortaleza();
  for (let i = 0; i < 12; i++) {
    const botoes = await page.$$eval('.calendario .cal-dia', bs => bs.map(b => ({ d: b.dataset.dia, off: b.disabled, vazio: b.classList.contains('sem-dados') })));
    // "dias" = dias COM dados (habilitados e sem a marca cinza "sem-dados"); dias sem registro continuam escolhíveis (a tela avisa)
    botoes.forEach(b => { if (!b.off && !b.vazio) dias.add(b.d); else if (b.off && b.d <= hoje) desabilitadosNoPassado.add(b.d); if (!b.off && b.d > hoje) futuroHabilitado++; });
    const ant = page.locator('.calendario [data-nav="-1"]');
    if (await ant.isDisabled()) break;
    await ant.click(); await page.waitForTimeout(30);
  }
  await page.keyboard.press('Escape');
  return { dias, desabilitadosNoPassado, futuroHabilitado };
}
async function escolherData(campo, iso) {
  await page.click(`.data-btn[data-campo=${campo}]`);
  await page.waitForSelector('.calendario');
  for (let i = 0; i < 24; i++) {
    const alvo = page.locator(`.calendario [data-dia="${iso}"]`);
    if (await alvo.count()) { await alvo.click(); return; }
    const mesAtual = await page.$eval('.calendario .cal-topo strong', e => e.textContent);
    const atual = await page.$$eval('.calendario .cal-dia', bs => bs[0].dataset.dia.slice(0, 7));
    await page.click(`.calendario [data-nav="${atual > iso.slice(0, 7) ? -1 : 1}"]`);
  }
  throw new Error('data não encontrada no calendário: ' + iso);
}

(async () => {
  await new Promise(r => servidor.listen(0, r));
  base = `http://localhost:${servidor.address().port}`;
  const navegador = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Tokyo', locale: 'pt-BR' });
  await ctx.addInitScript(base => { const k = localStorage.getItem('e2e_agora'); const fixo = k ? Number(k) : base; Date.now = () => fixo; }, AGORA_E2E);
  page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET|fonts\.g|favicon|Failed to load resource/.test(m.text())) errosConsole.push(m.text()); });
  page.on('request', q => { if (!apiPermitida && /:5000\/|\/api\//.test(q.url())) chamadasApiNoDemo.push(q.method() + ' ' + q.url()); });
  page.on('pageerror', e => errosConsole.push('PAGEERROR ' + e.message + ' @ ' + page.url()));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const HOJE = hojeFortaleza();
  console.log('Fuso do navegador: Asia/Tokyo | "hoje" em Fortaleza: ' + HOJE + '\n');
  await teste('00 Login de demonstração: usuario@exemplo.com / 123456; senha errada e conta inexistente são recusadas', async () => {
    await page.goto(`${base}/login/login.html`);
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(`${base}/login/login.html`);
    await page.fill('#email', 'usuario@exemplo.com'); await page.fill('#senha', 'errada1'); await page.click('button[type=submit]');
    await page.waitForTimeout(300);
    assert.match(await page.locator('body').innerText(), /E-mail ou senha incorretos/); assert.match(page.url(), /login/);
    await page.fill('#email', 'ninguem@exemplo.com'); await page.fill('#senha', '123456'); await page.click('button[type=submit]');
    await page.waitForTimeout(300); assert.match(page.url(), /login/);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('aquasmart_sessao')), null);
    // o texto da senha e o hash nunca ficam no navegador
    await entrar();
    const guardado = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)));
    assert.ok(!guardado.includes('123456'), 'a senha em texto não pode ser guardada');
    assert.match(await page.locator('body').innerText(), /Usuário/);
  });
  await entrar();

  /* ---------------- 1 ---------------- */
  await teste('01 Hoje: 4 telas coerentes, sem paginação diária', async () => {
    await irPara('dashboard');
    assert.equal((await pagInfo()).visivel, false, 'Hoje não deve mostrar paginação diária');
    const consumoDash = num(await textoDe('#consumoHoje'));
    assert.match(await textoDe('#tituloGrafico'), /hoje/i);
    await irPara('irrigacoes'); assert.equal((await pagInfo()).visivel, false);
    const aguaIrr = num(await textoDe('#kAgua'));
    await irPara('consumo'); assert.equal((await pagInfo()).visivel, false);
    const cardHoje = num(await textoDe('#cHoje'));
    await irPara('historico'); assert.equal((await pagInfo()).visivel, false);
    const resumo = await textoDe('#resumoDia');
    const doDia = num((resumo.match(/consumo do dia: ([\d.,]+)/) || [])[1] || 0);
    assert.equal(consumoDash, aguaIrr); assert.equal(aguaIrr, cardHoje); assert.equal(cardHoje, doDia);
  });

  /* ---------------- 2 ---------------- */
  await teste('02 7 dias: paginação diária (mais recente primeiro) sem recarregar a página', async () => {
    await irPara('dashboard');
    await page.evaluate(() => { window.__marca = 'viva'; });
    await periodo('7dias'); await esperaFim('#grafico');
    let i = await pagInfo();
    assert.equal(i.visivel, true); assert.equal(i.pos, i.total, 'deve começar no dia mais recente'); assert.ok(i.total >= 5 && i.total <= 7);
    assert.match(i.dataTxt, new RegExp(HOJE.slice(8, 10) + '/' + HOJE.slice(5, 7)));
    const titulo0 = await textoDe('#tituloGrafico');
    await page.click('[data-a=ant]'); await page.waitForTimeout(60);
    const i2 = await pagInfo();
    assert.equal(i2.pos, i.total - 1);
    assert.notEqual(await textoDe('#tituloGrafico'), titulo0, 'o gráfico deve trocar de dia');
    assert.equal(await page.evaluate(() => window.__marca), 'viva', 'a página não pode recarregar');
    await page.click('[data-a=prox]'); await page.waitForTimeout(60);
    assert.equal((await pagInfo()).pos, i.total);
    for (const p of ['historico', 'irrigacoes']) {
      await irPara(p); await periodo('7dias'); await page.waitForTimeout(150);
      const x = await pagInfo(); assert.equal(x.visivel, true, p); assert.equal(x.pos, x.total, p + ' começa no dia mais recente');
    }
    await irPara('consumo'); await periodo('7dias'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#paginacaoDias').isVisible(), false, 'consumo: até 7 dias não tem paginação (nem semanal nem diária)');
  });

  /* ---------------- 3 ---------------- */
  await teste('03 1 mês: totais batem entre Consumo, Irrigações e o cartão de 30 dias', async () => {
    await irPara('consumo'); await periodo('1mes'); await page.waitForTimeout(150);
    assert.equal(await textoDe('#subGrafico'), 'Consumo registrado no último mês');
    const total = await page.evaluate(() => Analise.estatisticaConsumo(dados.porDia).total);
    assert.equal(total, num(await textoDe('#c30')), 'total do período 1 mês deve igualar o cartão "Últimos 30 dias"');
    const slots = await page.evaluate(() => document.querySelectorAll('#grafico svg rect.barra, #grafico svg line[stroke="#c9d3de"]').length);
    assert.equal(slots, 2, '1 mês (30 dias) = 7+7+7+7+2: a semana mais recente (incompleta) mostra só os 2 dias restantes');
    await irPara('irrigacoes'); await periodo('1mes'); await page.waitForTimeout(150);
    assert.equal(num(await textoDe('#kAgua')), total);
    await irPara('dashboard'); await periodo('1mes'); await page.waitForTimeout(150);
    assert.equal(num(await textoDe('#consumoHoje')), total);
    assert.match(await textoDe('#rotuloConsumo'), /30 dias/);
  });

  /* ---------------- 4 ---------------- */
  await teste('04 Personalizado: calendário, datas futuras/sem dados bloqueadas, validação e aplicação', async () => {
    await irPara('consumo');
    await page.click('.periodo-opcoes button[data-valor="personalizado"]');
    assert.equal(await page.locator('.periodo-custom').isVisible(), true);
    await page.click('.data-btn[data-campo=ini]'); await page.waitForSelector('.calendario');
    const futuros = await page.$$eval('.calendario .cal-dia', (bs, h) => bs.filter(b => b.dataset.dia > h).map(b => b.disabled), HOJE);
    assert.ok(futuros.every(x => x === true), 'todos os dias futuros devem estar desabilitados');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.calendario').count(), 0, 'Esc fecha o calendário');
    // data final anterior à inicial → erro
    const { dias } = await diasHabilitadosDoCalendario();
    const lista = [...dias].sort();
    const [a, b] = [lista[lista.length - 3], lista[lista.length - 1]];
    await escolherData('ini', b); await escolherData('fim', a);
    await page.click('.f-aplicar');
    assert.match(await textoDe('.f-erro'), /anterior ou igual/);
    await escolherData('ini', a); await escolherData('fim', b);
    await page.click('.f-aplicar'); await page.waitForTimeout(150);
    assert.equal(await textoDe('.f-erro'), '');
    const [d1, m1, a1] = [a.slice(8), a.slice(5, 7), a.slice(0, 4)];
    assert.equal(await textoDe('#subGrafico'), 'Consumo registrado no período selecionado');
    assert.equal(await page.evaluate(() => periodoAtual.inicio), a);
    assert.equal((await pagInfo()).visivel, false, 'período personalizado de até 7 dias (3 dias) não tem paginação');
    // período de 1 dia: sem paginação
    await escolherData('ini', b); await escolherData('fim', b); await page.click('.f-aplicar'); await page.waitForTimeout(150);
    assert.equal((await pagInfo()).visivel, false, 'período de 1 dia não tem paginação');
    assert.equal(await textoDe('#subGrafico'), 'Consumo registrado no período selecionado');
  });

  /* ---------------- 5 ---------------- */
  await teste('05 Anterior/Próximo: desabilitados nos limites e reiniciados ao trocar o filtro', async () => {
    await irPara('historico'); await periodo('7dias'); await page.waitForTimeout(150);
    let i = await pagInfo();
    assert.equal(i.prox, true, 'no dia mais recente "Próximo" está desabilitado'); assert.equal(i.ant, false);
    const total = i.total;
    for (let k = 1; k < total; k++) { await page.click('[data-a=ant]'); await page.waitForTimeout(30); }
    i = await pagInfo(); assert.equal(i.pos, 1); assert.equal(i.ant, true); assert.equal(i.prox, false);
    await periodo('1mes'); await page.waitForTimeout(200);
    i = await pagInfo(); assert.equal(i.pos, i.total, 'trocar o filtro volta ao dia mais recente');
    await periodo('hoje'); await page.waitForTimeout(150);
    assert.equal((await pagInfo()).visivel, false);
  });

  /* ---------------- 6 ---------------- */
  await teste('06 Estabilidade: os dados não mudam ao recarregar nem ao trocar de página; nada do demo fica no navegador', async () => {
    const tabela = async () => { await irPara('historico'); await periodo('7dias'); await page.waitForTimeout(150); await page.click('[data-a=ant]'); await page.waitForTimeout(60); return { t: await textoDe('#tabela tbody'), r: await textoDe('#resumoDia'), d: await textoDe('#tituloMedicoes') }; };
    const a = await tabela();
    await irPara('consumo'); await irPara('dashboard'); await page.reload(); await esperaFim('#grafico');
    const b = await tabela();
    assert.deepEqual(a, b, 'a tabela do mesmo dia deve ser idêntica');
    const chaves = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
    assert.ok(!chaves.some(k => /demo/.test(k)), 'as leituras simuladas não são guardadas no navegador: ' + chaves);
    const igual = await page.evaluate(() => { const antes = JSON.stringify(Demo.estado().E); Demo.reiniciar(); return antes === JSON.stringify(Demo.estado().E); });
    assert.equal(igual, true, 'regerar produz exatamente os mesmos dados');
  });

  /* ---------------- 7 ---------------- */
  await teste('07 Dashboard e Histórico mostram a MESMA leitura atual', async () => {
    await irPara('dashboard');
    const umid = num(await textoDe('#umidade')), hora = (await textoDe('#soloHora')).match(/(\d\d:\d\d)/)[1], temp = num(await textoDe('#temperatura'));
    await irPara('historico');
    const ultima = await page.evaluate(() => linhasDoDia[linhasDoDia.length - 1]);
    assert.equal(ultima.umidade, umid); assert.equal(ultima.temperatura, temp); assert.equal(ultima.hora.slice(11, 16), hora);
    // e a umidade do gráfico no mesmo horário
    await irPara('dashboard');
    const ponto = await page.evaluate(() => { const g = dadosPeriodo.grupos.filter(x => x.umidade != null); return g[g.length - 1]; });
    assert.equal(ponto.umidade, umid);
  });

  /* ---------------- 8 ---------------- */
  await teste('08 Irrigações ↔ Histórico: mesmos eventos, mesmos horários, em todos os dias de 7 dias', async () => {
    await irPara('irrigacoes'); await periodo('7dias'); await page.waitForTimeout(150);
    const irr = {};
    await percorrerDias(async () => {
      const dia = await page.evaluate(() => pagDias.dia);
      irr[dia] = await page.$$eval('#eventos .evento', cs => cs.map(c => c.querySelector('.hora').textContent));
      irr[dia].total = await page.evaluate(() => eventosDoDia.map(e => ({ ini: e.ini, fim: e.fim, litros: e.litros })));
    });
    await irPara('historico'); await periodo('7dias'); await page.waitForTimeout(150);
    let conferidos = 0;
    await percorrerDias(async () => {
      const r = await page.evaluate(() => ({ dia: pagDias.dia, linhas: linhasDoDia.map(l => ({ h: l.hora, lig: l.ligada, ev: l.eventoId })), eventos: dados.eventos.filter(e => e.dia === pagDias.dia).map(e => ({ ini: e.ini, fim: e.fim })) }));
      const esperado = irr[r.dia] ? irr[r.dia].total : [];
      assert.equal(r.eventos.length, esperado.length, `${r.dia}: quantidade de eventos`);
      esperado.forEach(ev => {
        const ligadas = r.linhas.filter(l => l.h >= ev.ini && (!ev.fim || l.h < ev.fim));
        assert.ok(ligadas.every(l => l.lig), `${r.dia}: linhas dentro do evento devem estar Ligada`);
        const fora = r.linhas.filter(l => l.lig && !esperado.some(e => l.h >= e.ini && (!e.fim || l.h < e.fim)));
        assert.equal(fora.length, 0, `${r.dia}: nenhuma linha Ligada fora dos eventos`);
        conferidos++;
      });
    });
    assert.ok(conferidos >= 3);
  });

  /* ---------------- 9 ---------------- */
  await teste('09 Consumo diário = soma dos eventos (Consumo, Irrigações e Histórico iguais por dia)', async () => {
    await irPara('consumo'); await periodo('7dias'); await page.waitForTimeout(150);
    const cons = {};
    for (const r of await page.evaluate(() => dados.porDia.map(x => ({ d: x.dia, litros: x.litros, soma: Analise.soma(x.eventos.map(e => e.litros)) })))) {
      assert.equal(r.litros, r.soma, `${r.d}: total do dia = soma dos eventos`);
      cons[r.d] = r.litros;
    }
    assert.equal(Object.keys(cons).length, 7, 'os 7 dias têm consumo');
    await irPara('irrigacoes'); await periodo('7dias'); await page.waitForTimeout(150);
    await percorrerDias(async () => {
      const dia = await page.evaluate(() => pagDias.dia);
      assert.equal(num(await textoDe('#tagsDia .tag-resumo:nth-child(2) strong')), cons[dia], `${dia}: Irrigações = Consumo`);
    });
    await irPara('historico'); await periodo('7dias'); await page.waitForTimeout(150);
    await percorrerDias(async () => {
      const dia = await page.evaluate(() => pagDias.dia);
      const resumo = await textoDe('#resumoDia'); const l = num((resumo.match(/consumo do dia: ([\d.,]+) L/) || [])[1]);
      assert.equal(l, cons[dia] || 0, `${dia}: Histórico = Consumo`);
      const ac = await page.evaluate(() => linhasDoDia.map(l => l.acumulado));
      for (let k = 1; k < ac.length; k++) assert.ok(ac[k] >= ac[k - 1], `${dia}: acumulado diminuiu`);
    });
  });

  /* ---------------- 10 ---------------- */
  await teste('10 Totais fixos (7 e 30 dias) = soma exata dos mesmos eventos filtrados', async () => {
    await irPara('consumo');
    const c7 = num(await textoDe('#c7')), c30 = num(await textoDe('#c30')), total = num(await textoDe('#cTotal')), c0 = num(await textoDe('#cHoje'));
    const calc = await page.evaluate(async hoje => {
      const todos = Analise.eventosOrdenados((await getIrrigacoesData('0000-01-01', '9999-12-31')).eventos);
      const por = Analise.consumoPorDia(todos);
      const ate = n => Analise.soma(por.filter(d => d.dia >= Tempo.somarDias(hoje, -n) && d.dia <= hoje).map(d => d.litros));
      return { c0: ate(0), c7: ate(6), c30: ate(29), total: Analise.soma(por.map(d => d.litros)) };
    }, HOJE);
    assert.deepEqual({ c0, c7, c30, total }, calc);
    await periodo('7dias'); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => Analise.estatisticaConsumo(dados.porDia).total), c7);
    // média diária = total ÷ dias com consumo
    const media = num(await textoDe('#mediaDiaria')); const txt = await textoDe('#mediaTexto'); const [, tot, n] = txt.match(/([\d.,]+) L ÷ (\d+)/);
    assert.ok(Math.abs(media - num(tot) / Number(n)) < 0.06);
  });

  /* ---------------- 11 ---------------- */
  await teste('11 Calendários: cada tela marca os dias com dados da sua fonte (dias sem registro continuam escolhíveis)', async () => {
    const fontes = { dashboard: 'leituras', historico: 'leituras', irrigacoes: 'eventos', consumo: 'consumo' };
    const diasPorFonte = {};
    for (const [pag, fonte] of Object.entries(fontes)) {
      await irPara(pag);
      const { dias, desabilitadosNoPassado, futuroHabilitado } = await diasHabilitadosDoCalendario();
      const esperado = await page.evaluate(f => getDiasDisponiveis(f), fonte);
      assert.deepEqual([...dias].sort(), [...esperado].sort(), `${pag}: dias habilitados ≠ dias com dados (${fonte})`);
      assert.equal(futuroHabilitado, 0, pag + ': dia futuro habilitado');
      assert.ok([...desabilitadosNoPassado].every(d => d < '2025-10-19'), pag + ': só dias com mais de 366 dias de distância ficam indisponíveis');
      assert.deepEqual([...dias].sort(), T_lista('2026-08-01', HOJE), pag + ': todos os dias de 01/08 até hoje habilitados');
      diasPorFonte[pag] = [...dias];
    }
    assert.deepEqual(diasPorFonte.dashboard, diasPorFonte.historico);
    assert.deepEqual(diasPorFonte.irrigacoes, diasPorFonte.dashboard);
    assert.equal(diasPorFonte.consumo.length, 80);
  });

  /* ---------------- 12 ---------------- */
  await teste('12 Editar MOCK_AJUSTES em mockData.js reflete nas quatro páginas (e só elas)', async () => {
    const original = fs.readFileSync(path.join(RAIZ, 'shared/js/mockData.js'), 'utf8');
    const editado = original.replace(/\n  \],\n\n  \/\* Cria eventos/, `
    { hora: '2026-10-19T10:00', umidade: 55.5, temperatura: 38.8 },
  ],

  /* Cria eventos`).replace(/\n  \],\n\n  \/\* Apaga/, `
    { inicio: '2026-10-19T12:30', fim: '2026-10-19T12:50', vazao_lmin: 10 },
  ],

  /* Apaga`);
    assert.notEqual(editado, original, 'a edição de teste precisa ter sido aplicada');
    await irPara('consumo'); const antes = num(await textoDe('#cHoje'));
    await page.route('**/shared/js/mockData.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: editado }));
    try {
      await irPara('dashboard');
      const ponto10 = await page.evaluate(() => dadosPeriodo.grupos.find(g => g.hora === '2026-10-19T10:00:00'));
      assert.equal(ponto10.umidade, 55.5); assert.equal(ponto10.temperatura, 38.8);
      const pontos = await page.$$eval('#grafico svg circle.ponto', cs => cs.map(c => { const b = c.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
      await page.mouse.move(...pontos[4]);                                                   // 10:00 é o 5º ponto (06,07,08,09,10)
      assert.match(await textoDe('#grafico .balao'), /Umidade: 55,5%/); assert.match(await textoDe('#grafico .balao'), /Temperatura: 38,8 °C/);
      await irPara('historico');
      assert.match(await page.locator('#tabela tbody tr', { hasText: '10:00' }).first().innerText(), /55,5%.*38,8°C/s);
      await irPara('irrigacoes');
      assert.match(await textoDe('#eventos'), /12h30 – 12h50/); assert.match(await textoDe('#eventos'), /200 L/);            // 10 L/min × 20 min
      await irPara('consumo');
      assert.equal(num(await textoDe('#cHoje')), Math.round((antes + 200) * 10) / 10, 'o evento novo entra no consumo de hoje');
    } finally { await page.unroute('**/shared/js/mockData.js'); }
    await irPara('consumo'); assert.equal(num(await textoDe('#cHoje')) > 0, true);
  });

  /* ---------------- 13 ---------------- */
  await teste('13 Gráfico de umidade: 13 pontos 06–18h ligados, 7 rótulos, tooltip em TODOS os pontos (mouse e teclado); consumo em litros', async () => {
    await irPara('dashboard'); await periodo('7dias'); await esperaFim('#grafico');           // abre no dia mais recente: 19/10 (13 leituras, 06h–18h)
    const svg = '#grafico svg';
    const rotulos = await page.$$eval(`${svg} text.rotulo-hora`, ts => ts.map(t => t.textContent));
    assert.deepEqual(rotulos, ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
    const pontos = await page.$$eval(`${svg} circle.ponto`, cs => cs.map(c => { const b = c.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
    assert.equal(pontos.length, 13, 'um ponto por hora, das 06h às 18h');
    const linha = await page.$$eval(`${svg} polyline`, ps => ps.map(p => p.getAttribute('points').trim().split(/\s+/).length));
    assert.deepEqual(linha, [13], 'a linha conecta os 13 pontos');
    const dado = await page.evaluate(() => { const d = paginacao.dia; return dadosPeriodo.grupos.filter(g => g.dia === d && g.umidade != null).map(g => ({ h: g.hora.slice(11, 16), u: g.umidade, t: g.temperatura, lig: dadosPeriodo.eventos.some(e => e.ini <= g.hora && (!e.fim || e.fim > g.hora)) })); });
    assert.equal(dado.length, 13);
    const balao = page.locator('#grafico .balao');
    const fmt = v => v.toFixed(1).replace('.', ',');
    for (let i = 0; i < 13; i++) {                                                         // tooltip em cada um, inclusive 07h, 09h, 11h, 13h, 15h e 17h
      await page.mouse.move(5, 5); await page.mouse.move(...pontos[i]); await balao.waitFor({ state: 'visible' });
      const t = await balao.innerText();
      assert.match(t, new RegExp(`19/10/2026 · ${dado[i].h}`), `ponto ${i}: horário`);
      assert.ok(t.includes(`Umidade: ${fmt(dado[i].u)}%`), `ponto ${i}: umidade — ${t}`);
      assert.ok(t.includes(`Temperatura: ${fmt(dado[i].t)} °C`), `ponto ${i}: temperatura`);
      assert.ok(t.includes(`Irrigação: ${dado[i].lig ? 'ligada' : 'desligada'}`), `ponto ${i}: estado da irrigação`);
      const caixa = await balao.boundingBox(), area = await page.locator('#grafico .grafico-wrap').boundingBox();
      assert.ok(caixa.x >= area.x - 1 && caixa.x + caixa.width <= area.x + area.width + 1, `ponto ${i}: balão cortado`);
    }
    await page.mouse.move(5, 5); await page.waitForTimeout(50);
    // teclado: percorre os 13 pontos
    await page.focus('#grafico .grafico-wrap'); await balao.waitFor({ state: 'visible' });
    await page.keyboard.press('Home'); const vistos = [(await balao.innerText()).match(/· (\d\d:\d\d)/)[1]];
    for (let i = 1; i < 13; i++) { await page.keyboard.press('ArrowRight'); vistos.push((await balao.innerText()).match(/· (\d\d:\d\d)/)[1]); }
    assert.deepEqual(vistos, dado.map(d => d.h), 'o teclado percorre todos os pontos na ordem');
    assert.ok((await page.locator('#grafico .so-leitor').innerText()).includes('Umidade'), 'região aria-live com a leitura');
    await page.keyboard.press('Escape'); assert.equal(await balao.isHidden(), true);
    // consumo
    await irPara('consumo'); await periodo('7dias'); await page.waitForTimeout(200);
    const barra = await page.$$eval('#grafico rect.barra', rs => rs.map(r => { const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }));
    assert.ok(barra.length >= 3);
    await page.mouse.move(...barra[1]);
    const b2 = page.locator('#grafico .balao'); await b2.waitFor({ state: 'visible' });
    const tc = await b2.innerText(); assert.match(tc, /(seg|ter|qua|qui|sex|sáb|dom), \d\d\/\d\d\/\d{4}/); assert.match(tc, /[\d.,]+ L em \d irrigaç/);
    // alturas proporcionais ao volume e escala adaptada
    const geo = await page.$$eval('#grafico rect.barra', rs => rs.map(r => +r.getAttribute('height')));
    const vols = await page.evaluate(() => Analise.consumoPorDia(dados.eventos).map(d => d.litros).filter(v => v > 0));
    const razoes = geo.map((h, i) => h / vols[i]); assert.ok(Math.max(...razoes) / Math.min(...razoes) < 1.02, 'altura proporcional ao volume');
  });

  /* ---------------- 14 ---------------- */
  await teste('14 Período 01/08–19/10 sem lacunas: todos os dias com 13 leituras e irrigação; Histórico navega por todos', async () => {
    const info = await page.evaluate(() => {
      const est = Demo.estado(), todos = Tempo.listaDias('2026-08-01', '2026-10-19');
      const cont = d => Demo.leituras(est, d, d).filter(l => l.tipo === 'umidade_solo' && +l.hora_leitura.slice(11, 13) >= 6 && +l.hora_leitura.slice(11, 13) <= 18).length;
      const ev = d => Demo.eventos(est, d, d).length;
      return { n: todos.length, incompletos: todos.filter(d => cont(d) !== 13), semEvento: todos.filter(d => ev(d) < 1),
               total: Demo.leituras(est, '2026-08-01', '2026-10-19', ['umidade_solo']).filter(l => +l.hora_leitura.slice(11, 13) >= 6 && +l.hora_leitura.slice(11, 13) <= 18).length, fora: Demo.leituras(est, '2026-10-20', '2026-12-31').length };
    });
    assert.equal(info.n, 80); assert.deepEqual(info.incompletos, []); assert.deepEqual(info.semEvento, []);
    assert.equal(info.total, 1040); assert.equal(info.fora, 0, 'nada fora do período simulado');
    await irPara('historico'); await periodo('1mes'); await page.waitForTimeout(250);
    const dias = []; await percorrerDias(async () => { dias.push(await page.evaluate(() => pagDias.dia)); });
    assert.equal(dias.length, 30, 'a navegação passa pelos 30 dias do filtro, sem pular nenhum');
    assert.doesNotMatch(await textoDe('.pag-dias-info span'), /sem registros/);
    assert.equal(await page.locator('#tabela tbody tr').count(), 13);
    const horas = await page.$$eval('#tabela tbody tr td:first-child', tds => tds.map(t => t.textContent.trim()));
    assert.deepEqual(horas, ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
    // Personalizado: um intervalo qualquer no meio do período é aceito e todos os dias dele têm registros
    await page.click('.periodo-opcoes button[data-valor="personalizado"]');
    await escolherData('ini', '2026-08-03'); await escolherData('fim', '2026-08-17'); await page.click('.f-aplicar'); await page.waitForTimeout(250);
    assert.equal(await textoDe('.f-erro'), '');
    const n = []; await percorrerDias(async () => { n.push(await page.evaluate(() => pagDias.dia)); });
    assert.equal(n.length, 15, 'os 15 dias do intervalo personalizado têm registros');
  });

  /* ---------------- 15 ---------------- */
  await teste('15 Só existe paginação por dia (e por semana no Consumo); não há paginação de linhas nem inserção manual de leituras', async () => {
    for (const p of ['dashboard', 'historico', 'irrigacoes', 'consumo']) {
      await irPara(p); await periodo('7dias'); await page.waitForTimeout(150);
      assert.equal(await page.locator('.pag-dias').count(), 1, p + ': uma única paginação (diária)');
      assert.equal(await page.locator('.pag-linhas, .pag-botoes, .pag-resumo, #paginacaoLinhas').count(), 0, p + ': sem paginação de linhas');
      const txt = await page.locator('body').innerText();
      assert.doesNotMatch(txt, /leitura de teste|Registrar teste|Mostrando \d+–\d+ de/i, p + ': sem tela de leitura manual');
      assert.equal(await page.locator('#btnTeste').count(), 0);
    }
    const codigo = await page.evaluate(async () => (await Promise.all(['../shared/js/api.js', '../shared/js/componentes.js'].map(u => fetch(u).then(r => r.text())))).join('\n'));
    assert.doesNotMatch(codigo, /leituras-teste|abrirLeituraTeste|registrarLeituraTeste/);
  });

  /* ---------------- 19 ---------------- */
  await teste('19 Data de referência 19/10/2026: Hoje, 7 dias, 1 mês, 13 medições até 18h (computador em 16/10)', async () => {
    assert.equal(await page.evaluate(() => new Date(Date.now()).toISOString().slice(0, 10)), '2026-10-16', 'o relógio do computador no teste é 16/10');
    await irPara('historico');
    assert.equal(await page.evaluate(() => Tempo.hoje()), '2026-10-19');
    assert.match(await textoDe('#tituloMedicoes'), /19\/10\/2026/);
    assert.equal(await page.locator('#tabela tbody tr').count(), 13);
    const horas = await page.$$eval('#tabela tbody tr td:first-child', tds => tds.map(t => t.textContent.trim()));
    assert.deepEqual(horas, ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
    const per = async v => { await periodo(v); await page.waitForTimeout(120); return page.evaluate(() => { const p = periodoAtual; return [p.inicio, p.fim, p.dias]; }); };
    assert.deepEqual(await per('hoje'), ['2026-10-19', '2026-10-19', 1]);
    assert.deepEqual(await per('7dias'), ['2026-10-13', '2026-10-19', 7]);
    assert.deepEqual(await per('1mes'), ['2026-09-20', '2026-10-19', 30]);
    assert.equal((await pagInfo()).dataTxt, '19/10/2026', 'o dia mais recente da navegação é 19/10/2026');
    // Hoje: nenhum dado fora de 19/10 e nenhum evento aberto (tudo já terminou)
    await periodo('hoje'); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => dados.linhas.every(l => l.dia === '2026-10-19') && dados.eventos.every(e => e.dia === '2026-10-19' && !e.aberto)), true);
    // Dashboard: 13 pontos, termina às 18h, 7 rótulos
    await irPara('dashboard');
    assert.equal(await page.locator('#grafico svg circle.ponto').count(), 13);
    // cores iguais às do status da irrigação: verde (ligada) e vermelho (desligada)
    const cores = await page.$$eval('#grafico svg circle.ponto', cs => cs.map(c => [c.classList.contains('irrig-ligada'), c.getAttribute('fill')]));
    assert.ok(cores.every(([lig, f]) => f === (lig ? '#15803d' : '#e0141e')), 'pontos verdes com a bomba ligada e vermelhos desligada');
    assert.ok(cores.some(c => !c[0]) && cores.length - cores.filter(c => !c[0]).length >= 1, 'o dia tem pontos dos dois estados');
    assert.deepEqual(await page.$$eval('#grafico svg text.rotulo-hora', ts => ts.map(t => t.textContent)), ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00']);
    assert.equal(await page.evaluate(() => dadosPeriodo.grupos.filter(g => g.dia === '2026-10-19' && g.umidade != null).map(g => g.hora.slice(11, 16)).pop()), '18:00');
    // calendário: 19/10 habilitado, 22/10 (futuro de referência) desabilitado
    await page.click('.periodo-opcoes button[data-valor="personalizado"]'); await page.click('.data-btn[data-campo=ini]'); await page.waitForSelector('.calendario');
    assert.equal(await page.locator('.calendario [data-dia="2026-10-19"]').isEnabled(), true);
    assert.equal(await page.locator('.calendario [data-dia="2026-10-19"]').getAttribute('class').then(c => /hoje/.test(c)), true, '19/10 é marcado como hoje');
    assert.equal(await page.locator('.calendario [data-dia="2026-10-20"]').count() ? await page.locator('.calendario [data-dia="2026-10-20"]').isDisabled() : true, true);
    await page.keyboard.press('Escape');
  });

  /* ---------------- 20 ---------------- */
  await teste('20 Layout: filtros ao lado do título da seção principal; tags e paginação abaixo (Dashboard, Histórico, Irrigações, Consumo)', async () => {
    const caixa = async sel => page.$eval(sel, e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; });
    const ladoTitulo = async (p, tituloSel, caixaSel) => {
      const f = await caixa('#filtro .periodo-opcoes'), t = await caixa(tituloSel), c = await caixa(caixaSel);
      assert.ok(f.x > t.r && f.r <= c.r + 1 && Math.abs(f.y - t.y) < 40, p + ': filtro à direita, na linha do título');
      assert.ok(f.x > (c.x + c.r) / 2, p + ': filtro à direita');
      return f;
    };
    const centralizada = async p => {
      const g = await caixa('.pag-dias'), tela = await page.$eval('.conteudo', e => { const b = e.getBoundingClientRect(); return (b.x + b.right) / 2; });
      assert.ok(Math.abs((g.x + g.r) / 2 - tela) < 6, p + ': paginação centralizada');
      assert.match(await textoDe('.pag-dias-info strong'), p === 'consumo' ? /^Semana \d+ de \d+ — \d\d\/\d\d a \d\d\/\d\d$/ : /^Dia \d+ de \d+ — \d\d\/\d\d\/\d{4}$/);
      return g;
    };
    for (const p of ['dashboard', 'historico', 'irrigacoes', 'consumo']) {
      await irPara(p); await periodo(p === 'consumo' ? '1mes' : '7dias'); await page.waitForTimeout(200);
      assert.equal(await page.locator('#paginacaoDias').count(), 1, p + ': uma única paginação');
      assert.equal(await page.locator('#btnAtualizar, .selo-modo').count(), 0, p + ': sem Atualizar nem botão de modo');
    }
    // Dashboard: título + filtro no topo da caixa; gráfico; tags; só depois a paginação (fora da caixa)
    await irPara('dashboard'); await periodo('7dias'); await page.waitForTimeout(200);
    assert.ok(await page.$eval('#filtro', e => !!e.closest('.grafico-card')));
    await ladoTitulo('dashboard', '#tituloGrafico', '.grafico-card');
    let gr = await caixa('#grafico'), tg = await caixa('#resumoUmidade'), cx = await caixa('.grafico-card'), pg = await centralizada('dashboard');
    assert.ok(tg.y >= cx.b - 1 && tg.y >= gr.b, 'dashboard: resumo de umidade abaixo da caixa do gráfico (mesmo modelo do Consumo)');
    assert.ok(pg.y >= tg.b, 'dashboard: paginação abaixo do resumo de umidade');
    assert.equal(await page.locator('#resumoUmidade .resumo').count(), 3);
    assert.equal(await page.$eval('#resumoUmidade', e => e.closest('.card') === null), true);
    assert.equal(await page.$eval('#paginacaoDias', e => e.closest('.card') === null), true);
    // Histórico
    await irPara('historico'); await periodo('7dias'); await page.waitForTimeout(200);
    await ladoTitulo('historico', '#tituloMedicoes', '.medicoes');
    cx = await caixa('.medicoes'); pg = await centralizada('historico');
    assert.ok(pg.y >= cx.b); assert.equal(await page.locator('.medicoes .pag-dias').count(), 0);
    // Irrigações: filtro na linha do título "Eventos"; lista; tags; paginação abaixo das tags
    await irPara('irrigacoes'); await periodo('7dias'); await page.waitForTimeout(200);
    await ladoTitulo('irrigacoes', '#tituloEventos', '.eventos-topo');
    assert.equal(await textoDe('#tituloEventos'), 'Eventos');
    const k = await caixa('.grade-kpi'), tp = await caixa('.eventos-topo'), ls = await caixa('#eventos'), tags = await caixa('#tagsDia');
    pg = await centralizada('irrigacoes');
    assert.ok(k.b <= tp.y && tp.b <= ls.y + 1 && ls.b <= tags.y + 1 && tags.b <= pg.y, 'irrigações: KPIs → Eventos+filtro → lista → tags → paginação');
    assert.equal(await page.locator('.periodo').count(), 1, 'irrigações: filtro não duplicado');
    {
      const medir = () => page.$$eval('.resumo-tres > .resumo', cs => cs.map(c => { const r = c.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.left)]; }));
      const irr = await medir(); assert.equal(irr.length, 3, 'irrigações: três tags');
      assert.ok(irr.every(c => Math.abs(c[0] - irr[0][0]) <= 1), 'irrigações: mesma largura');
      const cx = await page.$eval('.resumo-tres', e => { const r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); return Math.abs((r.left - p.left) - (p.right - r.right)); });
      assert.ok(cx <= 2, 'irrigações: tags centralizadas ' + cx);
      await irPara('consumo'); await periodo('7dias'); await page.waitForTimeout(200);
      const con = await medir();
      assert.ok(Math.abs(con[0][0] - irr[0][0]) <= 2 && Math.abs(con[0][1] - irr[0][1]) <= 4, 'tags de Irrigações com o tamanho das do Consumo ' + JSON.stringify([irr[0], con[0]]));
      await irPara('irrigacoes'); await periodo('7dias'); await page.waitForTimeout(200);
    }
    // Consumo: filtro no cartão do gráfico; paginação abaixo de Maior/Menor/Média; sem resumo de irrigações
    await irPara('consumo'); await periodo('1mes'); await page.waitForTimeout(200);
    const tres = await caixa('.resumo-tres'), graf = await caixa('.grafico-consumo'); pg = await centralizada('consumo');
    assert.ok(await page.$eval('#filtro', e => !!e.closest('.grafico-consumo')));
    assert.ok(pg.y >= tres.b && tres.y >= graf.b);
    assert.equal(await page.locator('#detalheDia, #tabelaDetalhe').count(), 0, 'consumo: sem o bloco de irrigações do dia');
    assert.doesNotMatch(await page.locator('body').innerText(), /Irrigações de |Total do dia|em andamento \(não somado\)/);
    // Hoje: sem paginação em nenhuma tela
    for (const p of ['dashboard', 'historico', 'irrigacoes', 'consumo']) { await irPara(p); await periodo('hoje'); await page.waitForTimeout(120); assert.equal(await page.locator('#paginacaoDias').isVisible(), false, p + ': Hoje sem paginação'); }
    // teclado
    await irPara('dashboard'); await periodo('7dias'); await page.waitForTimeout(120);
    await page.focus('[data-a=ant]'); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
    assert.equal((await pagInfo()).pos, (await pagInfo()).total - 1);
  });

  /* ---------------- 22 ---------------- */
  await teste('22 Dashboard: tags Mínima/Média/Máxima do período inteiro; Consumo e Irrigações: subtítulos simples, tags, ordem e Antes/Depois', async () => {
    const txtTags = () => page.$$eval('#resumoUmidade .resumo', ts => ts.map(t => [t.querySelector('small').textContent.replace(/\s+/g, ' ').trim(), t.querySelector('strong').textContent, t.querySelector('span').textContent]));
    const esperado = () => page.evaluate(() => {
      const i = Analise.indicadoresLeituras(dadosPeriodo.medicoes), f = v => `${formatarNumero(v, 0, 1)}%`, q = r => `${Tempo.diaMesExtenso(r.dia)} às ${Tempo.horaDe(r.hora)}`;
      const n = dadosPeriodo.medicoes.filter(m => m.umidade != null).length;
      return [['UMIDADE MÁXIMA', q(i.umidadeMax), f(i.umidadeMax.umidade)], ['UMIDADE MÍNIMA', q(i.umidadeMin), f(i.umidadeMin.umidade)], ['UMIDADE MÉDIA (todas as leituras)', `≈ ${f(i.umidadeMedia)}`, `${n} ${n === 1 ? 'leitura' : 'leituras'} no período`]];
    });
    await irPara('dashboard');
    for (const v of ['hoje', '7dias', '1mes']) {
      await periodo(v); await page.waitForTimeout(200);
      assert.deepEqual(await txtTags(), await esperado(), v + ': resumo = leituras do período');
      assert.doesNotMatch(await textoDe('#subGrafico'), /mínima|média|máxima/i, v + ': cabeçalho sem mínima/média/máxima');
      assert.match(await textoDe('#subGrafico'), /^\d+ leituras?$/);
    }
    // período de vários dias: tags consideram TODAS as leituras, não só o dia visível
    const r = await page.evaluate(() => {
      const dia = paginacao.dia, todas = dadosPeriodo.medicoes.map(m => m.umidade), doDia = dadosPeriodo.medicoes.filter(m => m.dia === dia).map(m => m.umidade);
      return { min: Math.min(...todas), minDia: Math.min(...doDia), n: todas.length };
    });
    assert.ok(r.n > 13 * 20 && r.min <= r.minDia);
    await periodo('hoje'); await page.waitForTimeout(150); const hoje = await txtTags();
    await periodo('1mes'); await page.waitForTimeout(150); assert.notDeepEqual(await txtTags(), hoje, 'as tags mudam com o filtro');
    await periodo('personalizado'); await escolherData('ini', '2026-09-01'); await escolherData('fim', '2026-09-10'); await page.click('.f-aplicar'); await page.waitForTimeout(200);
    assert.deepEqual(await txtTags(), await esperado(), 'personalizado: tags do intervalo');
    assert.equal(await page.evaluate(() => dadosPeriodo.medicoes.every(m => m.dia >= '2026-09-01' && m.dia <= '2026-09-10')), true);

    // Consumo: subtítulos
    await irPara('consumo');
    const subs = { hoje: 'Consumo registrado hoje', '7dias': 'Consumo registrado nos últimos 7 dias', '1mes': 'Consumo registrado no último mês' };
    for (const [v, t] of Object.entries(subs)) { await periodo(v); await page.waitForTimeout(150); assert.equal(await textoDe('#subGrafico'), t); }
    assert.doesNotMatch(await page.locator('.grafico-consumo').innerText(), /total .* L em/i);
    // Irrigações: subtítulos, ordem decrescente, Antes/Depois, tags
    await irPara('irrigacoes');
    const subsI = { hoje: 'Irrigações de hoje', '7dias': 'Irrigações dos últimos 7 dias', '1mes': 'Irrigações do último mês' };
    for (const [v, t] of Object.entries(subsI)) { await periodo(v); await page.waitForTimeout(150); assert.equal(await textoDe('#subEventos'), t); }
    await periodo('personalizado'); await escolherData('ini', '2026-09-01'); await escolherData('fim', '2026-09-10'); await page.click('.f-aplicar'); await page.waitForTimeout(200);
    assert.equal(await textoDe('#subEventos'), 'Irrigações do período selecionado');
    await periodo('7dias'); await page.waitForTimeout(200);
    let verificadosDois = 0;
    await percorrerDias(async () => {
      const d = await page.evaluate(() => ({ dia: pagDias.dia, lista: eventosDoDia.map(e => e.ini), todos: dados.eventos.filter(e => e.dia === pagDias.dia).map(e => e.ini) }));
      assert.deepEqual(d.lista, [...d.todos].sort().reverse(), d.dia + ': do mais recente para o mais antigo');
      if (d.lista.length > 1) verificadosDois++;
      const horas = await page.$$eval('#eventos .evento .hora', hs => hs.map(h => h.textContent));
      assert.equal(horas.length, d.lista.length);
      // Antes / Depois: valor logo abaixo do rótulo, lado a lado
      const cards = await page.$$eval('#eventos .evento', cs => cs.map(c => { const q = s => c.querySelector(s).getBoundingClientRect(); return { a: c.querySelector('.antes-depois > div:first-child small').textContent, d: c.querySelector('.antes-depois > div:last-child small').textContent, ua: q('.ua'), la: q('.antes-depois > div:first-child small'), ud: q('.ud'), ld: q('.antes-depois > div:last-child small'), txtA: c.querySelector('.ua').textContent, txtD: c.querySelector('.ud').textContent }; }));
      const vals = await page.evaluate(() => eventosDoDia.map(e => [e.antes, e.depois].map(v => v == null ? '—' : formatarNumero(v, 0, 1) + '%')));
      cards.forEach((c, i) => {
        assert.deepEqual([c.a, c.d], ['Antes', 'Depois']);
        assert.ok(c.ua.y >= c.la.bottom - 1 && Math.abs(c.ua.x - c.la.x) < 2, 'valor Antes abaixo do rótulo ' + JSON.stringify([c.ua, c.la]));
        assert.ok(c.ud.y >= c.ld.bottom - 1 && Math.abs(c.ud.x - c.ld.x) < 2, 'valor Depois abaixo do rótulo ' + JSON.stringify([c.ud, c.ld]));
        assert.ok(c.ld.x > c.la.x + 40 && Math.abs(c.la.y - c.ld.y) < 2, 'lado a lado');
        assert.deepEqual([c.txtA, c.txtD], vals[i]);
      });
      // tags do dia
      const tags = await page.$$eval('#tagsDia .tag-resumo', ts => ts.map(t => [t.children[0].textContent, t.children[1].textContent]));
      const esp = await page.evaluate(() => { const i = Analise.indicadoresIrrigacao(eventosDoDia); return [['IRRIGAÇÕES', String(i.quantidade)], ['ÁGUA UTILIZADA', formatarLitros(i.litros)], ['TEMPO IRRIGANDO', formatarDuracao(i.minutos)]]; });
      assert.deepEqual(tags, esp);
      assert.deepEqual(await page.$$eval('#tagsDia .tag-resumo', ts => ts.map(t => [...t.classList].find(c => ['maior', 'menor', 'media'].includes(c)))), ['maior', 'menor', 'media'], 'ordem das cores: verde, azul, cinza');
      assert.doesNotMatch(await textoDe('#subEventos'), /Água utilizada|Tempo irrigando/);
    });
    assert.ok(verificadosDois >= 3, 'há dias com mais de um evento para provar a ordem: ' + verificadosDois);
  });

  /* ---------------- 26 ---------------- */
  await teste('26 Perfil do menu lateral: destaque ao passar o mouse e clique leva às Configurações', async () => {
    await irPara('dashboard');
    const fundo = () => page.$eval('#menuPerfil', e => getComputedStyle(e).backgroundColor);
    const antes = await fundo();
    await page.hover('#menuPerfil'); await page.waitForTimeout(250);
    assert.notEqual(await fundo(), antes, 'muda ao passar o mouse');
    assert.equal(await page.$eval('#menuPerfil', e => getComputedStyle(e).cursor), 'pointer');
    await page.click('#menuPerfil'); await page.waitForURL('**/configuracoes/**');
    assert.equal(await page.locator('#menuPerfil').count(), 1);
    // nome mostrado só "Usuário"; Sair com o mesmo fundo no hover; ícones alinhados com os do menu
    assert.equal(await textoDe('#menuNome'), 'Usuário');
    await page.mouse.move(0, 0); await page.hover('#menuPerfil'); await page.waitForTimeout(300);
    const bgPerfil = await page.$eval('#menuPerfil', e => getComputedStyle(e).backgroundColor);
    await page.mouse.move(0, 0); await page.hover('#btnSair'); await page.waitForTimeout(300);
    assert.equal(await page.$eval('#btnSair', e => getComputedStyle(e).backgroundColor), bgPerfil.replace(/\s/g, ' '), 'Sair com o mesmo fundo do perfil no hover');
    const cx = sel => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return r.left + r.width / 2; });
    const ref = await cx('.menu-item .icone');
    assert.ok(Math.abs(await cx('#btnSair .icone') - ref) <= 1, 'ícone do Sair alinhado com os ícones do menu');
    assert.ok(Math.abs(await cx('#menuAvatar') - ref) <= 1, 'avatar alinhado com os ícones do menu');
    const l = sel => page.$eval(sel, e => e.getBoundingClientRect().left);
    assert.ok(Math.abs(await l('#btnSair') - await l('.menu-item')) <= 1 && Math.abs(await l('#menuPerfil') - await l('.menu-item')) <= 1, 'mesma largura/posição dos botões do menu');
  });

  /* ---------------- 27 ---------------- */
  await teste('27 Consumo: paginação SEMANAL (blocos de até 7 dias), indicadores do período inteiro, cores e hierarquia das tags', async () => {
    const barras = () => page.evaluate(() => document.querySelectorAll('#grafico svg rect.barra, #grafico svg line[stroke="#c9d3de"]').length);
    const infoSem = () => textoDe('.pag-dias-info strong');
    const tags = () => page.$$eval('.resumo-consumo .resumo', ts => ts.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    await irPara('consumo');
    // 1-2) sem paginação em Hoje e em períodos de até 7 dias; com paginação acima disso
    await periodo('hoje'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#paginacaoDias').isVisible(), false, 'Hoje');
    await periodo('7dias'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#paginacaoDias').isVisible(), false, '7 dias');
    assert.equal(await barras(), 7, '7 dias: todos os dias num gráfico só');
    await periodo('1mes'); await page.waitForTimeout(200);
    assert.equal(await page.locator('#paginacaoDias').isVisible(), true, '1 mês');
    // 3) sem destaque de um dia e sem "Dia N de M"; uma única paginação
    assert.doesNotMatch(await textoDe('#paginacaoDias'), /Dia \d+ de \d+/);
    assert.equal(await page.locator('.pag-dias').count(), 1, 'sem segunda paginação');
    assert.equal(await page.locator('#grafico svg rect.barra.sel').count(), 0, 'nenhum dia destacado como seleção principal');
    // 6-7) 1 mês = blocos consecutivos de até 7 dias; a última (incompleta) é navegável
    const esperado = await page.evaluate(() => Tempo.blocosSemanais(periodoAtual.inicio, periodoAtual.fim).map(b => ({ i: b.inicio, f: b.fim, n: b.dias.length })));
    assert.deepEqual(esperado.map(b => b.n), [7, 7, 7, 7, 2], '30 dias = 7+7+7+7+2');
    const ds = d => d.slice(8) + '/' + d.slice(5, 7);
    assert.equal(await infoSem(), `Semana 5 de 5 — ${ds(esperado[4].i)} a ${ds(esperado[4].f)}`);
    assert.equal(await barras(), 2, 'última semana (incompleta) exibe os 2 dias restantes');
    const indic = await tags();
    const fixos = await page.evaluate(() => { const e = Analise.estatisticaConsumo(dados.porDia); return { maior: formatarLitros(e.maior.litros), menor: formatarLitros(e.menor.litros), media: formatarLitros(Analise.r1(e.mediaDiaria)) }; });
    assert.ok(indic[0].includes(fixos.maior) && indic[1].includes(fixos.menor) && indic[2].includes(fixos.media), 'indicadores = período inteiro: ' + JSON.stringify([indic, fixos]));
    // 4, 5, 13) navegar: cada página mostra só os dias do seu bloco; os indicadores não mudam
    for (let k = 3; k >= 0; k--) {
      await page.click('[data-a=ant]'); await page.waitForTimeout(80);
      assert.equal(await infoSem(), `Semana ${k + 1} de 5 — ${ds(esperado[k].i)} a ${ds(esperado[k].f)}`);
      assert.equal(await barras(), esperado[k].n, `semana ${k + 1}: só os dias do bloco`);
      const dentro = await page.evaluate(b => [...document.querySelectorAll('#grafico svg text')].map(t => t.textContent).filter(t => /^\d\d\/\d\d$/.test(t)).every(t => { const [d, m] = t.split('/'); const iso = [...Tempo.listaDias(b.i, b.f)].find(x => x.slice(8) === d && x.slice(5, 7) === m); return !!iso; }), esperado[k]);
      assert.ok(dentro, `semana ${k + 1}: rótulos só com datas do bloco`);
      assert.deepEqual(await tags(), indic, 'indicadores não mudam ao trocar de semana');
    }
    assert.equal(await page.locator('[data-a=ant]').isDisabled(), true, 'primeira semana: Anterior desabilitado');
    await page.click('[data-a=prox]'); await page.waitForTimeout(80);
    assert.match(await infoSem(), /^Semana 2 de 5/); assert.equal(await page.locator('[data-a=ant]').isDisabled(), false);
    // mudar de filtro recalcula as semanas e escolhe a mais recente
    await periodo('7dias'); await page.waitForTimeout(120); await periodo('1mes'); await page.waitForTimeout(150);
    assert.match(await infoSem(), /^Semana 5 de 5/);
    assert.equal(await page.locator('[data-a=prox]').isDisabled(), true);
    // 8-9) Personalizado respeita exatamente as datas escolhidas (15 dias = 7+7+1)
    await page.click('.periodo-opcoes button[data-valor="personalizado"]');
    await escolherData('ini', '2026-08-03'); await escolherData('fim', '2026-08-17'); await page.click('.f-aplicar'); await page.waitForTimeout(250);
    assert.equal(await textoDe('.f-erro'), '');
    assert.equal(await infoSem(), 'Semana 3 de 3 — 17/08 a 17/08');
    const vistos = [];
    for (let k = 3; k >= 1; k--) {
      const b = await page.evaluate(() => ({ i: pagSem.bloco.inicio, f: pagSem.bloco.fim, dias: pagSem.bloco.dias }));
      vistos.push(...b.dias); assert.equal(await barras(), b.dias.length);
      if (k > 1) { await page.click('[data-a=ant]'); await page.waitForTimeout(80); }
    }
    const todosDias = await page.evaluate(() => Tempo.listaDias('2026-08-03', '2026-08-17'));
    assert.deepEqual(vistos.sort(), todosDias, 'os blocos cobrem exatamente 03/08–17/08, sem datas extras e sem esconder a última');
    assert.equal(await page.evaluate(() => pagSem.bloco.inicio), '2026-08-03', 'começa na data inicial escolhida');
    // 10-12) tags: cores do gráfico, maior em azul-escuro (não verde), nome → valor → data, valor centralizado
    await periodo('1mes'); await page.waitForTimeout(150);
    for (let k = 0; k < 5; k++) { await page.click('[data-a=ant]').catch(() => {}); await page.waitForTimeout(40); }
    const cores = await page.evaluate(() => {
      const css = (sel, v) => getComputedStyle(document.querySelector(sel)).getPropertyValue(v).trim();
      const cor = (sel, p) => getComputedStyle(document.querySelector(sel))[p];
      const fills = [...document.querySelectorAll('#grafico rect.barra')].map(r => r.getAttribute('fill'));
      return { cssMax: css('.cons-maior', '--cor'), cssMin: css('.cons-menor', '--cor'), borda: cor('.cons-maior', 'borderTopColor'), bordaMin: cor('.cons-menor', 'borderTopColor'),
               valor: cor('.cons-maior strong', 'color'), fills, fonteMax: document.querySelector('.cons-maior strong').outerHTML.length };
    });
    assert.equal(cores.cssMax, '#1d68a3'); assert.equal(cores.cssMin, '#a9d4ef');
    assert.ok(cores.fills.includes('#1d68a3') && cores.fills.includes('#a9d4ef'), 'o gráfico usa as mesmas cores: ' + cores.fills.join(','));
    assert.equal(cores.borda, 'rgb(29, 104, 163)', 'maior consumo: azul-escuro do gráfico'); assert.equal(cores.valor, 'rgb(29, 104, 163)');
    assert.equal(cores.bordaMin, 'rgb(169, 212, 239)', 'menor consumo: cor do gráfico');
    const [r, g, b] = cores.borda.match(/\d+/g).map(Number); assert.ok(b > g && g > r && b > 120, 'não é verde');
    const geo = await page.$$eval('.resumo-consumo .resumo', ts => ts.map(t => {
      const q = x => t.querySelector(x).getBoundingClientRect(), tb = t.getBoundingClientRect();
      const fs = x => parseFloat(getComputedStyle(t.querySelector(x)).fontSize);
      return { ySmall: q('small').y, yStrong: q('strong').y, ySpan: q('span').y, centro: Math.abs((q('strong').x + q('strong').right) / 2 - (tb.x + tb.right) / 2), fStrong: fs('strong'), fSpan: fs('span'), fSmall: fs('small'), alt: tb.height, txtSpan: t.querySelector('span').textContent };
    }));
    geo.forEach((x, i) => { assert.ok(x.ySmall < x.yStrong && x.yStrong < x.ySpan, `tag ${i}: nome → valor → data`); assert.ok(x.centro < 3, `tag ${i}: valor centralizado`); assert.ok(x.fStrong >= 18 && x.fStrong > x.fSpan + 6 && x.fStrong > x.fSmall + 6, `tag ${i}: valor em destaque`); assert.ok(x.alt <= 100, `tag ${i}: compacta (${x.alt}px)`); });
    assert.match(geo[0].txtSpan, /^\d{1,2} de \w+$/); assert.match(geo[1].txtSpan, /^\d{1,2} de \w+$/); assert.match(geo[2].txtSpan, /÷/);
    assert.match((await tags())[0], /^MAIOR CONSUMO [\d.,]+ L \d/);
    await page.screenshot({ path: path.join(SAIDA, 'consumo-semanal.png'), fullPage: true });
  });

  /* ---------------- 28 ---------------- */
  await teste('28 Demonstração em 19/10/2026: >= 2 medições no dia, as mesmas em todos os filtros e telas, sem duplicar nem mudar', async () => {
    const info = () => page.evaluate(() => {
      const est = mockSerie(mockPropriedadeDoUsuario(1).id), um = Demo.leituras(est, '2026-10-19', '2026-10-19', ['umidade_solo']);
      const todas = Demo.leituras(est, '2026-08-01', '2026-10-31');
      let h = 0; todas.forEach(l => { const t = l.sensor_id + l.valor + l.hora_leitura; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; });
      return { dia: um.map(l => [l.hora_leitura, l.valor]), total: todas.length, ate: todas.reduce((a, l) => l.hora_leitura > a ? l.hora_leitura : a, ''), de: todas.reduce((a, l) => !a || l.hora_leitura < a ? l.hora_leitura : a, ''), hash: h };
    });
    const antes = await info();
    assert.ok(antes.dia.length >= 2, 'pelo menos 2 medições em 19/10/2026: ' + antes.dia.length);
    assert.equal(new Set(antes.dia.map(d => d[0])).size, antes.dia.length, 'sem duplicatas');
    assert.ok(antes.dia.every(([h, v]) => h.startsWith('2026-10-19T') && v >= 6 && v <= 98), 'horários coerentes e valores plausíveis');
    assert.deepEqual(antes.dia.slice(0, 13).map(d => d[0].slice(11, 16)), ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'].slice(0, Math.min(13, antes.dia.length)), 'padrão horário 06h–18h preservado');
    assert.ok(antes.de.startsWith('2026-08-01T06') && antes.ate.startsWith('2026-10-19'), 'histórico de 01/08 a 19/10 preservado; nada depois de 19/10');
    const contagem = async () => (await page.$$eval('#tabela tbody tr td:first-child', t => t.map(x => x.textContent.trim())));
    const esperadoHoras = antes.dia.map(d => d[0].slice(11, 16));
    // Histórico: Hoje, 7 dias, 1 mês e Personalizado mostram as MESMAS medições de 19/10 (uma vez cada)
    await irPara('historico');
    for (const f of ['hoje', '7dias', '1mes']) {
      await periodo(f); await page.waitForTimeout(150);
      assert.deepEqual(await contagem(), esperadoHoras, `Histórico ${f}: medições de 19/10`);
    }
    await page.click('.periodo-opcoes button[data-valor="personalizado"]');
    await escolherData('ini', '2026-10-17'); await escolherData('fim', '2026-10-19'); await page.click('.f-aplicar'); await page.waitForTimeout(200);
    assert.deepEqual(await contagem(), esperadoHoras, 'Histórico personalizado 17–19/10');
    for (let i = 0; i < 3; i++) { await periodo('hoje'); await periodo('1mes'); await periodo('7dias'); }
    await page.waitForTimeout(150);
    assert.deepEqual(await contagem(), esperadoHoras, 'depois de alternar filtros várias vezes: sem duplicar');
    // Dashboard e Consumo/Irrigações usam os mesmos registros (leituras e eventos de 19/10)
    await irPara('dashboard'); await periodo('hoje'); await page.waitForTimeout(200);
    assert.equal(await page.locator('#grafico circle.ponto').count(), antes.dia.length, 'Dashboard: um ponto por medição de 19/10');
    assert.equal((await textoDe('#subGrafico')).trim(), `${antes.dia.length} leituras`);
    const eventosHoje = await page.evaluate(() => Demo.eventos(mockSerie(mockPropriedadeDoUsuario(1).id), '2026-10-19', '2026-10-19').map(e => e.iniciado_em.slice(11, 16) + '-' + e.encerrado_em.slice(11, 16)));
    assert.deepEqual(eventosHoje, ['08:00-10:00', '15:00-17:00'], 'duas irrigações em 19/10/2026 (apresentação)');
    await irPara('irrigacoes'); await periodo('hoje'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#eventos .evento').count(), eventosHoje.length);
    await irPara('consumo'); await periodo('hoje'); await page.waitForTimeout(150);
    assert.equal(await page.locator('#grafico rect.barra').count(), eventosHoje.length);
    // nada mudou durante a navegação (mesmos dados, mesma impressão digital)
    assert.deepEqual(await info(), antes, 'os dados simulados não mudam ao navegar, trocar de filtro ou recarregar');
    await page.reload(); await esperaFim('#grafico');
    assert.deepEqual(await info(), antes, 'nem ao recarregar a página');
  });

  /* ---------------- 29 ---------------- */
  await teste('29 Calendário do Personalizado: qualquer dia até hoje pode ser escolhido (sem registros = aviso), futuros bloqueados', async () => {
    await irPara('historico');
    await page.click('.periodo-opcoes button[data-valor="personalizado"]');
    await page.click('.data-btn[data-campo=ini]'); await page.waitForSelector('.calendario');
    const r = await page.$$eval('.calendario .cal-dia', (bs, h) => ({ futuros: bs.filter(b => b.dataset.dia > h).every(b => b.disabled), passadoLivre: bs.filter(b => b.dataset.dia <= h).every(b => !b.disabled) }), HOJE_DEMO);
    assert.ok(r.futuros, 'dias futuros desabilitados'); assert.ok(r.passadoLivre, 'dias passados habilitados mesmo sem registros');
    await page.keyboard.press('Escape');
    await escolherData('ini', '2026-07-10'); await escolherData('fim', '2026-07-20'); await page.click('.f-aplicar'); await page.waitForTimeout(250);
    assert.equal(await textoDe('.f-erro'), '', 'intervalo antes da instalação é aceito');
    assert.match(await textoDe('#tabela'), /Nenhuma medição registrada no período selecionado/);
    assert.equal(await textoDe('#kUmidMedia'), '—', 'sem dados: indicador "—", nunca 0%');
    // intervalo que cruza o início do histórico mostra só o que existe
    await escolherData('ini', '2026-07-28'); await escolherData('fim', '2026-08-03'); await page.click('.f-aplicar'); await page.waitForTimeout(250);
    const dias = []; await percorrerDias(async () => { dias.push(await page.evaluate(() => pagDias.dia)); });
    assert.deepEqual(dias.sort(), ['2026-08-01', '2026-08-02', '2026-08-03'], 'nenhum dia anterior a 01/08 é inventado');
    assert.match(await textoDe('.pag-dias-info span'), /Medições registradas em 3 de 7 dias/);
  });

  /* ---------------- 21 ---------------- */
  await teste('21 Cenário seco e quente: temperaturas altas, irrigação frequente e coerente com a área da propriedade', async () => {
    const r = await page.evaluate(() => {
      const est = Demo.estado(null, null, { area_hectares: 2 });
      const porDia = {}; est.L.filter(l => l[0] === 2).forEach(l => { const d = l[2].slice(0, 10); porDia[d] = Math.max(porDia[d] || 0, l[1]); });
      const maxs = Object.values(porDia).sort((a, b) => a - b);
      const ev = est.E, dias = Tempo.listaDias(Demo.INICIO, Demo.FIM);
      const grande = Demo.gerar({ liga: 18, desliga: 30 }, { area_hectares: 8 });
      const litros = e => e.reduce((a, x) => a + x.agua_utilizada_litros, 0);
      const um = est.L.filter(l => l[0] === 1).map(l => l[1]);
      const volOk = ev.every(e => Math.abs(e.agua_utilizada_litros - Math.round(e.vazao_lmin * e.duracao_minutos * 10) / 10) < 0.11);
      const porDiaEv = {}; ev.forEach(e => { const d = e.iniciado_em.slice(0, 10); porDiaEv[d] = (porDiaEv[d] || 0) + 1; });
      return { medianaMax: maxs[Math.floor(maxs.length / 2)], mediaEv: ev.length / dias.length, maxEvDia: Math.max(...Object.values(porDiaEv)), um: [Math.min(...um), Math.max(...um)],
               volOk, razao: litros(grande.E) / litros(est.E), vazoes: [...new Set(est.E.map(e => e.vazao_lmin))].sort(), vazoes8: [...new Set(grande.E.map(e => e.vazao_lmin))].sort() };
    });
    assert.ok(r.medianaMax >= 33, 'máxima diária mediana alta: ' + r.medianaMax);
    assert.ok(r.mediaEv >= 1.3 && r.mediaEv <= 2.5, 'irrigação frequente mas não contínua: ' + r.mediaEv); assert.ok(r.maxEvDia <= 3);
    assert.ok(r.um[0] >= 0 && r.um[1] <= 100); assert.ok(r.volOk, 'volume = vazão × duração');
    assert.ok(r.razao > 1.4 && r.razao < 2.6, 'área 4× maior gasta mais água, mas não 4×: ' + r.razao);
    assert.ok(Math.max(...r.vazoes) < Math.max(...r.vazoes8) && Math.max(...r.vazoes8) < 2.2 * Math.max(...r.vazoes));
  });

  /* ---------------- 17 ---------------- */
  await teste('17 Modos demo e API explícitos e separados', async () => {
    for (const p of ['dashboard', 'historico', 'irrigacoes', 'consumo', 'configuracoes']) { await irPara(p === 'configuracoes' ? 'dashboard' : p); assert.equal(await page.locator('.selo-modo').count(), 0, p + ': sem botão de modo demonstração'); }
    // ?modo=api sem servidor: erros claros, nada de dados simulados
    const estadoAntes = JSON.stringify(await page.evaluate(() => Object.keys(localStorage).filter(k => /demo/.test(k))));
    apiPermitida = true;
    await page.goto(`${base}/login/login.html?modo=api`);
    assert.equal(await page.evaluate(() => localStorage.getItem('aquasmart_modo')), 'api');
    await page.fill('#email', 'usuario@exemplo.com'); await page.fill('#senha', '123456'); await page.click('button[type=submit]');
    await page.waitForTimeout(800);
    assert.match(await page.locator('body').innerText(), /conectar ao servidor/i);
    assert.equal(JSON.stringify(await page.evaluate(() => Object.keys(localStorage).filter(k => /demo/.test(k)))), estadoAntes, 'o modo API não toca nos dados de demonstração');
    // volta ao demo
    apiPermitida = false;
    await page.goto(`${base}/login/login.html?modo=demo`); await page.fill('#email', 'usuario@exemplo.com'); await page.fill('#senha', '123456'); await page.click('button[type=submit]');
    await page.waitForURL('**/dashboard/**'); await esperaFim('#grafico');
    assert.equal(await page.evaluate(() => localStorage.getItem('aquasmart_modo')), 'demo');
    // pelo endereço, ?modo=api troca o modo e a sessão do demo não vale na API (e vice-versa)
    await page.goto(`${base}/login/login.html?modo=api`); assert.equal(await page.evaluate(() => localStorage.getItem('aquasmart_modo')), 'api');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('aquasmart_sessao')), null, 'trocar o modo encerra a sessão');
    await page.goto(`${base}/login/login.html?modo=demo`);
    await entrar();
  });

  /* ---------------- 18 ---------------- */
  await teste('18 Estados de carregamento, erro, vazio e resposta antiga (corrida)', async () => {
    // erro + tentar novamente
    await irPara('historico');
    await page.evaluate(() => { window.__orig = getHistoricoData; window.__falha = true; getHistoricoData = async (...a) => { if (window.__falha) throw new Error('Falha simulada do servidor.'); return window.__orig(...a); }; });
    await periodo('7dias'); await page.waitForSelector('#tabela .estado-erro');
    assert.match(await textoDe('#tabela .estado-erro'), /Falha simulada/);
    await page.screenshot({ path: path.join(SAIDA, 'estado-erro.png') });
    await page.evaluate(() => { window.__falha = false; });
    await page.click('#tabela .estado-erro button'); await page.waitForSelector('#tabela table');
    // carregando
    await page.evaluate(() => { window.__falha = false; getHistoricoData = (...a) => new Promise(r => setTimeout(() => r(window.__orig(...a)), 900)); });
    await periodo('1mes'); await page.waitForSelector('#tabela .spinner');
    await page.screenshot({ path: path.join(SAIDA, 'estado-carregando.png') });
    await page.waitForSelector('#tabela table');
    // corrida: pedido lento (7 dias) é ultrapassado por um rápido (1 mês); só o último vale
    await page.evaluate(() => { getHistoricoData = (ini, fim, o) => new Promise(r => setTimeout(() => r(window.__orig(ini, fim, o)), Tempo.diasEntre(ini, fim) === 6 ? 900 : 100)); });
    await periodo('7dias'); await periodo('1mes'); await page.waitForTimeout(1400);
    const res = await page.evaluate(() => ({ tipo: dados.periodo.tipo, dias: dados.periodo.dias, ativo: document.querySelector('.periodo-opcoes .ativo').dataset.valor, kpi: document.querySelector('#nUmidMedia').textContent }));
    assert.equal(res.tipo, '1mes'); assert.equal(res.ativo, '1mes'); assert.match(res.kpi, /30 dias/, 'a resposta antiga (7 dias) não pode sobrescrever a nova');
    await page.evaluate(() => { getHistoricoData = window.__orig; });
  });

  await teste('18b Estado vazio: propriedade nova sem dispositivo', async () => {
    await page.evaluate(() => {
      const u = mockCadastrarUsuario({ nome: 'Maria Teste', email: 'maria' + Date.now() + '@teste.com', telefone: '(88) 98888-7777', senha: 'abc123' });
      mockCadastrarPropriedade(u.usuario_id, { nome: 'Sítio Novo', localizacao: 'Crato - CE', area_hectares: 1, cultura: 'Milho', metodo_irrigacao: 'Gravidade' });
      salvarSessao({ usuario_id: u.usuario_id, propriedade_id: 2, nome: u.nome, email: u.email });
    });
    await irPara('dashboard');
    assert.match(await textoDe('#grafico'), /Nenhum dispositivo cadastrado/);
    assert.equal(await textoDe('#irrigStatus'), 'Sem dispositivo');
    await page.screenshot({ path: path.join(SAIDA, 'estado-vazio-dashboard.png') });
    for (const [p, sel, rx] of [['historico', '#tabela', /Nenhuma medição registrada hoje até o momento/], ['irrigacoes', '#eventos', /Nenhuma irrigação registrada hoje até o momento/], ['consumo', '#grafico', /Nenhuma irrigação registrada hoje até o momento/]]) {
      await irPara(p); assert.match(await textoDe(sel), rx, p);
      await periodo('7dias'); await page.waitForTimeout(150);
      assert.match(await textoDe(sel), p === 'historico' ? /Nenhuma medição registrada na semana/ : /Nenhuma irrigação registrada na semana/, p + ' 7 dias');
      await periodo('1mes'); await page.waitForTimeout(150);
      assert.match(await textoDe(sel), p === 'historico' ? /Nenhuma medição registrada no mês/ : /Nenhuma irrigação registrada no mês/, p + ' 1 mês');
    }
    // conta nova do demo: nenhuma medição simulada da conta de demonstração (nem as de 19/10/2026)
    assert.equal(await page.evaluate(() => Demo.leituras(Demo.estado(), '2026-10-19', '2026-10-19').length > 0 && mockLeiturasPeriodo(2, '2026-08-01', '2026-10-19').length), 0, 'conta nova não herda as medições do demo');
    assert.equal(await page.evaluate(() => mockEventosPeriodo(2, '2026-08-01', '2026-10-19').length), 0);
    await page.screenshot({ path: path.join(SAIDA, 'estado-vazio-consumo.png') });
    await page.evaluate(() => { sessionStorage.clear(); });
    await entrar();
  });

  await teste('18c Visual (desktop): sem rolagem horizontal e capturas das telas', async () => {
    for (const largura of [1440, 1280, 1100]) {
      await page.setViewportSize({ width: largura, height: 900 });
      for (const p of ['dashboard', 'historico', 'irrigacoes', 'consumo']) {
        await irPara(p); await periodo('7dias'); await page.waitForTimeout(250);
        const sobra = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(sobra <= 0, `${p} @${largura}: rolagem horizontal de ${sobra}px`);
        if (largura === 1440) await page.screenshot({ path: path.join(SAIDA, `${p}-7dias.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await irPara('consumo'); await page.click('.periodo-opcoes button[data-valor="personalizado"]'); await page.click('.data-btn[data-campo=ini]'); await page.waitForSelector('.calendario');
    await page.screenshot({ path: path.join(SAIDA, 'calendario.png') });
    await page.keyboard.press('Escape');
    await irPara('dashboard'); await periodo('7dias'); await page.waitForTimeout(200);
    const c = await page.$$eval('#grafico svg circle.ponto', cs => cs.map(x => x.getBoundingClientRect().x + 3)); const caixa = await page.locator('#grafico svg').first().boundingBox();
    await page.mouse.move(c[Math.floor(c.length / 2)], caixa.y + caixa.height / 2); await page.waitForTimeout(100);
    await page.screenshot({ path: path.join(SAIDA, 'dashboard-tooltip.png') });
  });

  await teste('16 Console do navegador sem erros em toda a execução', async () => {
    assert.deepEqual(errosConsole.filter(e => !/Falha simulada/.test(e)), []);
    assert.deepEqual(chamadasApiNoDemo, [], 'o modo demonstração não pode falar com o servidor/PostgreSQL');
  });

  await navegador.close(); servidor.close();
  const ok = resultados.filter(r => r.ok).length;
  console.log(`\n${ok}/${resultados.length} testes de navegador passaram`);
  fs.writeFileSync(path.join(SAIDA, 'resultado-e2e.json'), JSON.stringify(resultados, null, 2));
  process.exit(ok === resultados.length ? 0 : 1);
})();
