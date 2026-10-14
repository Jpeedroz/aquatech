/* configuracoes.js — abas "Minha conta" (usuarios) e "Minha propriedade" (propriedades).
   As duas áreas são independentes: cada uma tem seu formulário e suas chamadas à API. */
let usuarioAtual = null, propriedadeAtual = null;

document.addEventListener('DOMContentLoaded', async () => {
  if (!exigirLogin()) return;
  montarLayout('configuracoes');
  definirTopo('Configurações', 'Gerencie seus dados e as informações da propriedade');
  aplicarMascaraTelefone(document.getElementById('telefone'));
  CULTURAS.forEach(c => document.getElementById('pCultura').add(new Option(c, c)));
  montarMetodos();

  document.querySelectorAll('.aba').forEach(b => b.addEventListener('click', () => {      // troca de aba
    document.querySelectorAll('.aba').forEach(x => x.classList.toggle('ativa', x === b));
    document.getElementById('painelConta').hidden = b.dataset.aba !== 'conta';
    document.getElementById('painelPropriedade').hidden = b.dataset.aba !== 'propriedade';
  }));
  document.getElementById('painelConta').addEventListener('submit', salvarConta);
  document.getElementById('painelPropriedade').addEventListener('submit', salvarPropriedade);
  document.getElementById('cancelarConta').addEventListener('click', preencherConta);
  document.getElementById('cancelarProp').addEventListener('click', preencherPropriedade);
  document.getElementById('btnSenha').addEventListener('click', abrirTrocaSenha);
  await Promise.all([preencherConta(), preencherPropriedade()]);
});

/* ---------------- MINHA CONTA ---------------- */
async function preencherConta() {
  try {
    usuarioAtual = await getUsuario();                       // GET /api/usuario
    document.getElementById('nome').value = usuarioAtual.nome;
    document.getElementById('email').value = usuarioAtual.email;
    document.getElementById('telefone').value = usuarioAtual.telefone || '';
    document.getElementById('erroConta').textContent = '';
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
}

async function salvarConta(ev) {
  ev.preventDefault();
  const erro = document.getElementById('erroConta');
  const nome = document.getElementById('nome').value.trim();
  const email = document.getElementById('email').value.trim();
  const telefone = document.getElementById('telefone').value.trim();
  if (!nome) { erro.textContent = 'Informe o nome completo.'; return; }
  if (!validarEmail(email)) { erro.textContent = 'Informe um e-mail válido.'; return; }
  erro.textContent = '';
  try {
    const emailAntigo = usuarioAtual.email;
    const u = await atualizarUsuario({ nome, telefone });    // PUT /api/usuario (nome e telefone)
    atualizarSessao({ nome: u.nome });
    atualizarUsuarioNoMenu(u.nome);
    usuarioAtual = u;
    mostrarMensagem('Dados atualizados com sucesso.', 'sucesso');
    // E-mail NÃO é trocado direto: exige senha e confirmação pelo back-end.
    if (email.toLowerCase() !== emailAntigo.toLowerCase()) pedirTrocaEmail(email);
  } catch (e) { erro.textContent = e.message; }
}

function pedirTrocaEmail(novoEmail) {
  abrirModal({
    titulo: 'Confirmar troca de e-mail',
    texto: `Para alterar o e-mail para ${novoEmail}, informe sua senha atual. O back-end enviará uma confirmação ao novo endereço.`,
    campos: [{ id: 'senha', label: 'Senha atual', tipo: 'password' }],
    textoConfirmar: 'Solicitar troca',
    aoConfirmar: async ({ senha }) => {
      if (!senha) throw new Error('Informe sua senha atual.');
      const r = await solicitarTrocaEmail(novoEmail, senha);  // POST /api/usuario/email
      document.getElementById('email').value = usuarioAtual.email;   // e-mail só muda após confirmação
      return r.mensagem;
    }
  });
}

function abrirTrocaSenha() {
  abrirModal({
    titulo: 'Alterar senha',
    texto: 'Informe a senha atual e escolha a nova senha.',
    campos: [{ id: 'atual', label: 'Senha atual', tipo: 'password' },
             { id: 'nova', label: 'Nova senha', tipo: 'password' },
             { id: 'confirmar', label: 'Confirmar nova senha', tipo: 'password' }],
    textoConfirmar: 'Salvar senha',
    aoConfirmar: async ({ atual, nova, confirmar }) => {
      if (!atual || !nova || !confirmar) throw new Error('Preencha todos os campos.');
      if (nova.length < 6) throw new Error('A nova senha deve ter pelo menos 6 caracteres.');
      if (nova !== confirmar) throw new Error('A confirmação não confere com a nova senha.');
      if (nova === atual) throw new Error('A nova senha deve ser diferente da atual.');
      // Só ENVIA a troca. Validar a senha atual, gerar o novo hash (senha_hash)
      // e invalidar sessões antigas é responsabilidade do Flask.
      const r = await alterarSenha(atual, nova);              // PUT /api/usuario/senha
      return r.mensagem || 'Senha alterada com sucesso.';
    }
  });
}

/* ---------------- MINHA PROPRIEDADE ---------------- */
function montarMetodos() {
  const area = document.getElementById('metodos');
  METODOS_IRRIGACAO.forEach(m => {
    const l = document.createElement('label');
    l.className = 'metodo';
    l.innerHTML = '<input type="radio" name="metodo"><span class="bolinha"></span><span><strong></strong><small></small></span>';
    l.querySelector('input').value = m.valor;
    l.querySelector('strong').textContent = m.titulo;
    l.querySelector('small').textContent = m.descricao;
    l.querySelector('input').addEventListener('change', marcarMetodo);
    area.appendChild(l);
  });
}
function marcarMetodo() {
  document.querySelectorAll('#metodos .metodo').forEach(l => l.classList.toggle('marcado', l.querySelector('input').checked));
}

async function preencherPropriedade() {
  try {
    propriedadeAtual = await getPropriedade();               // GET /api/propriedade
    document.getElementById('pNome').value = propriedadeAtual.nome;
    document.getElementById('pLocal').value = propriedadeAtual.localizacao || '';
    document.getElementById('pArea').value = propriedadeAtual.area_hectares ?? '';
    document.getElementById('pCultura').value = propriedadeAtual.cultura;
    document.querySelectorAll('#metodos input').forEach(i => { i.checked = i.value === propriedadeAtual.metodo_irrigacao; });
    marcarMetodo();
    document.getElementById('erroProp').textContent = '';
  } catch (e) { mostrarMensagem(e.message, 'erro'); }
}

async function salvarPropriedade(ev) {
  ev.preventDefault();
  const erro = document.getElementById('erroProp');
  const nome = document.getElementById('pNome').value.trim();
  const area = parseFloat(document.getElementById('pArea').value);
  const metodo = document.querySelector('#metodos input:checked');
  if (!nome) { erro.textContent = 'Informe o nome da propriedade.'; return; }
  if (isNaN(area) || area <= 0) { erro.textContent = 'Informe uma área cultivada maior que zero.'; return; }
  if (!metodo) { erro.textContent = 'Selecione o modo de irrigação.'; return; }
  erro.textContent = '';
  try {
    propriedadeAtual = await atualizarPropriedade({          // PUT /api/propriedade (persistente)
      nome, localizacao: document.getElementById('pLocal').value.trim(), area_hectares: area,
      cultura: document.getElementById('pCultura').value, metodo_irrigacao: metodo.value
    });
    mostrarMensagem('Propriedade atualizada. O Dashboard já mostra os novos dados.', 'sucesso');
  } catch (e) { erro.textContent = e.message; }
}
