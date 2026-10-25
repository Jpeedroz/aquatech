/* Testes de ESTRUTURA do projeto:   node --test frontend/tests/estrutura.test.js
   - existe um único README.md, na raiz;
   - o esquema do banco não ganhou colunas/migrations desnecessárias;
   - não há inserção manual de leituras nem paginação por linhas no código. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', '..');
const IGNORAR = new Set(['.git', 'node_modules', 'venv', '.venv', '__pycache__', 'capturas']);
function listar(dir, acc = []) {
  for (const nome of fs.readdirSync(dir)) {
    if (IGNORAR.has(nome)) continue;
    const p = path.join(dir, nome);
    fs.statSync(p).isDirectory() ? listar(p, acc) : acc.push(p);
  }
  return acc;
}
const arquivos = listar(RAIZ);
const ler = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('existe somente UM README.md, na raiz do projeto', () => {
  const readmes = arquivos.filter(f => /^readme(\.[a-z]+)?$/i.test(path.basename(f))).map(f => path.relative(RAIZ, f));
  assert.deepEqual(readmes, ['README.md']);
});
test('o README cobre o que a especificação pede', () => {
  const r = ler('README.md');
  for (const trecho of ['usuario@exemplo.com', '123456', 'MOCK_AJUSTES', 'criar_usuario_demo.py', '?modo=api', 'init_db.py', 'unittest', 'node --test', 'Migrations', 'persistid']) assert.ok(r.includes(trecho), 'falta no README: ' + trecho);
});
test('o esquema do banco não tem coluna "teste" nem há migrations pendentes', () => {
  assert.doesNotMatch(ler('database/aquatech_database.sql'), /\bteste\s+BOOLEAN/i);
  assert.ok(!fs.existsSync(path.join(RAIZ, 'database/migracoes')) || fs.readdirSync(path.join(RAIZ, 'database/migracoes')).length === 0);
});
test('não há inserção manual de leituras nem paginação por linhas no código', () => {
  const codigo = arquivos.filter(f => /\.(js|html|css|py)$/.test(f) && !/[\\/]tests[\\/]/.test(f)).map(f => ({ f: path.relative(RAIZ, f), t: fs.readFileSync(f, 'utf8') }));
  for (const { f, t } of codigo) {
    assert.doesNotMatch(t, /leituras-teste|abrirLeituraTeste|registrarLeituraTeste|criarPaginacaoLinhas|PERMITIR_LEITURA_TESTE/, f);
  }
});
test('o mock central tem o bloco de ajustes e o usuário de demonstração sem senha em texto', () => {
  const m = ler('frontend/shared/js/mockData.js');
  assert.match(m, /const MOCK_AJUSTES = \{/); assert.match(m, /usuario@exemplo\.com/);
  assert.doesNotMatch(m.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, ''), /['"]123456['"]/, 'a senha não pode estar em texto no código executável');
  const hashes = require('crypto').createHash('sha256').update('123456').digest('hex');
  assert.ok(m.includes(hashes), 'o SHA-256 guardado confere com a senha documentada');
});

test('a data de referência é definida num só lugar e só vale no modo demo', () => {
  const mock = ler('frontend/shared/js/mockData.js');
  assert.match(mock, /const MOCK_DATA_REFERENCIA = '2026-10-26';/);
  assert.match(mock, /if \(typeof USAR_MOCK !== 'undefined' && USAR_MOCK[^\n]*definirReferencia\(MOCK_DATA_REFERENCIA\)/);
  const usos = arquivos.filter(f => /\.(js|html)$/.test(f) && !/tests/.test(f) && /2026-10-26/.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(RAIZ, f));
  assert.deepEqual(usos.filter(f => !/mockData\.js|demo\.js/.test(f)), [], 'a data fixa não pode ser espalhada: ' + usos);
  assert.ok(!/definirReferencia/.test(ler('frontend/shared/js/api.js')), 'o modo API não usa a referência');
});
test('a paginação diária está fora das caixas principais (HTML)', () => {
  for (const [p, caixa] of [['dashboard', 'grafico-card'], ['historico', 'medicoes'], ['irrigacoes', 'linha-tempo'], ['consumo', 'grafico-consumo']]) {
    const h = ler(`frontend/${p}/${p}.html`);
    assert.equal((h.match(/id="paginacaoDias"/g) || []).length, 1, p);
    const i = h.indexOf('id="paginacaoDias"');
    assert.ok(i > h.indexOf(caixa), p + ': depois da caixa');
    const aberto = (h.slice(h.indexOf(caixa), i).match(/<(article|div)\b/g) || []).length - (h.slice(h.indexOf(caixa), i).match(/<\/(article|div)>/g) || []).length;
    assert.ok(aberto <= 0, p + ': a paginação não está aninhada na caixa principal');
  }
});

test('consumo sem o bloco de irrigações do dia; irrigações com tags e filtro junto ao título', () => {
  const c = ler('frontend/consumo/consumo.html') + ler('frontend/consumo/consumo.js');
  assert.ok(!/detalheDia|tabelaDetalhe|desenharDetalhe/.test(c));
  const i = ler('frontend/irrigacoes/irrigacoes.html');
  assert.ok(i.indexOf('id="filtro"') > i.indexOf('id="tituloEventos"') && i.indexOf('id="filtro"') < i.indexOf('id="eventos"'));
  assert.ok(i.indexOf('id="tagsDia"') > i.indexOf('id="eventos"') && i.indexOf('id="paginacaoDias"') > i.indexOf('id="tagsDia"'));
  const d = ler('frontend/dashboard/dashboard.html');
  assert.ok(d.indexOf('id="resumoUmidade"') > d.indexOf('</article>', d.indexOf('grafico-card')) && d.indexOf('id="paginacaoDias"') > d.indexOf('id="resumoUmidade"'));
  assert.ok(!/Atualizar/.test(d + i + ler('frontend/historico/historico.html')));
});

test('consumo: paginação semanal; cores das tags = cores do gráfico; ordem nome → valor → data', () => {
  const js = ler('frontend/consumo/consumo.js'), html = ler('frontend/consumo/consumo.html'), css = ler('frontend/consumo/consumo.css'), graf = ler('frontend/shared/js/graficos.js');
  assert.match(js, /criarPaginacaoSemanas/); assert.doesNotMatch(js, /criarPaginacaoDias|pagDias/, 'consumo não usa a paginação diária');
  const cor = nome => (css.match(new RegExp('--' + nome + ':\\s*(#[0-9a-f]{6})', 'i')) || [])[1];
  assert.ok(graf.includes(`i === maxIdx ? '${cor('cons-max')}'`) && graf.includes(`i === minIdx ? '${cor('cons-min')}'`), 'maior/menor usam no gráfico as mesmas cores das tags');
  for (const id of ['maiorLitros', 'menorLitros']) assert.ok(html.indexOf(`<strong id="${id}"`) > html.indexOf('<small>') && html.indexOf(`<span id="${id.replace('Litros', 'Dia')}"`) > html.indexOf(`<strong id="${id}"`), id + ': nome → valor → data');
  assert.doesNotMatch(css, /cons-maior[^}]*(verde|#1c6b3a|#7ed38e|#ecfbef)/);
});
