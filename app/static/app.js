const $ = (id) => document.getElementById(id);

const estado = {
  bases: [],
  modo: 'producao',
  rodando: false,
  aba: 'preparar',
  vpn: null,
  filtro: { telefones: 0, arquivos: [], numeros: [] },
  ultimaExecucao: null,
  execucao: null,
  tplSujo: false,
  agenda: { itens: [], sujo: false, modo: 'teste' },
};

// Título e subtítulo da barra de topo por rota.
const ROTAS = {
  preparar: ['Preparar disparo', 'templates · horário · o que criar'],
  templates: ['Templates', 'um número por segmento · prefixo fixo por base'],
  agenda: ['Agenda', 'o servidor dispara sozinho nos horários salvos'],
  monitorar: ['Monitorar', 'execução ao vivo, atualiza por SSE'],
  historico: ['Histórico', 'todo disparo registrado por base'],
};

// A VPN as vezes demora a subir; tenta de novo antes de acusar erro.
const VPN_TENTATIVAS = 3;
const VPN_ESPERA_MS = 1500;

// Tempo que o botao de producao precisa ficar pressionado pra disparar.
const SEGURAR_MS = 1500;

const GRUPOS = {
  amigavel: 'Amigável',
  amigavel_dez: 'Amigável D/E/Z',
  contencioso: 'Contencioso',
};

// Ordem em que o dispatch.js roda as fases: campanha, depois a lista, depois a
// transmissão (que precisa das duas). Mesma ordem dos checkboxes no HTML.
const ETAPAS = ['campanha', 'lista', 'transmissao'];

const ROTULO_ETAPA = {
  lista: 'criando lista',
  campanha: 'criando campanha',
  transmissao: 'criando transmissão',
};

const ROTULO_FASE = { lista: 'lista', campanha: 'campanha', transmissao: 'transmissão' };

// Fases marcadas na aba Preparar, na ordem canônica (a ordem dos checkboxes no HTML).
const fasesEscolhidas = () => [...document.querySelectorAll('.fase:checked')].map((campo) => campo.value);

const total = () => estado.bases.reduce((soma, base) => soma + base.contatos, 0);
const numero = (valor) => Number(valor || 0).toLocaleString('pt-BR');
const plural = (qtd, um, muitos) => `${numero(qtd)} ${qtd === 1 ? um : muitos}`;

function debounce(fn, ms) {
  let temporizador;
  return (...args) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => fn(...args), ms);
  };
}

// "Disparo amigavel A/B/W" -> "Amigavel A/B/W": o prefixo e o mesmo nos cinco.
const rotulo = (nome) => {
  const curto = String(nome || '').replace(/^Disparo /, '');
  return curto.charAt(0).toUpperCase() + curto.slice(1);
};

const grupoDaBase = (base) => base.grupo || base.key.split('_')[0];

/* ------------------------------------------------ tema */

function aplicarTema(tema) {
  if (tema) document.documentElement.dataset.tema = tema;
  else delete document.documentElement.dataset.tema;
}

function alternarTema() {
  const atual = document.documentElement.dataset.tema;
  const proximo = atual === 'claro' ? 'escuro' : atual === 'escuro' ? '' : 'claro';

  aplicarTema(proximo);
  if (proximo) localStorage.setItem('tema', proximo);
  else localStorage.removeItem('tema');

  $('btn-tema').title = proximo ? `Tema ${proximo}` : 'Tema do sistema';
}

/* ------------------------------------------------ abas */

function irPara(aba) {
  if (!ROTAS[aba]) aba = 'preparar';
  estado.aba = aba;

  for (const botao of document.querySelectorAll('.nav-item')) {
    const ativa = botao.dataset.aba === aba;
    botao.classList.toggle('ativa', ativa);
    if (ativa) botao.setAttribute('aria-current', 'page');
    else botao.removeAttribute('aria-current');
  }

  for (const secao of document.querySelectorAll('.view')) {
    secao.hidden = secao.id !== `view-${aba}`;
  }

  $('rota-titulo').textContent = ROTAS[aba][0];
  $('rota-sub').textContent = ROTAS[aba][1];

  if (location.hash !== `#${aba}`) location.hash = aba;
  if (aba === 'historico') carregarHistorico();
  if (aba === 'agenda') entrarAgenda();
  else pararPollAgenda();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ------------------------------------------------ vpn */

function pintarVpn(situacao, texto) {
  const chip = $('chip-vpn');
  chip.className = `pilula-vpn ${situacao}`;
  $('chip-vpn-texto').textContent = texto;
  chip.title = situacao === 'erro' ? texto : 'Conferir a VPN de novo';
}

// Confere a VPN ao abrir a tela: ate 3 tentativas, parando na primeira que der certo.
async function verificarVpn() {
  let motivo = '';

  for (let tentativa = 1; tentativa <= VPN_TENTATIVAS; tentativa++) {
    pintarVpn('checando', `Conferindo a VPN — ${tentativa}/${VPN_TENTATIVAS}...`);

    try {
      const resposta = await fetch('/api/vpn').then((r) => r.json());

      if (resposta.ok) {
        estado.vpn = { ok: true, detalhe: plural(resposta.conexoes.length, 'banco respondendo', 'bancos respondendo') };
        pintarVpn('ok', `VPN · ${estado.vpn.detalhe}`);
        return true;
      }

      motivo = resposta.conexoes.filter((c) => !c.ok).map((c) => `${c.nome}: ${c.erro}`).join(' · ');
    } catch (erro) {
      motivo = String(erro);
    }

    if (tentativa < VPN_TENTATIVAS) await new Promise((pronto) => setTimeout(pronto, VPN_ESPERA_MS));
  }

  estado.vpn = { ok: false, detalhe: motivo };
  pintarVpn('erro', `VPN fora do ar — ${motivo}`);
  return false;
}

/* ------------------------------------------------ preparar: bases */

async function carregarBases() {
  estado.bases = await fetch(`/api/bases?modo=${estado.modo}`).then((r) => r.json());
  estado.tplSujo = false;
  desenharTemplates();
  desenharBases();
  atualizarAcoesTemplates();
}

// As bases do mesmo grupo sempre saem com o mesmo numero de template, entao a
// tela edita um numero por grupo — cada base mantem o proprio prefixo.
function agruparBases() {
  const grupos = [];

  for (const base of estado.bases) {
    const chave = grupoDaBase(base);
    let grupo = grupos.find((item) => item.grupo === chave);

    if (!grupo) {
      grupo = { grupo: chave, rotulo: GRUPOS[chave] || rotulo(base.nome), bases: [] };
      grupos.push(grupo);
    }

    grupo.bases.push(base);
  }

  return grupos;
}

// Preparar mostra as bases da rodada só para leitura (contagem + volume). A
// edição do número de template vive na rota Templates.
function desenharBases() {
  const lista = $('bases');
  lista.innerHTML = '';

  const maior = Math.max(...estado.bases.map((base) => base.contatos), 1);

  for (const base of estado.bases) {
    const item = document.createElement('li');
    item.innerHTML = `
      <div class="nome">
        <strong></strong>
        <em></em>
        <div class="volume"><i></i></div>
      </div>
      <div class="contagem"><span></span><small></small></div>
    `;

    item.querySelector('strong').textContent = rotulo(base.nome);
    item.querySelector('em').textContent = templateEscolhido(base);

    const barra = item.querySelector('.volume i');
    barra.style.width = `${Math.max((base.contatos / maior) * 100, base.contatos ? 4 : 2)}%`;
    barra.classList.toggle('vazio', !base.contatos);

    const contagem = item.querySelector('.contagem');
    contagem.classList.toggle('zero', !base.contatos);
    contagem.querySelector('span').textContent = numero(base.contatos);
    contagem.querySelector('small').textContent = base.contatos ? 'contatos' : base.existe ? 'CSV vazio' : 'sem CSV';

    lista.appendChild(item);
  }

  $('dica-bases').textContent = `${plural(estado.bases.length, 'base', 'bases')} · ${agruparBases().length} grupos`;
  atualizarResumo();
}

/* ------------------------------------------------ rota templates */

// Um cartão por grupo (amigavel / amigavel_dez / contencioso): um stepper, e uma
// linha por base do grupo com o nome final resolvido (prefixo + número).
function desenharTemplates() {
  const alvo = $('templates-grupos');
  alvo.innerHTML = '';

  for (const grupo of agruparBases()) {
    const max = grupo.grupo === 'contencioso' ? 10 : 7;
    const numeroAtual = grupo.bases[0].template.match(/_(\d{1,3})$/)?.[1] || '';

    const card = document.createElement('div');
    card.className = `grupo${grupo.grupo === 'contencioso' ? ' contencioso' : ''}`;
    card.innerHTML = `
      <div class="grupo-topo">
        <strong></strong>
        <div class="stepper">
          <button type="button" data-passo="-1" aria-label="Diminuir">−</button>
          <input type="text" inputmode="numeric" maxlength="3" aria-label="Número do template">
          <button type="button" data-passo="1" aria-label="Aumentar">+</button>
        </div>
      </div>
      <ul class="grupo-bases"></ul>
      <div class="grupo-pe">máx ${String(max).padStart(2, '0')}</div>
    `;

    card.querySelector('strong').textContent = grupo.rotulo;

    const campo = card.querySelector('input');
    campo.dataset.grupo = grupo.grupo;
    campo.value = numeroAtual;

    const ul = card.querySelector('.grupo-bases');
    for (const base of grupo.bases) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="nome"></span><code class="tpl-resolvido"></code><span class="cont"></span>';
      li.querySelector('.nome').textContent = rotulo(base.nome);

      const cod = li.querySelector('.tpl-resolvido');
      cod.dataset.prefix = base.template.replace(/_\d{1,3}$/, '');
      cod.textContent = `${cod.dataset.prefix}_${(numeroAtual || '').padStart(2, '0')}`;

      li.querySelector('.cont').textContent = base.contatos ? numero(base.contatos) : base.existe ? 'CSV vazio' : 'sem CSV';
      ul.appendChild(li);
    }

    for (const botao of card.querySelectorAll('.stepper button')) {
      botao.onclick = () => {
        let atual = Number(campo.value || 0) + Number(botao.dataset.passo);
        if (atual > max) atual = 1;
        if (atual < 1) atual = max;
        aplicarNumeroGrupo(grupo.grupo, String(atual).padStart(2, '0'));
      };
    }

    campo.oninput = () => {
      const limpo = campo.value.replace(/\D/g, '').slice(0, 3);
      if (campo.value !== limpo) campo.value = limpo;
      aplicarNumeroGrupo(grupo.grupo, limpo, campo);
    };

    alvo.appendChild(card);
  }

  $('dica-templates').textContent = `${plural(agruparBases().length, 'grupo', 'grupos')} · ${plural(estado.bases.length, 'base', 'bases')}`;
  resumoTemplatesPreparar();
}

