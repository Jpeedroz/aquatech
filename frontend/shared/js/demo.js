/* ============================================================
   demo.js — GERADOR DOS DADOS DE DEMONSTRAÇÃO (só existe no modo demo).
   Nada daqui é lido no modo API.

   Uma ÚNICA série alimenta Dashboard, Histórico, Irrigações e Consumo.

   Período e frequência (fixos, ver INICIO / FIM / HORAS)
   - 01/08/2026 a 26/10/2026, inclusive (87 dias corridos).
   - UMA leitura por hora, das 06h às 18h, inclusive: 13 por dia, para
     umidade, temperatura e vazão (87 × 13 = 1.131 por sensor).
   - SEM lacunas: todos os 87 dias têm as 13 leituras e pelo menos 1 evento de
     irrigação (1 ou 2 por dia, com horários, durações e volumes variados).
     Para simular uma falha, edite MOCK_AJUSTES em mockData.js.

   Cenário (ILUSTRATIVO e FICTÍCIO: não são medições reais nem previsão do tempo)
   - Período SECO e QUENTE: máxima do dia entre ~33 e ~39 °C (manhã ~23–29,
     meio-dia ~33–39, fim da tarde ~27–33), quase sem chuva e evaporação alta;
     por isso a irrigação é frequente (em média ~1,7 por dia, de 1 a 2), nunca contínua;
     em raros dias nublados e mais frescos há menos irrigação, mas sempre alguma.
   - Propriedade usada (mockData.js): Sítio Boa Vista, 2 ha, cebola, bomba d'água,
     liga abaixo de 18% e desliga em 30% (limites da própria propriedade).
   - A vazão da bomba cresce com a RAIZ da área (3,2 L/min para 2 ha), e a umidade
     sobe na razão vazão ÷ √área: uma área maior gasta mais água no total, mas
     não de forma linear. Sem área informada, vale 2 ha.

   Como os valores nascem (sem Math.random)
   - Um sorteio determinístico (hash + mulberry32) usa só a semente e a
     posição no tempo: mesma semente = exatamente os mesmos dados, em
     qualquer página, a cada recarga. NADA é guardado no navegador.
   - A simulação anda minuto a minuto. A umidade DECAI sem irrigação
     (mais rápido de dia, conforme a evaporação do dia) e SOBE enquanto a
     irrigação está ligada. Sempre entre 6 e 98%.
   - A irrigação liga quando a leitura da hora fica abaixo do limite de
     ligar (a bomba liga NA MESMA medição, no mesmo horário) e desliga ao atingir o limite de
     desligar SÓ na medição em que a umidade chega a 30% ou mais (com a bomba ligada o sensor mede de hora em hora até ela desligar, mesmo depois das 18h). Início e fim ficam sempre em horas cheias.
   - Volume do evento = vazão (L/min) × duração (min). Se nenhuma leitura
     de vazão caiu dentro do evento, o volume é marcado como ESTIMADO.

   Quem manda no "hoje"
   - MOCK_DATA_REFERENCIA (mockData.js) = '2026-10-26': "hoje" é 26/10/2026 e todo
     esse dia (13 leituras, 06h–18h) já está disponível, qualquer que seja a data
     do computador. Com null, vale o horário real: só aparece o que já aconteceu
     e uma irrigação em andamento aparece ABERTA, com volume 0, até terminar.

   AJUSTES MANUAIS: ver MOCK_AJUSTES em mockData.js (é lá que você edita).
   Este arquivo também roda no Node.js (frontend/tests/).
   ============================================================ */
