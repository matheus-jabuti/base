/* Operação B: rota própria de preparação, templates e disparo.
 *
 * Carrega depois do app.js e reaproveita dele o que é infraestrutura comum — o
 * painel de revisão, a aba Monitorar, o chip de VPN, o toggle produção/teste e
 * os helpers de formatação. Tudo que é regra da operação (bases, templates,
 * endpoints) mora aqui, e nada nesta rota lê ou escreve o estado da Operação A.
 */

const estadoB = {
  bases: [],
  tplSujo: false,
  carregado: false,
};

const ROTULOS_B = {
  b_amigavel_a: 'Amigável A',
  b_amigavel_d: 'Amigável D',
  b_contencioso_menor_500: 'Contencioso < 500',
  b_contencioso_maior_500: 'Contencioso > 500',
  b_outros: 'Outros',
};

// Espelho do número de template no navegador, como na Operação A — chave
// própria pra uma operação não sobrescrever a escolha da outra.
const LS_NUMEROS_B = 'disparo.templateNumerosB';

const fasesEscolhidasB = () => [...document.querySelectorAll('.fase-b:checked')].map((campo) => campo.value);

const totalB = () => estadoB.bases.reduce((soma, base) => soma + base.contatos, 0);

const grupoDaBaseB = (base) => base.grupo || base.key;

const rotuloB = (base) => ROTULOS_B[grupoDaBaseB(base)] || rotulo(base.nome);

function lerNumerosBLS() {
  try {
    const bruto = JSON.parse(localStorage.getItem(LS_NUMEROS_B));
    return bruto && typeof bruto === 'object' ? bruto : {};
  } catch {
    return {};
  }
}

function gravarNumerosBLS() {
  const nums = {};
  for (const campo of document.querySelectorAll('#templates-grupos-b input[data-grupo]')) {
    nums[campo.dataset.grupo] = campo.value.trim();
  }
  try {
    localStorage.setItem(LS_NUMEROS_B, JSON.stringify(nums));
  } catch {
    /* modo privado / storage cheio: segue sem espelho */
  }
}

/* ------------------------------------------------ bases */

async function carregarBasesB() {
  estadoB.bases = await fetch(`/api/b/bases?modo=${estado.modo}`).then((r) => r.json()).catch(() => []);
  estadoB.tplSujo = false;
  desenharTemplatesB();
  desenharBasesB();
  atualizarAcoesTemplatesB();
}

function desenharBasesB() {
  const lista = $('bases-b');
  lista.innerHTML = '';

  const maior = Math.max(...estadoB.bases.map((base) => base.contatos), 1);

  for (const base of estadoB.bases) {
    const item = document.createElement('li');
    item.innerHTML = `
      <div class="nome">
        <strong></strong>
        <em></em>
        <div class="volume"><i></i></div>
      </div>
      <div class="contagem"><span></span><small></small></div>
    `;

    item.querySelector('strong').textContent = rotuloB(base);
    item.querySelector('em').textContent = templateEscolhidoB(base);

    const barra = item.querySelector('.volume i');
    barra.style.width = `${Math.max((base.contatos / maior) * 100, base.contatos ? 4 : 2)}%`;
    barra.classList.toggle('vazio', !base.contatos);

    const contagem = item.querySelector('.contagem');
    contagem.classList.toggle('zero', !base.contatos);
    contagem.querySelector('span').textContent = numero(base.contatos);
    contagem.querySelector('small').textContent = base.contatos ? 'contatos' : base.existe ? 'CSV vazio' : 'sem CSV';

    lista.appendChild(item);
  }

  $('dica-bases-b').textContent = `${plural(estadoB.bases.length, 'planilha', 'planilhas')} · uma por rating`;
  atualizarResumoB();
}

/* ------------------------------------------------ templates */