function aplicarNumeroGrupo(grupo, valor, origem) {
  const card = document.querySelector(`.grupo .stepper input[data-grupo="${grupo}"]`)?.closest('.grupo');
  if (!card) return;

  const campo = card.querySelector('input[data-grupo]');
  if (campo !== origem) campo.value = valor;

  for (const cod of card.querySelectorAll('.tpl-resolvido')) {
    cod.textContent = `${cod.dataset.prefix}_${(valor || '').padStart(2, '0')}`;
  }

  estado.tplSujo = true;
  atualizarAcoesTemplates();
  resumoTemplatesPreparar();
  atualizarResumo();
}

function resumoTemplatesPreparar() {
  $('preparar-templates').innerHTML = agruparBases().map((grupo) => {
    const nomes = [...new Set(grupo.bases.map((base) => templateEscolhido(base)))].join(' · ');
    return `<div><dt>${grupo.rotulo}</dt><dd>${nomes}</dd></div>`;
  }).join('');
}

function atualizarAcoesTemplates() {
  $('tpl-acoes').hidden = !estado.tplSujo;
  $('tpl-estado').textContent = estado.tplSujo ? 'mudanças não salvas' : '';
}

async function salvarTemplates() {
  const resposta = await fetch('/api/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lerTemplates()),
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    alert(erro.detail || 'Não consegui salvar os templates.');
    return;
  }

  await carregarBases();
  $('tpl-estado').textContent = 'salvo';
  setTimeout(() => { if (!estado.tplSujo) $('tpl-estado').textContent = ''; }, 2500);
}

function lerTemplates() {
  const numeros = {};

  for (const campo of document.querySelectorAll('.stepper input')) {
    numeros[campo.dataset.grupo] = campo.value.trim();
  }

  return estado.bases.map((base) => ({
    key: base.key,
    template_prefix: base.template.replace(/_\d{1,3}$/, ''),
    template_numero: numeros[grupoDaBase(base)] || '',
  }));
}

function templateEscolhido(base) {
  const campo = document.querySelector(`.stepper input[data-grupo="${grupoDaBase(base)}"]`);
  const prefixo = base.template.replace(/_\d{1,3}$/, '');

  return `${prefixo}_${(campo?.value || '').padStart(2, '0')}`;
}

/* ------------------------------------------------ preparar: horario */

// Todo disparo e agendado no dispatch.js (nunca envio imediato), pra sempre
// sobrar janela de cancelamento. Se o horario ja passou ou esta perto demais, o
// dispatch.js agenda ~10min pra frente — textoRelativo() avisa isso.
function agendado() {
  return $('hora').value ? true : null;
}

function alvoEmMinutos() {
  const [hh, mm] = ($('hora').value || '').split(':').map(Number);
  if (Number.isNaN(hh)) return 0;

  const alvo = new Date();
  alvo.setHours(hh, mm, 0, 0);

  return Math.round((alvo.getTime() - Date.now()) / 60000);
}

function textoRelativo() {
  const minutos = alvoEmMinutos();

  if (minutos < -1) return `horário já passou hoje (${-minutos} min atrás) — será agendado ~10 min à frente`;
  if (minutos < 10) return 'muito perto do horário atual — será agendado ~10 min à frente';
  if (minutos < 60) return `hoje, daqui a ${minutos} minutos`;

  return `hoje, daqui a ${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, '0')}`;
}

