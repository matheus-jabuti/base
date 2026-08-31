"""Testes de app/passos.py — o encadeamento VPN -> base -> disparo."""

from __future__ import annotations

from datetime import date

from app import passos


def _mockar_pipeline(monkeypatch, capturado):
    monkeypatch.setattr(passos, "checar_vpn", lambda: [passos.Conexao("banco", "host", 5432, True)])
    monkeypatch.setattr(passos, "contagens", lambda modo: [])
    monkeypatch.setattr(passos, "disparar", lambda hora, modo, fases=None: iter(()))

    def fake_gerar_base(data_inicio, data_fim, com_relatorio, dry_run=False):
        capturado["com_relatorio"] = com_relatorio
        yield ("total", 1)

    monkeypatch.setattr(passos, "gerar_base", fake_gerar_base)


def test_executar_modo_teste_nunca_gera_relatorio(monkeypatch):
    capturado: dict = {}
    _mockar_pipeline(monkeypatch, capturado)

    list(passos.executar(date(2026, 1, 1), date(2026, 1, 2), "10:00", "teste", com_relatorio=True, gerar=True))

    assert capturado["com_relatorio"] is False


def test_executar_modo_producao_respeita_com_relatorio(monkeypatch):
    capturado: dict = {}
    _mockar_pipeline(monkeypatch, capturado)

    list(passos.executar(date(2026, 1, 1), date(2026, 1, 2), "10:00", "producao", com_relatorio=True, gerar=True))

    assert capturado["com_relatorio"] is True


def test_executar_repassa_fases_pro_disparar(monkeypatch):
    capturado: dict = {}
    _mockar_pipeline(monkeypatch, capturado)

    def fake_disparar(hora, modo, fases=None):
        capturado["fases"] = fases
        return iter(())

    monkeypatch.setattr(passos, "disparar", fake_disparar)

    list(passos.executar(
        date(2026, 1, 1), date(2026, 1, 2), "10:00", "producao",
        com_relatorio=False, gerar=True, fases=["lista", "campanha"],
    ))

    assert capturado["fases"] == ["lista", "campanha"]


def test_disparar_monta_flag_fases(monkeypatch):
    chamadas: dict = {}

    class FakeProc:
        returncode = 0
        stdout = iter(())

        def wait(self):
            return 0

    def fake_popen(comando, **kwargs):
        chamadas["comando"] = comando
        return FakeProc()

    monkeypatch.setattr(passos.shutil, "which", lambda _: "node")
    monkeypatch.setattr(passos.subprocess, "Popen", fake_popen)

    list(passos.disparar("10:00", "teste", ["lista", "transmissao"]))

    comando = chamadas["comando"]
    assert "--fases" in comando
    assert comando[comando.index("--fases") + 1] == "lista,transmissao"


def test_disparar_sem_fases_nao_passa_flag(monkeypatch):
    chamadas: dict = {}

    class FakeProc:
        returncode = 0
        stdout = iter(())

        def wait(self):
            return 0

    def fake_popen(comando, **kwargs):
        chamadas["comando"] = comando
        return FakeProc()

    monkeypatch.setattr(passos.shutil, "which", lambda _: "node")
    monkeypatch.setattr(passos.subprocess, "Popen", fake_popen)

    list(passos.disparar("10:00", "teste"))

    assert "--fases" not in chamadas["comando"]