// Um cartão por planilha: cada rating tem número próprio, pra mensagem poder
// variar entre amigável A, amigável D, os dois contenciosos e outros.
function desenharTemplatesB() {
  const alvo = $('templates-grupos-b');
  alvo.innerHTML = '';

  for (const base of estadoB.bases) {
    const grupo = grupoDaBaseB(base);
    const numeroAtual = base.template.match(/_(\d{1,3})$/)?.[1] || '';

    const card = document.createElement('div');
    card.className = `grupo${grupo.startsWith('b_contencioso') ? ' contencioso' : ''}`;
    card.innerHTML = `
      <div class="grupo-topo">
        <strong></strong>
        <div class="stepper-b">
          <button type="button" data-passo="-1" aria-label="Diminuir">−</button>
          <input type="text" inputmode="numeric" maxlength="3" aria-label="Número do template">
          <button type="button" data-passo="1" aria-label="Aumentar">+</button>
        </div>
      </div>
      <ul class="grupo-bases"></ul>
      <div class="grupo-pe"></div>
    `;

    card.querySelector('strong').textContent = ROTULOS_B[grupo] || rotulo(base.nome);
    card.querySelector('.grupo-pe').textContent = base.csv;

    const campo = card.querySelector('input');
    campo.dataset.grupo = grupo;
    campo.value = numeroAtual;

    const li = document.createElement('li');
    li.innerHTML = '<span class="nome"></span><code class="tpl-resolvido"></code><span class="cont"></span>';
    li.querySelector('.nome').textContent = rotulo(base.nome);

    const cod = li.querySelector('.tpl-resolvido');
    cod.dataset.prefix = base.template.replace(/_\d{1,3}$/, '');
    cod.textContent = `${cod.dataset.prefix}_${(numeroAtual || '').padStart(2, '0')}`;

    li.querySelector('.cont').textContent = base.contatos ? numero(base.contatos) : base.existe ? 'CSV vazio' : 'sem CSV';
    card.querySelector('.grupo-bases').appendChild(li);

    for (const botao of card.querySelectorAll('.stepper-b button')) {
      botao.onclick = () => {
        let atual = Number(campo.value || 0) + Number(botao.dataset.passo);
        if (atual > 999) atual = 1;
        if (atual < 1) atual = 1;
        aplicarNumeroGrupoB(grupo, String(atual).padStart(2, '0'));
      };
    }

    campo.oninput = () => {
      const limpo = campo.value.replace(/\D/g, '').slice(0, 3);
      if (campo.value !== limpo) campo.value = limpo;
      aplicarNumeroGrupoB(grupo, limpo, campo);
    };

    alvo.appendChild(card);
  }

  for (const [grupo, valor] of Object.entries(lerNumerosBLS())) {
    if (!/^\d{1,3}$/.test(String(valor))) continue;
    const campo = document.querySelector(`#templates-grupos-b input[data-grupo="${grupo}"]`);
    if (campo && campo.value !== valor && campo.value !== String(valor).padStart(2, '0')) {
      aplicarNumeroGrupoB(grupo, String(valor).padStart(2, '0'));
    }
  }

  gravarNumerosBLS();
  $('dica-templates-b').textContent = `${plural(estadoB.bases.length, 'planilha', 'planilhas')} · número independente por rating`;
  resumoTemplatesPrepararB();
}

function aplicarNumeroGrupoB(grupo, valor, origem) {
  const campo = document.querySelector(`#templates-grupos-b input[data-grupo="${grupo}"]`);
  const card = campo?.closest('.grupo');
  if (!card) return;

  if (campo !== origem) campo.value = valor;

  for (const cod of card.querySelectorAll('.tpl-resolvido')) {
    cod.textContent = `${cod.dataset.prefix}_${(valor || '').padStart(2, '0')}`;
  }

  estadoB.tplSujo = true;
  gravarNumerosBLS();
  atualizarAcoesTemplatesB();
  resumoTemplatesPrepararB();
  atualizarResumoB();
}

function templateEscolhidoB(base) {
  const campo = document.querySelector(`#templates-grupos-b input[data-grupo="${grupoDaBaseB(base)}"]`);
  const prefixo = base.template.replace(/_\d{1,3}$/, '');

  return `${prefixo}_${(campo?.value || '').padStart(2, '0')}`;
}

function lerTemplatesB() {
  return estadoB.bases.map((base) => ({
    key: base.key,
    template_prefix: base.template.replace(/_\d{1,3}$/, ''),
    template_numero: (document.querySelector(`#templates-grupos-b input[data-grupo="${grupoDaBaseB(base)}"]`)?.value || '').trim(),
  }));
}

function resumoTemplatesPrepararB() {
  $('preparar-templates-b').innerHTML = estadoB.bases
    .map((base) => `<div><dt>${ROTULOS_B[grupoDaBaseB(base)] || rotulo(base.nome)}</dt><dd>${templateEscolhidoB(base)}</dd></div>`)
    .join('');
}

function atualizarAcoesTemplatesB() {
  $('tpl-acoes-b').hidden = !estadoB.tplSujo;
  $('tpl-estado-b').textContent = estadoB.tplSujo ? 'mudanças não salvas' : '';
}

async function salvarTemplatesB() {
  const resposta = await fetch('/api/b/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lerTemplatesB()),
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    alert(erro.detail || 'Não consegui salvar os templates da Operação B.');
    return;
  }

  await carregarBasesB();
  $('tpl-estado-b').textContent = 'salvo';
  setTimeout(() => { if (!estadoB.tplSujo) $('tpl-estado-b').textContent = ''; }, 2500);
}

async function descartarTemplatesB() {
  try {
    localStorage.removeItem(LS_NUMEROS_B);
  } catch {
    /* ignore */
  }
  await carregarBasesB();
}

/* ------------------------------------------------ resumo */

