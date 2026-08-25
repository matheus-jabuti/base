const $ = (id) => document.getElementById(id);

const estado = {
  bases: [],
  modo: 'producao',
  rodando: false,
  tempoTotal: null,
  filtroRemovidos: 0,
  filtroNumeros: [],
};

// A VPN as vezes demora a subir; tenta de novo antes de acusar erro.
const VPN_TENTATIVAS = 3;
const VPN_ESPERA_MS = 1500;

const GRUPOS = {
  amigavel: 'Amigável',
  contencioso: 'Contencioso',
};

const ETAPAS = {
  lista: 'criando lista',
  campanha: 'criando campanha',
  transmissao: 'criando transmissão',
};

const total = () => estado.bases.reduce((soma, base) => soma + base.contatos, 0);
const numero = (valor) => valor.toLocaleString('pt-BR');
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
  const curto = nome.replace(/^Disparo /, '');
  return curto.charAt(0).toUpperCase() + curto.slice(1);
};

/* ------------------------------------------------ vpn */

function pintarVpn(situacao, texto, comBotao) {
  const faixa = $('faixa-vpn');
  faixa.hidden = false;
  faixa.className = `faixa vpn ${situacao}`;
  $('vpn-texto').textContent = texto;
  $('btn-vpn').hidden = !comBotao;
}

// Confere a VPN ao abrir a tela: ate 3 tentativas, parando na primeira que der certo.
async function verificarVpn() {
  let motivo = '';

  for (let tentativa = 1; tentativa <= VPN_TENTATIVAS; tentativa++) {
    pintarVpn('checando', `Conferindo a VPN — tentativa ${tentativa} de ${VPN_TENTATIVAS}...`, false);

    try {
      const resposta = await fetch('/api/vpn').then((r) => r.json());

      if (resposta.ok) {
        pintarVpn('ok', `VPN conectada — ${plural(resposta.conexoes.length, 'banco respondendo', 'bancos respondendo')}.`, false);
        return true;
      }

      motivo = resposta.conexoes.filter((c) => !c.ok).map((c) => `${c.nome}: ${c.erro}`).join(' · ');
    } catch (erro) {
      motivo = String(erro);
    }

    if (tentativa < VPN_TENTATIVAS) await new Promise((pronto) => setTimeout(pronto, VPN_ESPERA_MS));
  }

  pintarVpn('erro', `VPN fora do ar depois de ${VPN_TENTATIVAS} tentativas. Conecte a VPN da empresa antes de disparar. ${motivo}`, true);
  return false;
}

/* ------------------------------------------------ menu */

async function carregarBases() {
  estado.bases = await fetch(`/api/bases?modo=${estado.modo}`).then((r) => r.json());
  desenharTipos();
}

// As bases do mesmo grupo sempre saem com o mesmo numero de template, entao a
// tela edita um numero por grupo — cada base mantem o proprio prefixo.
function agruparBases() {
  const grupos = [];

  for (const base of estado.bases) {
    // Sem o campo grupo (servidor antigo), o prefixo da key ja separa amigavel de contencioso.
    const chave = base.grupo || base.key.split('_')[0];
    let grupo = grupos.find((item) => item.grupo === chave);

    if (!grupo) {
      grupo = { grupo: chave, rotulo: GRUPOS[chave] || rotulo(base.nome), bases: [] };
      grupos.push(grupo);
    }

    grupo.bases.push(base);
  }

  return grupos;
}