function definirHora(data) {
  $('hora').value = `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
  atualizarResumo();
}

/* ------------------------------------------------ preparar: resumo */

function atualizarResumo() {
  const contatos = total();
  const cheias = estado.bases.filter((base) => base.contatos).length;
  const agenda = agendado();

  const pilula = $('hora-modo');
  pilula.textContent = agenda === null ? '—' : agenda ? 'agendado' : 'envio imediato';
  pilula.className = `pilula ${agenda === null ? '' : agenda ? 'agendado' : 'imediato'}`;

  $('hora-relativa').textContent = textoRelativo();
  $('hora-data').textContent = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  $('resumo-contatos').textContent = numero(contatos);
  const vazias = estado.bases.length - cheias;
  $('resumo-bases').textContent = contatos
    ? `contatos em ${plural(cheias, 'base', 'bases')}${vazias ? ` · ${plural(vazias, 'base vazia', 'bases vazias')}` : ''}`
    : 'nenhum contato nos CSVs atuais';

  const numeros = [...new Set([...document.querySelectorAll('.stepper input')].map((campo) => campo.value))];

  const fases = fasesEscolhidas();
  const criar = fases.length === 3
    ? 'campanha, lista e transmissão'
    : fases.map((fase) => ROTULO_FASE[fase]).join(', ') || 'nada selecionado';

  const periodo = $('gerar-base').checked
    ? `${dataBR($('data-inicio').value)} → ${dataBR($('data-fim').value)}`
    : 'reaproveita os CSVs da pasta';

  const linhas = [
    ['Modo', estado.modo === 'producao' ? 'produção' : 'teste', estado.modo === 'producao'],
    ['Horário', `${$('hora').value || '--:--'} · ${agenda === null ? '—' : agenda ? 'agendado' : 'imediato'}`, false],
    ['Criar', criar, fases.length < 3],
    ['Templates', numeros.join(' / ') || '—', false],
    ['Período', periodo, false],
    ['Filtro manual', estado.filtro.telefones ? `${numero(estado.filtro.telefones)} números` : 'vazio', false],
    ['Última execução', estado.ultimaExecucao || '—', false],
  ];

  $('resumo-lista').innerHTML = linhas
    .map(([rot, valor, destaque]) => `<div><dt>${rot}</dt><dd class="${destaque ? 'destaque' : ''}">${valor}</dd></div>`)
    .join('');

  const impedido = estado.rodando || !contatos || !$('hora').value || !fases.length;
  $('btn-revisar').disabled = impedido;
  $('btn-previa').disabled = estado.rodando || !$('gerar-base').checked;

  $('btn-revisar-nota').textContent = contatos
    ? `${plural(cheias, 'base', 'bases')} · ${plural(contatos, 'contato', 'contatos')}`
    : 'nenhum contato nos CSVs atuais';
}

function trocarModo(modo) {
  estado.modo = modo;
  document.body.className = `modo-${modo}`;

  for (const botao of document.querySelectorAll('#segmento-modo button')) {
    botao.classList.toggle('ativo', botao.dataset.modo === modo);
  }

  const faixa = $('faixa-modo');
  faixa.className = `faixa-modo ${modo}`;
  faixa.innerHTML = modo === 'teste'
    ? '<strong>Modo teste.</strong> Dispara as bases de 1 contato em auto/bases/ — nada chega a cliente real.<span class="complemento">Para valer, troque para Produção.</span>'
    : '<strong>Modo produção.</strong> As mensagens vão para os clientes reais da base gerada.<span class="complemento">Para ensaiar, troque para Teste — 1 contato por base.</span>';

  // Em teste o backend nunca escreve o relatorio; o check fica desabilitado.
  const relatorio = $('com-relatorio');
  relatorio.disabled = modo === 'teste';
  relatorio.closest('.opcao').classList.toggle('desabilitada', modo === 'teste');

  carregarBases();
}

/* ------------------------------------------------ filtro manual */

async function carregarFiltro() {
  const dados = await fetch('/api/filtro').then((r) => r.json()).catch(() => null);
  if (!dados) return;

  estado.filtro = dados;

  $('filtro-resumo').textContent = dados.telefones
    ? `${plural(dados.arquivos.length, 'arquivo', 'arquivos')} · ${numero(dados.telefones)} telefones`
    : 'nenhum arquivo em filtros/';

  atualizarResumo();
}

// Digitos crus -> "(DD) 9 NNNN-NNNN" (celular) ou "(DD) NNNN-NNNN" (fixo, sem
// o 9). Numero fora desses dois formatos (ex: internacional) volta cru.
function formatarTelefone(digitos) {
  let d = String(digitos);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);

  if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

function abrirModalFiltro() {
  $('filtro-arquivos').textContent = estado.filtro.arquivos.length
    ? `${estado.filtro.arquivos.map((arquivo) => arquivo.nome).join(' · ')} — em ${estado.filtro.pasta}`
    : 'Nenhum arquivo na pasta filtros/.';

  const lista = $('filtro-numeros');
  lista.innerHTML = (estado.filtro.numeros || []).length
    ? estado.filtro.numeros.map(({ telefone, nome }) => `
        <li><span class="tel">${formatarTelefone(telefone)}</span><span class="nome">${nome || '—'}</span></li>
      `).join('')
    : '<li class="vazio">Nenhum telefone no filtro.</li>';

  $('modal-filtro').classList.add('aberto');
}

/* ------------------------------------------------ painel de revisao */

function montarChecklist(dryRun) {
  const itens = [];
  const vazias = estado.bases.filter((base) => !base.contatos);

  if (estado.vpn?.ok) itens.push(['ok', `VPN conectada — ${estado.vpn.detalhe}.`]);
  else itens.push(['erro', 'VPN sem resposta. A execução vai parar no primeiro passo.']);

  if ($('gerar-base').checked) {
    const inicio = $('data-inicio').value.split('-').reverse().join('/');
    const fim = $('data-fim').value.split('-').reverse().join('/');
    itens.push(['ok', `Base gerada agora do período <strong>${inicio} → ${fim}</strong>.`]);
  } else {
    itens.push(['alerta', 'Reaproveitando os CSVs que já estão na pasta — podem ser de outro dia.']);
  }

  if (estado.filtro.telefones) {
    itens.push(['ok', `<strong>${numero(estado.filtro.telefones)} telefones</strong> do filtro manual serão removidos.`]);
  } else {
    itens.push(['alerta', 'Nenhum telefone no filtro manual (pasta filtros/ vazia).']);
  }

  if (vazias.length) {
    itens.push(['alerta', `${plural(vazias.length, 'base fica', 'bases ficam')} de fora por CSV vazio: ${vazias.map((base) => rotulo(base.nome)).join(', ')}.`]);
  } else {
    itens.push(['ok', 'Todas as bases têm contatos.']);
  }

  if (dryRun) itens.push(['ok', 'Pré-visualização: nada é gravado em disco nem enviado.']);
  else if (estado.modo === 'teste') itens.push(['ok', 'Modo teste: 1 contato por base, nenhum cliente real.']);
  else itens.push(['alerta', 'Depois de criado no dashboard, o agendamento só é desfeito por lá.']);

  if (!dryRun) {
    const fases = fasesEscolhidas();
    if (fases.length < 3) {
      itens.push(['alerta', `Só vai criar: <strong>${fases.map((fase) => ROTULO_FASE[fase]).join(', ') || 'nada'}</strong>.`]);
      if (fases.includes('transmissao') && !(fases.includes('lista') && fases.includes('campanha'))) {
        itens.push(['alerta', 'A transmissão usa a lista e a campanha que já estiverem no dashboard — se não foram criadas antes, ela falha.']);
      }
    }
  }

  return itens;
}

function abrirRevisao(dryRun) {
  const contatos = total();
  const agenda = agendado();
  const producao = estado.modo === 'producao' && !dryRun;

  $('revisao-modo').className = `pilula-modo ${estado.modo}`;
  $('revisao-modo').textContent = dryRun
    ? 'pré-visualização · nada é enviado'
    : estado.modo === 'producao' ? 'produção · clientes reais' : 'teste · 1 contato por base';

  $('revisao-titulo').textContent = dryRun
    ? 'Rodar pré-visualização da base'
    : `Confirmar o disparo de ${numero(contatos)} contatos`;

  $('revisao-quando').innerHTML = dryRun
    ? 'Gera as contagens do período sem escrever CSV, sem abrir o dashboard e sem enviar mensagem.'
    : `${agenda ? 'Agendado para' : 'Envio imediato às'} <strong>${$('hora').value}</strong> — ${textoRelativo()}.`;

  $('revisao-bases').innerHTML = estado.bases.map((base) => {
    const vazia = !base.contatos;
    return `
      <div class="${vazia ? 'apagada' : ''}">
        <span>${rotulo(base.nome)} · ${templateEscolhido(base)}</span>
        <span>${vazia ? 'pulada' : numero(base.contatos)}</span>
      </div>`;
  }).join('');

  $('revisao-checklist').innerHTML = montarChecklist(dryRun).map(([tipo, texto]) => `
    <li>
      <span class="sinal ${tipo === 'ok' ? '' : tipo}">${tipo === 'ok' ? '✓' : '!'}</span>
      <span>${texto}</span>
    </li>`).join('');

  const botao = $('btn-confirmar');
  botao.classList.toggle('simples', !producao);
  botao.dataset.dryRun = String(dryRun);
  $('btn-confirmar-texto').textContent = producao
    ? 'Segure para disparar'
    : dryRun ? 'Rodar pré-visualização' : 'Disparar em modo teste';
  $('btn-confirmar-nota').textContent = producao ? 'solte para cancelar · 1,5s' : 'um clique';

  $('painel-revisao').hidden = false;
  botao.focus();
}

function fecharRevisao() {
  abortarSegurar();
  $('painel-revisao').hidden = true;
  $('btn-revisar').focus();
}

let seguraTimer = null;

function iniciarSegurar() {
  if (seguraTimer) return;

  const fita = $('btn-confirmar-fita');
  fita.style.transition = `width ${SEGURAR_MS}ms linear`;
  fita.style.width = '100%';
  seguraTimer = setTimeout(confirmarRevisao, SEGURAR_MS);
}

function abortarSegurar() {
  clearTimeout(seguraTimer);
  seguraTimer = null;

  const fita = $('btn-confirmar-fita');
  fita.style.transition = 'width .15s';
  fita.style.width = '0';
}

function confirmarRevisao() {
  abortarSegurar();
  const dryRun = $('btn-confirmar').dataset.dryRun === 'true';
  $('painel-revisao').hidden = true;
  executar(dryRun);
}

function acionarConfirmacao() {
  if ($('btn-confirmar').classList.contains('simples')) confirmarRevisao();
}

/* ------------------------------------------------ monitorar */

function prepararExecucao(dryRun) {
  estado.execucao = {
    inicio: Date.now(),
    hora: $('hora').value,
    modo: estado.modo,
    dryRun,
    fases: dryRun ? ETAPAS.slice() : fasesEscolhidas(),
    agendado: agendado(),
    contatos: total(),
    bases: new Map(),
    filtroRemovidos: 0,
    tempoTotal: null,
    status: 'rodando',
  };

  $('monitorar-vazio').hidden = true;
  $('monitorar-conteudo').hidden = false;
  $('ponto-monitorar').hidden = false;

  for (const item of document.querySelectorAll('.trilha > li')) {
    item.className = '';
    item.querySelector('.texto > em').textContent = '';
  }

  $('subbases').innerHTML = '';
  $('resultado').hidden = true;
  $('resultado').className = 'resultado';
  $('cartao-porbase').hidden = true;
  $('porbase').innerHTML = '';
  $('cartao-arquivos').hidden = true;
  $('arquivos').innerHTML = '';
  $('acoes-fim').hidden = true;
  $('log').textContent = '';
  $('bloco-log').open = false;

  $('cartao-tempos').hidden = true;
  $('tempos-fase').innerHTML = '';

  // Nada de coluna vazia esperando o primeiro evento: as bases ja conhecidas
  // aparecem na fila, e as metricas entram como esqueleto ate chegar valor.
  desenharSubbases(estado.bases.map((base) => ({
    key: base.key,
    nome: base.nome,
    contatos: base.contatos,
    template: templateEscolhido(base),
  })));

  if ($('gerar-base').checked) esqueletoMetricas();
  else {
    $('cartao-metricas').hidden = true;
    $('metricas').innerHTML = '';
  }

  $('btn-cancelar').hidden = false;
  $('btn-cancelar').disabled = false;

  $('execucao-titulo').textContent = dryRun
    ? 'Pré-visualização em andamento'
    : `Execução em andamento · ${estado.modo}`;

  marcarPasso('vpn', 'rodando');
  marcarPasso('base', '', $('gerar-base').checked ? 'aguarda a VPN responder' : 'vai reaproveitar os CSVs da pasta');
  marcarPasso('disparo', '', dryRun ? 'não roda em pré-visualização' : 'aguarda a base ficar pronta');

  atualizarSubtitulo();
  pintarProgresso(2, '');
  iniciarCronometro();
}

// Enquanto a geracao nao emite a primeira metrica, o cartao mostra barras
// cinzas no lugar de sumir da coluna.
function esqueletoMetricas() {
  $('cartao-metricas').hidden = false;
  $('metricas').innerHTML = [72, 58, 80, 64, 70].map((largura) => `
    <li class="esqueleto"><span style="width: ${largura}%"></span><span class="valor"></span></li>
  `).join('');
}

function atualizarSubtitulo() {
  const execucao = estado.execucao;
  if (!execucao) return;

  const inicio = new Date(execucao.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const alvo = execucao.dryRun
    ? 'sem disparo'
    : `alvo ${execucao.hora} (${execucao.agendado ? 'agendado' : 'imediato'})`;

  $('execucao-sub').textContent = `iniciada ${inicio} · ${alvo} · ${plural(execucao.contatos, 'contato', 'contatos')}`;
}

let cronometro = null;

function iniciarCronometro() {
  clearInterval(cronometro);

  const passo = () => {
    if (!estado.execucao) return;
    const segundos = Math.floor((Date.now() - estado.execucao.inicio) / 1000);
    $('cronometro').textContent = `${String(Math.floor(segundos / 60)).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
  };

  passo();
  cronometro = setInterval(passo, 1000);
}

