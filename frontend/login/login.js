/* login.js — validação campo a campo e chamada de login() (api.js).
   Erros: sob o campo com problema; erros gerais (credenciais) sob "Esqueci minha senha". */
document.getElementById('icMail').innerHTML = icone('mail');
document.getElementById('icLock').innerHTML = icone('lock');

const campos = {
  email: { input: document.getElementById('email'), erro: document.getElementById('erroEmail') },
  senha: { input: document.getElementById('senha'), erro: document.getElementById('erroSenha') }
};
const erroGeral = document.getElementById('erroGeral');
const alerta = document.getElementById('alerta');            // aviso de sucesso no topo

function erroNoCampo(nome, texto) {
  campos[nome].erro.textContent = texto;
  campos[nome].input.classList.add('invalido');
  campos[nome].input.setAttribute('aria-invalid', 'true');
}
function limparCampo(nome) {
  campos[nome].erro.textContent = '';
  campos[nome].input.classList.remove('invalido');
  campos[nome].input.removeAttribute('aria-invalid');
}
function limparErroGeral() {
  erroGeral.textContent = '';
  Object.keys(campos).forEach(n => campos[n].input.classList.remove('invalido'));
}
// ao digitar, some só o erro daquele campo (e o erro geral)
Object.keys(campos).forEach(nome => campos[nome].input.addEventListener('input', () => {
  const tinhaGeral = erroGeral.textContent !== '';
  limparCampo(nome);
  if (tinhaGeral) limparErroGeral();
}));

// Aviso deixado pela tela anterior (ex.: cadastro concluído)
const aviso = lerAviso();
if (aviso) { alerta.textContent = aviso; alerta.className = 'alerta alerta-ok'; alerta.hidden = false; }

document.getElementById('formLogin').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = campos.email.input.value.trim();
  const senha = campos.senha.input.value;
  Object.keys(campos).forEach(limparCampo);
  limparErroGeral();

  // 1) validação no próprio navegador (cada campo mostra o seu erro)
  if (!email) erroNoCampo('email', 'Informe seu e-mail.');
  else if (!validarEmail(email)) erroNoCampo('email', 'Informe um e-mail válido.');
  if (!senha) erroNoCampo('senha', 'Informe sua senha.');
  const primeiroInvalido = document.querySelector('.entrada input.invalido');
  if (primeiroInvalido) { primeiroInvalido.focus(); return; }

  // 2) validação no servidor
  try {
    const dados = await login(email, senha);          // POST /api/login
    if (!dados.propriedade_id) {                      // conta criada, mas cadastro da propriedade não concluído
      salvarCadastroPendente(dados);
      window.location.href = '../propriedade/propriedade.html';
      return;
    }
    salvarSessao(dados);                              // guarda usuario_id e propriedade_id (nunca a senha)
    window.location.href = '../dashboard/dashboard.html';
  } catch (e) {
    if (e.campo && campos[e.campo]) {                 // a API apontou o campo (ex.: e-mail não encontrado)
      erroNoCampo(e.campo, e.message); campos[e.campo].input.focus();
    } else {                                          // erro geral (ex.: "E-mail ou senha incorretos")
      erroGeral.textContent = e.message;
      Object.keys(campos).forEach(n => campos[n].input.classList.add('invalido'));
    }
  }
});
