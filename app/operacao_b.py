"""Os passos da Operacao B: VPN, base propria, disparo.

Espelha o `passos.py` da Operacao A, mas com configuracao propria (bases,
templates, pasta de CSV) e um fluxo mais curto: a geracao nao tem periodo nem
relatorio Excel, porque a consulta ja devolve a base fechada da operacao.

Fica em arquivo separado de proposito — as duas operacoes precisam evoluir sem
uma quebrar a outra. O que e infraestrutura compartilhada (checagem de VPN,
trava de execucao unica, cancelamento) continua vindo do `passos.py`.
"""

from __future__ import annotations

import contextlib
import json
import queue
import shutil
import subprocess
import threading

from app import passos
from app.passos import AUTO_DIR, BASE_DIR, DISPATCH_SCRIPT, MARCA_ETAPA, checar_vpn

DISPATCHES_FILE = AUTO_DIR / "config" / "dispatches-b.json"
NUMEROS_FILE = AUTO_DIR / "config" / "template-numeros-b.json"
NUMEROS_EXEMPLO_FILE = AUTO_DIR / "config" / "template-numeros-b.example.json"

# Producao le os CSVs recem-gerados em out_b/; teste usa as bases de um contato
# so que ficam versionadas em auto/bases-b/.
BASES_DIR = {
    "producao": BASE_DIR / "out_b",
    "teste": AUTO_DIR / "bases-b",
}


def _ler_numeros() -> dict:
    """Numero de template por grupo, do arquivo de runtime (gitignored)."""
    if not NUMEROS_FILE.exists() and NUMEROS_EXEMPLO_FILE.exists():
        shutil.copyfile(NUMEROS_EXEMPLO_FILE, NUMEROS_FILE)

    try:
        dados = json.loads(NUMEROS_FILE.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in dados.items()} if isinstance(dados, dict) else {}
    except (OSError, ValueError):
        return {}


def gravar_numeros_template(numeros: dict) -> dict:
    """Grava o numero de template de cada grupo, com a mesma regra da Operacao A."""
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
    """Estrutura das cinco bases da Operacao B com o numero de cada grupo sobreposto."""
    bases = json.loads(DISPATCHES_FILE.read_text(encoding="utf-8"))
    numeros = _ler_numeros()

    for cfg in bases:
        grupo = cfg.get("grupo", cfg["key"])
        cfg["template_numero"] = numeros.get(grupo, "01")

    return bases


def gravar_templates(entradas: list[dict]) -> list[dict]:
    """Grava so o numero de cada grupo; prefixo/key/nome/csv sao estrutura."""
    por_key = {cfg["key"]: cfg.get("grupo", cfg["key"]) for cfg in ler_templates()}
    numeros: dict[str, str] = {}

    for entrada in entradas:
        grupo = por_key.get(entrada.get("key"))
        if grupo is None:
            continue
        numeros[grupo] = str(entrada.get("template_numero", "")).strip()

    gravar_numeros_template(numeros)

    return ler_templates()


def contagens(modo: str) -> list[dict]:
    """Quantos contatos cada uma das cinco bases tem, na pasta do modo escolhido."""
    pasta = BASES_DIR[modo]

    return [
        {
            "key": cfg["key"],
            "nome": cfg["nome"],
            "csv": cfg["csv"],
            "grupo": cfg.get("grupo", cfg["key"]),
            "template": f"{cfg['template_prefix']}_{cfg['template_numero']}",
            "contatos": passos.contar_csv(pasta / cfg["csv"]),
            "existe": (pasta / cfg["csv"]).exists(),
        }
        for cfg in ler_templates()
    ]


def contagens_previa(modo: str, grupos_previa: dict[str, int]) -> list[dict]:
    """Mesma forma de contagens(), a partir do resultado em memoria de um dry-run."""
    import contatos_b

    return [
        {
            "key": cfg["key"],
            "nome": cfg["nome"],
            "csv": cfg["csv"],
            "grupo": cfg.get("grupo", cfg["key"]),
            "template": f"{cfg['template_prefix']}_{cfg['template_numero']}",
            "contatos": grupos_previa.get(contatos_b.CSV_PARA_GRUPO_B.get(cfg["csv"], ""), 0),
            "existe": grupos_previa.get(contatos_b.CSV_PARA_GRUPO_B.get(cfg["csv"], ""), 0) > 0,
        }
        for cfg in ler_templates()
    ]


def gerar_base(dry_run: bool = False):
    """Roda o pipeline da Operacao B e vai emitindo o que ele imprime."""
    import config
    import gerar_base_b as pipeline

    config.load_env()
    fila: queue.Queue = queue.Queue()
    resultado: dict = {}

    def executar():
        saida = passos._FilaDeLinhas(fila)
        try:
            with contextlib.redirect_stdout(saida):
                retorno = pipeline.gerar(
                    dry_run=dry_run,
                    deve_cancelar=passos._evento_cancelamento.is_set,
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
    yield from passos._drenar(fila)

    if dry_run and "grupos" in resultado:
        yield ("grupos_previa", resultado["grupos"])

    yield ("total", resultado.get("total", 0))


def disparar(hora: str, modo: str, fases: list[str] | None = None):
    """Chama o dispatch.js com --operacao b e repassa a saida dele em tempo real."""
    node = shutil.which("node")
    if not node:
        yield ("erro", "Node nao encontrado no PATH. Instale o Node pra rodar o disparo.")
        yield ("falhou", "node ausente")
        return

    pasta = BASES_DIR[modo]
    comando = [node, str(DISPATCH_SCRIPT), "--operacao", "b", "--hora", hora, "--bases-dir", str(pasta)]
    if fases:
        comando += ["--fases", ",".join(fases)]

    yield ("log", f"Operacao B · modo {modo}: lendo bases de {pasta}")
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
    passos._registrar_processo(processo)

    try:
        for linha in processo.stdout:
            linha = linha.rstrip()
            if not linha:
                continue

            if linha.startswith(MARCA_ETAPA):
                try:
                    yield ("etapa", json.loads(linha[len(MARCA_ETAPA):]))
                    continue
                except json.JSONDecodeError:
                    pass

            yield ("erro" if linha.startswith(("[ERRO]", "[FATAL]")) else "log", linha)

        processo.wait()

        if passos._evento_cancelamento.is_set():
            yield ("cancelado", True)
        elif processo.returncode != 0:
            yield ("falhou", f"dispatch.js saiu com codigo {processo.returncode}")
    finally:
        passos._registrar_processo(None)


def executar(hora: str, modo: str, gerar: bool, dry_run: bool = False, fases: list[str] | None = None):
    """O disparo da Operacao B inteiro num evento so: VPN, base e disparo.

    Mesmos eventos da Operacao A, pra tela reaproveitar a aba Monitorar sem
    saber de qual operacao veio.
    """
    passos._evento_cancelamento.clear()
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

    grupos_previa: dict[str, int] = {}

    if gerar:
        yield marcar("base", "rodando")
        total = 0
        cancelado = False

        for tipo, dado in gerar_base(dry_run=dry_run):
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
            yield marcar("base", "erro", "Falha ao gerar" if falhou else "Nenhum contato na operacao B.")
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
