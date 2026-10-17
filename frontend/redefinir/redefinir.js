/* redefinir.js — passo 2: o usuário chega pelo link do e-mail (…/redefinir.html?token=XXXX).
   O formulário só aparece se o back-end confirmar que o token é válido. */
const token = new URLSearchParams(window.location.search).get('token');

document.addEventListener('DOMContentLoaded', async () => {
  let valido = false;
  try { valido = (await verificarTokenRecuperacao(token)).valido; }   // GET /api/redefinir-senha/verificar
  catch (e) { valido = false; }
  document.getElementById('formRedefinir').hidden = !valido;
  document.getElementById('linkInvalido').hidden = valido;
});

document.getElementById('formRedefinir').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const erro = document.getElementById('erro');
  const senha = document.getElementById('senha').value;
  const confirmar = document.getElementById('confirmar').value;
  if (!senha || !confirmar) { erro.textContent = 'Preencha os dois campos.'; return; }
  if (senha.length < 6) { erro.textContent = 'A senha deve ter pelo menos 6 caracteres.'; return; }
  if (senha !== confirmar) { erro.textContent = 'A confirmação não confere com a nova senha.'; return; }
  erro.textContent = '';
  try {
    // O Flask valida o token de novo, gera o novo hash e invalida o token (uso único).
    const r = await redefinirSenha(token, senha);            // POST /api/redefinir-senha
    mostrarMensagem(r.mensagem, 'sucesso');
    setTimeout(() => { window.location.href = '../login/login.html'; }, 2200);
  } catch (e) {
    erro.textContent = e.message;                            // ex.: token expirou enquanto digitava
  }
});