function desenharTipos() {
  const lista = $('tipos');
  lista.innerHTML = '';

  for (const grupo of agruparBases()) {
    const contatos = grupo.bases.reduce((soma, base) => soma + base.contatos, 0);
    const prefixos = [...new Set(grupo.bases.map((base) => base.template.replace(/_\d{1,3}$/, '')))];
    const num = grupo.bases[0].template.match(/_(\d{1,3})$/)?.[1] || '';

    const item = document.createElement('li');
    item.innerHTML = `
      <div class="tipo-nome">
        <strong></strong>
        <em></em>
      </div>
      <span class="contagem${contatos ? '' : ' zero'}"></span>
      <div class="stepper">
        <button type="button" data-passo="-1" aria-label="Diminuir">−</button>
        <input type="text" inputmode="numeric" maxlength="3" data-grupo="${grupo.grupo}" aria-label="Número do template">
        <button type="button" data-passo="1" aria-label="Aumentar">+</button>
      </div>
    `;

    item.querySelector('strong').textContent = grupo.rotulo;
    item.querySelector('em').textContent = prefixos.join(' · ');

    const contagem = item.querySelector('.contagem');
    contagem.textContent = grupo.bases.some((base) => base.existe) ? plural(contatos, 'contato', 'contatos') : 'sem CSV';
    contagem.title = grupo.bases.map((base) => `${rotulo(base.nome)}: ${numero(base.contatos)}`).join('\n');

    const campo = item.querySelector('input');
    campo.value = num;

    const max = grupo.grupo === 'contencioso' ? 10 : 7;

    for (const botao of item.querySelectorAll('.stepper button')) {
      botao.onclick = () => {
        let atual = Number(campo.value || 0) + Number(botao.dataset.passo);
        if (atual > max) atual = 1;
        if (atual < 1) atual = max;
        campo.value = String(atual).padStart(2, '0');
      };
    }

    lista.appendChild(item);
  }

  atualizarLancamento();
}

function lerTemplates() {
  const numeros = {};

  for (const campo of document.querySelectorAll('.stepper input')) {
    numeros[campo.dataset.grupo] = campo.value.trim();
  }

  return estado.bases.map((base) => ({
    key: base.key,
    template_prefix: base.template.replace(/_\d{1,3}$/, ''),
    template_numero: numeros[base.grupo || base.key.split('_')[0]] || '',
  }));
}

// Espelha o decideMode do dispatch.js: com mais de ~2min de folga o disparo é
// agendado; abaixo disso a plataforma manda na hora.
function agendado() {
  const [hh, mm] = ($('hora').value || '').split(':').map(Number);
  if (Number.isNaN(hh)) return null;

  const alvo = new Date();
  alvo.setHours(hh, mm, 0, 0);

  return alvo.getTime() - Date.now() > 2 * 60 * 1000;
}

function atualizarLancamento() {
  const contatos = total();
  const agenda = agendado();

  const modoHora = $('hora-modo');
  modoHora.textContent = agenda === null ? '' : agenda ? 'agendado' : 'envio imediato';
  modoHora.classList.toggle('imediato', agenda === false);

  const semContatos = estado.rodando || !contatos || !$('hora').value;
  $('btn-disparar').disabled = semContatos;

  const cheias = estado.bases.filter((base) => base.contatos).length;
  $('btn-disparar-nota').textContent = contatos
    ? `${plural(contatos, 'contato', 'contatos')} em ${plural(cheias, 'base', 'bases')}`
    : 'nenhum contato nos CSVs atuais';
}

function trocarModo(modo) {
  estado.modo = modo;
  document.body.className = `modo-${modo}`;

  for (const botao of document.querySelectorAll('#segmento-modo button')) {
    botao.classList.toggle('ativo', botao.dataset.modo === modo);
  }

  const faixa = $('faixa-modo');
  faixa.className = `faixa ${modo}`;
  faixa.textContent = modo === 'teste'
    ? 'Modo teste — dispara as bases de 1 contato em auto/bases/. Nada chega a cliente real.'
    : 'Modo produção — as mensagens vão para os clientes reais da base gerada.';

  carregarBases();
}

/* ------------------------------------------------ filtro manual */