function pintarProgresso(porcento, situacao) {
  const fita = $('progresso-fita');
  fita.style.width = `${Math.min(porcento, 100)}%`;
  // Sem situacao final, a barra fica com o brilho que varre enquanto roda.
  fita.className = situacao || (estado.rodando ? 'rodando' : '');
}

// O dispatch.js roda fase a fase (lista de todas, depois campanha, depois
// transmissao), entao contar so base concluida deixaria a barra parada por
// minutos. Cada base tambem rende fracao conforme a etapa em que esta.
const PESO_ETAPA = { lista: 0.2, campanha: 0.55, transmissao: 0.85 };

function calcularProgresso() {
  const bases = [...(estado.execucao?.bases.values() || [])];
  if (!bases.length) return 45;

  const feito = bases.reduce((soma, base) => {
    if (base.status && base.status !== 'rodando') return soma + 1;
    if (base.status === 'rodando') return soma + (PESO_ETAPA[base.etapa] || 0.1);
    return soma;
  }, 0);

  return 45 + (55 * feito) / bases.length;
}

// O backend manda detalhe vazio ao entrar em 'rodando'; sem isso a linha ficaria
// so com o titulo enquanto o passo demora.
const ESPERA_PASSO = {
  vpn: 'abrindo socket nos dois bancos...',
  base: 'consultando os bancos e aplicando as regras...',
  disparo: 'abrindo o dashboard...',
};

function marcarPasso(id, status, detalhe) {
  const item = document.querySelector(`.trilha > li[data-passo="${id}"]`);
  if (!item) return;

  item.className = status || '';
  if (status === 'rodando' && !detalhe) detalhe = ESPERA_PASSO[id];
  if (detalhe !== undefined) item.querySelector('.texto > em').textContent = detalhe;

  if (id === 'vpn' && status === 'ok') pintarProgresso(15, '');
  if (id === 'base' && (status === 'ok' || status === 'pulado')) pintarProgresso(45, '');
}