(function (raiz) {
  'use strict';
  const T = raiz.Tempo || (typeof require !== 'undefined' ? require('./tempo.js') : null);

  const INICIO = '2026-08-01';
  const FIM = '2026-10-26';
  const SEMENTE = 20260801;
  const HORA_INICIAL = 6, HORA_FINAL = 18;               // medições de hora em hora, inclusive
  const HORAS = Array.from({ length: HORA_FINAL - HORA_INICIAL + 1 }, (_, i) => HORA_INICIAL + i);
  const ID_DISPOSITIVO = 1;
  const SENSOR = { umidade_solo: 1, temperatura: 2, vazao_agua: 3 };
  const TIPO = { 1: 'umidade_solo', 2: 'temperatura', 3: 'vazao_agua' };
  const LIMITES_PADRAO = { liga: 18, desliga: 30 };
  const MAX_MINUTOS_IRRIGACAO = 480;
  const AREA_PADRAO = 2;                                 // ha (Sítio Boa Vista); usada se a propriedade não informar a área
  const VAZAO_REF = 3.2;                                 // L/min da bomba para AREA_PADRAO
  const TAXA_REF = 0.05;                               // % de umidade por minuto por (L/min ÷ √ha)
  const TOTAL_DIAS = T.diasEntre(INICIO, FIM) + 1;       // 87

  /* ---------- sorteio determinístico ---------- */
  function hash32(a, b) {
    let h = (a ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (b >>> 0), 0x85ebca6b) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  function mulberry32(semente) {
    let s = semente >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const arred = (v, c) => { const f = 10 ** c; return Math.round(v * f) / f; };
  const limitar = (v, a, b) => Math.min(b, Math.max(a, v));
  const luz = h => Math.max(0, Math.sin(Math.PI * (h - 6) / 14));      // 0 à noite, 1 por volta das 13h
  const dois = n => String(n).padStart(2, '0');

  /* ---------- características de cada dia ---------- */
  function paramsDoDia(d) {
    const r = mulberry32(hash32(SEMENTE, d * 7919 + 13));
    const ameno = r() < 0.1;                                        // raros dias nublados e mais frescos (menos irrigação, mas sempre há alguma)
    const tempBase = 29 + r() * 6 - (ameno ? 3.5 : 0);              // cenário SECO e QUENTE: máxima do dia entre ~33 e ~39 °C
    const p = {
      tempBase,
      evap: (2.4 + (tempBase - 29) / 6 * 1.4 + r() * 1.0) * (ameno ? 0.85 : 1),   // evaporação do dia: maior nos dias mais quentes (2,4 a 4,8)
      chuva: r() < 0.01,                                            // praticamente sem chuva
    };
    return p;
  }

  /* ---------- geração da série completa ---------- */
  function gerar(limites, propriedade) {
    const lim = Object.assign({}, LIMITES_PADRAO, limites || {});
    const area = propriedade && propriedade.area_hectares > 0 ? Number(propriedade.area_hectares) : AREA_PADRAO;
    const vazaoNominal = arred(VAZAO_REF * Math.sqrt(area / AREA_PADRAO), 2);   // cresce com a RAIZ da área, não linearmente
    const L = [], E = [];
    let umid = 27, ev = null, proxId = 1;
    const totalMin = TOTAL_DIAS * 1440;
    for (let m = 0; m < totalMin + MAX_MINUTOS_IRRIGACAO + 20; m++) {
      const d = Math.floor(m / 1440), minDia = m % 1440, h = minDia / 60;
      const dentro = d < TOTAL_DIAS;
      if (!dentro && !ev) break;                         // depois do último dia só termina a irrigação aberta
      const P = paramsDoDia(Math.min(d, TOTAL_DIAS - 1));
      const r = mulberry32(hash32(SEMENTE, m + 99991));
      const dia = T.somarDias(INICIO, d);
      const ts = `${dia}T${dois(Math.floor(minDia / 60))}:${dois(minDia % 60)}:00`;

      /* 1) leitura da hora cheia (estado no começo do minuto) */
      const horaCheia = minDia % 60 === 0 && ((h >= HORA_INICIAL && h <= HORA_FINAL) || !!ev);   // com a bomba ligada o sensor segue medindo de hora em hora até ela desligar
      if (horaCheia && dentro) {
        const leitura = arred(limitar(umid + (r() - 0.5) * 0.6, 0, 100), 1);
        const temp = arred(limitar(P.tempBase - 6 + 10 * luz(h) + (r() - 0.5) * 1.2, 15, 42), 1);
        /* a bomba liga NA MESMA medição que ficou abaixo do limite (mesmo horário da leitura) */
        /* ...e só desliga NA MEDIÇÃO em que a umidade chega ao limite de desligar (30%) */
        let desligouAgora = false;
        if (ev && leitura >= lim.desliga) {
          const dur = Math.max(1, m - ev.ini);
          E.push({ id: proxId++, dispositivo_id: ID_DISPOSITIVO, iniciado_em: ev.ts, encerrado_em: ts,
                   duracao_minutos: dur, agua_utilizada_litros: arred(ev.F * dur, 1), umidade_antes: ev.antes,
                   umidade_depois: leitura, volume_estimado: ev.leiturasVazao === 0, vazao_lmin: ev.F });
          ev = null; desligouAgora = true;
        }
        if (!ev && !desligouAgora && leitura < lim.liga) {
          const F = arred(vazaoNominal * (0.9 + 0.2 * r()), 1);                // vazão da bomba neste evento (L/min)
          // a umidade sobe mais devagar quanto maior a área para a mesma vazão (por isso F ÷ √área)
          ev = { ini: m, ts, F, taxa: TAXA_REF * F / Math.sqrt(area) * (0.85 + 0.3 * r()), leiturasVazao: 0, antes: leitura };
        }
        L.push([SENSOR.umidade_solo, leitura, ts], [SENSOR.temperatura, temp, ts],
               [SENSOR.vazao_agua, ev ? ev.F : 0, ts]);
        if (ev) ev.leiturasVazao++;
      }

      /* 3) física do minuto: sobe irrigando, decai sem irrigar */
      if (ev) umid += ev.taxa * (0.9 + 0.2 * r());
      else {
        umid -= 0.55 * P.evap * (0.35 + luz(h)) / 60 * (0.85 + 0.3 * r());
        if (P.chuva && h >= 13 && h < 16) umid += 0.07;
      }
      umid = limitar(umid, 6, 98);

      /* 4) desliga ao atingir o limite de desligar (ou no tempo máximo) */
      if (ev && m - ev.ini >= MAX_MINUTOS_IRRIGACAO) {                 // trava de segurança (nunca deveria ser atingida)
        const dur = Math.max(1, m + 1 - ev.ini);
        E.push({ id: proxId++, dispositivo_id: ID_DISPOSITIVO, iniciado_em: ev.ts, encerrado_em: tsDeMinuto(m + 1),
                 duracao_minutos: dur, agua_utilizada_litros: arred(ev.F * dur, 1), umidade_antes: ev.antes,
                 umidade_depois: arred(umid, 1), volume_estimado: ev.leiturasVazao === 0, vazao_lmin: ev.F });
        ev = null;
      }
    }
    return { L, E };
  }
  function tsDeMinuto(m) {                               // minuto desde 00:00 de INICIO → "AAAA-MM-DDTHH:MM:00"
    const d = Math.floor(m / 1440), x = m % 1440;
    return `${T.somarDias(INICIO, d)}T${dois(Math.floor(x / 60))}:${dois(x % 60)}:00`;
  }

  /* ---------- ajustes manuais (MOCK_AJUSTES) ---------- */
  const RE_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
  function normTs(ts, rotulo) {
    if (typeof ts !== 'string' || !RE_TS.test(ts) || !T.dataValida(ts.slice(0, 10))) throw new Error(`MOCK_AJUSTES: ${rotulo} inválido (use "AAAA-MM-DDTHH:MM" ou "AAAA-MM-DDTHH:MM:SS"): ${ts}`);
    return ts.length === 16 ? ts + ':00' : ts;
  }
  function numero(v, rotulo, a, b) {
    if (!Number.isFinite(Number(v)) || v === '' || v === null) throw new Error(`MOCK_AJUSTES: ${rotulo} precisa ser um número.`);
    const n = Number(v);
    if (n < a || n > b) throw new Error(`MOCK_AJUSTES: ${rotulo} deve estar entre ${a} e ${b} (recebido ${n}).`);
    return n;
  }
  function aplicarAjustes(base, ajustes) {
    if (!ajustes) return base;
    let { L, E } = base;
    const trocar = (sensor, ts, valor) => { L = L.filter(l => !(l[0] === sensor && l[2] === ts)); L.push([sensor, valor, ts]); };
    (ajustes.leituras || []).forEach((a, i) => {
      const ts = normTs(a.hora, `leituras[${i}].hora`);
      if (a.umidade != null) trocar(SENSOR.umidade_solo, ts, arred(numero(a.umidade, `leituras[${i}].umidade`, 0, 100), 1));
      if (a.temperatura != null) trocar(SENSOR.temperatura, ts, arred(numero(a.temperatura, `leituras[${i}].temperatura`, -40, 85), 1));
      if (a.vazao != null) trocar(SENSOR.vazao_agua, ts, arred(numero(a.vazao, `leituras[${i}].vazao`, 0, 100), 2));
    });
    const remover = new Set((ajustes.remover_eventos || []).map((x, i) => normTs(x, `remover_eventos[${i}]`)));
    E = E.filter(e => !remover.has(e.iniciado_em));
    (ajustes.eventos || []).forEach((a, i) => {
      const ini = normTs(a.inicio, `eventos[${i}].inicio`), fim = normTs(a.fim, `eventos[${i}].fim`);
      const dur = Math.round(T.minutosTs(fim) - T.minutosTs(ini));
      if (dur <= 0) throw new Error(`MOCK_AJUSTES: eventos[${i}] termina antes de começar.`);
      const F = numero(a.vazao_lmin, `eventos[${i}].vazao_lmin`, 0.1, 100);
      E.push({ id: 0, dispositivo_id: ID_DISPOSITIVO, iniciado_em: ini, encerrado_em: fim, duracao_minutos: dur,
               agua_utilizada_litros: arred(F * dur, 1),
               umidade_antes: a.umidade_antes != null ? numero(a.umidade_antes, `eventos[${i}].umidade_antes`, 0, 100) : null,
               umidade_depois: a.umidade_depois != null ? numero(a.umidade_depois, `eventos[${i}].umidade_depois`, 0, 100) : null,
               volume_estimado: a.estimado === true, vazao_lmin: F });
    });
    E.sort((a, b) => a.iniciado_em < b.iniciado_em ? -1 : 1).forEach((e, i) => { e.id = i + 1; });
    L.sort((a, b) => a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[0] - b[0]);
    return { L, E };
  }

  /* ---------- série em memória (uma por página; refeita a cada carregamento) ---------- */
  let cache = null, chaveCache = '';
  function estado(limites, ajustes, propriedade) {
    const chave = JSON.stringify([limites || null, ajustes || null, propriedade || null]);
    if (!cache || chave !== chaveCache) {
      cache = aplicarAjustes(gerar(limites, propriedade), ajustes);
      chaveCache = chave;
    }
    return cache;
  }
  function reiniciar() { cache = null; chaveCache = ''; }

  /* ---------- o que "já aconteceu" no horário atual ---------- */
  function eventoVisivel(e, agoraMin) {                 // devolve o evento como ele estaria agora (ou null se ainda não começou)
    if (T.minutosTs(e.iniciado_em) > agoraMin) return null;
    if (e.encerrado_em && T.minutosTs(e.encerrado_em) <= agoraMin) return Object.assign({}, e);
    // em andamento: sem fim, sem duração e sem volume (ainda não foi consumido)
    return Object.assign({}, e, { encerrado_em: null, duracao_minutos: null, agua_utilizada_litros: 0, umidade_depois: null, volume_estimado: false });
  }

  /* Até quando os dados "já existem". Com data de referência (apresentação), o dia de referência
     inteiro (até as 18h, última medição) já está disponível, qualquer que seja a hora do computador.
     Sem referência, vale o horário real de Fortaleza: só aparece o que já aconteceu. */
  const corte = () => T.temReferencia() ? T.hoje() + 'T23:59:59' : T.agora();

  const noPeriodo = (ts, ini, fim) => { const d = ts.slice(0, 10); return d >= ini && d <= fim; };

  function leituras(est, ini, fim, tipos) {
    const agora = T.minutosTs(corte());
    const lista = [];
    est.L.forEach(l => {
      if (noPeriodo(l[2], ini, fim) && T.minutosTs(l[2]) <= agora && (!tipos || tipos.includes(TIPO[l[0]])))
        lista.push({ sensor_id: l[0], tipo: TIPO[l[0]], valor: l[1], hora_leitura: l[2] });
    });
    return lista;
  }
  function eventos(est, ini, fim) {
    const agora = T.minutosTs(corte());
    return est.E.filter(e => noPeriodo(e.iniciado_em, ini, fim)).map(e => eventoVisivel(e, agora)).filter(Boolean);
  }
  function diasDisponiveis(est, fonte) {                // fonte: 'leituras' | 'eventos' | 'consumo'
    const s = new Set();
    const ate = corte().slice(0, 10);
    if (fonte === 'leituras') est.L.forEach(l => { if (l[0] !== SENSOR.vazao_agua && l[2].slice(0, 10) <= ate && T.minutosTs(l[2]) <= T.minutosTs(corte())) s.add(l[2].slice(0, 10)); });
    else eventos(est, '0000-01-01', '9999-12-31').forEach(e => s.add(e.iniciado_em.slice(0, 10)));   // 'eventos' e 'consumo': um dia por dia com evento (como a view consumo_diario)
    return [...s].sort();
  }

  /* Hora cheia programada mais recente (o ESP32 só mede de 06h às 18h). */
  function ultimaMedicaoProgramada() {
    const agora = corte(), dia = agora.slice(0, 10), h = Number(agora.slice(11, 13));
    if (h >= HORA_FINAL) return `${dia}T${dois(HORA_FINAL)}:00:00`;
    if (h < HORA_INICIAL) return `${T.somarDias(dia, -1)}T${dois(HORA_FINAL)}:00:00`;
    return `${dia}T${dois(h)}:00:00`;
  }

  function situacaoAtual(est) {
    const visiveis = leituras(est, '0000-01-01', '9999-12-31', ['umidade_solo', 'temperatura']);
    let um = null, te = null;
    for (let i = visiveis.length - 1; i >= 0 && (!um || !te); i--) {
      const l = visiveis[i];
      if (l.tipo === 'umidade_solo' && !um) um = l;
      if (l.tipo === 'temperatura' && !te) te = l;
    }
    const abertos = eventos(est, '0000-01-01', '9999-12-31').filter(e => e.encerrado_em == null);
    return {
      umidade_atual: um ? um.valor : null, temperatura_atual: te ? te.valor : null,
      ultimo_sinal: um ? um.hora_leitura : null,
      irrigacao_ligada: abertos.length > 0,
      // online = a última leitura é a da medição programada mais recente (o ESP32 mede de hora em hora, 06h–18h)
      online: um ? um.hora_leitura >= ultimaMedicaoProgramada() : false
    };
  }

  const api = {
    INICIO, FIM, SEMENTE, TOTAL_DIAS, HORAS, LIMITES_PADRAO, SENSOR, ID_DISPOSITIVO,
    gerar, aplicarAjustes, estado, reiniciar,
    leituras, eventos, diasDisponiveis, situacaoAtual, mulberry32, hash32
  };
  raiz.Demo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
