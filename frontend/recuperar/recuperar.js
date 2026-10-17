/* recuperar.js — passo 1: pede o link de redefinição por e-mail. */
document.getElementById('formRecuperar').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = document.getElementById('erro');
  const email = document.getElementById('email').value.trim();
  if (!email) { erro.textContent = 'Informe o seu e-mail.'; return; }
  if (!validarEmail(email)) { erro.textContent = 'Informe um e-mail válido.'; return; }
  erro.textContent = '';
  try {
    const r = await solicitarRecuperacaoSenha(email);        // POST /api/recuperar-senha
    document.getElementById('textoResposta').textContent = r.mensagem;   // mesma mensagem sempre
    document.getElementById('resposta').hidden = false;
    // Sem back-end não existe e-mail para clicar: segue direto para a nova senha.
    // Com a API real (USAR_MOCK = false) o usuário abre o link recebido por e-mail.
    if (r.mock) setTimeout(() => { window.location.href = '../redefinir/redefinir.html'; }, 1600);
  } catch (e) { erro.textContent = e.message; }
});