function desenharSubbases(bases) {
  const lista = $('subbases');
  // O evento 'bases' redesenha a lista que ja estava na tela desde o inicio da
  // execucao; so a primeira vez entra em cascata.
  const primeira = !lista.childElementCount;
  lista.innerHTML = '';

  bases.forEach((base, indice) => {
    estado.execucao.bases.set(base.key, { ...base, status: '', etapa: null, duracao: null, detalhe: '' });

    const item = document.createElement('li');
    item.dataset.key = base.key;
    // As cinco linhas entram em cascata, nao todas de uma vez.
    if (primeira) item.style.setProperty('--atraso', `${indice * 70}ms`);
    else item.style.animation = 'none';
    item.innerHTML = `
      <span class="esquerda">
        <strong></strong>
        <span class="etapas"></span>
      </span>
      <span class="situacao"></span>
    `;
    item.querySelector('strong').textContent = rotulo(base.nome);
    lista.appendChild(item);

    pintarSubbase(base.key);
  });
}

function pintarSubbase(key) {
  const dados = estado.execucao?.bases.get(key);
  const item = document.querySelector(`.subbases li[data-key="${key}"]`);
  if (!dados || !item) return;

  item.className = dados.status || '';

  const fases = estado.execucao.fases && estado.execucao.fases.length ? estado.execucao.fases : ETAPAS;
  const etapas = item.querySelector('.etapas');
  if (estado.execucao.dryRun) {
    etapas.innerHTML = '';
  } else if (!dados.contatos) {
    etapas.innerHTML = '<span>CSV vazio</span>';
  } else {
    const atual = fases.indexOf(dados.etapa);
    etapas.innerHTML = fases.map((etapa, indice) => {
      const situacao = dados.status === 'ok' || (atual >= 0 && indice < atual) ? 'ok'
        : indice === atual && dados.status === 'rodando' ? 'rodando'
          : '';
      return `<span class="${situacao}">${etapa}</span>`;
    }).join('');
  }

  const situacao = item.querySelector('.situacao');
  const anterior = situacao.textContent;

  if (estado.execucao.dryRun) situacao.textContent = dados.contatos ? 'prévia' : 'sem contatos';
  else if (dados.status === 'ok') {
    const acao = fases.includes('transmissao') ? (dados.modoEnvio === 'agendado' ? 'agendado' : 'enviado') : 'criado';
    situacao.textContent = `${acao}${dados.duracao ? ` · ${dados.duracao}` : ''}`;
  }
  else if (dados.status === 'erro') situacao.textContent = 'falhou';
  else if (dados.status === 'pulado') situacao.textContent = dados.detalhe || 'pulada';
  else if (dados.status === 'rodando') situacao.textContent = dados.detalhe || ROTULO_ETAPA[dados.etapa] || 'processando';
  else situacao.textContent = dados.contatos ? 'na fila' : 'sem contatos';

  // Texto novo entra com um fade curto em vez de trocar seco.
  if (anterior && anterior !== situacao.textContent) {
    situacao.classList.remove('trocou');
    void situacao.offsetWidth;
    situacao.classList.add('trocou');
  }
}

function atualizarSubbase({ key, status, etapa, detalhe, modo }) {
  const dados = estado.execucao?.bases.get(key);
  if (!dados) return;

  dados.status = status;
  if (etapa) dados.etapa = etapa;
  if (detalhe !== undefined) dados.detalhe = detalhe;
  if (modo) dados.modoEnvio = modo;

  pintarSubbase(key);
  pintarProgresso(calcularProgresso(), '');

  if (status === 'erro' && detalhe) escreverLog(detalhe, 'erro');
}

function atualizarMetrica({ chave, valor, rotulo: rotuloMetrica, por_grupo }) {
  $('cartao-metricas').hidden = false;

  // Primeira metrica de verdade derruba o esqueleto.
  if ($('metricas').querySelector('.esqueleto')) $('metricas').innerHTML = '';

  let item = document.querySelector(`#metricas li[data-chave="${chave}"]`);
  if (!item) {
    item = document.createElement('li');
    item.dataset.chave = chave;
    item.innerHTML = '<span></span><strong></strong>';
    $('metricas').appendChild(item);
  }

  // Metricas de corte aparecem com sinal negativo: sao subtracoes do funil.
  const negativa = ['filtro', 'pagamento_recente_bloqueado'].includes(chave);

  item.querySelector('span').textContent = rotuloMetrica;
  item.querySelector('strong').textContent = `${negativa && valor ? '−' : ''}${numero(valor)}`;
  item.querySelector('strong').className = negativa && valor ? 'menos' : '';

  if (chave === 'filtro') {
    estado.execucao.filtroRemovidos = valor;
    if (por_grupo && Object.keys(por_grupo).length) {
      item.title = Object.entries(por_grupo).map(([grupo, qtd]) => `${grupo}: ${qtd}`).join(' · ');
    }
  }

  item.classList.remove('piscou');
  void item.offsetWidth;
  item.classList.add('piscou');
}

function atualizarTempo({ escopo, chave, key, etapa, duracao }) {
  if (escopo === 'base' && chave === 'transmissao_completa') {
    const dados = estado.execucao?.bases.get(key);
    if (dados) {
      dados.duracao = duracao;
      pintarSubbase(key);
    }
  } else if (escopo === 'fase') {
    $('cartao-tempos').hidden = false;

    let item = document.querySelector(`#tempos-fase li[data-etapa="${etapa}"]`);
    if (!item) {
      item = document.createElement('li');
      item.dataset.etapa = etapa;
      item.innerHTML = '<span></span><strong></strong>';
      $('tempos-fase').appendChild(item);
    }

    item.querySelector('span').textContent = etapa;
    item.querySelector('strong').textContent = duracao;
  } else if (escopo === 'total') {
    estado.execucao.tempoTotal = duracao;
  }
}

function escreverLog(texto, tipo) {
  const alvo = $('log');
  const linha = document.createElement('div');
  if (tipo === 'erro') linha.className = 'erro';
  linha.textContent = texto;
  alvo.appendChild(linha);
  alvo.scrollTop = alvo.scrollHeight;
}

/* ------------------------------------------------ execucao */

async function executar(dryRun) {
  const salvos = await fetch('/api/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lerTemplates()),
  });

  if (!salvos.ok) {
    const erro = await salvos.json().catch(() => ({}));
    alert(erro.detail || 'Não consegui salvar os templates.');
    return;
  }

  estado.rodando = true;
  atualizarResumo();
  prepararExecucao(dryRun);
  irPara('monitorar');

  const parametros = new URLSearchParams({
    hora: $('hora').value,
    modo: estado.modo,
    gerar: $('gerar-base').checked,
    com_relatorio: $('com-relatorio').checked,
    data_inicio: $('data-inicio').value,
    data_fim: $('data-fim').value,
    dry_run: dryRun,
    fases: fasesEscolhidas().join(','),
  });

  const fonte = new EventSource(`/api/executar?${parametros}`);

  fonte.onmessage = (evento) => {
    const { tipo, dado } = JSON.parse(evento.data);

    if (tipo === 'passo') marcarPasso(dado.id, dado.status, dado.detalhe);
    else if (tipo === 'bases') desenharSubbases(dado);
    else if (tipo === 'metrica') atualizarMetrica(dado);
    else if (tipo === 'etapa' && dado.evento === 'base') atualizarSubbase(dado);
    else if (tipo === 'etapa' && dado.evento === 'login') marcarPasso('disparo', 'rodando', dado.status === 'ok' ? 'conectado ao dashboard' : 'entrando no dashboard...');
    else if (tipo === 'etapa' && dado.evento === 'plano') escreverLog(`Plano: ${dado.bases.length} bases${dado.fases && dado.fases.length < 3 ? ` · fases: ${dado.fases.join(', ')}` : ''}`);
    else if (tipo === 'etapa' && dado.evento === 'tempo') atualizarTempo(dado);
    else if (tipo === 'log') escreverLog(String(dado));
    else if (tipo === 'erro') escreverLog(String(dado), 'erro');
    else if (tipo === 'fim') {
      fonte.close();
      encerrar(dado.status);
    }
  };

  fonte.onerror = () => {
    fonte.close();
    escreverLog('Conexão com o servidor caiu.', 'erro');
    encerrar('erro');
  };
}

