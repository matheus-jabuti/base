"""Testes de app/passos.py — o encadeamento VPN -> base -> disparo."""

from __future__ import annotations

from datetime import date

from app import passos


def _mockar_pipeline(monkeypatch, capturado):
    monkeypatch.setattr(passos, "checar_vpn", lambda: [passos.Conexao("banco", "host", 5432, True)])
    monkeypatch.setattr(passos, "contagens", lambda modo: [])
    monkeypatch.setattr(passos, "disparar", lambda hora, modo: iter(()))

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
