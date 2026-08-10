"""Caminhos e credenciais do projeto.

As credenciais ficam no .env da raiz (fora do versionamento). Use o
.env.example como modelo.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
SQL_DIR = BASE_DIR / "sql"
INPUT_DIR = BASE_DIR / "in"
OUTPUT_DIR = BASE_DIR / "out"
REPORT_DIR = BASE_DIR / "relatorio"
COPY_FILE = BASE_DIR / "copy.md"
ENV_FILE = BASE_DIR / ".env"

# Owner da Porto Seguro nos logs de mensagem.
DEFAULT_OWNER_ID = "e28cac64-6cc2-4880-934b-e819c4afde6c"


def load_env(env_file: Path = ENV_FILE) -> None:
    """Le o .env sem sobrescrever variaveis ja presentes no ambiente."""
    if not env_file.exists():
        return

    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]

        os.environ.setdefault(key.strip(), value)


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Variavel de ambiente obrigatoria ausente: {name}. Preencha o .env.")

    return value


def env_port(prefix: str) -> int:
    return int(os.environ.get(f"{prefix}_PORT", "").strip() or 5432)


def owner_id() -> str:
    return os.environ.get("OWNER_ID", "").strip() or DEFAULT_OWNER_ID