async function cancelarExecucao() {
  if (!confirm('Cancelar a execução em andamento?\n\nSe o disparo já começou, listas/campanhas já criadas no dashboard podem ficar sem transmissão correspondente.')) return;

  $('btn-cancelar').disabled = true;
  await fetch('/api/cancelar', { method: 'POST' }).catch(() => {});
}

const ICONES_RESULTADO = { ok: '✓', erro: '!', cancelado: '—', 'pre-visualizacao': '◔' };

function encerrar(status) {
  estado.rodando = false;
  estado.execucao.status = status;

  clearInterval(cronometro);
  $('btn-cancelar').hidden = true;
  $('ponto-monitorar').hidden = true;
  $('execucao-titulo').textContent = estado.execucao.dryRun ? 'Pré-visualização concluída' : `Execução encerrada · ${estado.execucao.modo}`;

  for (const item of document.querySelectorAll('.trilha > li.rodando')) {
    item.className = status === 'ok' || status === 'pre-visualizacao' ? 'ok' : status === 'cancelado' ? 'cancelado' : 'erro';
  }

  pintarProgresso(100, status === 'ok' || status === 'pre-visualizacao' ? 'ok' : status === 'erro' ? 'erro' : '');
  desenharResultado(status);
  desenharPorBase();
  desenharArquivos();

  if (status === 'erro') $('bloco-log').open = true;

  $('acoes-fim').hidden = false;
  atualizarResumo();
  carregarUltimaExecucao();
}

function desenharResultado(status) {
  const execucao = estado.execucao;
  const bases = [...execucao.bases.values()];
  const ok = bases.filter((base) => base.status === 'ok');
  const pulados = bases.filter((base) => base.status === 'pulado' || !base.contatos);
  const erros = bases.filter((base) => base.status === 'erro');
  const enviados = ok.reduce((soma, base) => soma + base.contatos, 0);
  const tempo = execucao.tempoTotal ? ` · levou ${execucao.tempoTotal}` : '';
  const semTransmissao = execucao.fases && !execucao.fases.includes('transmissao');

  let titulo = '';
  let sub = '';

  if (status === 'ok') {
    titulo = semTransmissao
      ? `${plural(ok.length, 'base preparada', 'bases preparadas')} · ${execucao.fases.map((fase) => ROTULO_FASE[fase]).join(' + ')}`
      : `${plural(ok.length, 'base', 'bases')} ${execucao.agendado ? `agendadas para ${execucao.hora}` : 'enviadas agora'}`;
    sub = `${plural(enviados, 'contato', 'contatos')}${pulados.length ? ` · ${plural(pulados.length, 'base pulada', 'bases puladas')}` : ''}${tempo}`;
  } else if (status === 'pre-visualizacao') {
    titulo = 'Prévia gerada';
    sub = `${plural(execucao.contatos, 'contato', 'contatos')} seriam disparados. Nenhum CSV gravado, nenhuma mensagem enviada${tempo}`;
  } else if (status === 'cancelado') {
    titulo = 'Execução cancelada';
    sub = `${plural(ok.length, 'base já concluída', 'bases já concluídas')} antes da interrupção — confira o dashboard${tempo}`;
  } else {
    titulo = 'Terminou com erro';
    sub = `${erros.length ? `${plural(erros.length, 'base falhou', 'bases falharam')} · ` : ''}abra o log técnico para ver o que aconteceu${tempo}`;
  }

  const caixa = $('resultado');
  caixa.className = `resultado ${status}`;
  caixa.hidden = false;
  $('resultado-icone').textContent = ICONES_RESULTADO[status] || '!';
  $('resultado-titulo').textContent = titulo;
  $('resultado-sub').textContent = sub;
}

function desenharPorBase() {
  const bases = [...estado.execucao.bases.values()];
  if (!bases.length) return;

  $('cartao-porbase').hidden = false;
  $('porbase-dica').textContent = `${new Date(estado.execucao.inicio).toLocaleDateString('pt-BR')} · alvo ${estado.execucao.hora} · ${estado.execucao.modo}`;

  const semTransmissao = estado.execucao.fases && !estado.execucao.fases.includes('transmissao');

  $('porbase').innerHTML = bases.map((base) => {
    const situacao = base.status || 'pulado';
    const texto = estado.execucao.dryRun ? 'prévia'
      : situacao === 'ok' ? (semTransmissao ? 'criada' : (base.modoEnvio === 'agendado' ? 'agendada' : 'enviada'))
        : situacao;
    const apagada = situacao === 'pulado' ? ' apagado' : '';

    return `
      <tr>
        <td class="${apagada.trim()}">${rotulo(base.nome)}</td>
        <td class="mono${apagada}">${base.contatos ? base.template : '—'}</td>
        <td class="num${apagada}">${numero(base.contatos)}</td>
        <td class="num${apagada}">${base.duracao || '—'}</td>
        <td><span class="marcador-status ${situacao}">${texto}</span></td>
      </tr>`;
  }).join('');
}

function desenharArquivos() {
  const itens = [];

  if (estado.execucao.filtroRemovidos > 0) {
    itens.push(`<a class="opcao acionavel" href="/api/filtro/ultimo-removido"><span>Removidos pelo filtro</span><strong>${numero(estado.execucao.filtroRemovidos)} números · CSV</strong></a>`);
  }

  // Modo teste nunca escreve o relatorio (o backend bloqueia), entao nao anuncia.
  if ($('com-relatorio').checked && !estado.execucao.dryRun && estado.execucao.modo === 'producao') {
    itens.push('<span class="opcao"><span>Relatório Excel</span><strong>pasta relatorio/</strong></span>');
  }

  const linhas = $('log').childElementCount;
  if (linhas) itens.push(`<span class="opcao"><span>Log técnico</span><strong>${plural(linhas, 'linha', 'linhas')}</strong></span>`);

  if (!itens.length) return;

  $('cartao-arquivos').hidden = false;
  $('arquivos').innerHTML = itens.join('');
}

/* ------------------------------------------------ historico */

// O log grava o nome da campanha inteiro ("Contencioso - 25/08/2026 - 16H16");
// data e hora ja tem coluna propria, entao a tabela mostra so a base.
const nomeDaBase = (nome) => rotulo(String(nome || '').replace(/\s*-\s*\d{2}\/\d{2}\/\d{4}\s*-\s*\d{2}H\d{2}\s*$/i, ''));

