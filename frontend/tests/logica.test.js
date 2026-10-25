/* Testes da LÓGICA do front-end (datas, períodos, paginação, dados de demonstração e cálculos).
   Rodam no Node.js, sem navegador:   node --test frontend/tests/logica.test.js   */
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../shared/js/tempo.js');
const D = require('../shared/js/demo.js');
const A = require('../shared/js/analise.js');

const AGORA = '2026-10-16T17:05:00Z';           // 14:05 em Fortaleza (UTC-3)
T.definirRelogio(() => Date.parse(AGORA));
const AGORA_LOCAL = '2026-10-16T14:05:00';
const HOJE = '2026-10-16';
const relogio = local => T.definirRelogio(() => Date.parse(local + 'Z') + 3 * 3600000);   // "hora de Fortaleza" → instante real
const gerar = (ate, lim, ajustes) => { if (ate) relogio(ate); return D.estado(lim || null, ajustes || null); };
const ev = est => A.eventosOrdenados(D.eventos(est, '0000-01-01', '9999-12-31'));
const leit = (est, a = '0000-01-01', b = '9999-12-31') => D.leituras(est, a, b);

/* ============================ tempo.js ============================ */
test('hoje() usa o fuso de Fortaleza, não o do navegador', () => {
  assert.equal(T.agora(), '2026-10-16T14:05:00');
  T.definirRelogio(() => Date.parse('2026-10-17T02:30:00Z'));      // ainda é 16/10 à noite em Fortaleza
  assert.equal(T.hoje(), '2026-10-16');
  T.definirRelogio(() => Date.parse('2026-10-17T03:00:00Z'));      // meia-noite em Fortaleza
  assert.equal(T.hoje(), '2026-10-17');
  T.definirRelogio(() => Date.parse(AGORA));
});
test('períodos: Hoje, 7 dias (hoje + 6), 1 mês (30 dias incluindo hoje)', () => {
  const h = T.resolverPeriodo('hoje'), s = T.resolverPeriodo('7dias'), m = T.resolverPeriodo('1mes');
  assert.deepEqual([h.inicio, h.fim, h.dias], [HOJE, HOJE, 1]);
  assert.deepEqual([s.inicio, s.fim, s.dias], ['2026-10-10', HOJE, 7]);
  assert.deepEqual([m.inicio, m.fim, m.dias], ['2026-09-17', HOJE, 30]);
  assert.equal(T.listaDias(s.inicio, s.fim).length, 7);
  assert.equal(T.listaDias(m.inicio, m.fim).length, 30);
});
test('aritmética de datas atravessa mês/ano/bissexto', () => {
  assert.equal(T.somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(T.somarDias('2028-03-01', -1), '2028-02-29');
  assert.equal(T.somarDias('2026-12-31', 1), '2027-01-01');
  assert.equal(T.diasEntre('2026-10-10', '2026-10-16'), 6);
  assert.equal(T.dataValida('2026-02-31'), false);
  assert.equal(T.dataValida('2026-10-16'), true);
});
test('período personalizado: valida vazio, inválido, futuro, ordem, limite e dias sem dados', () => {
  const disp = new Set(['2026-10-12', '2026-10-13', '2026-10-14']);
  const v = (a, b, o) => T.validarPersonalizado(a, b, Object.assign({ hoje: HOJE }, o));
  assert.equal(v('', '2026-10-13').ok, false);
  assert.match(v('2026-02-31', '2026-10-13').erro, /inválida/);
  assert.match(v('2026-10-10', '2026-10-17').erro, /futuras/);          // fim no futuro
  assert.match(v('2026-10-20', '2026-10-19').erro, /futuras/);
  assert.match(v('2026-10-14', '2026-10-12').erro, /anterior/);
  assert.match(v('2025-01-01', '2026-10-16').erro, /366/);
  // intervalo SEM nenhum registro (ou conta sem dados) é aceito: a tela mostra "Nenhuma medição registrada no período selecionado"
  assert.equal(v('2026-10-01', '2026-10-05', { disponiveis: disp }).ok, true);
  assert.equal(v('2026-10-01', '2026-10-05', { disponiveis: new Set() }).ok, true);
  assert.equal(v('2026-10-11', '2026-10-13', { disponiveis: disp }).ok, true);   // lacunas dentro do intervalo são permitidas
  assert.equal(v('2026-10-14', '2026-10-14', { disponiveis: disp }).ok, true);   // 1 dia
});
test('paginação por dia: começa no mais recente, respeita limites e ignora dias sem dados', () => {
  const p = T.resolverPeriodo('7dias');
  const dias = T.diasComDados(p, new Set(['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-16', '2026-09-01']));
  assert.deepEqual(dias, ['2026-10-10', '2026-10-12', '2026-10-14', '2026-10-16']);     // 09/01 fora do período
  const pg = T.criarPaginaDias(dias);
  assert.equal(pg.dia, '2026-10-16'); assert.equal(pg.posicao, 4); assert.equal(pg.total, 4);
  assert.equal(pg.podeProximo, false); assert.equal(pg.proximo(), '2026-10-16');       // limite superior
  assert.equal(pg.anterior(), '2026-10-14'); assert.equal(pg.anterior(), '2026-10-12'); assert.equal(pg.anterior(), '2026-10-10');
  assert.equal(pg.podeAnterior, false); assert.equal(pg.anterior(), '2026-10-10');      // limite inferior
  assert.equal(pg.posicao, 1);
  const vazio = T.criarPaginaDias([]);
  assert.equal(vazio.dia, null); assert.equal(vazio.podeAnterior, false); assert.equal(vazio.podeProximo, false);
});

/* ============================ demo.js ============================ */
const FIM_DEMO = '2026-10-26T23:59:00';
const horaDe = ts => Number(ts.slice(11, 13));
test('demo: período de 01/08/2026 a 26/10/2026, inclusive (87 dias)', () => {
  const est = gerar(FIM_DEMO);
  const dias = [...new Set(est.L.map(l => l[2].slice(0, 10)))].sort();
  assert.equal(D.TOTAL_DIAS, 87);
  assert.equal(dias[0] >= '2026-08-01', true); assert.equal(dias[dias.length - 1] <= '2026-10-26', true);
  assert.deepEqual(dias, T.listaDias('2026-08-01', '2026-10-26'), 'todos os 87 dias têm leituras, sem lacunas');
  assert.equal(dias[0], '2026-08-01'); assert.equal(dias[dias.length - 1], '2026-10-26');
  assert.equal(T.diasEntre('2026-08-01', '2026-10-26') + 1, 87);
  assert.equal(est.L.filter(l => l[2] < '2026-08-01' || l[2] > '2026-10-26T23:59:59').length, 0);
  assert.ok(est.E.every(e => e.iniciado_em >= '2026-08-01' && e.iniciado_em <= '2026-10-26T23:59:59'));
});
test('demo: 13 medições por dia (06h–18h), até 1.131 por sensor, sem duplicatas e em ordem', () => {
  const est = gerar(FIM_DEMO);
  for (const sensor of [1, 2, 3]) {
    const ls = est.L.filter(l => l[0] === sensor);
    const naJanela = ls.filter(l => horaDe(l[2]) >= 6 && horaDe(l[2]) <= 18 && l[2].slice(0, 10) <= D.FIM);
    assert.equal(naJanela.length, 1131, `sensor ${sensor}: ${naJanela.length} medições entre 06h e 18h`);
    // fora da janela só há medição enquanto a bomba está ligada (o sensor segue medindo até ela desligar)
    ls.filter(l => !(horaDe(l[2]) >= 6 && horaDe(l[2]) <= 18)).forEach(l => assert.ok(est.E.some(e => l[2] > e.iniciado_em && l[2] <= e.encerrado_em), 'medição fora de 06–18h sem irrigação: ' + l[2]));
    assert.equal(new Set(ls.map(l => l[2])).size, ls.length, 'duplicata');
    ls.forEach((l, i) => { if (i) assert.ok(l[2] > ls[i - 1][2], 'fora de ordem'); });
    ls.forEach(l => assert.ok(l[2].slice(14) === '00:00', l[2]));
  }
  const porDia = new Map();
  est.L.filter(l => l[0] === 1 && horaDe(l[2]) >= 6 && horaDe(l[2]) <= 18).forEach(l => { const d = l[2].slice(0, 10); porDia.set(d, (porDia.get(d) || []).concat(horaDe(l[2]))); });
  const completos = [...porDia.values()].filter(h => h.length === 13);
  assert.equal(completos.length, 87, `dias completos: ${completos.length}`);
  completos.forEach(h => assert.deepEqual(h, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]));
  assert.ok([...porDia.values()].every(h => h.length <= 13));
  // as três séries andam juntas (mesmos horários)
  const horas = s => est.L.filter(l => l[0] === s).map(l => l[2]).join();
  assert.equal(horas(1), horas(2)); assert.equal(horas(1), horas(3));
});
test('demo: determinístico e sem Math.random; nada é guardado no navegador', () => {
  const orig = Math.random; Math.random = () => { throw new Error('Math.random proibido'); };
  try {
    D.reiniciar(); const a = JSON.stringify(gerar(FIM_DEMO));
    D.reiniciar(); const b = JSON.stringify(gerar(FIM_DEMO));
    assert.equal(a, b);
  } finally { Math.random = orig; }
  assert.equal(typeof localStorage, 'undefined');                      // o gerador não precisa (nem usa) armazenamento
});
test('demo: valores dentro dos limites físicos e variados', () => {
  const est = gerar(FIM_DEMO);
  const por = s => est.L.filter(l => l[0] === s).map(l => l[1]);
  por(1).forEach(v => assert.ok(v >= 0 && v <= 100)); por(2).forEach(v => assert.ok(v >= 15 && v <= 42)); por(3).forEach(v => assert.ok(v >= 0));
  assert.ok(new Set(por(1)).size > 150); assert.ok(new Set(por(2)).size > 60);
  assert.ok(por(3).some(v => v > 0) && por(3).some(v => v === 0));
});
test('demo: NENHUM dia sem registros: 13 leituras e pelo menos 1 irrigação em todos os 87 dias', () => {
  const est = gerar(FIM_DEMO);
  const cont = new Map(); est.L.filter(l => l[0] === 1 && horaDe(l[2]) >= 6 && horaDe(l[2]) <= 18).forEach(l => cont.set(l[2].slice(0, 10), (cont.get(l[2].slice(0, 10)) || 0) + 1));
  const ev = new Map(); est.E.forEach(e => ev.set(e.iniciado_em.slice(0, 10), (ev.get(e.iniciado_em.slice(0, 10)) || 0) + 1));
  T.listaDias(D.INICIO, D.FIM).forEach(d => { assert.equal(cont.get(d), 13, d + ': leituras'); assert.ok(ev.get(d) >= 1, d + ': sem irrigação'); });
});
test('demo: umidade sobe durante a irrigação e decai fora dela', () => {
  const est = gerar(FIM_DEMO), um = est.L.filter(l => l[0] === 1);
  const evs = est.E;
  const dentro = (ts, e) => ts > e.iniciado_em && ts < e.encerrado_em;
  let subiu = 0, totalDentro = 0, decaiu = 0, totalFora = 0;
  for (let i = 1; i < um.length; i++) {
    const [a, b] = [um[i - 1], um[i]];
    if (T.minutosTs(b[2]) - T.minutosTs(a[2]) !== 60) continue;
    const ev1 = evs.find(e => e.iniciado_em <= a[2] && e.encerrado_em >= b[2]);          // intervalo inteiro dentro de um evento
    const toca = evs.some(e => e.iniciado_em < b[2] && e.encerrado_em > a[2]);
    if (ev1) { totalDentro++; if (b[1] > a[1]) subiu++; }
    else if (!toca) { totalFora++; if (b[1] <= a[1] + 0.8) decaiu++; }
  }
  assert.ok(totalDentro >= 3 && subiu / totalDentro > 0.95, `subiu ${subiu}/${totalDentro}`);
  assert.ok(totalFora > 300 && decaiu / totalFora > 0.9, `decaiu ${decaiu}/${totalFora}`);
});
test('demo: eventos variam, não se sobrepõem e volume = vazão × duração', () => {
  const est = gerar(FIM_DEMO), evs = est.E;
  assert.ok(evs.length > 60);
  const porDia = new Map(); evs.forEach(e => porDia.set(e.iniciado_em.slice(0, 10), (porDia.get(e.iniciado_em.slice(0, 10)) || 0) + 1));
  assert.ok(new Set(porDia.values()).size >= 2, 'quantidade de irrigações por dia deve variar');
  assert.ok(T.listaDias(D.INICIO, D.FIM).every(d => porDia.has(d)), 'todo dia tem irrigação');
  assert.ok(new Set(evs.map(e => e.duracao_minutos)).size >= 2, 'durações variam (múltiplos de 60 min: a bomba só desliga numa medição)'); assert.ok(new Set(evs.map(e => e.agua_utilizada_litros)).size > 10, 'volumes variam');
  // a bomba só desliga NA medição em que a umidade chega a 30% ou mais
  const umd = new Map(est.L.filter(l => l[0] === 1).map(l => [l[2], l[1]]));
  evs.forEach(e => { assert.ok(umd.get(e.encerrado_em) >= 30, 'desligou sem medição >= 30%: ' + e.encerrado_em); assert.equal(e.umidade_depois, umd.get(e.encerrado_em)); assert.equal(e.duracao_minutos % 60, 0);
    // e nenhuma medição intermediária (com a bomba ligada) tinha chegado a 30%
    est.L.filter(l => l[0] === 1 && l[2] > e.iniciado_em && l[2] < e.encerrado_em).forEach(l => assert.ok(l[1] < 30, 'passou de 30% e a bomba continuou: ' + l[2])); });
  assert.ok(new Set(evs.map(e => e.iniciado_em.slice(11, 16))).size >= 5, 'horários de início variados (horas diferentes)');
  // a bomba liga NA MESMA medição que ficou abaixo do limite: cada início coincide com uma leitura de umidade < 18% e "antes" = essa leitura
  const umid = new Map(est.L.filter(l => l[0] === 1 || l[0] === D.SENSOR?.umidade_solo).map(l => [l[2], l[1]]));
  evs.forEach(e => { const v = umid.get(e.iniciado_em); assert.ok(v !== undefined && v < 18, 'início sem leitura <18% no mesmo horário: ' + e.iniciado_em); assert.equal(e.umidade_antes, v); });
  evs.forEach((e, i) => {
    assert.equal(e.duracao_minutos, T.minutosTs(e.encerrado_em) - T.minutosTs(e.iniciado_em));
    assert.equal(e.agua_utilizada_litros, Math.round(e.vazao_lmin * e.duracao_minutos * 10) / 10, 'volume = vazão × duração');
    assert.ok(e.duracao_minutos >= 1 && e.agua_utilizada_litros > 0);
    if (i) assert.ok(evs[i - 1].encerrado_em <= e.iniciado_em, 'eventos sobrepostos');
  });
  assert.ok(evs.every(e => !e.volume_estimado), 'a bomba liga junto da leitura: todo evento tem leitura de vazão (volume medido)');
});
test('demo: só aparece o que já aconteceu; irrigação em andamento fica aberta com volume 0', () => {
  const est = gerar(FIM_DEMO);
  const e = est.E.find(x => x.iniciado_em.startsWith('2026-10-16') && x.duracao_minutos > 30);
  assert.ok(e, 'precisa existir um evento em 16/10');
  const meio = T.tsDeMs(T.msTs(e.iniciado_em) + 20 * 60000).slice(0, 16);              // 20 min depois do início
  relogio(meio);
  const vis = A.eventosOrdenados(D.eventos(est, HOJE, HOJE)).find(x => x.id === e.id);
  assert.equal(vis.aberto, true); assert.equal(vis.litros, 0); assert.equal(vis.fim, null);
  assert.equal(D.situacaoAtual(est).irrigacao_ligada, true);
  assert.ok(D.leituras(est, HOJE, HOJE).every(l => l.hora_leitura <= meio + ':59'));
  relogio('2026-10-16T23:00:00');
  const fim = A.eventosOrdenados(D.eventos(est, HOJE, HOJE)).find(x => x.id === e.id);
  assert.equal(fim.aberto, false); assert.equal(fim.litros, e.agua_utilizada_litros);
  assert.equal(D.situacaoAtual(est).irrigacao_ligada, false);
  relogio('2026-10-14T05:00:00');                                                      // antes de 01/08 não há nada; antes das 06h só o dia anterior
  assert.equal(D.leituras(est, '2026-10-14', '2026-10-14').length, 0);
  relogio(AGORA_LOCAL);
});
test('demo: ajustes manuais em MOCK_AJUSTES alteram os registros (e só eles)', () => {
  const base = gerar(FIM_DEMO, null, null);
  const umBase = base.L.find(l => l[0] === 1 && l[2] === '2026-10-13T10:00:00');
  const est = D.aplicarAjustes(base, { leituras: [{ hora: '2026-10-13T10:00', umidade: 55.5, temperatura: 33.3 }, { hora: '2026-10-13T12:00', vazao: 7 }],
    eventos: [{ inicio: '2026-10-13T14:00', fim: '2026-10-13T14:40', vazao_lmin: 3.5 }], remover_eventos: [base.E[0].iniciado_em] });
  assert.ok(umBase); assert.equal(est.L.find(l => l[0] === 1 && l[2] === '2026-10-13T10:00:00')[1], 55.5);
  assert.equal(est.L.find(l => l[0] === 2 && l[2] === '2026-10-13T10:00:00')[1], 33.3);
  assert.equal(est.L.find(l => l[0] === 3 && l[2] === '2026-10-13T12:00:00')[1], 7);
  assert.equal(est.L.filter(l => l[0] === 1 && l[2] === '2026-10-13T10:00:00').length, 1);   // trocou, não duplicou
  const novo = est.E.find(e => e.iniciado_em === '2026-10-13T14:00:00');
  assert.equal(novo.agua_utilizada_litros, 140); assert.equal(novo.duracao_minutos, 40);
  assert.ok(!est.E.some(e => e.iniciado_em === base.E[0].iniciado_em));
  est.E.forEach((e, i) => assert.equal(e.id, i + 1));
  assert.throws(() => D.aplicarAjustes(base, { leituras: [{ hora: '2026-10-13T10:00', umidade: 140 }] }), /entre 0 e 100/);
  assert.throws(() => D.aplicarAjustes(base, { leituras: [{ hora: 'ontem', umidade: 20 }] }), /inválido/);
  assert.throws(() => D.aplicarAjustes(base, { eventos: [{ inicio: '2026-10-13T14:40', fim: '2026-10-13T14:00', vazao_lmin: 3 }] }), /antes de começar/);
  // o ajuste chega às consultas das páginas (Demo.estado com ajustes)
  D.reiniciar();
  const viaEstado = D.estado(null, { leituras: [{ hora: '2026-10-13T10:00', umidade: 41.1 }] });
  assert.equal(D.leituras(viaEstado, '2026-10-13', '2026-10-13', ['umidade_solo']).find(l => l.hora_leitura === '2026-10-13T10:00:00').valor, 41.1);
  D.reiniciar();
});
test('demo: dias disponíveis por fonte (todos os dias até hoje, sem lacunas)', () => {
  const est = gerar(AGORA_LOCAL);
  const leit = D.diasDisponiveis(est, 'leituras'), evd = D.diasDisponiveis(est, 'eventos'), con = D.diasDisponiveis(est, 'consumo');
  assert.deepEqual(evd, con);
  assert.deepEqual(leit, T.listaDias(D.INICIO, HOJE), 'todos os dias de 01/08 até hoje têm leitura');
  assert.deepEqual(evd, leit, 'e todos têm irrigação/consumo');
  assert.ok(evd.every(d => d <= HOJE) && leit.every(d => d <= HOJE));   // nada do futuro
});