async function carregarFiltro() {
  const dados = await fetch('/api/filtro').then((r) => r.json()).catch(() => null);
  if (!dados) return;

  estado.filtroNumeros = dados.numeros || [];

  $('filtro-contagem').textContent = dados.telefones
    ? plural(dados.telefones, 'telefone único no filtro', 'telefones únicos no filtro')
    : 'Nenhum telefone no filtro.';

  const lista = $('filtro-arquivos');
  lista.innerHTML = dados.arquivos.length
    ? dados.arquivos.map((arquivo) => `<li>${arquivo.nome}</li>`).join('')
    : '<li class="vazio">Nenhum arquivo em filtros/</li>';
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

function abrirModalNumerosFiltro() {
  const lista = $('filtro-numeros');
  lista.innerHTML = estado.filtroNumeros.length
    ? estado.filtroNumeros.map(({ telefone, nome }) => `
        <li>
          <span class="tel">${formatarTelefone(telefone)}</span>
          <span class="nome">${nome || '—'}</span>
        </li>
      `).join('')
    : '<li class="vazio">Nenhum telefone no filtro.</li>';

  $('modal-filtro-numeros').classList.add('aberto');
}

function fecharModalNumerosFiltro() {
  $('modal-filtro-numeros').classList.remove('aberto');
}

/* ------------------------------------------------ progresso */

function trocarView(qual) {
  $('view-menu').hidden = qual !== 'menu';
  $('view-progresso').hidden = qual !== 'progresso';
  $('subtitulo').textContent = qual === 'menu' ? 'Escolha os templates e o horário' : 'Disparo em andamento';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function marcarPasso(id, status, detalhe) {
  const item = document.querySelector(`.trilha > li[data-passo="${id}"]`);
  if (!item) return;

  item.className = status || '';
  if (detalhe !== undefined) item.querySelector('.texto > em').textContent = detalhe;
}

function prepararTrilha() {
  for (const item of document.querySelectorAll('.trilha > li')) {
    item.className = '';
    item.querySelector('.texto > em').textContent = '';
  }

  $('subbases').innerHTML = '';
  $('resultado').hidden = true;
  $('resultado-extra').innerHTML = '';
  $('log').textContent = '';
  $('bloco-log').open = false;
  $('btn-voltar').hidden = true;

  $('cartao-metricas').hidden = true;
  $('metricas').innerHTML = '';
  $('cartao-tempos').hidden = true;
  $('tempos-fase').innerHTML = '';

  estado.tempoTotal = null;
  estado.filtroRemovidos = 0;

  $('btn-cancelar').hidden = false;
  $('btn-cancelar').disabled = false;
}

function desenharSubbases(bases) {
  const lista = $('subbases');
  lista.innerHTML = '';

  for (const base of bases) {
    const item = document.createElement('li');
    item.dataset.key = base.key;
    item.innerHTML = '<span class="marcador"></span><span class="nome"></span><span class="estado"></span>';
    item.querySelector('.nome').textContent = rotulo(base.nome);
    item.querySelector('.estado').textContent = `${numero(base.contatos)} · ${base.template}`;
    lista.appendChild(item);
  }
}

function atualizarSubbase({ key, status, etapa, detalhe, modo }) {
  const item = document.querySelector(`.subbases li[data-key="${key}"]`);
  if (!item) return;

  item.className = status;
  const estado_ = item.querySelector('.estado');

  if (status === 'rodando') estado_.textContent = detalhe || ETAPAS[etapa] || 'processando';
  else if (status === 'ok') estado_.textContent = modo === 'agendado' ? 'agendado' : 'enviado';
  else if (status === 'pulado') estado_.textContent = detalhe || 'pulado';
  else if (status === 'erro') estado_.textContent = 'falhou';

  if (status === 'erro' && detalhe) escreverLog(detalhe, 'erro');
}

function atualizarMetrica({ chave, valor, rotulo: rotuloMetrica, por_grupo }) {
  $('cartao-metricas').hidden = false;

  let item = document.querySelector(`#metricas li[data-chave="${chave}"]`);
  if (!item) {
    item = document.createElement('li');
    item.dataset.chave = chave;
    item.innerHTML = '<span class="rotulo"></span><strong></strong>';
    $('metricas').appendChild(item);
  }

  item.querySelector('.rotulo').textContent = rotuloMetrica;
  item.querySelector('strong').textContent = numero(valor);

  if (chave === 'filtro') {
    estado.filtroRemovidos = valor;
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
    const item = document.querySelector(`.subbases li[data-key="${key}"]`);
    if (item) item.querySelector('.estado').title = `Levou ${duracao}`;
  } else if (escopo === 'fase') {
    $('cartao-tempos').hidden = false;
    let item = document.querySelector(`#tempos-fase li[data-etapa="${etapa}"]`);
    if (!item) {
      item = document.createElement('li');
      item.dataset.etapa = etapa;
      $('tempos-fase').appendChild(item);
    }
    item.textContent = `${etapa}: ${duracao}`;
  } else if (escopo === 'total') {
    estado.tempoTotal = duracao;
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

async function disparar({ dryRun = false } = {}) {
  const salvos = await fetch('/api/templates', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lerTemplates()),
  });

  if (!salvos.ok) {
    const erro = await salvos.json();
    alert(erro.detail || 'Não consegui salvar os templates.');
    return;
  }

  const quando = agendado() ? `agendar para ${$('hora').value}` : `enviar agora (${$('hora').value})`;
  const aviso = dryRun
    ? 'Rodar uma pré-visualização (sem gravar CSVs nem disparar)?'
    : estado.modo === 'producao'
      ? `Disparar ${numero(total())} contatos REAIS?\n\nVai ${quando}.`
      : `Rodar o disparo de teste?\n\nVai ${quando}.`;

  if (!confirm(aviso)) return;

  estado.rodando = true;
  atualizarLancamento();
  prepararTrilha();
  trocarView('progresso');

  const parametros = new URLSearchParams({
    hora: $('hora').value,
    modo: estado.modo,
    gerar: $('gerar-base').checked,
    com_relatorio: $('com-relatorio').checked,
    data_inicio: $('data-inicio').value,
    data_fim: $('data-fim').value,
    dry_run: dryRun,
  });

  const fonte = new EventSource(`/api/executar?${parametros}`);

  fonte.onmessage = (evento) => {
    const { tipo, dado } = JSON.parse(evento.data);

    if (tipo === 'passo') marcarPasso(dado.id, dado.status, dado.detalhe);
    else if (tipo === 'bases') desenharSubbases(dado);
    else if (tipo === 'metrica') atualizarMetrica(dado);
    else if (tipo === 'etapa' && dado.evento === 'base') atualizarSubbase(dado);
    else if (tipo === 'etapa' && dado.evento === 'login') marcarPasso('disparo', 'rodando', dado.status === 'ok' ? 'conectado ao dashboard' : 'entrando no dashboard...');
    else if (tipo === 'etapa' && dado.evento === 'plano') escreverLog(`Plano: ${dado.bases.length} bases`);
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

const TEXTOS_RESULTADO = {
  ok: ['Tudo certo', 'Os disparos foram criados no dashboard.'],
  erro: ['Terminou com erro', 'Abra o log técnico abaixo para ver o que falhou.'],
  cancelado: ['Execução cancelada', 'A execução foi interrompida a pedido.'],
  'pre-visualizacao': ['Prévia gerada', 'Nenhum CSV foi gravado nem mensagem enviada.'],
};

function encerrar(status) {
  estado.rodando = false;
  $('btn-cancelar').hidden = true;

  for (const item of document.querySelectorAll('.trilha > li.rodando')) {
    item.className = status === 'ok' || status === 'pre-visualizacao' ? 'ok' : status === 'cancelado' ? 'cancelado' : 'erro';
  }

  const [titulo, texto] = TEXTOS_RESULTADO[status] || TEXTOS_RESULTADO.erro;

  const caixa = $('resultado');
  caixa.className = `resultado ${status}`;
  caixa.hidden = false;
  caixa.innerHTML = '<strong></strong><span></span>';
  caixa.querySelector('strong').textContent = titulo;
  caixa.querySelector('span').textContent = texto + (estado.tempoTotal ? ` (${estado.tempoTotal})` : '');

  if (status === 'erro') $('bloco-log').open = true;

  const extra = $('resultado-extra');
  extra.innerHTML = '';
  if (estado.filtroRemovidos > 0) {
    const link = document.createElement('a');
    link.href = '/api/filtro/ultimo-removido';
    link.textContent = 'Baixar números removidos pelo filtro (CSV)';
    extra.appendChild(link);
  }

  $('btn-voltar').hidden = false;
  carregarHistorico();
}

const HISTORICO_RECENTES = 5;

function desenharHistorico(idCorpo, linhas) {
  const corpo = $(idCorpo);
  corpo.innerHTML = '';

  if (!linhas.length) {
    corpo.innerHTML = '<tr><td colspan="5">Nenhum disparo registrado.</td></tr>';
    return;
  }

  for (const linha of linhas) {
    const item = document.createElement('tr');
    item.innerHTML = '<td></td><td></td><td></td><td></td><td></td>';
    const celulas = item.children;
    celulas[0].textContent = linha.data;
    celulas[1].textContent = linha.hora_alvo;
    celulas[2].textContent = linha.tipo;
    celulas[3].textContent = linha.modo;
    celulas[4].textContent = linha.status;
    celulas[4].className = `st-${linha.status}`;
    celulas[4].title = linha.detalhe || '';
    corpo.appendChild(item);
  }
}

// Card lateral: so os ultimos 5, sem filtro — pra ver mais e filtrar, o botao
// abre o modal com a lista inteira.
async function carregarHistorico() {
  const linhas = await fetch(`/api/historico?limite=${HISTORICO_RECENTES}`).then((r) => r.json());
  desenharHistorico('historico', linhas);
}

async function carregarHistoricoModal() {
  const parametros = new URLSearchParams({
    limite: 200,
    busca: $('historico-busca')?.value || '',
    status: $('historico-status')?.value || '',
  });

  const linhas = await fetch(`/api/historico?${parametros}`).then((r) => r.json());
  desenharHistorico('historico-modal', linhas);
}

function abrirModalHistorico() {
  $('modal-historico').classList.add('aberto');
  carregarHistoricoModal();
}

function fecharModalHistorico() {
  $('modal-historico').classList.remove('aberto');
}

/* ------------------------------------------------ boot */

async function iniciar() {
  const periodo = await fetch('/api/periodo-padrao').then((r) => r.json());
  $('data-inicio').value = periodo.data_inicio;
  $('data-fim').value = periodo.data_fim;

  const agora = new Date(Date.now() + 15 * 60 * 1000);
  $('hora').value = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

  for (const botao of document.querySelectorAll('#segmento-modo button')) {
    botao.onclick = () => !estado.rodando && trocarModo(botao.dataset.modo);
  }

  $('btn-vpn').onclick = verificarVpn;
  $('btn-disparar').onclick = () => disparar();
  $('btn-cancelar').onclick = cancelarExecucao;
  $('btn-voltar').onclick = () => { trocarView('menu'); carregarBases(); };
  $('hora').oninput = atualizarLancamento;
  $('gerar-base').onchange = atualizarLancamento;

  $('bloco-filtro').addEventListener('toggle', () => { if ($('bloco-filtro').open) carregarFiltro(); });
  $('btn-ver-numeros-filtro').onclick = abrirModalNumerosFiltro;
  $('btn-fechar-modal-filtro').onclick = fecharModalNumerosFiltro;

  $('btn-ver-historico').onclick = abrirModalHistorico;
  $('btn-fechar-modal-historico').onclick = fecharModalHistorico;
  $('historico-busca').oninput = debounce(carregarHistoricoModal, 250);
  $('historico-status').onchange = carregarHistoricoModal;

  for (const overlay of document.querySelectorAll('.modal-overlay')) {
    overlay.onclick = (evento) => { if (evento.target === overlay) overlay.classList.remove('aberto'); };
  }
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape') return;
    for (const overlay of document.querySelectorAll('.modal-overlay.aberto')) overlay.classList.remove('aberto');
  });

  trocarModo('producao');
  carregarFiltro();
  carregarHistorico();
  verificarVpn();
}

iniciar();
