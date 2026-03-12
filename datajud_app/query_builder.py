"""Construcao de consultas documentadas do DataJud."""

from __future__ import annotations

from typing import Any


def build_filter_query(
    *,
    numero_processo: str = "",
    classe_codigo: int | None = None,
    orgao_julgador_codigo: int | None = None,
    assunto_codigo: int | None = None,
    assuntos_codigos: list[int] | None = None,
    assuntos_excluir_codigos: list[int] | None = None,
    movimento_codigo: int | None = None,
    grau: str = "",
    sistema_codigo: int | None = None,
    formato_codigo: int | None = None,
    nivel_sigilo: int | None = None,
    data_ajuizamento_inicio: str = "",
    data_ajuizamento_fim: str = "",
    data_atualizacao_inicio: str = "",
    data_atualizacao_fim: str = "",
    extra_must: list[dict[str, Any]] | None = None,
    extra_filter: list[dict[str, Any]] | None = None,
    extra_must_not: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    must: list[dict[str, Any]] = []
    filters: list[dict[str, Any]] = []
    must_not: list[dict[str, Any]] = []

    if numero_processo:
        must.append({"match": {"numeroProcesso": numero_processo}})
    if classe_codigo is not None:
        must.append({"match": {"classe.codigo": classe_codigo}})
    if orgao_julgador_codigo is not None:
        must.append({"match": {"orgaoJulgador.codigo": orgao_julgador_codigo}})
    if assuntos_codigos:
        for code in assuntos_codigos:
            must.append({"match": {"assuntos.codigo": code}})
    elif assunto_codigo is not None:
        must.append({"match": {"assuntos.codigo": assunto_codigo}})
    if assuntos_excluir_codigos:
        for code in assuntos_excluir_codigos:
            must_not.append({"match": {"assuntos.codigo": code}})
    if movimento_codigo is not None:
        must.append({"match": {"movimentos.codigo": movimento_codigo}})
    if grau:
        must.append({"match": {"grau": grau}})
    if sistema_codigo is not None:
        must.append({"match": {"sistema.codigo": sistema_codigo}})
    if formato_codigo is not None:
        must.append({"match": {"formato.codigo": formato_codigo}})
    if nivel_sigilo is not None:
        must.append({"match": {"nivelSigilo": nivel_sigilo}})

    data_ajuizamento_range = _range_clause(
        "dataAjuizamento", data_ajuizamento_inicio, data_ajuizamento_fim
    )
    if data_ajuizamento_range:
        filters.append(data_ajuizamento_range)

    data_atualizacao_range = _range_clause(
        "dataHoraUltimaAtualizacao", data_atualizacao_inicio, data_atualizacao_fim
    )
    if data_atualizacao_range:
        filters.append(data_atualizacao_range)

    if extra_must:
        must.extend(extra_must)
    if extra_filter:
        filters.extend(extra_filter)
    if extra_must_not:
        must_not.extend(extra_must_not)

    bool_query: dict[str, Any] = {}
    if must:
        bool_query["must"] = must
    if filters:
        bool_query["filter"] = filters
    if must_not:
        bool_query["must_not"] = must_not

    return {"query": {"bool": bool_query or {"must": [{"match_all": {}}]}}}


def _range_clause(field: str, start: str, end: str) -> dict[str, Any] | None:
    values: dict[str, Any] = {}
    if start:
        values["gte"] = start
    if end:
        values["lte"] = end
    if not values:
        return None
    return {"range": {field: values}}
