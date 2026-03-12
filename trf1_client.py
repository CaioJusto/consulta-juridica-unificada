"""
Adapter que expõe uma interface orientada a objetos (TRF1Client) por cima das
funções do módulo datajud_app (official_sources + trf1_public).

Uso:
    client = TRF1Client(secao="TRF1", timeout=30)
    proc   = client.buscar_por_numero("0000001-23.2020.4.01.3400")
    lista  = client.buscar_por_nome("João Silva", False)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from typing import Any

from datajud_app.official_sources import (
    format_cnj_number,
    _process_single_trf1_row,
)
from datajud_app.trf1_public import (
    TRF1PublicSearchParams,
    search_trf1_public_bundle,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_DIGITS_RE = re.compile(r"\D")


def formatar_numero_processo(numero: str) -> str:
    """Normaliza e formata um número de processo no padrão CNJ."""
    digits = _DIGITS_RE.sub("", numero)
    return format_cnj_number(digits)


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------


@dataclass
class Movimentacao:
    data: str = ""
    descricao: str = ""
    tipo: str = ""


@dataclass
class Advogado:
    nome: str = ""
    oab: str = ""
    polo: str = ""


@dataclass
class Parte:
    nome: str = ""
    polo: str = ""
    documentos: list[str] = field(default_factory=list)
    advogados: list[str] = field(default_factory=list)


@dataclass
class ProcessoTRF1:
    numero_processo: str = ""
    classe: str = ""
    orgao_julgador: str = ""
    valor_causa: str = ""
    situacao: str = ""
    partes: list[dict[str, Any]] = field(default_factory=list)
    movimentacoes: list[dict[str, Any]] = field(default_factory=list)
    # campos extras
    polo_ativo: str = ""
    polo_passivo: str = ""
    assuntos: str = ""
    data_distribuicao: str = ""
    cessao_credito: bool = False
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResultadoBusca:
    numero_processo: str = ""
    classe: str = ""
    orgao_julgador: str = ""
    polo_ativo: str = ""
    polo_passivo: str = ""
    ultima_movimentacao: str = ""
    data_ultima_movimentacao: str = ""
    situacao: str = ""


# ---------------------------------------------------------------------------
# TRF1Client
# ---------------------------------------------------------------------------


def _build_partes_from_rows(
    party_rows: list[dict[str, Any]],
    lawyer_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Consolida party_rows e lawyer_rows numa lista de partes estruturadas."""
    partes_map: dict[str, dict[str, Any]] = {}

    for row in party_rows:
        nome = row.get("nome", "")
        polo = row.get("polo", "")
        key = f"{polo}::{nome}"
        if key not in partes_map:
            partes_map[key] = {
                "nome": nome,
                "polo": polo,
                "documentos": [],
                "advogados": [],
            }
        cpf = row.get("cpf", "")
        cnpj = row.get("cnpj", "")
        if cpf:
            partes_map[key]["documentos"].append(f"CPF: {cpf}")
        if cnpj:
            partes_map[key]["documentos"].append(f"CNPJ: {cnpj}")

    for row in lawyer_rows:
        nome_adv = row.get("nome_advogado", "") or row.get("nome", "")
        oab = row.get("oab_formatada", "") or row.get("oab", "")
        polo = row.get("polo", "")
        adv_str = f"{nome_adv} ({oab})" if oab else nome_adv
        # attach to matching party pole
        for parte in partes_map.values():
            if parte["polo"] == polo or not polo:
                parte["advogados"].append(adv_str)
                break

    return list(partes_map.values())