test('consumo diário = soma dos eventos; 7/30 dias e total fecham exatamente', () => {
  const est = gerar(AGORA_LOCAL), eventos = ev(est);
  const porDia = A.consumoPorDia(eventos);
  porDia.forEach(d => assert.equal(d.litros, A.soma(eventos.filter(e => e.dia === d.dia).map(e => e.litros))));
  const fixos = A.totaisFixos(eventos, HOJE);
  const somaDias = (n) => A.soma(porDia.filter(d => d.dia >= T.somarDias(HOJE, -n) && d.dia <= HOJE).map(d => d.litros));
  assert.equal(fixos.hoje, somaDias(0)); assert.equal(fixos.ultimos_7_dias, somaDias(6)); assert.equal(fixos.ultimos_30_dias, somaDias(29));
  assert.equal(fixos.total, A.soma(eventos.map(e => e.litros)));
  assert.ok(fixos.ultimos_7_dias >= fixos.hoje && fixos.ultimos_30_dias >= fixos.ultimos_7_dias && fixos.total >= fixos.ultimos_30_dias);
  // o mesmo período, consultado como "7 dias", dá o mesmo total do cartão fixo
  const p = T.resolverPeriodo('7dias');
  const dopPeriodo = A.eventosOrdenados(D.eventos(est, p.inicio, p.fim));
  assert.equal(A.estatisticaConsumo(A.consumoPorDia(dopPeriodo)).total, fixos.ultimos_7_dias);
});
test('média diária considera só dias COM consumo; maior/menor do período', () => {
  const porDia = [{ dia: '2026-10-10', litros: 100 }, { dia: '2026-10-11', litros: 0 }, { dia: '2026-10-12', litros: 200 }, { dia: '2026-10-13', litros: 60 }];
  const e = A.estatisticaConsumo(porDia);
  assert.equal(e.total, 360); assert.equal(e.diasComConsumo, 3); assert.equal(e.mediaDiaria, 120);
  assert.equal(e.maior.dia, '2026-10-12'); assert.equal(e.menor.dia, '2026-10-13');
  assert.deepEqual(A.estatisticaConsumo([]), { total: 0, diasComConsumo: 0, maior: null, menor: null, mediaDiaria: null });
});
test('histórico: estado da irrigação bate com os eventos e o acumulado fecha com o consumo do dia', () => {
  const est = gerar(AGORA_LOCAL), eventos = ev(est);
  const p = T.resolverPeriodo('1mes');
  const evP = A.eventosOrdenados(D.eventos(est, p.inicio, p.fim));
  const linhas = A.linhasHistorico(D.leituras(est, p.inicio, p.fim), evP);
  assert.ok(linhas.length > 300);
  for (const l of linhas) {
    const esperado = eventos.some(e => e.ini <= l.hora && (!e.fim || l.hora < e.fim));
    assert.equal(l.ligada, esperado, `${l.hora} ligada=${l.ligada}`);
    assert.ok(l.acumulado >= 0);
  }
  const porDia = new Map(); linhas.forEach(l => (porDia.get(l.dia) || porDia.set(l.dia, []).get(l.dia)).push(l));
  for (const [dia, ls] of porDia) {
    for (let i = 1; i < ls.length; i++) assert.ok(ls[i].acumulado + 1e-9 >= ls[i - 1].acumulado, `acumulado diminuiu em ${ls[i].hora}`);
    const total = A.soma(evP.filter(e => e.dia === dia).map(e => e.litros));
    const fim = ls[ls.length - 1];
    if (!evP.some(e => e.dia === dia && (e.aberto || e.fim.slice(0, 10) !== dia))) {
      const ultEv = evP.filter(e => e.dia === dia && e.fim).pop();
      if (ultEv && fim.hora >= ultEv.fim) assert.equal(fim.acumulado, total, `${dia}: acumulado final ${fim.acumulado} != consumo ${total}`);
    }
  }
  // sem leituras de vazão o acumulado é estimado e sinalizado
  const semVazao = A.linhasHistorico(D.leituras(est, p.inicio, p.fim).filter(l => l.tipo !== 'vazao_agua'), evP);
  assert.ok(semVazao.some(l => l.ligada && l.acumuladoEstimado));
});
test('dashboard e histórico usam a mesma leitura atual', () => {
  const est = gerar(AGORA_LOCAL);
  const sit = D.situacaoAtual(est);
  const linhas = A.linhasHistorico(D.leituras(est, HOJE, HOJE), A.eventosOrdenados(D.eventos(est, HOJE, HOJE)));
  const ultima = linhas[linhas.length - 1];
  assert.equal(ultima.hora, '2026-10-16T14:00:00');                                    // 14:05 → última medição foi às 14h
  assert.equal(sit.umidade_atual, ultima.umidade); assert.equal(sit.temperatura_atual, ultima.temperatura); assert.equal(sit.ultimo_sinal, ultima.hora);
  assert.equal(sit.online, true);
  relogio('2026-10-16T20:51:00');                                                      // depois das 18h o ESP32 não mede: continua online
  assert.equal(D.situacaoAtual(est).online, true); assert.equal(D.situacaoAtual(est).ultimo_sinal, '2026-10-16T18:00:00');
  relogio('2026-10-16T09:00:00'); assert.equal(D.situacaoAtual(est).ultimo_sinal, '2026-10-16T09:00:00');
  relogio(AGORA_LOCAL);
});
test('eixos e rótulos dos gráficos', () => {
  assert.deepEqual(A.escalaEixo(99.1), { topo: 100, passo: 20 });
  assert.deepEqual(A.escalaEixo(330), { topo: 400, passo: 100 });
  assert.deepEqual(A.escalaEixo(190), { topo: 200, passo: 50 });
  assert.deepEqual(A.escalaEixo(12), { topo: 12.5, passo: 2.5 });
  assert.deepEqual(A.escalaEixo(0), { topo: 10, passo: 5 });
  const idx = A.indicesRotulos(30, 10); assert.ok(idx.length <= 10 && idx[0] === 0);
  assert.deepEqual(A.indicesRotulos(5, 10), [0, 1, 2, 3, 4]); assert.deepEqual(A.indicesRotulos(0, 10), []);
});
test('evento: marcações medido / estimado / aberto / sem medição', () => {
  const base = { id: 1, iniciado_em: '2026-10-16T10:00:00', umidade_antes: 17, umidade_depois: 30 };
  assert.equal(A.normalizarEvento({ ...base, encerrado_em: null, agua_utilizada_litros: 0 }).aberto, true);
  const sm = A.normalizarEvento({ ...base, encerrado_em: '2026-10-16T10:30:00', duracao_minutos: 30, agua_utilizada_litros: 0 });
  assert.equal(sm.semMedicao, true); assert.equal(sm.vazaoMedia, null);
  const ok = A.normalizarEvento({ ...base, encerrado_em: '2026-10-16T10:30:00', duracao_minutos: 30, agua_utilizada_litros: 90 });
  assert.equal(ok.vazaoMedia, 3); assert.equal(ok.estimado, false);
  assert.equal(A.normalizarEvento({ ...base, encerrado_em: '2026-10-16T10:30:00', duracao_minutos: 30, agua_utilizada_litros: 90, volume_estimado: true }).estimado, true);
});

