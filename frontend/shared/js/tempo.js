/* ============================================================
   tempo.js — datas, períodos e paginação (lógica CENTRAL e pura).

   Regras:
   - Tudo é calculado no fuso da propriedade (America/Fortaleza, UTC-3,
     sem horário de verão), NUNCA no fuso do navegador.
   - Datas são textos "AAAA-MM-DD" e horários são textos
     "AAAA-MM-DDTHH:MM:SS" sem fuso (o mesmo formato que a API devolve).
   - Nenhuma função aqui mexe na tela. Por isso o arquivo também roda no
     Node.js (veja frontend/tests/).
   ============================================================ */
(function (raiz) {
  'use strict';

  const FUSO = 'America/Fortaleza';
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIA_MS = 86400000;

  /* ---------- relógio (pode ser trocado nos testes) ---------- */
  let relogio = () => Date.now();
  function definirRelogio(fn) { relogio = fn || (() => Date.now()); formatador = null; }

  /* Data de REFERÊNCIA (só o modo demo usa; ver MOCK_DATA_REFERENCIA em mockData.js).
     Quando definida, "hoje" passa a ser essa data, mantendo a hora do dia real.
     O relógio do computador NÃO é alterado e o modo API nunca chama isto. */
  let referencia = null;
  function definirReferencia(dataIso) { referencia = dataIso || null; }
  const temReferencia = () => referencia !== null;

  let formatador = null;
  function agoraReal() {                               // "2026-10-16T14:05:09" em Fortaleza
    if (!formatador) {
      formatador = new Intl.DateTimeFormat('en-CA', {
        timeZone: FUSO, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    const p = {};
    formatador.formatToParts(new Date(relogio())).forEach(x => { p[x.type] = x.value; });
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  }
  const agora = () => { const r = agoraReal(); return referencia ? referencia + r.slice(10) : r; };
  const hoje = () => agora().slice(0, 10);

  /* ---------- aritmética de datas (UTC puro, sem fuso do navegador) ---------- */
  const dois = n => String(n).padStart(2, '0');
  function msData(iso) { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); }
  function isoDeMs(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`; }
  function somarDias(iso, n) { return isoDeMs(msData(iso) + n * DIA_MS); }
  function diasEntre(a, b) { return Math.round((msData(b) - msData(a)) / DIA_MS); }   // b - a
  function listaDias(ini, fim) { const r = []; for (let d = ini; d <= fim; d = somarDias(d, 1)) r.push(d); return r; }
  function dataValida(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    return isoDeMs(msData(s)) === s;                    // recusa 2026-02-31
  }
  function diaDaSemana(iso) { return new Date(msData(iso)).getUTCDay(); }
  function msTs(ts) {                                   // horário "naïve" tratado como UTC (só serve para diferenças e ordem)
    const [d, h = '00:00:00'] = ts.split('T');
    const [a, m, di] = d.split('-').map(Number);
    const [hh, mm, ss = 0] = h.split(':').map(Number);
    return Date.UTC(a, m - 1, di, hh, mm, ss);
  }
  const minutosTs = ts => msTs(ts) / 60000;
  function tsDeMs(ms) {
    const d = new Date(ms);
    return `${isoDeMs(ms)}T${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())}`;
  }
  const diaDe = ts => ts.slice(0, 10);
  const horaDe = ts => ts.slice(11, 16);                // "14:05"
  const horaCurta = ts => { const h = +ts.slice(11, 13), m = ts.slice(14, 16); return m === '00' ? `${h}h` : `${h}h${m}`; };

  /* ---------- formatação ---------- */
  const dataBR = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  const dataCurta = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const nomeSemana = iso => SEMANA[diaDaSemana(iso)];
  const mesNome = m => MES[m];
  const diaMesExtenso = iso => `${+iso.slice(8, 10)} de ${MES[+iso.slice(5, 7) - 1]}`;
  const diaMesCurto = iso => { const m = MES[+iso.slice(5, 7) - 1].slice(0, 3); return `${+iso.slice(8, 10)} ${m[0].toUpperCase()}${m.slice(1)}`; };
  const rotuloDia = iso => `${nomeSemana(iso)}, ${dataBR(iso)}`;

  /* ---------- períodos ----------
     Hoje          → só o dia de hoje
     7 dias        → hoje e os 6 dias anteriores
     1 mês         → hoje e os 29 dias anteriores (últimos 30 dias)
     Personalizado → datas escolhidas (validadas)                         */
  function resolverPeriodo(tipo, ini, fim, hojeIso) {
    const h = hojeIso || hoje();
    let inicio, final;
    if (tipo === 'hoje') { inicio = h; final = h; }
    else if (tipo === '7dias') { inicio = somarDias(h, -6); final = h; }
    else if (tipo === '1mes') { inicio = somarDias(h, -29); final = h; }
    else if (tipo === 'personalizado') { inicio = ini; final = fim; }
    else throw new Error('Período desconhecido: ' + tipo);
    return { tipo, inicio, fim: final, dias: diasEntre(inicio, final) + 1 };
  }
  function descreverPeriodo(p) {
    if (p.tipo === 'hoje') return 'hoje';
    if (p.tipo === '7dias') return 'nos últimos 7 dias';
    if (p.tipo === '1mes') return 'nos últimos 30 dias';
    return p.inicio === p.fim ? `em ${dataBR(p.inicio)}` : `de ${dataBR(p.inicio)} a ${dataBR(p.fim)}`;
  }
  function rotuloCurtoPeriodo(p) {
    if (p.tipo === 'hoje') return 'hoje';
    if (p.tipo === '7dias') return '7 dias';
    if (p.tipo === '1mes') return '30 dias';
    return p.inicio === p.fim ? dataBR(p.inicio) : `${dataCurta(p.inicio)} – ${dataCurta(p.fim)}`;
  }

  /* Subtítulos simples por filtro (Consumo de água e Irrigações). */
  const SUBTITULOS = {
    consumo: ['Consumo registrado hoje', 'Consumo registrado nos últimos 7 dias', 'Consumo registrado no último mês', 'Consumo registrado no período selecionado'],
    irrigacoes: ['Irrigações de hoje', 'Irrigações dos últimos 7 dias', 'Irrigações do último mês', 'Irrigações do período selecionado']
  };
  function subtituloPeriodo(p, tela) {
    const i = { hoje: 0, '7dias': 1, '1mes': 2 }[p.tipo];
    return SUBTITULOS[tela][i === undefined ? 3 : i];
  }

  /* Valida um período personalizado.
     opcoes.disponiveis: Set de dias com dados (opcional); opcoes.minimo: primeiro dia com dados. */
  function validarPersonalizado(ini, fim, opcoes) {
    const o = opcoes || {};
    const h = o.hoje || hoje();
    if (!ini || !fim) return { ok: false, erro: 'Preencha a data inicial e a data final.' };
    if (!dataValida(ini) || !dataValida(fim)) return { ok: false, erro: 'Data inválida. Escolha as datas no calendário.' };
    if (ini > h || fim > h) return { ok: false, erro: 'Não é possível escolher datas futuras.' };
    if (ini > fim) return { ok: false, erro: 'A data inicial deve ser anterior ou igual à data final.' };
    if (diasEntre(ini, fim) + 1 > 366) return { ok: false, erro: 'O período pode ter no máximo 366 dias.' };
    // (sem dados no intervalo não é erro: a tela informa "Nenhuma medição registrada no período selecionado")
    return { ok: true, erro: '' };
  }

  /* Mensagem de "nada registrado" no período, igual em todas as telas.
     tipo: 'medicao' (leituras: Dashboard e Histórico) ou 'irrigacao' (eventos: Irrigações e Consumo). */
  function mensagemSemRegistros(p, tipo) {
    const o = tipo === 'irrigacao' ? 'Nenhuma irrigação registrada' : 'Nenhuma medição registrada';
    return o + ({ hoje: ' hoje até o momento', '7dias': ' na semana', '1mes': ' no mês' }[p.tipo] || ' no período selecionado');
  }
  /* "Medições registradas em 3 de 7 dias" — só quando o período tem mais de 1 dia e há lacunas (senão ''). */
  function coberturaDias(p, diasComRegistro, rotulo) {
    const n = new Set(diasComRegistro).size;
    return p.dias > 1 && n > 0 && n < p.dias ? `${rotulo || 'Medições'} registradas em ${n} de ${p.dias} dias` : '';
  }

  /* ---------- paginação por DIA ----------
     Só faz sentido quando o período tem mais de 1 dia. Navega apenas pelos
     dias que TÊM dados e começa no mais recente. */
  function diasComDados(periodo, disponiveis) {        // disponiveis: Set ou array de "AAAA-MM-DD"
    const s = disponiveis instanceof Set ? disponiveis : new Set(disponiveis);
    return listaDias(periodo.inicio, periodo.fim).filter(d => s.has(d));
  }
  function criarPaginaDias(dias, diaInicial) {
    const lista = [...dias].sort();
    let i = lista.length ? lista.length - 1 : -1;     // mais recente
    if (diaInicial && lista.includes(diaInicial)) i = lista.indexOf(diaInicial);
    const est = {
      get total() { return lista.length; },
      get posicao() { return i + 1; },
      get dia() { return i >= 0 ? lista[i] : null; },
      get podeAnterior() { return i > 0; },
      get podeProximo() { return i >= 0 && i < lista.length - 1; },
      anterior() { if (est.podeAnterior) i--; return est.dia; },
      proximo() { if (est.podeProximo) i++; return est.dia; },
      irPara(d) { const k = lista.indexOf(d); if (k >= 0) i = k; return est.dia; }
    };
    return est;
  }

  /* Blocos SEMANAIS consecutivos (até 7 dias) a partir do 1º dia do período; o último pode ter menos dias.
     Nunca inclui dias fora de [inicio, fim]. 30 dias → 7+7+7+7+2. */
  function blocosSemanais(inicio, fim, tamanho = 7) {
    const dias = listaDias(inicio, fim), blocos = [];
    for (let i = 0; i < dias.length; i += tamanho) {
      const d = dias.slice(i, i + tamanho);
      blocos.push({ inicio: d[0], fim: d[d.length - 1], dias: d });
    }
    return blocos;
  }

  /* ---------- paginação de LINHAS (tabelas e listas) ---------- */

  const api = {
    FUSO, definirRelogio, definirReferencia, temReferencia, agora, hoje, somarDias, diasEntre, listaDias, dataValida, diaDaSemana,
    msTs, minutosTs, tsDeMs, diaDe, horaDe, horaCurta, dataBR, dataCurta, nomeSemana, mesNome,
    diaMesExtenso, diaMesCurto, rotuloDia, resolverPeriodo, descreverPeriodo, rotuloCurtoPeriodo, subtituloPeriodo,
    validarPersonalizado, mensagemSemRegistros, coberturaDias, diasComDados, criarPaginaDias, blocosSemanais, dois, msData, isoDeMs
  };
  raiz.Tempo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
