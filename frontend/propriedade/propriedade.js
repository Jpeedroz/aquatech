/* propriedade.js — Etapa 2: dados da propriedade (tabela propriedades). */
// Só abre quem acabou de criar a conta (etapa 1) ou entrou com conta sem propriedade.
if (getCadastroPendente()) iniciar(); else window.location.replace('../login/login.html');

function iniciar() {
  document.getElementById('icOk').innerHTML = icone('check', 12);
  const selCultura = document.getElementById('cultura');
  CULTURAS.forEach(c => selCultura.add(new Option(c, c)));

  // cartões "Bomba d'água" / "Gravidade" (lista vem de utils.js)
  const areaMetodos = document.getElementById('metodos');
  METODOS_IRRIGACAO.forEach((m, i) => {
    const l = document.createElement('label');
    l.className = 'metodo' + (i === 0 ? ' marcado' : '');
    l.innerHTML = '<input type="radio" name="metodo"><span class="bolinha"></span><span><strong></strong><small></small></span>';
    l.querySelector('input').value = m.valor;
    l.querySelector('input').checked = i === 0;
    l.querySelector('strong').textContent = m.titulo;
    l.querySelector('small').textContent = m.descricao;
    l.querySelector('input').addEventListener('change', () => {
      areaMetodos.querySelectorAll('.metodo').forEach(x => x.classList.remove('marcado'));
      l.classList.add('marcado');
    });
    areaMetodos.appendChild(l);
  });

  document.getElementById('formPropriedade').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const erro = document.getElementById('erro');
    const nome = document.getElementById('nome').value.trim();
    const localizacao = document.getElementById('localizacao').value.trim();
    const area = parseFloat(document.getElementById('area').value);
    if (!nome || !localizacao || isNaN(area)) { erro.textContent = 'Preencha nome, localização e área cultivada.'; return; }
    if (area <= 0) { erro.textContent = 'A área cultivada deve ser maior que zero.'; return; }
    erro.textContent = '';
    try {
      await cadastrarPropriedade({            // POST /api/propriedades
        nome, localizacao, area_hectares: area,
        cultura: selCultura.value,
        metodo_irrigacao: document.querySelector('input[name=metodo]:checked').value
      });
      limparCadastroPendente();
      definirAviso('Cadastro concluído! Entre com seu e-mail e sua senha.');
      document.getElementById('conteudoForm').hidden = true;      // mostra a tela de sucesso
      document.getElementById('icSucesso').innerHTML = icone('check', 34);
      document.getElementById('sucesso').hidden = false;
      setTimeout(() => { window.location.href = '../login/login.html'; }, 3500);   // e volta ao login
    } catch (e) { erro.textContent = e.message; }
  });
}