// hora_execucao vem em ISO do node; na tabela basta o relogio local.
function horaCurta(valor) {
  const momento = new Date(valor);

  return Number.isNaN(momento.getTime())
    ? valor || '—'
    : momento.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

async function carregarHistorico() {
  const parametros = new URLSearchParams({
    limite: $('historico-limite').value,
    busca: $('historico-busca').value || '',
    status: $('historico-status').value || '',
    modo: $('historico-modo').value || '',
  });

  const linhas = await fetch(`/api/historico?${parametros}`).then((r) => r.json()).catch(() => []);
  const corpo = $('historico');

  $('historico-contadores').innerHTML = `
    <div><strong>${numero(linhas.length)}</strong><span>linhas</span></div>
    <div><strong>${numero(linhas.filter((linha) => linha.status === 'ok').length)}</strong><span>ok</span></div>
    <div><strong>${numero(linhas.filter((linha) => linha.status === 'erro').length)}</strong><span>com erro</span></div>
  `;

  if (!linhas.length) {
    corpo.innerHTML = '<tr><td colspan="7" class="apagado">Nenhum disparo registrado com esses filtros.</td></tr>';
    return;
  }

  corpo.innerHTML = linhas.map((linha) => `
    <tr>
      <td class="mono">${linha.data || ''}</td>
      <td class="mono">${linha.hora_alvo || ''}</td>
      <td>${nomeDaBase(linha.nome || linha.tipo || '')}</td>
      <td class="apagado">${linha.modo && linha.modo !== '-' ? linha.modo : '—'}</td>
      <td class="mono apagado">${horaCurta(linha.hora_execucao)}</td>
      <td><span class="marcador-status ${linha.status}">${linha.status}</span></td>
      <td class="${linha.status === 'erro' ? 'detalhe-erro' : 'apagado'}">${linha.detalhe || '—'}</td>
    </tr>`).join('');
}

async function carregarUltimaExecucao() {
  const linhas = await fetch('/api/historico?limite=1').then((r) => r.json()).catch(() => []);
  estado.ultimaExecucao = linhas.length ? `${linhas[0].data} ${linhas[0].hora_alvo}` : null;
  atualizarResumo();
}

/* ------------------------------------------------ agenda */

const ROTULO_SITUACAO = {
  agendado: 'agendado',
  pendente: 'disparando em breve',
  disparado: 'disparado',
  erro: 'falhou',
  cancelado: 'cancelado',
  perdido: 'perdido',
  desativado: 'desativado',
};

let pollAgenda = null;

function entrarAgenda() {
  if (!$('agenda-data').value) $('agenda-data').value = new Date().toISOString().slice(0, 10);
  carregarGruposAgenda();
  carregarAgenda();
  atualizarStatusAgenda();

  clearInterval(pollAgenda);
  pollAgenda = setInterval(() => {
    atualizarStatusAgenda();
    if (!estado.agenda.sujo) carregarAgenda();
  }, 15000);
}

function pararPollAgenda() {
  clearInterval(pollAgenda);
  pollAgenda = null;
}

// Os grupos de template (amigavel/contencioso) e o numero atual de cada um saem
// do dispatches.json; e a mesma divisao dos steppers da aba Preparar.
async function carregarGruposAgenda() {
  const templates = await fetch('/api/templates').then((r) => r.json()).catch(() => null);
  if (!templates) return;

  const grupos = [];
  for (const base of templates) {
    const chave = base.grupo || base.key.split('_')[0];
    if (!grupos.some((g) => g.grupo === chave)) {
      grupos.push({ grupo: chave, rotulo: GRUPOS[chave] || chave, numero: base.template_numero || '01' });
    }
  }

  estado.agenda.grupos = grupos;
  $('agenda-add-tpl').innerHTML = grupos.map((g) => `
    <label>${g.rotulo}<input type="text" inputmode="numeric" maxlength="3" data-grupo="${g.grupo}" value="${g.numero}"></label>
  `).join('');
  desenharAgenda();
}

const templatesPadrao = () =>
  Object.fromEntries((estado.agenda.grupos || []).map((g) => {
    const campo = $('agenda-add-tpl').querySelector(`input[data-grupo="${g.grupo}"]`);
    return [g.grupo, (campo?.value || g.numero || '').trim()];
  }));

async function carregarAgenda() {
  const dados = await fetch('/api/agenda').then((r) => r.json()).catch(() => null);
  if (!dados) return;

  estado.agenda = { ...estado.agenda, itens: dados.itens || [], modo: dados.modo || 'teste', sujo: false };
  pintarModoAgenda(estado.agenda.modo);
  desenharAgenda();
}

function pintarModoAgenda(modo) {
  for (const botao of document.querySelectorAll('#agenda-segmento-modo button')) {
    botao.classList.toggle('ativo', botao.dataset.modo === modo);
  }
  $('agenda-aviso-modo').hidden = modo !== 'producao';
}

async function definirModoAgenda(modo) {
  if (modo === estado.agenda.modo) return;

  if (modo === 'producao' && !confirm('Modo produção: cada horário da agenda vai gerar a base e ENVIAR para os clientes reais.\n\nConfirmar?')) {
    return;
  }

  const resposta = await fetch('/api/agenda/modo', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ modo }),
  }).catch(() => null);

  if (!resposta || !resposta.ok) return alert('Não consegui trocar o modo dos disparos automáticos.');

  const dados = await resposta.json();
  estado.agenda = { ...estado.agenda, modo: dados.modo };
  pintarModoAgenda(dados.modo);
}

const dataBR = (iso) => (iso || '').split('-').reverse().join('/');

function marcarAgendaSuja() {
  estado.agenda.sujo = true;
  $('agenda-acoes').hidden = false;
  $('agenda-dica').textContent = 'mudanças não salvas';
}

function celulaTemplates(item) {
  return (estado.agenda.grupos || []).map((g) => `
    <label>${g.rotulo}<input type="text" inputmode="numeric" maxlength="3"
      data-grupo="${g.grupo}" value="${(item.templates && item.templates[g.grupo]) || ''}"></label>
  `).join('');
}

function desenharAgenda() {
  const { itens, sujo } = estado.agenda;
  const corpo = $('agenda-linhas');

  if (!itens.length) {
    corpo.innerHTML = '<tr><td colspan="6" class="apagado">Nenhum horário na agenda. Adicione data e hora acima.</td></tr>';
  } else {
    corpo.innerHTML = itens.map((item) => {
      const situacao = item.ativo ? item.situacao : 'desativado';
      const rearmavel = !sujo && (situacao === 'erro' || situacao === 'perdido' || situacao === 'cancelado');
      const detalhe = item.detalhe || (item.quando ? `em ${horaCurta(item.quando)}` : '—');

      return `
        <tr data-id="${item.id}" class="${item.ativo ? '' : 'linha-off'}">
          <td class="mono">${dataBR(item.data)}</td>
          <td class="mono">${item.hora}</td>
          <td class="tpl-cel">${celulaTemplates(item)}</td>
          <td><span class="marcador-status ${situacao}">${ROTULO_SITUACAO[situacao] || situacao}</span></td>
          <td class="apagado">${detalhe}</td>
          <td class="acoes-col">
            <button type="button" class="link-mini" data-acao="toggle">${item.ativo ? 'desativar' : 'ativar'}</button>
            ${rearmavel ? '<button type="button" class="link-mini" data-acao="rearmar">re-armar</button>' : ''}
            <button type="button" class="link-mini perigo" data-acao="remover">remover</button>
          </td>
        </tr>`;
    }).join('');

    for (const linha of corpo.querySelectorAll('tr[data-id]')) {
      const id = linha.dataset.id;

      for (const botao of linha.querySelectorAll('button[data-acao]')) {
        botao.onclick = () => acaoAgenda(botao.dataset.acao, id);
      }

      // oninput nao redesenha (perderia o foco); so atualiza o modelo.
      for (const campo of linha.querySelectorAll('.tpl-cel input')) {
        campo.oninput = () => {
          const item = estado.agenda.itens.find((i) => i.id === id);
          if (!item) return;
          item.templates = { ...item.templates, [campo.dataset.grupo]: campo.value.trim() };
          marcarAgendaSuja();
        };
      }
    }
  }

  $('agenda-acoes').hidden = !sujo;
  $('agenda-dica').textContent = sujo
    ? 'mudanças não salvas'
    : `${plural(itens.filter((i) => i.ativo).length, 'horário ativo', 'horários ativos')}`;
}

function acaoAgenda(acao, id) {
  if (acao === 'rearmar') return rearmarItem(id);

  const item = estado.agenda.itens.find((i) => i.id === id);
  if (!item) return;

  if (acao === 'toggle') item.ativo = !item.ativo;
  else if (acao === 'remover') estado.agenda.itens = estado.agenda.itens.filter((i) => i.id !== id);

  estado.agenda.sujo = true;
  desenharAgenda();
}

