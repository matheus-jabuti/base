"""Regras de contato da Operacao B.

Mesmo produto final da Operacao A (CSVs de duas colunas, phonenumber e name),
mas com classificacao propria: cinco planilhas separadas por rating, com o
contencioso quebrado em menor/maior de 500 em vez de virar uma categoria so.

Fica separado de `contatos.py` de proposito — as duas operacoes evoluem por
conta propria e um ajuste de regra aqui nao pode mexer na A. O que e mecanica
pura e comum as duas (normalizacao de telefone, escrita de CSV, filtro manual)
continua vindo de la.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, NamedTuple

from contatos import normalize_phone, write_csv

GROUP_AMIGAVEL_A = "amigavel_a"
GROUP_AMIGAVEL_D = "amigavel_d"
GROUP_CONTENCIOSO_MENOR_500 = "contencioso_menor_500"
GROUP_CONTENCIOSO_MAIOR_500 = "contencioso_maior_500"
GROUP_OUTROS = "outros"

OUTPUT_FILES_B = {
    GROUP_AMIGAVEL_A: "b_amigavel_A.csv",
    GROUP_AMIGAVEL_D: "b_amigavel_D.csv",
    GROUP_CONTENCIOSO_MENOR_500: "b_contencioso_menor_500.csv",
    GROUP_CONTENCIOSO_MAIOR_500: "b_contencioso_maior_500.csv",
    GROUP_OUTROS: "b_outros.csv",
}

CSV_PARA_GRUPO_B = {arquivo: grupo for grupo, arquivo in OUTPUT_FILES_B.items()}

# O rating da Operacao B vem do campo `prioridade` e e um valor fechado, nao um
# prefixo: MENOR_500 e MAIOR_500 comecam com a mesma letra, entao a comparacao e
# pelo texto inteiro (diferente da A, que agrupa pela primeira letra).
RATING_GROUPS_B = {
    "A": GROUP_AMIGAVEL_A,
    "D": GROUP_AMIGAVEL_D,
    "MENOR_500": GROUP_CONTENCIOSO_MENOR_500,
    "MAIOR_500": GROUP_CONTENCIOSO_MAIOR_500,
    "OUTROS": GROUP_OUTROS,
}

# Registro sem nome ainda entra no disparo (diferente da Operacao A, que
# descarta): a mensagem trata o cliente de forma generica.
NOME_PADRAO = "Cliente"


class RegistroB(NamedTuple):
    """Linha bruta da consulta da Operacao B, antes de qualquer normalizacao."""

    telefone: object
    nome: object
    rating: object


@dataclass
class ResultadoContatosB:
    grupos: dict[str, list[tuple[str, str]]]
    total_lidos: int = 0
    telefone_invalido: int = 0
    sem_nome: int = 0
    duplicados: int = 0
    ratings_desconhecidos: Counter = field(default_factory=Counter)

    @property
    def total_contatos(self) -> int:
        return sum(len(rows) for rows in self.grupos.values())


def normalize_name_b(value: object) -> str:
    """Nome capitalizado; sem nome vira o generico.

    "MARIA DAS DORES" -> "Maria Das Dores". Nulo, vazio ou so espaco vira
    "Cliente", pra planilha nunca sair com a coluna name em branco.
    """
    if value is None:
        return NOME_PADRAO

    nome = " ".join(str(value).split())
    if not nome:
        return NOME_PADRAO

    return nome.lower().title()


def rating_group_b(rating: object) -> str | None:
    """Grupo do rating da Operacao B. None quando vazio ou desconhecido."""
    if rating is None:
        return None

    texto = str(rating).strip().upper()
    if not texto:
        return None

    return RATING_GROUPS_B.get(texto)


def rating_desconhecido_b(rating: object) -> bool:
    """True quando o rating veio preenchido mas nao e um dos cinco esperados."""
    if rating is None:
        return False

    texto = str(rating).strip().upper()

    return bool(texto) and texto not in RATING_GROUPS_B


def resolve_group_b(rating: object) -> str:
    """Rating fora da lista (ou ausente) cai em Outros, que e a planilha coringa."""
    return rating_group_b(rating) or GROUP_OUTROS


def coletar_contatos_b(registros: Iterable[RegistroB]) -> ResultadoContatosB:
    """Normaliza, deduplica por telefone e separa nas cinco planilhas.

    A deduplicacao e global, igual a da Operacao A: um telefone recebe um
    disparo so, mesmo aparecendo em ratings diferentes.
    """
    resultado = ResultadoContatosB(grupos={grupo: [] for grupo in OUTPUT_FILES_B})
    vistos: set[str] = set()

    for registro in registros:
        resultado.total_lidos += 1

        phone = normalize_phone(registro.telefone)
        if not phone:
            resultado.telefone_invalido += 1
            continue

        if phone in vistos:
            resultado.duplicados += 1
            continue

        nome = normalize_name_b(registro.nome)
        if nome == NOME_PADRAO:
            resultado.sem_nome += 1

        if rating_desconhecido_b(registro.rating):
            resultado.ratings_desconhecidos[str(registro.rating).strip().upper()] += 1

        vistos.add(phone)
        resultado.grupos[resolve_group_b(registro.rating)].append((phone, nome))

    return resultado


def escrever_grupos_b(output_dir: Path, grupos: dict[str, list[tuple[str, str]]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    for grupo, file_name in OUTPUT_FILES_B.items():
        write_csv(output_dir / file_name, grupos.get(grupo, []))


def imprimir_resumo_b(resultado: ResultadoContatosB) -> None:
    print("Arquivos gerados:")
    for grupo, file_name in OUTPUT_FILES_B.items():
        print(f"- {file_name} ({len(resultado.grupos.get(grupo, []))} contatos)")

    print(f"Total pronto para disparo: {resultado.total_contatos} contatos.")
    print(
        f"Descartados: {resultado.telefone_invalido} telefone invalido, "
        f"{resultado.duplicados} duplicados (de {resultado.total_lidos} linhas lidas)."
    )
    print(f"Sem nome no cadastro (tratados como '{NOME_PADRAO}'): {resultado.sem_nome}.")

    if resultado.ratings_desconhecidos:
        detalhes = ", ".join(
            f"{rating} ({quantidade})"
            for rating, quantidade in sorted(resultado.ratings_desconhecidos.items())
        )
        print(f"AVISO: ratings fora dos cinco esperados enviados para {OUTPUT_FILES_B[GROUP_OUTROS]}: {detalhes}.")
