const $ = (id) => document.getElementById(id);

const estado = {
  bases: [],
  modo: 'producao',
  rodando: false,
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

  const botao = $('btn-disparar');
  botao.disabled = estado.rodando || !contatos || !$('hora').value;
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
  $('log').textContent = '';
  $('bloco-log').open = false;
  $('btn-voltar').hidden = true;
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

function escreverLog(texto, tipo) {
  const alvo = $('log');
  const linha = document.createElement('div');
  if (tipo === 'erro') linha.className = 'erro';
  linha.textContent = texto;
  alvo.appendChild(linha);
  alvo.scrollTop = alvo.scrollHeight;
}

/* ------------------------------------------------ execucao */

async function disparar() {
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
  const aviso = estado.modo === 'producao'
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
  });

  const fonte = new EventSource(`/api/executar?${parametros}`);

  fonte.onmessage = (evento) => {
    const { tipo, dado } = JSON.parse(evento.data);

    if (tipo === 'passo') marcarPasso(dado.id, dado.status, dado.detalhe);
    else if (tipo === 'bases') desenharSubbases(dado);
    else if (tipo === 'etapa' && dado.evento === 'base') atualizarSubbase(dado);
    else if (tipo === 'etapa' && dado.evento === 'login') marcarPasso('disparo', 'rodando', dado.status === 'ok' ? 'conectado ao dashboard' : 'entrando no dashboard...');
    else if (tipo === 'etapa' && dado.evento === 'plano') escreverLog(`Plano: ${dado.bases.length} bases`);
    else if (tipo === 'log') escreverLog(String(dado));
    else if (tipo === 'erro') escreverLog(String(dado), 'erro');
    else if (tipo === 'fim') {
      fonte.close();
      encerrar(dado.status === 'ok');
    }
  };

  fonte.onerror = () => {
    fonte.close();
    escreverLog('Conexão com o servidor caiu.', 'erro');
    encerrar(false);
  };
}

function encerrar(ok) {
  estado.rodando = false;

  for (const item of document.querySelectorAll('.trilha > li.rodando')) {
    item.className = ok ? 'ok' : 'erro';
  }

  const caixa = $('resultado');
  caixa.className = `resultado ${ok ? 'ok' : 'erro'}`;
  caixa.hidden = false;
  caixa.innerHTML = ok
    ? '<strong>Tudo certo</strong><span>Os disparos foram criados no dashboard.</span>'
    : '<strong>Terminou com erro</strong><span>Abra o log técnico abaixo para ver o que falhou.</span>';

  if (!ok) $('bloco-log').open = true;

  $('btn-voltar').hidden = false;
  carregarHistorico();
}

async function carregarHistorico() {
  const linhas = await fetch('/api/historico?limite=10').then((r) => r.json());
  const corpo = $('historico');
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
  $('btn-disparar').onclick = disparar;
  $('btn-voltar').onclick = () => { trocarView('menu'); carregarBases(); };
  $('hora').oninput = atualizarLancamento;

  trocarModo('producao');
  carregarHistorico();
  verificarVpn();
}

iniciar();