function atualizarResumoB() {
  const contatos = totalB();
  const cheias = estadoB.bases.filter((base) => base.contatos).length;
  const hora = $('hora-b').value;

  const pilula = $('hora-modo-b');
  pilula.textContent = hora ? 'agendado' : '—';
  pilula.className = `pilula ${hora ? 'agendado' : ''}`;

  $('hora-relativa-b').textContent = textoRelativo(hora);
  $('hora-data-b').textContent = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  $('resumo-contatos-b').textContent = numero(contatos);
  const vazias = estadoB.bases.length - cheias;
  $('resumo-bases-b').textContent = contatos
    ? `contatos em ${plural(cheias, 'planilha', 'planilhas')}${vazias ? ` · ${plural(vazias, 'planilha vazia', 'planilhas vazias')}` : ''}`
    : 'nenhum contato nos CSVs atuais';

  const fases = fasesEscolhidasB();
  const criar = fases.length === 3
    ? 'campanha, lista e transmissão'
    : fases.map((fase) => ROTULO_FASE[fase]).join(', ') || 'nada selecionado';

  const linhas = [
    ['Modo', estado.modo === 'producao' ? 'produção' : 'teste', estado.modo === 'producao'],
    ['Horário', `${hora || '--:--'} · agendado`, false],
    ['Criar', criar, fases.length < 3],
    ['Base', $('gerar-base-b').checked ? 'gera as cinco planilhas agora' : 'reaproveita os CSVs da pasta', false],
    ['Filtro manual', estado.filtro.telefones ? `${numero(estado.filtro.telefones)} números` : 'vazio', false],
  ];

  $('resumo-lista-b').innerHTML = linhas
    .map(([rot, valor, destaque]) => `<div><dt>${rot}</dt><dd class="${destaque ? 'destaque' : ''}">${valor}</dd></div>`)
    .join('');

  $('filtro-resumo-b').textContent = estado.filtro.telefones
    ? `${plural(estado.filtro.arquivos.length, 'arquivo', 'arquivos')} · ${numero(estado.filtro.telefones)} telefones`
    : 'nenhum arquivo em filtros/';

  const impedido = estado.rodando || !contatos || !hora || !fases.length;
  $('btn-revisar-b').disabled = impedido;
  $('btn-previa-b').disabled = estado.rodando || !$('gerar-base-b').checked;

  $('btn-revisar-nota-b').textContent = contatos
    ? `${plural(cheias, 'planilha', 'planilhas')} · ${plural(contatos, 'contato', 'contatos')}`
    : 'nenhum contato nos CSVs atuais';
}

/* ------------------------------------------------ execucao */

function contextoB(dryRun) {
  const fases = fasesEscolhidasB();

  return {
    operacao: 'b',
    dryRun,
    hora: $('hora-b').value,
    modo: estado.modo,
    fases,
    contatos: totalB(),
    gerarBase: $('gerar-base-b').checked,
    // A Operacao B nao gera relatorio Excel: a consulta ja e a base fechada.
    comRelatorio: false,
    textoBase: 'As cinco planilhas são geradas agora, direto do cadastro da operação B.',
    bases: estadoB.bases.map((base) => ({
      key: base.key,
      nome: base.nome,
      contatos: base.contatos,
      template: templateEscolhidoB(base),
    })),
    urlTemplates: '/api/b/templates',
    templates: lerTemplatesB(),
    urlExecutar: '/api/b/executar',
    parametros: new URLSearchParams({
      hora: $('hora-b').value,
      modo: estado.modo,
      gerar: $('gerar-base-b').checked,
      dry_run: dryRun,
      fases: fases.join(','),
    }),
    aoEncerrar: atualizarResumoB,
  };
}

/* ------------------------------------------------ boot */

// Carrega as bases só quando a rota é aberta pela primeira vez — abrir a tela na
// Operação A não deve custar uma leitura de CSV da B.
function entrarOperacaoB() {
  if (estadoB.carregado) return;

  estadoB.carregado = true;
  if (!$('hora-b').value) {
    const daqui = new Date(Date.now() + 15 * 60 * 1000);
    $('hora-b').value = `${String(daqui.getHours()).padStart(2, '0')}:${String(daqui.getMinutes()).padStart(2, '0')}`;
  }
  carregarBasesB();
}

function iniciarOperacaoB() {
  $('hora-b').oninput = atualizarResumoB;
  $('gerar-base-b').onchange = atualizarResumoB;
  for (const campo of document.querySelectorAll('.fase-b')) campo.onchange = atualizarResumoB;

  $('btn-filtro-b').onclick = abrirModalFiltro;
  $('tpl-salvar-b').onclick = salvarTemplatesB;
  $('tpl-descartar-b').onclick = descartarTemplatesB;

  $('btn-revisar-b').onclick = () => abrirRevisao(contextoB(false));
  $('btn-previa-b').onclick = () => abrirRevisao(contextoB(true));
}

iniciarOperacaoB();
