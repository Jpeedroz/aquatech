/* ============================================================
   analise.js — cálculos das telas a partir dos REGISTROS (leituras e
   eventos). Funciona igual no modo demo e no modo API, porque os dois
   entregam o mesmo formato. Nada aqui mexe na tela (roda no Node).

   Regras de coerência (valem para as 4 telas):
   - Um evento de irrigação é UM registro: Irrigações, Histórico e
     Consumo mostram o mesmo início, fim, duração e volume.
   - O consumo de um dia é a SOMA do volume dos eventos que COMEÇARAM
     naquele dia (é o que a view consumo_diario do banco faz).
   - Evento aberto (sem fim) tem volume 0 no banco: aparece como
     "em andamento" e ainda não entra nos totais.
   - Evento fechado com 0 L e duração > 0 = "volume não medido".
   - "Estimado" = volume calculado por vazão nominal × tempo, sem
     leituras de vazão.
   ============================================================ */
(function (raiz) {
  'use strict';
  const T = raiz.Tempo || (typeof require !== 'undefined' ? require('./tempo.js') : null);

  const r1 = v => Math.round(v * 10) / 10;
  const r2 = v => Math.round(v * 100) / 100;
  const soma = lista => r2(lista.reduce((t, v) => t + v, 0));
  const media = lista => lista.length ? lista.reduce((a, b) => a + b, 0) / lista.length : null;

  /* ---------- eventos ---------- */
  function normalizarEvento(e) {
    const aberto = e.encerrado_em == null;
    const litros = Number(e.agua_utilizada_litros) || 0;
    const duracao = aberto ? null : (e.duracao_minutos == null ? Math.round(T.minutosTs(e.encerrado_em) - T.minutosTs(e.iniciado_em)) : Number(e.duracao_minutos));
    return {
      id: e.id, ini: e.iniciado_em, fim: e.encerrado_em || null, dia: e.iniciado_em.slice(0, 10),
      aberto, duracao, litros: aberto ? 0 : litros,
      estimado: e.volume_estimado === true,
      semMedicao: !aberto && litros === 0 && (duracao || 0) > 0,
      vazaoMedia: !aberto && duracao > 0 && litros > 0 ? litros / duracao : null,
      antes: e.umidade_antes == null ? null : Number(e.umidade_antes),
      depois: e.umidade_depois == null ? null : Number(e.umidade_depois)
    };
  }
  const eventosOrdenados = eventos => eventos.map(normalizarEvento).sort((a, b) => a.ini < b.ini ? -1 : a.ini > b.ini ? 1 : 0);

  function indicadoresIrrigacao(eventos) {              // eventos normalizados
    const fechados = eventos.filter(e => !e.aberto);
    const medidos = fechados.filter(e => !e.semMedicao);
    const minutosTotal = fechados.reduce((t, e) => t + (e.duracao || 0), 0);
    const minutosMedidos = medidos.reduce((t, e) => t + (e.duracao || 0), 0);
    const litros = soma(fechados.map(e => e.litros));
    return {
      quantidade: eventos.length,
      abertos: eventos.filter(e => e.aberto).length,
      estimados: eventos.filter(e => e.estimado).length,
      semMedicao: eventos.filter(e => e.semMedicao).length,
      minutos: minutosTotal, litros,
      // vazão média ponderada = litros ÷ minutos (só eventos fechados com volume medido/estimado)
      vazaoMedia: minutosMedidos > 0 ? soma(medidos.map(e => e.litros)) / minutosMedidos : null
    };
  }

  /* ---------- consumo ---------- */
  function consumoPorDia(eventos) {                     // → [{dia, litros, eventos:[...], abertos, estimados, semMedicao}]
    const mapa = new Map();
    eventos.forEach(e => {
      if (!mapa.has(e.dia)) mapa.set(e.dia, { dia: e.dia, eventos: [] });
      mapa.get(e.dia).eventos.push(e);
    });
    return [...mapa.values()].sort((a, b) => a.dia < b.dia ? -1 : 1).map(d => ({
      dia: d.dia, eventos: d.eventos,
      litros: soma(d.eventos.map(e => e.litros)),
      abertos: d.eventos.filter(e => e.aberto).length,
      estimados: d.eventos.filter(e => e.estimado).length,
      semMedicao: d.eventos.filter(e => e.semMedicao).length
    }));
  }
  /* Só entram na estatística os dias COM consumo (litros > 0). */
  function estatisticaConsumo(porDia) {
    const com = porDia.filter(d => d.litros > 0);
    if (!com.length) return { total: 0, diasComConsumo: 0, maior: null, menor: null, mediaDiaria: null };
    const maior = com.reduce((a, b) => b.litros > a.litros ? b : a), menor = com.reduce((a, b) => b.litros < a.litros ? b : a);
    const total = soma(com.map(d => d.litros));
    return { total, diasComConsumo: com.length, maior, menor, mediaDiaria: total / com.length };
  }
  /* Totais dos cartões fixos (Hoje, 7 dias, 30 dias e total), a partir de TODOS os eventos. */
  function totaisFixos(todosEventos, hoje) {
    const porDia = consumoPorDia(todosEventos);
    const ate = n => { const ini = T.somarDias(hoje, -n); return soma(porDia.filter(d => d.dia >= ini && d.dia <= hoje).map(d => d.litros)); };
    return { hoje: ate(0), ultimos_7_dias: ate(6), ultimos_30_dias: ate(29), total: soma(porDia.map(d => d.litros)) };
  }

  /* ---------- leituras ---------- */
  function agruparLeituras(leituras) {                  // junta umidade, temperatura e vazão pelo mesmo horário
    const mapa = new Map();
    leituras.forEach(l => {
      const reg = mapa.get(l.hora_leitura) || { hora: l.hora_leitura, dia: l.hora_leitura.slice(0, 10), umidade: null, temperatura: null, vazao: null };
      const v = Number(l.valor);
      if (l.tipo === 'umidade_solo') reg.umidade = v;
      else if (l.tipo === 'temperatura') reg.temperatura = v;
      else if (l.tipo === 'vazao_agua') reg.vazao = v;
      mapa.set(l.hora_leitura, reg);
    });
    return [...mapa.values()].sort((a, b) => a.hora < b.hora ? -1 : 1);
  }
  const pontosDeMedicao = grupos => grupos.filter(g => g.umidade != null || g.temperatura != null);

  function indicadoresLeituras(grupos) {
    const um = grupos.filter(g => g.umidade != null), te = grupos.filter(g => g.temperatura != null);
    const mais = (lista, campo, cmp) => lista.length ? lista.reduce((a, b) => cmp(b[campo], a[campo]) ? b : a) : null;
    return {
      quantidade: grupos.length,
      umidadeMedia: media(um.map(g => g.umidade)), temperaturaMedia: media(te.map(g => g.temperatura)),
      umidadeMin: mais(um, 'umidade', (a, b) => a < b), umidadeMax: mais(um, 'umidade', (a, b) => a > b),
      temperaturaMax: mais(te, 'temperatura', (a, b) => a > b)
    };
  }
  function diasComLeituras(leituras) {
    const s = new Set();
    leituras.forEach(l => { if (l.tipo !== 'vazao_agua') s.add(l.hora_leitura.slice(0, 10)); });
    return s;
  }

  /* ---------- Histórico: estado da irrigação e consumo acumulado ---------- */
  /* Volume já usado por um evento até o instante t (minutos). Com leituras de
     vazão: integral até t (interpolando o último trecho). Sem elas: proporção
     linear do volume final (marcada como estimativa). A integral só vale se as
     leituras de vazão começam junto com o evento (até 10 min do início); com
     leituras espaçadas (ex.: de hora em hora) ela ignoraria o começo do evento. */
  function volumeAte(ev, pontosVazao, tMin) {
    const ini = T.minutosTs(ev.ini);
    if (tMin <= ini) return { litros: 0, estimado: false };
    if (pontosVazao.length >= 2 && pontosVazao[0][0] - ini <= 10) {
      let s = 0;
      for (let i = 1; i < pontosVazao.length; i++) {
        const [t0, v0] = pontosVazao[i - 1], [t1, v1] = pontosVazao[i];
        if (t0 >= tMin) break;
        const fimTrecho = Math.min(t1, tMin);
        const vf = t1 === t0 ? v1 : v0 + (v1 - v0) * (fimTrecho - t0) / (t1 - t0);
        s += (v0 + vf) / 2 * (fimTrecho - t0);
      }
      return { litros: s, estimado: false };
    }
    if (ev.fim) {
      const fim = T.minutosTs(ev.fim);
      return { litros: ev.litros * Math.min(1, (tMin - ini) / Math.max(1, fim - ini)), estimado: true };
    }
    return { litros: 0, estimado: true };               // aberto e sem vazão: não há como medir
  }

  /* Linhas da tabela do Histórico (uma por horário de medição).
     leituras: todas do período (inclui vazão, se houver); eventos: normalizados. */
  function linhasHistorico(leituras, eventos) {
    const grupos = agruparLeituras(leituras);
    const vazaoDe = new Map();                          // evento.id → [[min, L/min], ...]
    eventos.forEach(e => {
      const a = T.minutosTs(e.ini), b = e.fim ? T.minutosTs(e.fim) : Infinity;
      vazaoDe.set(e.id, grupos.filter(g => g.vazao != null && T.minutosTs(g.hora) >= a && T.minutosTs(g.hora) <= b)
        .map(g => [T.minutosTs(g.hora), g.vazao]));
    });
    return pontosDeMedicao(grupos).map(g => {
      const t = T.minutosTs(g.hora);
      let ligada = false, acum = 0, estimado = false, evento = null;
      eventos.forEach(e => {
        if (e.dia !== g.dia) return;                    // o consumo conta no dia em que o evento começou
        const a = T.minutosTs(e.ini);
        if (a > t) return;
        if (e.fim && T.minutosTs(e.fim) <= t) { acum += e.litros; return; }     // evento já terminado
        ligada = true; evento = e;
        const p = volumeAte(e, vazaoDe.get(e.id) || [], t);
        acum += p.litros; estimado = estimado || p.estimado || e.aberto;
      });
      // evento que começou no dia anterior e ainda roda: a linha está "ligada", sem somar ao dia
      if (!ligada) {
        const e2 = eventos.find(e => e.dia !== g.dia && T.minutosTs(e.ini) <= t && (!e.fim || T.minutosTs(e.fim) > t));
        if (e2) { ligada = true; evento = e2; }
      }
      return { hora: g.hora, dia: g.dia, umidade: g.umidade, temperatura: g.temperatura,
               ligada, acumulado: r2(acum), acumuladoEstimado: estimado, eventoId: evento ? evento.id : null };
    });
  }

  /* ---------- gráficos ---------- */
  /* Escolhe quais rótulos mostrar para não sobrepor (todos os pontos continuam desenhados). */
  function indicesRotulos(n, max) {
    if (n <= 0) return [];
    if (n <= max) return Array.from({ length: n }, (_, i) => i);
    const passo = Math.ceil(n / max), r = [];
    for (let i = 0; i < n; i += passo) r.push(i);
    return r;
  }
  /* Escala "bonita" para o eixo Y: devolve { topo, passo } com no máximo ~6 divisões. */
  function escalaEixo(maximo) {
    if (!(maximo > 0)) return { topo: 10, passo: 5 };
    const bruto = maximo / 5, exp = Math.pow(10, Math.floor(Math.log10(bruto))), f = bruto / exp;
    const passo = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    return { topo: Math.ceil(maximo / passo) * passo, passo };
  }

  /* Estado do solo (SÓ visual: calculado na hora de mostrar, nada disso é gravado).
     crítico < 2/3 do limite de ligar (12% para 18%) · seco < limite de ligar · adequado até o limite de desligar · úmido >= limite de desligar. */
  const ROTULOS_SOLO = { critico: 'Solo crítico', seco: 'Solo seco', adequado: 'Solo adequado', umido: 'Solo úmido' };
  function estadoSolo(umidade, liga, desliga) {
    if (umidade == null || !Number.isFinite(Number(umidade))) return null;
    const lg = Number.isFinite(Number(liga)) && liga != null ? Number(liga) : 18, ds = Number.isFinite(Number(desliga)) && desliga != null ? Number(desliga) : 30;
    const u = Number(umidade);
    const chave = u < lg * 2 / 3 ? 'critico' : u < lg ? 'seco' : u < ds ? 'adequado' : 'umido';
    return { chave, rotulo: ROTULOS_SOLO[chave], faixa: { critico: lg * 2 / 3, liga: lg, desliga: ds } };
  }

  const api = {
    estadoSolo, r1, r2, soma, media, normalizarEvento, eventosOrdenados, indicadoresIrrigacao, consumoPorDia, estatisticaConsumo,
    totaisFixos, agruparLeituras, pontosDeMedicao, indicadoresLeituras, diasComLeituras, volumeAte, linhasHistorico, indicesRotulos, escalaEixo
  };
  raiz.Analise = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