/* ============ data de referência da apresentação (19/10/2026) ============ */
test('referência: "hoje" vira 19/10/2026 sem mexer no relógio; períodos Hoje / 7 dias / 1 mês', () => {
  relogio('2026-10-16T14:05:00');
  T.definirReferencia('2026-10-19');
  try {
    assert.equal(T.hoje(), '2026-10-19');
    assert.equal(T.agora().slice(11), '14:05:00', 'mantém a hora do dia real');
    const h = T.resolverPeriodo('hoje'), s = T.resolverPeriodo('7dias'), m = T.resolverPeriodo('1mes');
    assert.deepEqual([h.inicio, h.fim], ['2026-10-19', '2026-10-19']);
    assert.deepEqual([s.inicio, s.fim, s.dias], ['2026-10-13', '2026-10-19', 7]);
    assert.deepEqual([m.inicio, m.fim, m.dias], ['2026-09-20', '2026-10-19', 30]);
  } finally { T.definirReferencia(null); relogio(AGORA_LOCAL); }
  assert.equal(T.hoje(), HOJE, 'sem referência volta à data real');
});
test('referência: 19/10 tem 13 leituras (06h–18h) e nenhum evento aberto, mesmo de madrugada no computador', () => {
  relogio('2026-10-16T03:00:00');
  T.definirReferencia('2026-10-19'); D.reiniciar();
  try {
    const est = D.estado(null, null, { area_hectares: 2 });
    const um = D.leituras(est, '2026-10-19', '2026-10-19', ['umidade_solo']);
    assert.deepEqual(um.map(l => l.hora_leitura.slice(11, 16)), ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
    const evs = D.eventos(est, '2026-10-19', '2026-10-19');
    assert.ok(evs.length >= 1 && evs.every(e => e.encerrado_em), 'eventos do dia já terminados');
    assert.equal(D.diasDisponiveis(est, 'leituras').pop(), '2026-10-19');
    assert.equal(D.situacaoAtual(est).online, true);
    assert.equal(D.situacaoAtual(est).ultimo_sinal.slice(0, 16), '2026-10-19T18:00');
  } finally { T.definirReferencia(null); relogio(AGORA_LOCAL); D.reiniciar(); }
});
test('cenário seco e quente: irrigação frequente e volume cresce com a raiz da área (não linear)', () => {
  const g2 = D.gerar({ liga: 18, desliga: 30 }, { area_hectares: 2 }), g8 = D.gerar({ liga: 18, desliga: 30 }, { area_hectares: 8 });
  assert.ok(g2.E.length / D.TOTAL_DIAS >= 1.3 && g2.E.length / D.TOTAL_DIAS <= 2.5);
  const maxPorDia = {}; g2.E.forEach(e => { const d = e.iniciado_em.slice(0, 10); maxPorDia[d] = (maxPorDia[d] || 0) + 1; });
  assert.ok(Math.max(...Object.values(maxPorDia)) <= 3, 'nunca irrigação contínua');
  g2.E.forEach(e => assert.ok(Math.abs(e.agua_utilizada_litros - Math.round(e.vazao_lmin * e.duracao_minutos * 10) / 10) < 0.11));
  const tot = g => g.E.reduce((a, e) => a + e.agua_utilizada_litros, 0);
  assert.ok(tot(g8) / tot(g2) > 1.4 && tot(g8) / tot(g2) < 2.6);
  const t = g2.L.filter(l => l[0] === 2).map(l => l[1]);
  assert.ok(Math.max(...t) >= 36 && Math.min(...t) > 15);
  assert.ok(g2.L.filter(l => l[0] === 1).every(l => l[1] >= 0 && l[1] <= 100));
});

test('subtítulos simples por filtro (Consumo e Irrigações)', () => {
  const p = t => T.resolverPeriodo(t, '2026-10-01', '2026-10-05', '2026-10-19');
  assert.deepEqual(['hoje', '7dias', '1mes', 'personalizado'].map(t => T.subtituloPeriodo(p(t), 'consumo')),
    ['Consumo registrado hoje', 'Consumo registrado nos últimos 7 dias', 'Consumo registrado no último mês', 'Consumo registrado no período selecionado']);
  assert.deepEqual(['hoje', '7dias', '1mes', 'personalizado'].map(t => T.subtituloPeriodo(p(t), 'irrigacoes')),
    ['Irrigações de hoje', 'Irrigações dos últimos 7 dias', 'Irrigações do último mês', 'Irrigações do período selecionado']);
});
test('referência 26/10: tudo disponível, sem eventos abertos e nada depois de 26/10', () => {
  relogio('2026-10-16T03:00:00'); T.definirReferencia('2026-10-26'); D.reiniciar();
  try {
    const est = D.estado(null, null, { area_hectares: 2 });
    const evs = D.eventos(est, '2026-08-01', '2026-12-31');
    assert.ok(evs.every(e => e.encerrado_em), 'nenhum evento aberto');
    assert.equal(evs.length, est.E.length, 'todos os eventos visíveis');
    assert.equal(D.diasDisponiveis(est, 'consumo').length, 87);
    assert.equal(D.leituras(est, '2026-10-27', '2026-12-31').length, 0);
    assert.equal(D.diasDisponiveis(est, 'leituras').pop(), '2026-10-26');
  } finally { T.definirReferencia(null); relogio(AGORA_LOCAL); D.reiniciar(); }
});

test('blocosSemanais: blocos consecutivos de até 7 dias, sem dias fora do intervalo', () => {
  const b30 = T.blocosSemanais('2026-09-20', '2026-10-19');
  assert.deepEqual(b30.map(b => b.dias.length), [7, 7, 7, 7, 2]);
  assert.equal(b30[0].inicio, '2026-09-20'); assert.equal(b30[4].inicio, '2026-10-18'); assert.equal(b30[4].fim, '2026-10-19');
  assert.deepEqual(b30.flatMap(b => b.dias), T.listaDias('2026-09-20', '2026-10-19'));
  b30.forEach((b, i) => { if (i) assert.equal(T.somarDias(b30[i - 1].fim, 1), b.inicio, 'consecutivos, em ordem crescente'); });
  const pers = T.blocosSemanais('2026-08-03', '2026-08-17');
  assert.deepEqual(pers.map(b => [b.inicio, b.fim]), [['2026-08-03', '2026-08-09'], ['2026-08-10', '2026-08-16'], ['2026-08-17', '2026-08-17']]);
  assert.deepEqual(T.blocosSemanais('2026-10-13', '2026-10-19').map(b => b.dias.length), [7]);
  assert.deepEqual(T.blocosSemanais('2026-10-19', '2026-10-19').map(b => b.dias.length), [1]);
  assert.deepEqual(T.blocosSemanais('2026-08-01', '2026-10-19').map(b => b.dias.length).slice(-2), [7, 3]);   // 80 dias = 11 × 7 + 3
});

test('mensagens de "sem registros" e cobertura de dias (iguais em todas as telas)', () => {
  const p = t => T.resolverPeriodo(t, '2026-10-01', '2026-10-05', HOJE);
  assert.deepEqual(['hoje', '7dias', '1mes', 'personalizado'].map(t => T.mensagemSemRegistros(p(t), 'medicao')),
    ['Nenhuma medição registrada hoje até o momento', 'Nenhuma medição registrada na semana', 'Nenhuma medição registrada no mês', 'Nenhuma medição registrada no período selecionado']);
  assert.equal(T.mensagemSemRegistros(p('7dias'), 'irrigacao'), 'Nenhuma irrigação registrada na semana');
  assert.equal(T.coberturaDias(p('7dias'), ['2026-10-14', '2026-10-15', '2026-10-15'], 'Medições'), 'Medições registradas em 2 de 7 dias');   // sem contar duas vezes o mesmo dia
  assert.equal(T.coberturaDias(p('7dias'), [], 'Medições'), '', 'sem nenhum registro: a mensagem de vazio já informa');
  assert.equal(T.coberturaDias(p('hoje'), ['2026-10-16']), '', 'um dia só: sem texto');
  assert.equal(T.coberturaDias(p('7dias'), T.listaDias('2026-10-10', '2026-10-16')), '', 'todos os dias com registro: sem texto');
});

/* ============================ estado do solo (só visual) ============================ */
test('estadoSolo: crítico (< 2/3 do limite de ligar), seco, adequado e úmido (>= limite de desligar)', () => {
  const e = u => A.estadoSolo(u, 18, 30).chave;
  assert.deepEqual([e(8.4), e(11.9), e(12), e(17.9), e(18), e(29.9), e(30), e(36)],
    ['critico', 'critico', 'seco', 'seco', 'adequado', 'adequado', 'umido', 'umido']);
  assert.equal(A.estadoSolo(null, 18, 30), null);
  assert.equal(A.estadoSolo(14, 18, 30).rotulo, 'Solo seco');
  assert.equal(A.estadoSolo(14, null, null).chave, 'seco');                  // sem limites informados: vale 18 e 30
  assert.equal(A.estadoSolo(20, 24, 40).chave, 'seco');                      // acompanha os limites da propriedade (crítico < 16)
  assert.equal(A.estadoSolo(15, 24, 40).chave, 'critico');
});
test('dados de teste: a semana de 13 a 19/10 mostra os quatro estados do solo (e nada disso é gravado nas leituras)', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../shared/js/mockData.js'), 'utf8');
  const MOCK_AJUSTES = vm.runInNewContext(src.slice(src.indexOf('const MOCK_AJUSTES'), src.indexOf('/* DATA DE REFERÊNCIA')) + '; MOCK_AJUSTES');
  T.definirRelogio(() => Date.parse('2026-10-19T20:00:00Z'));
  const est = D.estado({ liga: 18, desliga: 30 }, MOCK_AJUSTES, { area_hectares: 2 });
  const us = D.leituras(est, '2026-10-13', '2026-10-19', ['umidade_solo']);
  const estados = new Set(us.map(l => A.estadoSolo(l.valor, 18, 30).chave));
  assert.deepEqual([...estados].sort(), ['adequado', 'critico', 'seco', 'umido']);
  assert.ok(us.every(l => Object.keys(l).sort().join() === 'hora_leitura,sensor_id,tipo,valor'));   // formato das leituras inalterado
  T.definirRelogio(() => Date.parse(AGORA));
});
