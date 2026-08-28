"""Agendador: o servidor dispara sozinho nos horarios de auto/config/agenda.json.

Enquanto o servidor estiver de pe, uma thread confere a agenda de tempos em
tempos e roda a pipeline inteira (VPN, base, disparo) quando chega a hora de um
item. A tela (aba Agenda) so gerencia a lista; quem dispara e esta thread.

A parte de decisao (o que disparar, o que ja se perdeu) sao funcoes puras, sem
IO, testadas em tests/test_agendador.py. O resto le/grava arquivo e roda a
pipeline.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path

from app import passos

AGENDA_FILE = passos.AUTO_DIR / "config" / "agenda.json"
# Estado e log ficam em auto/logs/, que ja e ignorado pelo git.
ESTADO_FILE = passos.AUTO_DIR / "logs" / "agenda_estado.json"
LOG_FILE = passos.AUTO_DIR / "logs" / "agenda.log"

# De quanto em quanto tempo a thread confere a agenda.
INTERVALO_TICK_S = 30

# Dispara este tanto de minutos antes do horario do item (0 = na hora exata).
# Acima de ~2 o dispatch.js agenda na plataforma em vez de enviar na hora, e o
# agendamento da plataforma pode estourar a tolerancia de atraso — por isso 0.
ANTECEDENCIA_MIN = 0

# Passou este tanto do horario sem disparar (servidor desligado, ocupado com
# outra execucao), o item vira "perdido" e nao dispara mais atrasado.
TOLERANCIA_ATRASO_MIN = 20

_thread: threading.Thread | None = None
_iniciado_em: datetime | None = None
_execucao_atual: dict | None = None
_trava_estado = threading.Lock()


# --------------------------------------------------------------------- puro

def id_do_item(item: dict) -> str:
    """Chave natural do item: data + hora. Mexer no horario cria um item novo."""
    return f"{item['data']} {item['hora']}"


def alvo_do_item(item: dict, antecedencia_min: int = ANTECEDENCIA_MIN) -> datetime:
    alvo = datetime.strptime(f"{item['data']} {item['hora']}", "%Y-%m-%d %H:%M")
    return alvo - timedelta(minutes=antecedencia_min)


def situacao_do_item(
    item: dict,
    estado: dict,
    agora: datetime,
    *,
    antecedencia_min: int = ANTECEDENCIA_MIN,
    tolerancia_min: int = TOLERANCIA_ATRASO_MIN,
) -> str:
    """O rotulo que a tela mostra pro item.

    desativado | disparado | erro | cancelado | perdido | pendente | agendado.
    O que ja rodou (esta no estado) vence o calculo por horario.
    """
    if not item.get("ativo", True):
        return "desativado"

    registro = estado.get(id_do_item(item))
    if registro:
        return registro.get("situacao", "disparado")

    alvo = alvo_do_item(item, antecedencia_min)
    if agora < alvo:
        return "agendado"
    if agora - alvo > timedelta(minutes=tolerancia_min):
        return "perdido"
    return "pendente"


def itens_a_disparar(
    itens: list[dict],
    estado: dict,
    agora: datetime,
    *,
    antecedencia_min: int = ANTECEDENCIA_MIN,
    tolerancia_min: int = TOLERANCIA_ATRASO_MIN,
) -> list[tuple[dict, str]]:
    """(item, acao) pra cada item que precisa de acao agora.

    acao e "disparar" (chegou a hora, dentro da janela) ou "perder" (passou da
    janela sem rodar). Item ja no estado ou desativado nao aparece.
    """
    saida: list[tuple[dict, str]] = []

    for item in itens:
        if not item.get("ativo", True):
            continue
        if id_do_item(item) in estado:
            continue

        alvo = alvo_do_item(item, antecedencia_min)
        if agora < alvo:
            continue

        if agora - alvo > timedelta(minutes=tolerancia_min):
            saida.append((item, "perder"))
        else:
            saida.append((item, "disparar"))

    return saida


def proximo_disparo(
    itens: list[dict],
    estado: dict,
    agora: datetime,
    *,
    antecedencia_min: int = ANTECEDENCIA_MIN,
) -> dict | None:
    """O proximo item ainda por disparar, com quantos minutos faltam."""
    futuros = [
        (alvo_do_item(item, antecedencia_min), item)
        for item in itens
        if item.get("ativo", True)
        and id_do_item(item) not in estado
        and alvo_do_item(item, antecedencia_min) >= agora
    ]
    if not futuros:
        return None

    alvo, item = min(futuros, key=lambda par: par[0])

    return {
        "id": id_do_item(item),
        "data": item["data"],
        "hora": item["hora"],
        "em_minutos": round((alvo - agora).total_seconds() / 60),
    }


# --------------------------------------------------------------------- arquivo

def _ler_json(caminho: Path, padrao):
    try:
        return json.loads(caminho.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def ler_agenda() -> list[dict]:
    dados = _ler_json(AGENDA_FILE, [])
    return dados if isinstance(dados, list) else []


def _ler_estado() -> dict:
    dados = _ler_json(ESTADO_FILE, {})
    return dados if isinstance(dados, dict) else {}


def _gravar_estado(estado: dict) -> None:
    ESTADO_FILE.parent.mkdir(parents=True, exist_ok=True)
    ESTADO_FILE.write_text(json.dumps(estado, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _registrar(item_id: str, situacao: str, detalhe: str = "") -> None:
    with _trava_estado:
        estado = _ler_estado()
        estado[item_id] = {
            "situacao": situacao,
            "quando": datetime.now().isoformat(timespec="seconds"),
            "detalhe": detalhe,
        }
        _gravar_estado(estado)


def _log(texto: str) -> None:
    linha = f"{datetime.now().isoformat(timespec='seconds')}  {texto}"
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as arquivo:
        arquivo.write(linha + "\n")
    print(f"[agenda] {texto}")


def _validar_data(valor: str) -> None:
    try:
        datetime.strptime(valor, "%Y-%m-%d")
    except ValueError:
        raise ValueError(f"Data invalida: '{valor}'. Use AAAA-MM-DD.")


def _validar_hora(valor: str) -> str:
    try:
        hh, _, mm = valor.partition(":")
        horas, minutos = int(hh), int(mm)
        if not (0 <= horas <= 23 and 0 <= minutos <= 59):
            raise ValueError
    except ValueError:
        raise ValueError(f"Horario invalido: '{valor}'. Use HH:MM.")

    return f"{horas:02d}:{minutos:02d}"


def gravar_agenda(itens: list[dict]) -> list[dict]:
    """Valida, ordena e regrava a agenda. Poda o estado de itens que sumiram."""
    limpos: list[dict] = []
    vistos: set[str] = set()

    for entrada in itens:
        data = str(entrada.get("data", "")).strip()
        hora = str(entrada.get("hora", "")).strip()
        _validar_data(data)
        hora = _validar_hora(hora)

        chave = f"{data} {hora}"
        if chave in vistos:
            raise ValueError(f"Horario repetido na agenda: {data} {hora}.")
        vistos.add(chave)

        limpos.append({"data": data, "hora": hora, "ativo": bool(entrada.get("ativo", True))})

    limpos.sort(key=lambda entrada: (entrada["data"], entrada["hora"]))
    AGENDA_FILE.write_text(json.dumps(limpos, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    with _trava_estado:
        estado = _ler_estado()
        podado = {chave: valor for chave, valor in estado.items() if chave in vistos}
        if podado != estado:
            _gravar_estado(podado)

    return limpos


def agenda_para_tela() -> list[dict]:
    """A agenda com a situacao calculada de cada item, pro GET /api/agenda."""
    itens = ler_agenda()
    estado = _ler_estado()
    agora = datetime.now()

    return [
        {
            "id": id_do_item(item),
            "data": item["data"],
            "hora": item["hora"],
            "ativo": item.get("ativo", True),
            "situacao": situacao_do_item(item, estado, agora),
            "quando": estado.get(id_do_item(item), {}).get("quando"),
            "detalhe": estado.get(id_do_item(item), {}).get("detalhe", ""),
        }
        for item in itens
    ]


def rearmar(item_id: str) -> None:
    """Tira o item do estado pra ele poder disparar de novo (falhou ou se perdeu)."""
    with _trava_estado:
        estado = _ler_estado()
        if item_id in estado:
            del estado[item_id]
            _gravar_estado(estado)

    _log(f"{item_id}: rearmado pela tela")


def status() -> dict:
    with _trava_estado:
        execucao = dict(_execucao_atual) if _execucao_atual else None

    itens = ler_agenda()
    estado = _ler_estado()

    return {
        "ligado": _thread is not None and _thread.is_alive(),
        "desde": _iniciado_em.isoformat(timespec="seconds") if _iniciado_em else None,
        "em_execucao": execucao,
        "proximo": proximo_disparo(itens, estado, datetime.now()),
        "tolerancia_min": TOLERANCIA_ATRASO_MIN,
        "antecedencia_min": ANTECEDENCIA_MIN,
    }


# --------------------------------------------------------------------- disparo

_SITUACAO_FIM = {"ok": "disparado", "erro": "erro", "cancelado": "cancelado"}


def _disparar_item(item: dict) -> None:
    """Roda a pipeline pra um item da agenda e registra como foi."""
    import gerar_base

    item_id = id_do_item(item)

    # A mesma trava que a tela usa: se ha disparo manual rodando, sai e tenta no
    # proximo ciclo (ou vira "perdido" se estourar a tolerancia ate la).
    if not passos.LOCK_EXECUCAO.acquire(blocking=False):
        _log(f"{item_id}: servidor ocupado com outra execucao, tenta no proximo ciclo")
        return

    global _execucao_atual
    with _trava_estado:
        _execucao_atual = {"id": item_id, "desde": datetime.now().isoformat(timespec="seconds")}

    _log(f"{item_id}: iniciando disparo automatico")
    situacao = "erro"
    erros: list[str] = []

    try:
        inicio, fim = gerar_base.periodo_padrao()
        for tipo, dado in passos.executar(
            data_inicio=inicio,
            data_fim=fim,
            hora=item["hora"],
            modo="producao",
            com_relatorio=True,
            gerar=True,
        ):
            if tipo == "erro":
                erros.append(str(dado))
                _log(f"{item_id}: erro: {dado}")
            elif tipo == "log":
                _log(f"{item_id}: {dado}")
            elif tipo == "fim":
                situacao = _SITUACAO_FIM.get(dado.get("status"), "erro")
    except BaseException as erro:  # noqa: BLE001 - vira detalhe do estado, nao derruba a thread
        erros.append(f"{type(erro).__name__}: {erro}")
        _log(f"{item_id}: excecao: {erro}")
    finally:
        passos.LOCK_EXECUCAO.release()
        with _trava_estado:
            _execucao_atual = None

    _registrar(item_id, situacao, " | ".join(erros[-3:]))
    _log(f"{item_id}: fim ({situacao})")


def _rodar_pendencias() -> None:
    itens = ler_agenda()
    estado = _ler_estado()
    agora = datetime.now()

    for item, acao in itens_a_disparar(itens, estado, agora):
        item_id = id_do_item(item)

        if acao == "perder":
            _registrar(item_id, "perdido", f"nao disparou dentro de {TOLERANCIA_ATRASO_MIN} min do horario")
            _log(f"{item_id}: perdido (passou de {TOLERANCIA_ATRASO_MIN} min)")
            continue

        # So um disparo por ciclo: ele bloqueia por minutos e o estado muda no
        # meio. O proximo ciclo relê tudo e pega o item seguinte.
        _disparar_item(item)
        return


def _ciclo() -> None:
    while True:
        try:
            _rodar_pendencias()
        except Exception as erro:  # noqa: BLE001 - a thread nao pode morrer
            _log(f"erro no ciclo: {erro}")

        time.sleep(INTERVALO_TICK_S)


def iniciar() -> None:
    """Sobe a thread do agendador uma vez. Chamado por app.server.main()."""
    global _thread, _iniciado_em

    if _thread is not None and _thread.is_alive():
        return

    _iniciado_em = datetime.now()
    _thread = threading.Thread(target=_ciclo, name="agendador", daemon=True)
    _thread.start()
    _log(f"agendador ligado (tick {INTERVALO_TICK_S}s, tolerancia {TOLERANCIA_ATRASO_MIN} min)")
