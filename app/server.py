"""Servidor da tela de disparo.

Roda com:
    python -m app.server

Serve a tela em http://127.0.0.1:8000 e expoe os passos como endpoints. Os
passos longos (gerar base, disparar) devolvem SSE, que o browser consome com
EventSource — assim a tela mostra o log ao vivo em vez de um spinner mudo.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app import agendador, passos

STATIC_DIR = Path(__file__).resolve().parent / "static"

app = FastAPI(title="Disparo Porto")

# Uma execucao por vez (tela ou agendador): a trava mora em passos.LOCK_EXECUCAO.


def _sse(gerador):
    """Empacota (tipo, dado) como evento SSE."""

    def fluxo():
        if not passos.LOCK_EXECUCAO.acquire(blocking=False):
            yield _evento("erro", "Ja tem uma execucao em andamento.")
            yield _evento("fim", {"status": "ocupado"})
            return

        try:
            for tipo, dado in gerador:
                yield _evento(tipo, dado)
        finally:
            passos.LOCK_EXECUCAO.release()

    return StreamingResponse(
        fluxo(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _evento(tipo: str, dado) -> str:
    return f"data: {json.dumps({'tipo': tipo, 'dado': dado}, ensure_ascii=False)}\n\n"


def _parse_data(valor: str | None, padrao: date) -> date:
    if not valor:
        return padrao

    try:
        return datetime.strptime(valor, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(400, f"Data invalida: '{valor}'. Use AAAA-MM-DD.")


def _validar_hora(hora: str) -> str:
    try:
        hh, _, mm = hora.partition(":")
        if not (0 <= int(hh) <= 23 and 0 <= int(mm) <= 59):
            raise ValueError
    except ValueError:
        raise HTTPException(400, f"Horario invalido: '{hora}'. Use HH:MM.")

    return f"{int(hh):02d}:{int(mm):02d}"


def _validar_modo(modo: str) -> str:
    if modo not in passos.BASES_DIR:
        raise HTTPException(400, f"Modo invalido: '{modo}'. Use 'producao' ou 'teste'.")

    return modo


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/vpn")
def vpn():
    conexoes = [asdict(conexao) for conexao in passos.checar_vpn()]

    return {"ok": all(conexao["ok"] for conexao in conexoes), "conexoes": conexoes}


@app.get("/api/templates")
def templates():
    return passos.ler_templates()


@app.put("/api/templates")
def salvar_templates(entradas: list[dict]):
    try:
        return passos.gravar_templates(entradas)
    except ValueError as erro:
        raise HTTPException(400, str(erro))


@app.get("/api/bases")
def bases(modo: str = "producao"):
    return passos.contagens(_validar_modo(modo))


@app.get("/api/periodo-padrao")
def periodo_padrao():
    import gerar_base

    inicio, fim = gerar_base.periodo_padrao()

    return {"data_inicio": inicio.isoformat(), "data_fim": fim.isoformat()}


@app.get("/api/executar")
def executar(
    hora: str,
    modo: str = "producao",
    gerar: bool = True,
    data_inicio: str | None = None,
    data_fim: str | None = None,
    com_relatorio: bool = True,
    dry_run: bool = False,
):
    """VPN, geracao da base e disparo num stream so — o botao unico da tela."""
    import gerar_base

    if dry_run and not gerar:
        raise HTTPException(400, "Pre-visualizacao exige gerar a base.")

    padrao_inicio, padrao_fim = gerar_base.periodo_padrao()
    inicio = _parse_data(data_inicio, padrao_inicio)
    fim = _parse_data(data_fim, padrao_fim)

    if inicio > fim:
        raise HTTPException(400, "Data de inicio maior que a data de fim.")

    return _sse(
        passos.executar(
            data_inicio=inicio,
            data_fim=fim,
            hora=_validar_hora(hora),
            modo=_validar_modo(modo),
            com_relatorio=com_relatorio,
            gerar=gerar,
            dry_run=dry_run,
        )
    )


@app.post("/api/cancelar")
def cancelar():
    if not passos.LOCK_EXECUCAO.locked():
        raise HTTPException(409, "Nenhuma execucao em andamento.")

    passos.cancelar()

    return {"ok": True}


@app.get("/api/agenda")
def agenda():
    return agendador.agenda_para_tela()


@app.put("/api/agenda")
def salvar_agenda(corpo: dict):
    try:
        return agendador.gravar_agenda(corpo.get("itens", []), corpo.get("modo", "teste"))
    except ValueError as erro:
        raise HTTPException(400, str(erro))


@app.put("/api/agenda/modo")
def salvar_agenda_modo(corpo: dict):
    try:
        return agendador.gravar_modo(corpo.get("modo", "teste"))
    except ValueError as erro:
        raise HTTPException(400, str(erro))


@app.get("/api/agenda/status")
def agenda_status():
    return agendador.status()


@app.post("/api/agenda/rearmar")
def agenda_rearmar(corpo: dict):
    item_id = str(corpo.get("id", "")).strip()
    if not item_id:
        raise HTTPException(400, "Informe o id do item da agenda.")

    agendador.rearmar(item_id)

    return agendador.agenda_para_tela()


@app.get("/api/filtro")
def filtro():
    return passos.filtro_atual()


@app.get("/api/filtro/ultimo-removido")
def filtro_ultimo_removido():
    caminho = passos.ultimo_arquivo_filtro_removidos()
    if not caminho:
        raise HTTPException(404, "Nenhum arquivo de filtro removido encontrado.")

    return FileResponse(caminho, filename=caminho.name, media_type="text/csv")


@app.get("/api/historico")
def historico(limite: int = 10, busca: str = "", status: str = "", modo: str = ""):
    return passos.ultimos_disparos(limite, busca, status, modo)


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def main() -> None:
    import uvicorn

    agendador.iniciar()
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


if __name__ == "__main__":
    main()
