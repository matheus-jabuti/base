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
from datetime import date
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# gerar_base.py e config.py ficam na raiz do projeto, um nivel acima daqui.
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

AUTO_DIR = BASE_DIR / "auto"
DISPATCHES_FILE = AUTO_DIR / "config" / "dispatches.json"
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


@dataclass
class Conexao:
    nome: str
    host: str
    porta: int
    ok: bool
    erro: str = ""


def _porta(prefixo: str) -> int:
    return int(os.environ.get(f"{prefixo}_PORT", "").strip() or 5432)


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
        porta = _porta(prefixo)

        if not host:
            resultados.append(Conexao(nome, "", porta, False, f"{prefixo}_HOST nao preenchido no .env"))
            continue

        try:
            with socket.create_connection((host, porta), timeout=TIMEOUT_VPN_S):
                resultados.append(Conexao(nome, host, porta, True))
        except OSError as erro:
            resultados.append(Conexao(nome, host, porta, False, str(erro)))

    return resultados


def ler_templates() -> list[dict]:
    return json.loads(DISPATCHES_FILE.read_text(encoding="utf-8"))


def gravar_templates(entradas: list[dict]) -> list[dict]:
    """Regrava so prefixo e numero; key/nome/csv sao estrutura, nao configuracao."""
    atuais = ler_templates()
    por_key = {entrada.get("key"): entrada for entrada in entradas}

    for cfg in atuais:
        nova = por_key.get(cfg["key"])
        if not nova:
            continue

        prefixo = str(nova.get("template_prefix", "")).strip()
        numero = str(nova.get("template_numero", "")).strip()

        if not prefixo:
            raise ValueError(f"Prefixo de template vazio em '{cfg['nome']}'.")
        if not numero.isdigit() or len(numero) > 3:
            raise ValueError(f"Numero de template invalido em '{cfg['nome']}': '{numero}'. Use de 1 a 3 digitos.")

        cfg["template_prefix"] = prefixo
        cfg["template_numero"] = numero.zfill(2)

    DISPATCHES_FILE.write_text(json.dumps(atuais, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return atuais


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


def _em_thread(alvo, fila: queue.Queue) -> threading.Thread:
    def executar():
        try:
            alvo()
        except BaseException as erro:  # noqa: BLE001 - vira linha de log, nao derruba o server
            fila.put(("erro", f"{type(erro).__name__}: {erro}"))
        finally:
            fila.put(None)

    thread = threading.Thread(target=executar, daemon=True)
    thread.start()

    return thread


class _FilaDeLinhas(io.TextIOBase):
    """Transforma o que o gerar_base imprime em eventos, linha a linha."""

    def __init__(self, fila: queue.Queue):
        self._fila = fila
        self._buffer = ""

    def write(self, texto: str) -> int:
        self._buffer += texto

        while "\n" in self._buffer:
            linha, _, self._buffer = self._buffer.partition("\n")
            if linha.strip():
                self._fila.put(("log", linha.rstrip()))

        return len(texto)

    def flush(self) -> None:
        if self._buffer.strip():
            self._fila.put(("log", self._buffer.rstrip()))
            self._buffer = ""


def gerar_base(data_inicio: date, data_fim: date, hora: str, com_relatorio: bool = True):
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
        with contextlib.redirect_stdout(saida):
            retorno = pipeline.gerar(
                data_inicio=data_inicio,
                data_fim=data_fim,
                hora=hora,
                com_relatorio=com_relatorio,
                com_copy=True,
            )
            saida.flush()

        resultado["total"] = retorno.total_contatos

    _em_thread(executar, fila)
    yield from _drenar(fila)

    yield ("total", resultado.get("total", 0))


def disparar(hora: str, modo: str):
    """Chama o dispatch.js do auto/ e repassa a saida dele em tempo real."""
    node = shutil.which("node")
    if not node:
        yield ("erro", "Node nao encontrado no PATH. Instale o Node pra rodar o disparo.")
        yield ("falhou", "node ausente")
        return

    pasta = BASES_DIR[modo]
    comando = [node, str(DISPATCH_SCRIPT), "--hora", hora, "--bases-dir", str(pasta)]

    yield ("log", f"Modo {modo}: lendo bases de {pasta}")

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

    if processo.returncode != 0:
        yield ("falhou", f"dispatch.js saiu com codigo {processo.returncode}")


def executar(data_inicio: date, data_fim: date, hora: str, modo: str, com_relatorio: bool, gerar: bool):
    """O disparo inteiro num evento so: VPN, base e disparo, em sequencia.

    Emite ('passo', ...) a cada troca de etapa pra tela desenhar o progresso, e
    para na primeira falha — nao adianta gerar base sem VPN nem disparar sem base.
    """
    falhou = False

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

    if gerar:
        yield marcar("base", "rodando")
        total = 0

        for tipo, dado in gerar_base(data_inicio, data_fim, hora.replace(":", "H"), com_relatorio):
            if tipo == "total":
                total = dado
            else:
                if tipo == "erro":
                    falhou = True
                yield (tipo, dado)

        if falhou or not total:
            yield marcar("base", "erro", "Falha ao gerar" if falhou else "Nenhum contato elegivel no periodo.")
            yield ("fim", {"status": "erro"})
            return

        yield marcar("base", "ok", f"{total:,} contatos".replace(",", "."))
    else:
        yield marcar("base", "pulado", "Usando os CSVs que ja estavam na pasta")

    yield ("bases", contagens(modo))

    yield marcar("disparo", "rodando")

    for tipo, dado in disparar(hora, modo):
        if tipo == "falhou":
            falhou = True
            yield ("erro", dado)
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


def ultimos_disparos(limite: int = 10) -> list[dict]:
    """Ultimas linhas do log do auto/, pro resumo final da tela."""
    if not LOG_DISPAROS.exists():
        return []

    import csv

    with LOG_DISPAROS.open(encoding="utf-8", newline="") as arquivo:
        linhas = list(csv.DictReader(arquivo))

    return linhas[-limite:][::-1]