def _build_movimentacoes_from_rows(event_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    movs = []
    for row in event_rows:
        movs.append(
            {
                "data": row.get("data_hora", ""),
                "descricao": row.get("evento", ""),
                "tipo": row.get("tipo_evento", ""),
            }
        )
    return movs


class TRF1Client:
    """
    Cliente para o TRF1 (portal consulta pública).

    Args:
        secao:   Seção judiciária (ignorado na prática — o portal é único).
        timeout: Timeout em segundos (usado como referência, Playwright gerencia).
    """

    def __init__(self, secao: str = "TRF1", timeout: int = 30) -> None:
        self.secao = secao
        self.timeout = timeout

    # ------------------------------------------------------------------
    # Busca por número (retorna ProcessoTRF1 ou None)
    # ------------------------------------------------------------------

    def buscar_por_numero(self, numero: str) -> ProcessoTRF1 | None:
        row = {
            "tribunal_alias": "api_publica_trf1",
            "numero_processo": formatar_numero_processo(numero),
            "linha_origem": None,
        }
        result = _process_single_trf1_row(row, "TRF1 consulta publica")

        if result["status"] != "success":
            return None

        proc_row: dict[str, Any] = result["process_row"]
        partes = _build_partes_from_rows(
            result.get("party_rows", []),
            result.get("lawyer_rows", []),
        )
        movimentacoes = _build_movimentacoes_from_rows(result.get("event_rows", []))

        return ProcessoTRF1(
            numero_processo=proc_row.get("numero_processo", ""),
            classe=proc_row.get("classe", ""),
            orgao_julgador=proc_row.get("orgao_julgador", ""),
            valor_causa=proc_row.get("valor_causa", ""),
            situacao=proc_row.get("ultimo_evento", ""),
            partes=partes,
            movimentacoes=movimentacoes,
            polo_ativo=proc_row.get("polo_ativo", ""),
            polo_passivo=proc_row.get("polo_passivo", ""),
            assuntos=proc_row.get("assuntos", ""),
            data_distribuicao=proc_row.get("data_distribuicao", ""),
            cessao_credito=bool(proc_row.get("cessao_credito")),
            raw=proc_row,
        )

    # ------------------------------------------------------------------
    # Buscas por lista — retornam list[ResultadoBusca]
    # ------------------------------------------------------------------

    def _buscar_bundle(self, params: TRF1PublicSearchParams) -> list[ResultadoBusca]:
        bundle = search_trf1_public_bundle(params, max_details=50)
        resultados: list[ResultadoBusca] = []

        for proc_row in bundle.process_rows:
            resultados.append(
                ResultadoBusca(
                    numero_processo=proc_row.get("numero_processo", ""),
                    classe=proc_row.get("classe", "") or proc_row.get("classe_resultado", ""),
                    orgao_julgador=proc_row.get("orgao_julgador", ""),
                    polo_ativo=proc_row.get("polo_ativo", "") or proc_row.get("polo_ativo_resumo_resultado", ""),
                    polo_passivo=proc_row.get("polo_passivo", "") or proc_row.get("polo_passivo_resumo_resultado", ""),
                    ultima_movimentacao=proc_row.get("ultimo_evento", "") or proc_row.get("ultima_movimentacao_resultado", ""),
                    data_ultima_movimentacao=proc_row.get("data_ultimo_evento", "") or proc_row.get("data_ultima_movimentacao_resultado", ""),
                    situacao=proc_row.get("ultimo_evento", ""),
                )
            )

        # Fallback: se não encontrou detalhes mas tem search_rows
        if not resultados and bundle.search_rows:
            for row in bundle.search_rows:
                resultados.append(
                    ResultadoBusca(
                        numero_processo=row.get("numero_processo", ""),
                        classe=row.get("classe_resultado", ""),
                        orgao_julgador="",
                        polo_ativo=row.get("polo_ativo_resumo", ""),
                        polo_passivo=row.get("polo_passivo_resumo", ""),
                        ultima_movimentacao=row.get("ultima_movimentacao", ""),
                        data_ultima_movimentacao=row.get("data_ultima_movimentacao", ""),
                        situacao="",
                    )
                )

        return resultados

    def buscar_por_nome(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        params = TRF1PublicSearchParams(party_name=valor)
        return self._buscar_bundle(params)

    def buscar_por_cpf_cnpj(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        digits = _DIGITS_RE.sub("", valor)
        if len(digits) <= 11:
            params = TRF1PublicSearchParams(document_kind="cpf", document_number=valor)
        else:
            params = TRF1PublicSearchParams(document_kind="cnpj", document_number=valor)
        return self._buscar_bundle(params)

    def buscar_por_advogado(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        params = TRF1PublicSearchParams(lawyer_name=valor)
        return self._buscar_bundle(params)

    def buscar_por_oab(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        # Parse "OAB/DF 12345" or "12345/DF" or just "12345"
        oab_num = valor.strip()
        oab_state = ""
        oab_suffix = ""
        state_match = re.search(r"([A-Z]{2})", oab_num)
        if state_match:
            oab_state = state_match.group(1)
            oab_num = re.sub(r"[A-Z]{2}", "", oab_num)
        oab_num = re.sub(r"[^\d]", "", oab_num)
        params = TRF1PublicSearchParams(
            oab_number=oab_num,
            oab_state=oab_state,
            oab_suffix=oab_suffix,
        )
        return self._buscar_bundle(params)