function adicionarHorario() {
  const data = $('agenda-data').value;
  const hora = $('agenda-hora').value;
  if (!data || !hora) return alert('Escolha data e hora.');

  const id = `${data} ${hora}`;
  if (estado.agenda.itens.some((i) => i.id === id)) return alert('Esse horário já está na agenda.');

  const templates = templatesPadrao();
  if (Object.values(templates).some((n) => !n)) return alert('Preencha o número de template de cada grupo.');

  estado.agenda.itens.push({ id, data, hora, ativo: true, templates, situacao: 'agendado', quando: null, detalhe: '' });
  estado.agenda.itens.sort((a, b) => a.id.localeCompare(b.id));
  estado.agenda.sujo = true;
  $('agenda-hora').value = '';
  desenharAgenda();
}

async function salvarAgenda() {
  const corpo = {
    modo: estado.agenda.modo,
    itens: estado.agenda.itens.map(({ data, hora, ativo, templates }) => ({ data, hora, ativo, templates })),
  };

  const resposta = await fetch('/api/agenda', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    const erro = await resposta.json().catch(() => ({}));
    return alert(erro.detail || 'Não consegui salvar a agenda.');
  }

  const dados = await resposta.json();
  estado.agenda = { ...estado.agenda, itens: dados.itens || [], modo: dados.modo || estado.agenda.modo, sujo: false };
  pintarModoAgenda(estado.agenda.modo);
  desenharAgenda();
  atualizarStatusAgenda();
}

async function rearmarItem(id) {
  if (!confirm(`Re-armar ${id}?\n\nO disparo vai acontecer de novo se o horário ainda estiver dentro da janela de tolerância.`)) return;

  const resposta = await fetch('/api/agenda/rearmar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => null);

  if (!resposta || !resposta.ok) return alert('Não consegui re-armar o item.');

  const dados = await resposta.json();
  estado.agenda = { ...estado.agenda, itens: dados.itens || [], modo: dados.modo || estado.agenda.modo, sujo: false };
  desenharAgenda();
}

async function atualizarStatusAgenda() {
  const status = await fetch('/api/agenda/status').then((r) => r.json()).catch(() => null);
  if (!status) return;

  if (!estado.agenda.sujo && status.modo && status.modo !== estado.agenda.modo) {
    estado.agenda.modo = status.modo;
    pintarModoAgenda(status.modo);
  }

  if (status.em_execucao) {
    $('agenda-proximo-hora').textContent = 'agora';
    $('agenda-proximo-quando').textContent = `disparo automático rodando · ${status.em_execucao.modo || ''} (${status.em_execucao.id})`;
  } else if (status.proximo) {
    const min = status.proximo.em_minutos;
    $('agenda-proximo-hora').textContent = status.proximo.hora;
    $('agenda-proximo-quando').textContent = `${dataBR(status.proximo.data)} · ${
      min < 60 ? `em ${min} min` : `em ${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
    }`;
  } else {
    $('agenda-proximo-hora').textContent = '—';
    $('agenda-proximo-quando').textContent = 'nenhum disparo agendado';
  }

  $('agenda-status-lista').innerHTML = [
    ['Agendador', status.ligado ? 'ligado' : 'parado', !status.ligado],
    ['Modo', status.modo === 'producao' ? 'produção' : 'teste', status.modo === 'producao'],
    ['Servidor desde', status.desde ? horaCurta(status.desde) : '—', false],
    ['Atraso tolerado', `${status.tolerancia_min} min`, false],
  ].map(([rot, val, alerta]) => `<div><dt>${rot}</dt><dd class="${alerta ? 'destaque' : ''}">${val}</dd></div>`).join('');
}

/* ------------------------------------------------ boot */

async function iniciar() {
  aplicarTema(localStorage.getItem('tema') || '');

  const periodo = await fetch('/api/periodo-padrao').then((r) => r.json());
  $('data-inicio').value = periodo.data_inicio;
  $('data-fim').value = periodo.data_fim;

  definirHora(new Date(Date.now() + 15 * 60 * 1000));

  for (const botao of document.querySelectorAll('.nav-item')) {
    botao.onclick = () => irPara(botao.dataset.aba);
  }

  for (const botao of document.querySelectorAll('[data-ir]')) {
    botao.onclick = () => irPara(botao.dataset.ir);
  }

  $('tpl-salvar').onclick = salvarTemplates;
  $('tpl-descartar').onclick = () => carregarBases();

  window.onhashchange = () => irPara(location.hash.replace('#', ''));

  for (const botao of document.querySelectorAll('#segmento-modo button')) {
    botao.onclick = () => !estado.rodando && trocarModo(botao.dataset.modo);
  }

  $('btn-tema').onclick = alternarTema;
  $('chip-vpn').onclick = verificarVpn;
  $('btn-filtro').onclick = abrirModalFiltro;
  $('btn-cancelar').onclick = cancelarExecucao;

  $('hora').oninput = atualizarResumo;
  $('gerar-base').onchange = atualizarResumo;
  for (const campo of document.querySelectorAll('.fase')) campo.onchange = atualizarResumo;

  for (const botao of $('atalhos-hora').querySelectorAll('button')) {
    botao.onclick = () => {
      if (botao.dataset.hora) {
        $('hora').value = botao.dataset.hora;
        atualizarResumo();
      } else {
        definirHora(new Date(Date.now() + Number(botao.dataset.minutos) * 60 * 1000));
      }
    };
  }

  $('btn-revisar').onclick = () => abrirRevisao(false);
  $('btn-previa').onclick = () => abrirRevisao(true);
  $('btn-voltar-ajustar').onclick = fecharRevisao;

  const confirmar = $('btn-confirmar');
  confirmar.onpointerdown = (evento) => { evento.preventDefault(); confirmar.classList.contains('simples') ? acionarConfirmacao() : iniciarSegurar(); };
  confirmar.onpointerup = abortarSegurar;
  confirmar.onpointerleave = abortarSegurar;
  confirmar.onpointercancel = abortarSegurar;
  confirmar.onkeydown = (evento) => {
    if (evento.repeat || (evento.key !== ' ' && evento.key !== 'Enter')) return;
    evento.preventDefault();
    confirmar.classList.contains('simples') ? acionarConfirmacao() : iniciarSegurar();
  };
  confirmar.onkeyup = abortarSegurar;

  for (const botao of document.querySelectorAll('[data-fechar]')) {
    botao.onclick = () => $(botao.dataset.fechar).classList.remove('aberto');
  }

  for (const overlay of document.querySelectorAll('.modal-overlay')) {
    overlay.onclick = (evento) => { if (evento.target === overlay) overlay.classList.remove('aberto'); };
  }

  $('painel-revisao').onclick = (evento) => { if (evento.target === $('painel-revisao')) fecharRevisao(); };

  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    if (!$('painel-revisao').hidden) fecharRevisao();
    for (const overlay of document.querySelectorAll('.modal-overlay.aberto')) overlay.classList.remove('aberto');
  });

  $('agenda-add').onclick = adicionarHorario;
  $('agenda-salvar').onclick = salvarAgenda;
  $('agenda-descartar').onclick = carregarAgenda;

  for (const botao of document.querySelectorAll('#agenda-segmento-modo button')) {
    botao.onclick = () => definirModoAgenda(botao.dataset.modo);
  }

  $('historico-busca').oninput = debounce(carregarHistorico, 250);
  $('historico-status').onchange = carregarHistorico;
  $('historico-modo').onchange = carregarHistorico;
  $('historico-limite').onchange = carregarHistorico;

  trocarModo('producao');
  carregarFiltro();
  carregarUltimaExecucao();
  verificarVpn();
  irPara(location.hash.replace('#', '') || 'preparar');
}

iniciar();
