"""Os passos que a tela executa, na ordem: VPN, base, templates, disparo.

Cada passo devolve um gerador de linhas de texto. Quem consome (o server)
so repassa essas linhas pro browser via SSE, sem saber de onde vieram.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import queue
import shutil
import socket
import subprocess
import sys
import threading
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# gerar_base.py e config.py ficam na raiz do projeto, um nivel acima daqui.
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

AUTO_DIR = BASE_DIR / "auto"
DISPATCHES_FILE = AUTO_DIR / "config" / "dispatches.json"
# O numero de template por grupo muda quase toda rodada: mora fora do git, num
# arquivo de runtime semeado do .example na primeira leitura.
NUMEROS_FILE = AUTO_DIR / "config" / "template-numeros.json"
NUMEROS_EXEMPLO_FILE = AUTO_DIR / "config" / "template-numeros.example.json"
DISPATCH_SCRIPT = AUTO_DIR / "dispatch.js"
LOG_DISPAROS = AUTO_DIR / "logs" / "disparos.csv"

# Producao le os CSVs recem-gerados; teste usa as bases de um contato so que
# ficam versionadas em auto/bases/, pra rodar a automacao sem disparar de verdade.
BASES_DIR = {
    "producao": BASE_DIR / "out",
    "teste": AUTO_DIR / "bases",
}

# Os dois bancos so respondem com a VPN da empresa ligada.
CONEXOES = (
    ("Banco de mensagens", "DB"),
    ("Banco de clientes", "CUSTOMERS_DB"),
)

TIMEOUT_VPN_S = 4

# Prefixo que o dispatch.js usa pras linhas de progresso legiveis por maquina.
MARCA_ETAPA = "[ETAPA] "

# Mesmo esquema, so que emitido pelo gerar_base.py pras contagens intermediarias.
MARCA_METRICA = "[METRICA] "

# Uma execucao por vez: geracao e disparo mexem nos mesmos CSVs. A tela
# (server._sse) e o agendador (agendador._disparar_item) compartilham esta trava
# pra so haver um disparo rodando de cada vez, venha da tela ou do horario.
LOCK_EXECUCAO = threading.Lock()

# Estado de cancelamento: uma execucao por vez (LOCK_EXECUCAO garante isso),
# entao um Event/Popen a nivel de modulo basta pra sinalizar "pare" pro passo
# que estiver rodando no momento.
_evento_cancelamento = threading.Event()
_lock_processo = threading.Lock()
_processo_disparo: subprocess.Popen | None = None


def _matar_processo(processo: subprocess.Popen) -> None:
    """Mata o processo e os filhos.

    O node spawna o chromium do Playwright; Popen.kill() so mata o processo
    imediato e deixa o chromium orfao, por isso o taskkill com /T no Windows.
    """
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(processo.pid), "/T", "/F"], capture_output=True)
    else:
        processo.terminate()

    try:
        processo.wait(timeout=5)
    except subprocess.TimeoutExpired:
        processo.kill()


def _registrar_processo(processo: subprocess.Popen | None) -> None:
    """Guarda (ou solta) o subprocesso de disparo em andamento.

    Existe pra Operacao B poder disparar pelo mesmo cancelar(): so ha uma
    execucao por vez (LOCK_EXECUCAO), entao um slot a nivel de modulo basta pras
    duas operacoes.
    """
    global _processo_disparo

    with _lock_processo:
        _processo_disparo = processo


def cancelar() -> None:
    """Sinaliza cancelamento pro passo em andamento. Chamado por POST /api/cancelar.

    Um cancelamento durante a geracao (thread Python, sem forma de matar de
    fora) so surte efeito no proximo ponto de checagem em gerar_base.py — nao
    e instantaneo. Durante o disparo (subprocesso node), mata o processo na
    hora, o que fecha o stdout e destrava o loop que le a saida dele.
    """
    _evento_cancelamento.set()
    with _lock_processo:
        if _processo_disparo is not None:
            _matar_processo(_processo_disparo)


@dataclass
class Conexao:
    nome: str
    host: str
    porta: int
    ok: bool
    erro: str = ""


def checar_vpn() -> list[Conexao]:
    """Abre um socket em cada banco. Sem VPN, o connect estoura o timeout.

    E o mesmo host/porta que o SQLAlchemy usaria, so que a falha aparece em
    segundos e com uma mensagem legivel, em vez do traceback do psycopg2.
    """
    import config

    config.load_env()
    resultados = []

    for nome, prefixo in CONEXOES:
        host = os.environ.get(f"{prefixo}_HOST", "").strip()
        porta = config.env_port(prefixo)

        if not host:
            resultados.append(Conexao(nome, "", porta, False, f"{prefixo}_HOST nao preenchido no .env"))
            continue

        try:
            with socket.create_connection((host, porta), timeout=TIMEOUT_VPN_S):
                resultados.append(Conexao(nome, host, porta, True))
        except OSError as erro:
            resultados.append(Conexao(nome, host, porta, False, str(erro)))

    return resultados


def _ler_numeros() -> dict:
    """Numero de template por grupo, do arquivo de runtime (gitignored).

    Se ele nao existe, semeia do .example; se nem o .example existe, devolve {}.
    """
    if not NUMEROS_FILE.exists() and NUMEROS_EXEMPLO_FILE.exists():
        shutil.copyfile(NUMEROS_EXEMPLO_FILE, NUMEROS_FILE)

    try:
        dados = json.loads(NUMEROS_FILE.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in dados.items()} if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        return {}


def gravar_numeros_template(numeros: dict) -> dict:
    """Grava o numero de template de cada grupo no arquivo de runtime.

    Valida 1 a 3 digitos e aplica zfill(2), a mesma regra do buildTemplateName no JS.
    """
    limpos: dict[str, str] = {}
    for grupo, valor in numeros.items():
        digitos = str(valor).strip()
        if not digitos.isdigit() or len(digitos) > 3:
            raise ValueError(f"Numero de template invalido para '{grupo}': '{valor}'. Use de 1 a 3 digitos.")
        limpos[str(grupo)] = digitos.zfill(2)

    atuais = _ler_numeros()
    atuais.update(limpos)
    NUMEROS_FILE.write_text(json.dumps(atuais, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return atuais


def ler_templates() -> list[dict]:
    """Estrutura das bases (dispatches.json) com o numero de cada grupo sobreposto.

    dispatches.json guarda so key/nome/csv/grupo/template_prefix; o numero vem do
    arquivo de runtime. A forma devolvida (com template_numero por entrada) e a
    mesma de antes, pra tela e agendador nao precisarem mudar.
    """
    bases = json.loads(DISPATCHES_FILE.read_text(encoding="utf-8"))
    numeros = _ler_numeros()

    for cfg in bases:
        grupo = cfg.get("grupo", cfg["key"])
        cfg["template_numero"] = numeros.get(grupo, "01")

    return bases


def grupos_templates() -> list[str]:
    """Grupos distintos de template, na ordem em que aparecem no dispatches.json.

    E a mesma divisao que a tela Preparar usa nos steppers: um numero por grupo,
    cada base do grupo mantendo o proprio prefixo.
    """
    vistos: list[str] = []
    for cfg in ler_templates():
        grupo = cfg.get("grupo", cfg["key"])
        if grupo not in vistos:
            vistos.append(grupo)

    return vistos


def gravar_templates(entradas: list[dict]) -> list[dict]:
    """Grava so o numero de cada grupo (no arquivo de runtime).

    A tela e o agendador mandam uma entrada por base; prefixo/key/nome/csv sao
    estrutura e ficam so no dispatches.json. Colapsa as entradas em um numero por
    grupo e delega pra gravar_numeros_template.
    """
    por_key = {cfg["key"]: cfg.get("grupo", cfg["key"]) for cfg in ler_templates()}
    numeros: dict[str, str] = {}

    for entrada in entradas:
        grupo = por_key.get(entrada.get("key"))
        if grupo is None:
            continue
        numeros[grupo] = str(entrada.get("template_numero", "")).strip()

    gravar_numeros_template(numeros)

    return ler_templates()


def contar_csv(caminho: Path) -> int:
    if not caminho.exists():
        return 0

    with caminho.open(encoding="utf-8") as arquivo:
        return max(sum(1 for linha in arquivo if linha.strip()) - 1, 0)


def contagens(modo: str) -> list[dict]:
    """Quantos contatos cada base tem, na pasta do modo escolhido."""
    pasta = BASES_DIR[modo]

    return [
        {
            "key": cfg["key"],
            "nome": cfg["nome"],
            "csv": cfg["csv"],
            # Bases do mesmo grupo compartilham o numero do template na tela.
            "grupo": cfg.get("grupo", cfg["key"]),
            "template": f"{cfg['template_prefix']}_{cfg['template_numero']}",
            "contatos": contar_csv(pasta / cfg["csv"]),
            "existe": (pasta / cfg["csv"]).exists(),
        }
        for cfg in ler_templates()
    ]


def contagens_previa(modo: str, grupos_previa: dict[str, int]) -> list[dict]:
    """Mesma forma de contagens(), a partir do resultado em memoria de um dry-run.

    Nada foi gravado em disco, entao 'existe' aqui significa 'teria contatos',
    nao 'ha um CSV na pasta'.
    """
    import contatos

    return [
        {
            "key": cfg["key"],
            "nome": cfg["nome"],
            "csv": cfg["csv"],
            "grupo": cfg.get("grupo", cfg["key"]),
            "template": f"{cfg['template_prefix']}_{cfg['template_numero']}",
            "contatos": grupos_previa.get(contatos.CSV_PARA_GRUPO.get(cfg["csv"], ""), 0),
            "existe": grupos_previa.get(contatos.CSV_PARA_GRUPO.get(cfg["csv"], ""), 0) > 0,
        }
        for cfg in ler_templates()
    ]


def _nomes_da_base(pasta: Path) -> dict[str, str]:
    """Mapa telefone -> nome, lido dos CSVs de disparo (phonenumber;name) ja gerados.

    So serve pra exibir o nome de quem esta no filtro quando o contato tambem
    esta na base atual; sem cadastro correspondente, o nome fica vazio. Nao
    bate no banco de clientes de proposito — filtro_atual() nao precisa de VPN.
    """
    import csv

    nomes: dict[str, str] = {}
    if not pasta.exists():
        return nomes

    for arquivo in pasta.glob("*.csv"):
        with arquivo.open(encoding="utf-8", newline="") as f:
            for linha in csv.DictReader(f, delimiter=";"):
                telefone = (linha.get("phonenumber") or "").strip()
                if telefone:
                    nomes[telefone] = (linha.get("name") or "").strip()

    return nomes


def filtro_atual() -> dict:
    """Arquivos e telefones (com nome, quando achado na base atual) na pasta de filtro manual."""
    import config
    import contatos

    config.load_env()
    arquivos = contatos.coletar_arquivos_filtro(config.FILTER_DIR)
    telefones = contatos.ler_telefones_filtro(config.FILTER_DIR)
    nomes = _nomes_da_base(BASES_DIR["producao"])

    return {
        "pasta": str(config.FILTER_DIR),
        "arquivos": [
            {
                "nome": arquivo.name,
                "tamanho_bytes": arquivo.stat().st_size,
                "modificado": datetime.fromtimestamp(arquivo.stat().st_mtime).isoformat(),
            }
            for arquivo in arquivos
        ],
        "telefones": len(telefones),
        "numeros": [{"telefone": t, "nome": nomes.get(t, "")} for t in sorted(telefones)],
    }


def ultimo_arquivo_filtro_removidos() -> Path | None:
    """CSV mais recente com os numeros removidos pelo filtro manual, se existir."""
    import config

    candidatos = sorted(config.REPORT_DIR.glob("filtro_removidos_*.csv"), key=lambda p: p.stat().st_mtime)

    return candidatos[-1] if candidatos else None


class _FilaDeLinhas(io.TextIOBase):
    """Transforma o que o gerar_base imprime em eventos, linha a linha."""

    def __init__(self, fila: queue.Queue):
        self._fila = fila
        self._buffer = ""

    def write(self, texto: str) -> int:
        self._buffer += texto

        while "\n" in self._buffer:
            linha, _, self._buffer = self._buffer.partition("\n")
            linha = linha.rstrip()
            if not linha:
                continue

            if linha.startswith(MARCA_METRICA):
                try:
                    self._fila.put(("metrica", json.loads(linha[len(MARCA_METRICA):])))
                    continue
                except json.JSONDecodeError:
                    pass

            self._fila.put(("log", linha))

        return len(texto)

    def flush(self) -> None:
        if self._buffer.strip():
            self._fila.put(("log", self._buffer.rstrip()))
            self._buffer = ""


def gerar_base(data_inicio: date, data_fim: date, com_relatorio: bool = True, dry_run: bool = False):
    """Roda o pipeline do banco e vai emitindo o que ele imprime.

    O gerar_base.py continua sendo um CLI que so imprime; em vez de duplicar a
    logica aqui, capturamos o stdout dele e repassamos como evento.
    """
    import config
    import gerar_base as pipeline

    config.load_env()
    fila: queue.Queue = queue.Queue()
    resultado: dict = {}

    def executar():
        saida = _FilaDeLinhas(fila)
        try:
            with contextlib.redirect_stdout(saida):
                retorno = pipeline.gerar(
                    data_inicio=data_inicio,
                    data_fim=data_fim,
                    com_relatorio=com_relatorio,
                    dry_run=dry_run,
                    deve_cancelar=_evento_cancelamento.is_set,
                )
                saida.flush()

            resultado["total"] = retorno.total_contatos
            resultado["grupos"] = {grupo: len(linhas) for grupo, linhas in retorno.grupos.items()}
        except pipeline.OperacaoCancelada:
            saida.flush()
            fila.put(("cancelado", True))
        except BaseException as erro:  # noqa: BLE001 - vira linha de log, nao derruba o server
            fila.put(("erro", f"{type(erro).__name__}: {erro}"))
        finally:
            fila.put(None)

    threading.Thread(target=executar, daemon=True).start()
    yield from _drenar(fila)

    if dry_run and "grupos" in resultado:
        yield ("grupos_previa", resultado["grupos"])

    yield ("total", resultado.get("total", 0))


def disparar(hora: str, modo: str, fases: list[str] | None = None):
    """Chama o dispatch.js do auto/ e repassa a saida dele em tempo real."""
    node = shutil.which("node")
    if not node:
        yield ("erro", "Node nao encontrado no PATH. Instale o Node pra rodar o disparo.")
        yield ("falhou", "node ausente")
        return

    pasta = BASES_DIR[modo]
    comando = [node, str(DISPATCH_SCRIPT), "--hora", hora, "--bases-dir", str(pasta)]
    if fases:
        comando += ["--fases", ",".join(fases)]

    yield ("log", f"Modo {modo}: lendo bases de {pasta}")
    if fases and len(fases) < 3:
        yield ("log", f"Fases: so {', '.join(fases)}")

    processo = subprocess.Popen(
        comando,
        cwd=str(AUTO_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    _registrar_processo(processo)

    try:
        for linha in processo.stdout:
            linha = linha.rstrip()
            if not linha:
                continue

            # O dispatch.js marca o progresso com [ETAPA] {json}; o resto e log solto.
            if linha.startswith(MARCA_ETAPA):
                try:
                    yield ("etapa", json.loads(linha[len(MARCA_ETAPA):]))
                    continue
                except json.JSONDecodeError:
                    pass

            yield ("erro" if linha.startswith(("[ERRO]", "[FATAL]")) else "log", linha)

        processo.wait()

        if _evento_cancelamento.is_set():
            yield ("cancelado", True)
        elif processo.returncode != 0:
            yield ("falhou", f"dispatch.js saiu com codigo {processo.returncode}")
    finally:
        _registrar_processo(None)


def executar(
    data_inicio: date, data_fim: date, hora: str, modo: str, com_relatorio: bool, gerar: bool,
    dry_run: bool = False, fases: list[str] | None = None,
):
    """O disparo inteiro num evento so: VPN, base e disparo, em sequencia.

    Emite ('passo', ...) a cada troca de etapa pra tela desenhar o progresso, e
    para na primeira falha, no cancelamento, ou (em dry-run) apos a previa —
    nao adianta gerar base sem VPN nem disparar sem base.
    """
    _evento_cancelamento.clear()
    falhou = False

    # Modo teste nunca escreve o relatorio Excel — so encheria relatorio/ de
    # arquivo de ensaio. Vale pra tela e pro agendador.
    if modo == "teste":
        com_relatorio = False

    def marcar(passo: str, status: str, detalhe: str = ""):
        return ("passo", {"id": passo, "status": status, "detalhe": detalhe})

    yield marcar("vpn", "rodando")
    conexoes = checar_vpn()

    for conexao in conexoes:
        if not conexao.ok:
            yield ("erro", f"{conexao.nome}: {conexao.erro}")

    if not all(conexao.ok for conexao in conexoes):
        yield marcar("vpn", "erro", "Conecte a VPN da empresa e tente de novo.")
        yield ("fim", {"status": "erro"})
        return

    yield marcar("vpn", "ok", f"{len(conexoes)} bancos respondendo")

    grupos_previa: dict[str, int] = {}

    if gerar:
        yield marcar("base", "rodando")
        total = 0
        cancelado = False

        for tipo, dado in gerar_base(data_inicio, data_fim, com_relatorio, dry_run=dry_run):
            if tipo == "total":
                total = dado
            elif tipo == "grupos_previa":
                grupos_previa = dado
            elif tipo == "cancelado":
                cancelado = True
            else:
                if tipo == "erro":
                    falhou = True
                yield (tipo, dado)

        if cancelado:
            yield marcar("base", "cancelado", "Cancelado pela tela.")
            yield ("fim", {"status": "cancelado"})
            return

        if falhou or not total:
            yield marcar("base", "erro", "Falha ao gerar" if falhou else "Nenhum contato elegivel no periodo.")
            yield ("fim", {"status": "erro"})
            return

        detalhe = f"{total:,} contatos".replace(",", ".")
        yield marcar("base", "ok", f"{detalhe} (pre-visualizacao)" if dry_run else detalhe)
    else:
        yield marcar("base", "pulado", "Usando os CSVs que ja estavam na pasta")

    if dry_run:
        yield ("bases", contagens_previa(modo, grupos_previa))
        yield marcar("disparo", "pulado", "Pre-visualizacao: disparo nao executado")
        yield ("fim", {"status": "pre-visualizacao"})
        return

    yield ("bases", contagens(modo))

    yield marcar("disparo", "rodando")

    for tipo, dado in disparar(hora, modo, fases):
        if tipo == "falhou":
            falhou = True
            yield ("erro", dado)
        elif tipo == "cancelado":
            yield marcar("disparo", "cancelado", "Cancelado pela tela.")
            yield ("fim", {"status": "cancelado"})
            return
        else:
            yield (tipo, dado)

    yield marcar("disparo", "erro" if falhou else "ok")
    yield ("fim", {"status": "erro" if falhou else "ok"})


def _drenar(fila: queue.Queue):
    while True:
        item = fila.get()
        if item is None:
            return

        yield item


def ultimos_disparos(limite: int = 10, busca: str = "", status: str = "", modo: str = "") -> list[dict]:
    """Ultimas linhas do log do auto/, pro resumo final da tela.

    Filtros aplicados antes do corte por limite, senao a busca so olharia
    dentro das ultimas `limite` linhas em vez do log inteiro.
    """
    if not LOG_DISPAROS.exists():
        return []

    import csv

    with LOG_DISPAROS.open(encoding="utf-8", newline="") as arquivo:
        linhas = list(csv.DictReader(arquivo))

    if status:
        linhas = [linha for linha in linhas if linha.get("status") == status]
    if modo:
        linhas = [linha for linha in linhas if linha.get("modo") == modo]
    if busca:
        alvo = busca.strip().lower()
        linhas = [
            linha for linha in linhas
            if alvo in linha.get("nome", "").lower() or alvo in linha.get("tipo", "").lower()
        ]

    return linhas[-limite:][::-1]
