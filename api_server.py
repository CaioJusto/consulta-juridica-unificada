#!/usr/bin/env python3
"""
API backend unificado — 3 fontes de consulta:
  1. TRF1 Processual (2ª instância) — requests direto
  2. DataJud API (CNJ) — Elasticsearch via API pública
  3. TRF1 Consulta Pública 1º Grau (PJe) — Playwright
"""
import sys
import os
import json
import re
import html as html_mod
import xml.etree.ElementTree as ET
import threading
import uuid
import logging
import traceback
from datetime import datetime
from typing import Any

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("api_server")

ENABLE_TRF1_SCRAPING = os.environ.get("ENABLE_TRF1_SCRAPING", "true").lower() in ("true", "1", "yes")
TRF1_PROXY_URL = os.environ.get("TRF1_PROXY_URL", "").strip()

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "trf1_consulta"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "automacao-datajud-trf1"))

import requests
from fastapi import FastAPI, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from dataclasses import asdict
from trf1_client import TRF1Client, TRF1SearchTooBroadError, formatar_numero_processo
from pipeline_store import (
    delete_all_pipeline_jobs,
    delete_pipeline_job,
    load_pipeline_jobs,
    save_pipeline_job,
)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ═══════════════════════════════════════════════════════════════
# DataJud constants
# ═══════════════════════════════════════════════════════════════

DATAJUD_API_KEY = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="
DATAJUD_BASE_URL = "https://api-publica.datajud.cnj.jus.br"
SGT_WSDL_URL = "https://www.cnj.jus.br/sgt/sgt_ws.php"

TRIBUNAL_OPTIONS = [
    {"label": "Superior Tribunal de Justiça", "alias": "api_publica_stj"},
    {"label": "TRF da 1ª Região", "alias": "api_publica_trf1"},
    {"label": "TRF da 2ª Região", "alias": "api_publica_trf2"},
    {"label": "TRF da 3ª Região", "alias": "api_publica_trf3"},
    {"label": "TRF da 4ª Região", "alias": "api_publica_trf4"},
    {"label": "TRF da 5ª Região", "alias": "api_publica_trf5"},
    {"label": "TRF da 6ª Região", "alias": "api_publica_trf6"},
    {"label": "TJ do Acre", "alias": "api_publica_tjac"},
    {"label": "TJ de Alagoas", "alias": "api_publica_tjal"},
    {"label": "TJ do Amazonas", "alias": "api_publica_tjam"},
    {"label": "TJ do Amapá", "alias": "api_publica_tjap"},
    {"label": "TJ da Bahia", "alias": "api_publica_tjba"},
    {"label": "TJ do Ceará", "alias": "api_publica_tjce"},
    {"label": "TJ do DF e Territórios", "alias": "api_publica_tjdft"},
    {"label": "TJ do Espírito Santo", "alias": "api_publica_tjes"},
    {"label": "TJ de Goiás", "alias": "api_publica_tjgo"},
    {"label": "TJ do Maranhão", "alias": "api_publica_tjma"},
    {"label": "TJ de Minas Gerais", "alias": "api_publica_tjmg"},
    {"label": "TJ de Mato Grosso do Sul", "alias": "api_publica_tjms"},
    {"label": "TJ de Mato Grosso", "alias": "api_publica_tjmt"},
    {"label": "TJ do Pará", "alias": "api_publica_tjpa"},
    {"label": "TJ da Paraíba", "alias": "api_publica_tjpb"},
    {"label": "TJ de Pernambuco", "alias": "api_publica_tjpe"},
    {"label": "TJ do Piauí", "alias": "api_publica_tjpi"},
    {"label": "TJ do Paraná", "alias": "api_publica_tjpr"},
    {"label": "TJ do Rio de Janeiro", "alias": "api_publica_tjrj"},
    {"label": "TJ do Rio Grande do Norte", "alias": "api_publica_tjrn"},
    {"label": "TJ de Rondônia", "alias": "api_publica_tjro"},
    {"label": "TJ de Roraima", "alias": "api_publica_tjrr"},
    {"label": "TJ do Rio Grande do Sul", "alias": "api_publica_tjrs"},
    {"label": "TJ de Santa Catarina", "alias": "api_publica_tjsc"},
    {"label": "TJ de Sergipe", "alias": "api_publica_tjse"},
    {"label": "TJ de São Paulo", "alias": "api_publica_tjsp"},
    {"label": "TJ de Tocantins", "alias": "api_publica_tjto"},
    {"label": "TST", "alias": "api_publica_tst"},
    {"label": "TSE", "alias": "api_publica_tse"},
    {"label": "STM", "alias": "api_publica_stm"},
]

TRIBUNAL_BY_ALIAS = {t["alias"]: t["label"] for t in TRIBUNAL_OPTIONS}

CREDIT_PRESET_CONFIGS: dict[str, dict[str, Any]] = {
    "precatorio_pendente": {
        "label": "Precatório pendente",
        "description": (
            "Busca processos com assunto de precatório e indício de expedição, "
            "excluindo sinais estruturados de pagamento ou levantamento."
        ),
        "default_grau": "G1",
        "subject_codes": [10672, 13506],
        "positive_movement_codes": [12457, 15247, 12165],
        "negative_movement_codes": [12447, 1049, 12449, 12548],
        "related_classes": [12078, 15215, 156, 157],
    },
    "rpv_pendente": {
        "label": "RPV pendente",
        "description": (
            "Busca processos com assunto de RPV e indício de expedição, "
            "excluindo sinais estruturados de pagamento ou levantamento."
        ),
        "default_grau": "G1",
        "subject_codes": [10673, 14842],
        "positive_movement_codes": [12457, 15248, 12165],
        "negative_movement_codes": [12447, 1049, 12449, 12548],
        "related_classes": [12078, 15215, 156, 157],
    },
}


# ═══════════════════════════════════════════════════════════════
# Health
# ═══════════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config/status")
def config_status():
    return {
        "trf1_scraping_enabled": ENABLE_TRF1_SCRAPING,
        "trf1_proxy_configured": bool(TRF1_PROXY_URL),
        "trf1_proxy_url": TRF1_PROXY_URL[:20] + "..." if len(TRF1_PROXY_URL) > 20 else TRF1_PROXY_URL or None,
        "playwright_use_xvfb": os.environ.get("PLAYWRIGHT_USE_XVFB", "1"),
        "trf1_processual_headless": os.environ.get("TRF1_PROCESSUAL_HEADLESS", "auto"),
        "trf1_public_headless": os.environ.get("TRF1_PUBLIC_HEADLESS", "auto"),
        "trf1_playwright_ws_configured": bool(os.environ.get("TRF1_PLAYWRIGHT_WS_ENDPOINT", "").strip()),
        "trf1_playwright_cdp_configured": bool(os.environ.get("TRF1_PLAYWRIGHT_CDP_URL", "").strip()),
    }


# ═══════════════════════════════════════════════════════════════
# FONTE 1: TRF1 Processual (2ª Instância) — endpoints existentes
# ═══════════════════════════════════════════════════════════════

@app.get("/api/processo")
def buscar_processo(
    numero: str = Query("", description="Número do processo"),
    secao: str = Query("TRF1", description="Seção judiciária"),
    url: str = Query("", description="URL direta do processo no portal processual"),
):
    from fastapi.responses import JSONResponse
    try:
        if not numero.strip() and not url.strip():
            return {"success": False, "error": "Informe o número do processo ou uma URL direta"}
        client = TRF1Client(secao=secao, timeout=30)
        proc = client.buscar_por_url(url.strip()) if url.strip() else client.buscar_por_numero(numero)
        if proc is None:
            return {"success": False, "error": "Processo não encontrado"}
        return {"success": True, "data": proc.to_dict()}
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, ConnectionError, TimeoutError) as e:
        logger.warning("TRF1 Processual indisponível: %s", e)
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Enriquecimento TRF1 indisponível neste ambiente. O serviço pode estar bloqueado ou temporariamente fora do ar."},
        )
    except Exception as e:
        logger.error("Erro /api/processo: %s\n%s", e, traceback.format_exc())
        return {"success": False, "error": f"Erro ao consultar: {str(e)}"}


@app.get("/api/buscar")
def buscar_lista(
    tipo: str = Query(..., description="Tipo de busca"),
    valor: str = Query(..., description="Valor de busca"),
    secao: str = Query("TRF1", description="Seção judiciária"),
    baixados: str = Query("false", description="Mostrar processos baixados"),
):
    try:
        client = TRF1Client(secao=secao, timeout=30)
        mostrar_baixados = baixados.lower() == "true"

        if tipo == "nomeParte":
            resultados = client.buscar_por_nome(valor, mostrar_baixados)
        elif tipo == "cpfCnpj":
            resultados = client.buscar_por_cpf_cnpj(valor, mostrar_baixados)
        elif tipo == "nomeAdvogado":
            resultados = client.buscar_por_advogado(valor, mostrar_baixados)
        elif tipo == "oab":
            resultados = client.buscar_por_oab(valor, mostrar_baixados)
        else:
            return {"success": False, "error": "Tipo de busca inválido"}

        if not resultados:
            return {"success": False, "error": "Nenhum resultado encontrado"}

        return {
            "success": True,
            "data": [asdict(r) for r in resultados],
        }
    except TRF1SearchTooBroadError as e:
        return {"success": False, "error": str(e) or "Pesquisa ampla demais. Refine o termo informado."}
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout, ConnectionError, TimeoutError) as e:
        from fastapi.responses import JSONResponse
        logger.warning("TRF1 Processual indisponível: %s", e)
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Enriquecimento TRF1 indisponível neste ambiente. O serviço pode estar bloqueado ou temporariamente fora do ar."},
        )
    except Exception as e:
        logger.error("Erro /api/buscar: %s\n%s", e, traceback.format_exc())
        return {"success": False, "error": f"Erro ao consultar: {str(e)}"}


# ═══════════════════════════════════════════════════════════════
# FONTE 2: DataJud API (CNJ)
# ═══════════════════════════════════════════════════════════════

def _datajud_search(tribunal_alias: str, body: dict, api_key: str = DATAJUD_API_KEY) -> dict:
    """Faz POST no endpoint DataJud."""
    url = f"{DATAJUD_BASE_URL}/{tribunal_alias}/_search"
    headers = {
        "Authorization": f"APIKey {api_key}",
        "Content-Type": "application/json",
    }
    resp = requests.post(url, json=body, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _extract_total_hits(raw: dict) -> int:
    """Compat: hits.total can be object ({value}) or int depending on ES version."""
    total = raw.get("hits", {}).get("total", 0)
    if isinstance(total, dict):
        return int(total.get("value", 0) or 0)
    try:
        return int(total or 0)
    except Exception:
        return 0


def _safe_int(value: Any) -> int | None:
    """Best-effort int parser; returns None for blank/invalid values."""
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value == value else None
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(text)
    except Exception:
        return None


def _apply_credit_preset_filters(
    preset_key: str,
    *,
    must: list[dict[str, Any]],
    must_not: list[dict[str, Any]],
    default_target: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    preset = CREDIT_PRESET_CONFIGS.get((preset_key or "").strip())
    if not preset:
        return None

    must.append(
        {
            "bool": {
                "should": [{"match": {"assuntos.codigo": code}} for code in preset["subject_codes"]],
                "minimum_should_match": 1,
            }
        }
    )
    must.append(
        {
            "bool": {
                "should": [
                    {"match": {"movimentos.codigo": code}}
                    for code in preset["positive_movement_codes"]
                ],
                "minimum_should_match": 1,
            }
        }
    )
    for code in preset["negative_movement_codes"]:
        must_not.append({"match": {"movimentos.codigo": code}})

    if default_target is not None and not str(default_target.get("grau") or "").strip():
        default_target["grau"] = preset.get("default_grau", "")

    return preset


def _numero_processo_clauses(raw_numero: str) -> list[dict]:
    """
    Build robust clauses for process number matching.
    DataJud indexes can store numeroProcesso formatted and/or normalized.
    """
    numero = (raw_numero or "").strip()
    if not numero:
        return []

    digits = re.sub(r"\D", "", numero)
    candidates: list[str] = []
    if numero:
        candidates.append(numero)
    if digits and digits != numero:
        candidates.append(digits)
    if digits and len(digits) == 20:
        formatted = (
            f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}."
            f"{digits[13:14]}.{digits[14:16]}.{digits[16:20]}"
        )
        if formatted not in candidates:
            candidates.append(formatted)

    should: list[dict] = []
    for cand in candidates:
        should.append({"term": {"numeroProcesso.keyword": cand}})
        should.append({"term": {"numeroProcesso": cand}})
        should.append({"match": {"numeroProcesso": cand}})

    return [{
        "bool": {
            "should": should,
            "minimum_should_match": 1,
        }
    }]


def _parse_datajud_date(raw: str) -> str:
    """Parse DataJud dates which come in various formats."""
    if not raw:
        return ""
    # ISO format: 2026-03-10T14:31:49.745000Z
    if "T" in raw or "-" in raw:
        return raw  # Already ISO, frontend can handle
    # Compact format: 20241127085254 (YYYYMMDDHHmmss)
    raw = raw.strip()
    if len(raw) >= 8 and raw.isdigit():
        try:
            y, mo, d = raw[:4], raw[4:6], raw[6:8]
            h, mi, s = "00", "00", "00"
            if len(raw) >= 14:
                h, mi, s = raw[8:10], raw[10:12], raw[12:14]
            return f"{y}-{mo}-{d}T{h}:{mi}:{s}"
        except Exception:
            pass
    return raw


def _normalize_date_for_range(date_str: str) -> str:
    """Normalize date input for Elasticsearch range queries.

    Some tribunals (e.g. TJSP) store dataAjuizamento as compact digits
    like '20231211161834' instead of ISO 8601. We accept user input as
    ISO dates (YYYY-MM-DD) and also emit the compact format so both
    index formats are covered via a multi-format range query.
    """
    if not date_str:
        return ""
    date_str = date_str.strip()
    # Already compact digits — convert to ISO
    if date_str.isdigit() and len(date_str) >= 8:
        y, mo, d = date_str[:4], date_str[4:6], date_str[6:8]
        h, mi, s = "00", "00", "00"
        if len(date_str) >= 14:
            h, mi, s = date_str[8:10], date_str[10:12], date_str[12:14]
        return f"{y}-{mo}-{d}T{h}:{mi}:{s}"
    # Standard ISO input — keep as-is
    return date_str


def _date_range_filter(field: str, start: str, end: str) -> list[dict]:
    """Build range filter(s) for a date field, handling both ISO and compact formats."""
    start = _normalize_date_for_range(start)
    end = _normalize_date_for_range(end)
    if not start and not end:
        return []
    date_range: dict[str, Any] = {}
    if start:
        date_range["gte"] = start
    if end:
        date_range["lte"] = end
    # Use format param so ES can parse both ISO and compact yyyyMMddHHmmss
    date_range["format"] = "strict_date_optional_time||yyyyMMddHHmmss||yyyy-MM-dd"
    return [{"range": {field: date_range}}]


def _format_grau(raw: str) -> str:
    """Format grau value for display."""
    mapping = {
        "G1": "1º Grau",
        "G2": "2º Grau",
        "TR": "Turma Recursal",
        "JE": "Juizado Especial",
        "REsp": "Recurso Especial",
        "SUP": "Superior",
        "ORI": "Originário",
    }
    return mapping.get(raw, raw)


def _parse_datajud_hits(raw: dict, tribunal_alias: str) -> list[dict]:
    """Converte hits do Elasticsearch em formato padronizado."""
    processos = []
    hits = raw.get("hits", {}).get("hits", [])
    for hit in hits:
        src = hit.get("_source", {})
        numero = src.get("numeroProcesso", "")
        classe_obj = src.get("classe", {})
        orgao_obj = src.get("orgaoJulgador", {})

        # Assuntos
        assuntos_raw = src.get("assuntos", [])
        assuntos = [
            {"codigo": a.get("codigo", 0), "nome": a.get("nome", "")}
            for a in assuntos_raw
        ]

        # Movimentos (pegar últimos 50)
        movimentos_raw = src.get("movimentos", [])
        movimentos = []
        for m in movimentos_raw[:50]:
            complementos_raw = m.get("complementosTabelados", [])
            complemento_str = "; ".join(
                f"{c.get('nome', '')}: {c.get('valor', '')}"
                for c in complementos_raw
                if c.get("nome") or c.get("valor")
            )
            movimentos.append({
                "codigo": m.get("codigo", 0),
                "nome": m.get("nome", ""),
                "data_hora": m.get("dataHora", ""),
                "complementos": complemento_str,
            })

        processos.append({
            "numero_processo": numero,
            "classe": classe_obj.get("nome", ""),
            "classe_codigo": classe_obj.get("codigo", 0),
            "orgao_julgador": orgao_obj.get("nome", ""),
            "orgao_julgador_codigo": orgao_obj.get("codigo", 0),
            "assuntos": assuntos,
            "movimentos": movimentos,
            "data_ajuizamento": _parse_datajud_date(src.get("dataAjuizamento", "")),
            "ultima_atualizacao": _parse_datajud_date(src.get("dataHoraUltimaAtualizacao", "")),
            "grau": src.get("grau", ""),
            "sistema": (src.get("sistema") or {}).get("nome", ""),
            "formato": (src.get("formato") or {}).get("nome", ""),
            "nivel_sigilo": src.get("nivelSigilo", 0),
            "tribunal": TRIBUNAL_BY_ALIAS.get(tribunal_alias, tribunal_alias),
        })
    return processos


@app.get("/api/datajud/tribunais")
def datajud_tribunais():
    """Lista de tribunais disponíveis."""
    return {"success": True, "data": TRIBUNAL_OPTIONS}


@app.get("/api/datajud/presets")
def datajud_credit_presets():
    return {
        "success": True,
        "data": [
            {
                "key": key,
                "label": preset["label"],
                "description": preset["description"],
                "default_grau": preset["default_grau"],
                "subject_codes": preset["subject_codes"],
                "positive_movement_codes": preset["positive_movement_codes"],
                "negative_movement_codes": preset["negative_movement_codes"],
                "related_classes": preset["related_classes"],
            }
            for key, preset in CREDIT_PRESET_CONFIGS.items()
        ],
    }


@app.post("/api/datajud/buscar")
def datajud_buscar(payload: dict = Body(...)):
    """
    Busca no DataJud com filtros completos.
    Body: {
      tribunal_alias: string,
      numero_processo?: string,
      classe_codigo?: int,
      assunto_codigo?: int,
      assuntos_codigos?: int[],         # múltiplos assuntos (AND)
      assuntos_excluir_codigos?: int[], # excluir assuntos
      movimento_codigo?: int,           # filtrar por movimentação
      orgao_julgador_codigo?: int,
      credit_preset?: string,           # precatorio_pendente | rpv_pendente
      grau?: string,
      sistema_codigo?: int,
      formato_codigo?: int,
      nivel_sigilo?: int,
      data_ajuizamento_inicio?: string,
      data_ajuizamento_fim?: string,
      data_atualizacao_inicio?: string,
      data_atualizacao_fim?: string,
      # Filtros de presença
      tem_assuntos?: bool,        # exists assuntos
      tem_movimentos?: bool,      # exists movimentos
      min_movimentos?: int,       # script filter: qtd mínima movimentos
      max_movimentos?: int,       # script filter: qtd máxima movimentos
      # Paginação
      page_size?: int (default 20, max 10000),
      search_after?: list,
      sort_field?: string (default "dataHoraUltimaAtualizacao"),
      sort_order?: string (default "desc"),
    }
    """
    try:
        tribunal_alias = (payload.get("tribunal_alias") or "api_publica_trf1").strip()
        if not tribunal_alias:
            tribunal_alias = "api_publica_trf1"
        page_size = max(1, min(int(payload.get("page_size", 20)), 10000))

        # Construir query
        must: list[dict] = []
        filters: list[dict] = []
        must_not: list[dict] = []

        # Número do processo
        numero = (payload.get("numero_processo") or "").strip()
        must.extend(_numero_processo_clauses(numero))

        # Classe
        classe_codigo = _safe_int(payload.get("classe_codigo"))
        if classe_codigo is not None:
            must.append({"term": {"classe.codigo": classe_codigo}})

        # Assuntos (múltiplos — AND)
        assuntos_codigos = payload.get("assuntos_codigos") or []
        if assuntos_codigos:
            for code in assuntos_codigos:
                code_int = _safe_int(code)
                if code_int is not None:
                    must.append({"term": {"assuntos.codigo": code_int}})
        else:
            assunto_codigo = _safe_int(payload.get("assunto_codigo"))
            if assunto_codigo is not None:
                must.append({"term": {"assuntos.codigo": assunto_codigo}})

        # Assuntos excluídos
        assuntos_excluir = payload.get("assuntos_excluir_codigos") or []
        for code in assuntos_excluir:
            code_int = _safe_int(code)
            if code_int is not None:
                must_not.append({"term": {"assuntos.codigo": code_int}})

        _apply_credit_preset_filters(
            str(payload.get("credit_preset") or ""),
            must=must,
            must_not=must_not,
            default_target=payload,
        )

        # Movimentação
        movimento_codigo = _safe_int(payload.get("movimento_codigo"))
        if movimento_codigo is not None:
            must.append({"term": {"movimentos.codigo": movimento_codigo}})

        # Órgão julgador
        orgao_julgador_codigo = _safe_int(payload.get("orgao_julgador_codigo"))
        if orgao_julgador_codigo is not None:
            must.append({"term": {"orgaoJulgador.codigo": orgao_julgador_codigo}})

        # Grau
        grau = (payload.get("grau") or "").strip()
        if grau and grau.lower() != "all" and grau != "__all__":
            must.append({"term": {"grau.keyword": grau}})

        # Sistema
        sistema_codigo = _safe_int(payload.get("sistema_codigo"))
        if sistema_codigo is not None:
            must.append({"term": {"sistema.codigo": sistema_codigo}})

        # Formato
        formato_codigo = _safe_int(payload.get("formato_codigo"))
        if formato_codigo is not None:
            must.append({"term": {"formato.codigo": formato_codigo}})

        # Nível de sigilo
        nivel_sigilo = _safe_int(payload.get("nivel_sigilo"))
        if nivel_sigilo is not None:
            must.append({"term": {"nivelSigilo": nivel_sigilo}})

        # Filtros de presença (exists / not exists)
        tem_assuntos = payload.get("tem_assuntos")
        if tem_assuntos is True:
            filters.append({"exists": {"field": "assuntos"}})
        elif tem_assuntos is False:
            must_not.append({"exists": {"field": "assuntos"}})

        tem_movimentos = payload.get("tem_movimentos")
        if tem_movimentos is True:
            filters.append({"exists": {"field": "movimentos"}})
        elif tem_movimentos is False:
            must_not.append({"exists": {"field": "movimentos"}})

        # Quantidade de movimentações (via script)
        min_mov = _safe_int(payload.get("min_movimentos"))
        max_mov = _safe_int(payload.get("max_movimentos"))
        if min_mov is not None or max_mov is not None:
            script_parts = []
            params = {}
            if min_mov is not None:
                script_parts.append(
                    "(doc.containsKey('movimentos.codigo') ? doc['movimentos.codigo'].size() : 0) >= params.minMov"
                )
                params["minMov"] = min_mov
            if max_mov is not None:
                script_parts.append(
                    "(doc.containsKey('movimentos.codigo') ? doc['movimentos.codigo'].size() : 0) <= params.maxMov"
                )
                params["maxMov"] = max_mov
            filters.append({
                "script": {
                    "script": {
                        "source": " && ".join(script_parts),
                        "params": params,
                    }
                }
            })

        # Date ranges — ajuizamento (normalized for compact/ISO formats)
        filters.extend(_date_range_filter(
            "dataAjuizamento",
            payload.get("data_ajuizamento_inicio", ""),
            payload.get("data_ajuizamento_fim", ""),
        ))

        # Date ranges — atualização
        filters.extend(_date_range_filter(
            "dataHoraUltimaAtualizacao",
            payload.get("data_atualizacao_inicio", ""),
            payload.get("data_atualizacao_fim", ""),
        ))

        # Construir bool query
        bool_query: dict[str, Any] = {}
        if must:
            bool_query["must"] = must
        if filters:
            bool_query["filter"] = filters
        if must_not:
            bool_query["must_not"] = must_not
        query_clause: dict[str, Any]
        if not bool_query:
            query_clause = {"match_all": {}}
        else:
            query_clause = {"bool": bool_query}

        # Sort
        sort_field = payload.get("sort_field", "dataHoraUltimaAtualizacao")
        sort_order = payload.get("sort_order", "desc")
        body: dict[str, Any] = {
            "size": page_size,
            "query": query_clause,
            "sort": [{sort_field: {"order": sort_order}}],
        }

        # search_after para paginação
        search_after = payload.get("search_after")
        if search_after:
            body["search_after"] = search_after

        raw = _datajud_search(tribunal_alias, body)
        total = _extract_total_hits(raw)
        processos = _parse_datajud_hits(raw, tribunal_alias)

        # Extrair search_after do último hit
        hits = raw.get("hits", {}).get("hits", [])
        next_search_after = hits[-1].get("sort") if hits else None

        return {
            "success": True,
            "data": {
                "total": total,
                "processos": processos,
                "page_size": page_size,
                "returned": len(processos),
                "search_after": next_search_after,
            },
        }
    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else 0
        detail = ""
        try:
            detail = e.response.text[:500] if e.response is not None else ""
        except Exception:
            pass
        return {"success": False, "error": f"DataJud retornou erro HTTP {status}: {detail}"}
    except Exception as e:
        return {"success": False, "error": f"Erro DataJud: {str(e)}"}


@app.get("/api/datajud/orgaos")
def datajud_orgaos(
    tribunal: str = Query("api_publica_trf1"),
    q: str = Query("", description="Texto de busca do órgão julgador"),
):
    """Busca órgãos julgadores por nome via aggregation no DataJud."""
    try:
        if not q.strip():
            return {"success": True, "data": []}

        agg_body: dict[str, Any] = {
            "size": 0,
            "query": {"match": {"orgaoJulgador.nome": q.strip()}},
            "aggs": {
                "orgaos": {
                    "terms": {"field": "orgaoJulgador.codigo", "size": 50},
                    "aggs": {
                        "top": {
                            "top_hits": {
                                "size": 1,
                                "_source": ["orgaoJulgador.codigo", "orgaoJulgador.nome"],
                            }
                        }
                    },
                }
            },
        }

        raw = _datajud_search(tribunal, agg_body)
        items = []
        for bucket in raw.get("aggregations", {}).get("orgaos", {}).get("buckets", []):
            hits_inner = bucket.get("top", {}).get("hits", {}).get("hits", [])
            if not hits_inner:
                continue
            orgao = hits_inner[0].get("_source", {}).get("orgaoJulgador", {})
            if orgao.get("codigo") and orgao.get("nome"):
                items.append({"codigo": orgao["codigo"], "nome": orgao["nome"]})

        items.sort(key=lambda x: x["nome"].lower())
        return {"success": True, "data": items}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/datajud/filter-options")
def datajud_filter_options(
    tribunal: str = Query("api_publica_trf1"),
    kind: str = Query(..., description="grau, sistema ou formato"),
):
    """Retorna opções de filtro dinamicamente via aggregation."""
    try:
        configs = {
            "grau": {"agg_field": "grau.keyword", "source_fields": ["grau"], "value_path": ["grau"], "code_path": None},
            "sistema": {"agg_field": "sistema.codigo", "source_fields": ["sistema.codigo", "sistema.nome"], "value_path": ["sistema", "nome"], "code_path": ["sistema", "codigo"]},
            "formato": {"agg_field": "formato.codigo", "source_fields": ["formato.codigo", "formato.nome"], "value_path": ["formato", "nome"], "code_path": ["formato", "codigo"]},
        }
        config = configs.get(kind)
        if not config:
            return {"success": False, "error": "Tipo inválido. Use: grau, sistema, formato"}

        agg_body: dict[str, Any] = {
            "size": 0,
            "query": {"match_all": {}},
            "aggs": {
                "items": {
                    "terms": {"field": config["agg_field"], "size": 100},
                    "aggs": {
                        "top": {
                            "top_hits": {
                                "size": 1,
                                "_source": config["source_fields"],
                            }
                        }
                    },
                }
            },
        }

        raw = _datajud_search(tribunal, agg_body)
        items = []
        for bucket in raw.get("aggregations", {}).get("items", {}).get("buckets", []):
            hits_inner = bucket.get("top", {}).get("hits", {}).get("hits", [])
            if not hits_inner:
                continue
            source = hits_inner[0].get("_source", {})
            # Navigate nested path
            nome = source
            for p in config["value_path"]:
                nome = nome.get(p) if isinstance(nome, dict) else None
            codigo = None
            if config["code_path"]:
                codigo = source
                for p in config["code_path"]:
                    codigo = codigo.get(p) if isinstance(codigo, dict) else None
            else:
                codigo = bucket.get("key")
            if nome:
                items.append({"codigo": codigo, "nome": nome})

        items.sort(key=lambda x: str(x["nome"]).lower())
        return {"success": True, "data": items}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/datajud/sgt")
def datajud_sgt_search(
    kind: str = Query(..., description="classe, assunto ou movimento"),
    q: str = Query(..., description="Texto de busca"),
):
    """Busca classes/assuntos/movimentos no SGT do CNJ (SOAP)."""
    try:
        table_types = {"classe": "C", "assunto": "A", "movimento": "M"}
        table_type = table_types.get(kind)
        if not table_type:
            return {"success": False, "error": "Tipo inválido. Use: classe, assunto, movimento"}

        def _escape_xml(v: str) -> str:
            return v.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")

        soap_body = f"""<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:tns="https://www.cnj.jus.br/sgt/sgt_ws.php">
  <soapenv:Body>
    <tns:pesquisarItemPublicoWS>
      <tipoTabela>{table_type}</tipoTabela>
      <tipoPesquisa>N</tipoPesquisa>
      <valorPesquisa>{_escape_xml(q.strip())}</valorPesquisa>
    </tns:pesquisarItemPublicoWS>
  </soapenv:Body>
</soapenv:Envelope>"""

        resp = requests.post(
            SGT_WSDL_URL,
            data=soap_body.encode("utf-8"),
            headers={
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": f"{SGT_WSDL_URL}#pesquisarItemPublicoWS",
            },
            timeout=30,
        )
        resp.raise_for_status()

        root = ET.fromstring(resp.content)
        items = []
        html_tag_re = re.compile(r"<[^>]+>")
        for item_node in root.iter():
            tag = item_node.tag.rsplit("}", 1)[-1]
            if tag != "Item":
                continue

            def child_text(name: str) -> str:
                for ch in item_node:
                    if ch.tag.rsplit("}", 1)[-1] == name:
                        return ch.text or ""
                return ""

            raw_name = html_mod.unescape(child_text("nome") or "")
            raw_name = html_tag_re.sub(" ", raw_name)
            raw_name = " ".join(raw_name.strip().split())

            raw_gloss = html_mod.unescape(child_text("dscGlossario") or "")
            raw_gloss = html_tag_re.sub(" ", raw_gloss)
            raw_gloss = " ".join(raw_gloss.strip().split())

            items.append({
                "codigo": child_text("cod_item"),
                "nome": raw_name,
                "glossario": raw_gloss,
                "tipo": kind,
            })

        # Dedup
        seen: dict[str, dict] = {}
        for item in items:
            cod = str(item.get("codigo", "")).strip()
            if cod and cod not in seen:
                seen[cod] = item

        result = sorted(seen.values(), key=lambda x: (x.get("nome", "").lower(), x.get("codigo", "")))
        return {"success": True, "data": result[:50]}
    except Exception as e:
        return {"success": False, "error": f"Erro SGT: {str(e)}"}


# ═══════════════════════════════════════════════════════════════
# FONTE 3: TRF1 Consulta Pública 1º Grau (PJe)
# Usa requests + BeautifulSoup quando possível
# ═══════════════════════════════════════════════════════════════

TRF1_PUBLIC_BASE = "https://pje1g-consultapublica.trf1.jus.br"
TRF1_PUBLIC_SEARCH_URL = f"{TRF1_PUBLIC_BASE}/consultapublica/ConsultaPublica/listView.seam"
TRF1_PUBLIC_DETAIL_RE = re.compile(
    r"DetalheProcessoConsultaPublica/listView\.seam\?ca=[^\"'\s<]+"
)
CNJ_FORMAT_RE = re.compile(r"^(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})$")


def _format_cnj(raw: str) -> str:
    """Formata número CNJ: 0000000-00.0000.0.00.0000"""
    digits = re.sub(r"\D", "", raw)
    m = CNJ_FORMAT_RE.match(digits)
    if m:
        return f"{m.group(1)}-{m.group(2)}.{m.group(3)}.{m.group(4)}.{m.group(5)}.{m.group(6)}"
    return raw


def _build_trf1_public_process_payload(
    row: dict[str, Any],
    *,
    party_rows: list[dict[str, Any]],
    lawyer_rows: list[dict[str, Any]],
    event_rows: list[dict[str, Any]],
    document_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    numero = row.get("numero_processo", "")

    partes = []
    for p in party_rows:
        if p.get("numero_processo") != numero:
            continue
        related_lawyers = [
            lawyer for lawyer in lawyer_rows
            if lawyer.get("numero_processo") == numero
            and lawyer.get("polo") == p.get("polo")
        ]
        partes.append(
            {
                "nome": p.get("nome", ""),
                "polo": p.get("polo", ""),
                "tipo_participacao": p.get("tipo_registro", ""),
                "documentos": p.get("documento", ""),
                "advogados": " | ".join(
                    filter(
                        None,
                        [
                            f"{lawyer.get('nome_advogado', '')} ({lawyer.get('oab_formatada', '')})".strip(" ()")
                            for lawyer in related_lawyers
                        ],
                    )
                ),
                "documento": p.get("documento", ""),
                "documento_tipo": p.get("documento_tipo", ""),
                "papel": p.get("papel", ""),
                "situacao": p.get("situacao", ""),
                "observacao": p.get("observacao", ""),
                "texto_original": p.get("texto_original", ""),
            }
        )

    movimentacoes = []
    for m in event_rows:
        if m.get("numero_processo") != numero:
            continue
        movimentacoes.append(
            {
                "data": m.get("data_hora", ""),
                "tipo": m.get("evento", ""),
                "descricao": m.get("documento_resumo", "") or m.get("evento", ""),
                "documentos": [value for value in [m.get("documento_resumo", "")] if value],
                "documento_url": m.get("documento_url", ""),
            }
        )

    documentos = []
    for d in document_rows:
        if d.get("numero_processo") != numero:
            continue
        documentos.append(
            {
                "ordem": d.get("ordem", ""),
                "data_hora": d.get("data_hora", ""),
                "documento": d.get("documento", ""),
                "certidao": d.get("certidao", ""),
                "url_documento": d.get("url_documento", ""),
                "url_certidao": d.get("url_certidao", ""),
                "texto_documento": d.get("texto_documento", ""),
                "texto_certidao": d.get("texto_certidao", ""),
            }
        )

    return {
        "numero_processo": numero,
        "classe": row.get("classe", ""),
        "classe_codigo": row.get("classe_codigo", ""),
        "assunto": row.get("assuntos", ""),
        "orgao_julgador": row.get("orgao_julgador", ""),
        "jurisdicao": row.get("jurisdicao", ""),
        "endereco_orgao_julgador": row.get("endereco_orgao_julgador", ""),
        "data_distribuicao": row.get("data_distribuicao", ""),
        "valor_causa": row.get("valor_causa", ""),
        "situacao": row.get("ultimo_evento", "") or row.get("ultima_movimentacao_resultado", ""),
        "processo_referencia": row.get("processo_referencia", ""),
        "polo_ativo": row.get("polo_ativo", ""),
        "polo_passivo": row.get("polo_passivo", ""),
        "outros_interessados": row.get("outros_interessados", ""),
        "advogados_resumo": row.get("advogados_resumo", ""),
        "quantidade_partes": row.get("quantidade_partes", 0),
        "quantidade_advogados": row.get("quantidade_advogados", 0),
        "quantidade_eventos": row.get("quantidade_eventos", 0),
        "quantidade_documentos": row.get("quantidade_documentos", 0),
        "cessao_credito": row.get("cessao_credito", ""),
        "cessao_detalhes": row.get("cessao_detalhes", ""),
        "partes_cedentes": row.get("partes_cedentes", ""),
        "partes_nao_cedentes": row.get("partes_nao_cedentes", ""),
        "partes": partes,
        "movimentacoes": movimentacoes,
        "documentos": documentos,
        "url_detalhes": row.get("fonte_url", ""),
    }


@app.get("/api/trf1publico/buscar")
def trf1_publico_buscar(
    numero: str = Query("", description="Número do processo"),
    nome_parte: str = Query("", description="Nome da parte"),
    documento: str = Query("", description="CPF/CNPJ"),
    nome_advogado: str = Query("", description="Nome do advogado"),
    oab: str = Query("", description="Número OAB"),
    oab_uf: str = Query("", description="UF da OAB"),
):
    """
    Consulta pública TRF1 1ª instância.
    Usa Playwright para navegar no formulário do PJe.
    """
    from fastapi.responses import JSONResponse
    if not ENABLE_TRF1_SCRAPING:
        return JSONResponse(
            status_code=503,
            content={"success": False, "error": "Enriquecimento TRF1 indisponível neste ambiente (ENABLE_TRF1_SCRAPING=false)."},
        )
    try:
        # Verificar se algum campo foi preenchido
        if not any([numero.strip(), nome_parte.strip(), documento.strip(), nome_advogado.strip(), oab.strip()]):
            return {"success": False, "error": "Informe pelo menos um critério de busca"}

        from datajud_app.trf1_public import TRF1PublicSearchParams, search_trf1_public_bundle

        params = TRF1PublicSearchParams(
            process_number=numero.strip(),
            party_name=nome_parte.strip(),
            document_number=documento.strip(),
            lawyer_name=nome_advogado.strip(),
            oab_number=oab.strip(),
            oab_state=oab_uf.strip().upper() if oab_uf.strip() else "",
        )

        bundle = search_trf1_public_bundle(params, max_details=10)

        processos = [
            _build_trf1_public_process_payload(
                row,
                party_rows=bundle.party_rows,
                lawyer_rows=bundle.lawyer_rows,
                event_rows=bundle.event_rows,
                document_rows=bundle.document_rows,
            )
            for row in bundle.process_rows
        ]

        return {
            "success": True,
            "data": {
                "total_results": bundle.total_results,
                "processos": processos,
            },
        }
    except ImportError:
        return {
            "success": False,
            "error": "Módulo TRF1 público não disponível. Playwright pode não estar instalado.",
        }
    except Exception as e:
        return {"success": False, "error": f"Erro na consulta pública: {str(e)}"}


# ═══════════════════════════════════════════════════════════════
# Pipeline server-side (background jobs)
# ═══════════════════════════════════════════════════════════════

jobs: dict[str, dict] = load_pipeline_jobs()


def _persist_job(job: dict[str, Any] | None) -> None:
    if not job:
        return
    if job.get("_deleted"):
        try:
            delete_pipeline_job(str(job.get("id") or ""))
        except Exception as exc:
            logger.warning("Falha ao excluir job %s: %s", job.get("id"), exc)
        return
    try:
        save_pipeline_job(job)
    except Exception as exc:
        logger.warning("Falha ao persistir job %s: %s", job.get("id"), exc)


def _delete_job(job_id: str) -> bool:
    job = jobs.get(job_id)
    if job:
        job["status"] = "stopped"
        job["_deleted"] = True
    try:
        delete_pipeline_job(job_id)
    except Exception as exc:
        logger.warning("Falha ao remover job %s do store: %s", job_id, exc)
    removed = jobs.pop(job_id, None)
    return removed is not None or job is not None


def _active_passive_names(partes: list[dict[str, Any]]) -> tuple[str, str]:
    ativos = [p.get("nome", "") for p in partes if "AT" in str(p.get("tipo", "")).upper()]
    passivos = [p.get("nome", "") for p in partes if "PASS" in str(p.get("tipo", "")).upper()]
    return " | ".join(filter(None, ativos[:5])), " | ".join(filter(None, passivos[:5]))


def _advogado_names(partes: list[dict[str, Any]]) -> str:
    advogados = [p.get("nome", "") for p in partes if p.get("oab")]
    return " | ".join(filter(None, advogados[:5]))


def _flatten_processual_process(proc: dict[str, Any]) -> dict[str, Any]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return {
        "numero_processo": numero,
        "numero_antigo": proc.get("numero", ""),
        "nova_numeracao": proc.get("nova_numeracao", ""),
        "grupo": proc.get("grupo", ""),
        "assunto": proc.get("assunto", ""),
        "data_autuacao": proc.get("data_autuacao", ""),
        "orgao_julgador": proc.get("orgao_julgador", ""),
        "juiz_relator": proc.get("juiz_relator", ""),
        "processo_originario": proc.get("processo_originario", ""),
        "situacao": proc.get("situacao", ""),
        "url_consulta": proc.get("url_consulta", ""),
        "url_inteiro_teor": proc.get("url_inteiro_teor", ""),
        "secao": proc.get("secao", ""),
        "quantidade_partes": len(proc.get("partes", []) or []),
        "quantidade_movimentacoes": len(proc.get("movimentacoes", []) or []),
        "quantidade_distribuicoes": len(proc.get("distribuicoes", []) or []),
        "quantidade_peticoes": len(proc.get("peticoes", []) or []),
        "quantidade_documentos": len(proc.get("documentos", []) or []),
        "quantidade_incidentes": len(proc.get("incidentes", []) or []),
        "json_bruto": json.dumps(proc, ensure_ascii=False),
    }


def _flatten_processual_partes(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "tipo": parte.get("tipo", ""),
            "nome": parte.get("nome", ""),
            "entidade": parte.get("entidade", ""),
            "oab": parte.get("oab", ""),
            "caracteristica": parte.get("caracteristica", ""),
        }
        for index, parte in enumerate(proc.get("partes", []) or [], start=1)
    ]


def _flatten_processual_movimentacoes(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "data": mov.get("data", ""),
            "codigo": mov.get("codigo", ""),
            "descricao": mov.get("descricao", ""),
            "complemento": mov.get("complemento", ""),
        }
        for index, mov in enumerate(proc.get("movimentacoes", []) or [], start=1)
    ]


def _flatten_processual_distribuicoes(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "data": item.get("data", ""),
            "descricao": item.get("descricao", ""),
            "juiz": item.get("juiz", ""),
        }
        for index, item in enumerate(proc.get("distribuicoes", []) or [], start=1)
    ]


def _flatten_processual_peticoes(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "numero": item.get("numero", ""),
            "data_entrada": item.get("data_entrada", ""),
            "data_juntada": item.get("data_juntada", ""),
            "tipo": item.get("tipo", ""),
            "complemento": item.get("complemento", ""),
        }
        for index, item in enumerate(proc.get("peticoes", []) or [], start=1)
    ]


def _flatten_processual_documentos(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "descricao": item.get("descricao", ""),
            "data": item.get("data", ""),
            "url": item.get("url", ""),
        }
        for index, item in enumerate(proc.get("documentos", []) or [], start=1)
    ]


def _flatten_processual_incidentes(proc: dict[str, Any]) -> list[dict[str, Any]]:
    numero = proc.get("nova_numeracao") or proc.get("numero") or ""
    return [
        {
            "numero_processo": numero,
            "ordem": index,
            "descricao": item,
        }
        for index, item in enumerate(proc.get("incidentes", []) or [], start=1)
    ]


def _pipeline_status_for_row(
    row: dict[str, Any],
    *,
    processual_enabled: bool,
    publico_enabled: bool,
    processual_not_found: set[str],
    publico_not_found: set[str],
) -> tuple[str, str]:
    numero = row.get("numero_processo", "")
    processual_status = (
        "found"
        if row.get("processual_data")
        else "not_found"
        if numero in processual_not_found
        else "pending"
        if processual_enabled
        else "skipped"
    )
    publico_status = (
        "found"
        if row.get("publico_data")
        else "not_found"
        if numero in publico_not_found
        else "pending"
        if publico_enabled
        else "skipped"
    )
    return processual_status, publico_status


def _pipeline_row_summary(
    row: dict[str, Any],
    *,
    processual_enabled: bool,
    publico_enabled: bool,
    processual_not_found: set[str],
    publico_not_found: set[str],
) -> dict[str, Any]:
    processual_status, publico_status = _pipeline_status_for_row(
        row,
        processual_enabled=processual_enabled,
        publico_enabled=publico_enabled,
        processual_not_found=processual_not_found,
        publico_not_found=publico_not_found,
    )
    processual_data = row.get("processual_data") or {}
    publico_data = row.get("publico_data") or {}
    return {
        "numero_processo": row.get("numero_processo", ""),
        "tribunal": row.get("tribunal", ""),
        "classe": row.get("classe", ""),
        "orgao_julgador": row.get("orgao_julgador", ""),
        "grau": row.get("grau", ""),
        "data_ajuizamento": row.get("data_ajuizamento", ""),
        "ultima_atualizacao": row.get("ultima_atualizacao", ""),
        "assuntos": row.get("assuntos", ""),
        "qtd_movimentos": row.get("qtd_movimentos", 0),
        "ultima_movimentacao": row.get("ultima_movimentacao", ""),
        "polo_ativo_nome": row.get("polo_ativo_nome", ""),
        "polo_passivo_nome": row.get("polo_passivo_nome", ""),
        "advogados": row.get("advogados", ""),
        "situacao_processual": row.get("situacao_processual", ""),
        "valor_causa": row.get("valor_causa", ""),
        "situacao_pje": row.get("situacao_pje", ""),
        "orgao_julgador_pje": row.get("orgao_julgador_pje", ""),
        "tipo_credito": row.get("tipo_credito", ""),
        "status_recebimento": row.get("status_recebimento", ""),
        "motivo_recebimento": row.get("motivo_recebimento", ""),
        "status_oportunidade": row.get("status_oportunidade", ""),
        "motivos_status": row.get("motivos_status", ""),
        "cessao_credito": row.get("cessao_credito", ""),
        "cessao_detalhes": row.get("cessao_detalhes", ""),
        "partes_cedentes": row.get("partes_cedentes", ""),
        "partes_nao_cedentes": row.get("partes_nao_cedentes", ""),
        "movimentos_codigos_detectados": row.get("movimentos_codigos_detectados", ""),
        "assuntos_codigos_detectados": row.get("assuntos_codigos_detectados", ""),
        "processual_status": processual_status,
        "publico_status": publico_status,
        "processual_qtd_partes": len(processual_data.get("partes", []) or []),
        "processual_qtd_movimentacoes": len(processual_data.get("movimentacoes", []) or []),
        "processual_qtd_distribuicoes": len(processual_data.get("distribuicoes", []) or []),
        "processual_qtd_peticoes": len(processual_data.get("peticoes", []) or []),
        "processual_qtd_documentos": len(processual_data.get("documentos", []) or []),
        "processual_qtd_incidentes": len(processual_data.get("incidentes", []) or []),
        "publico_qtd_partes": len(publico_data.get("partes", []) or []),
        "publico_qtd_movimentacoes": len(publico_data.get("movimentacoes", []) or []),
        "publico_qtd_documentos": len(publico_data.get("documentos", []) or []),
    }


def _pipeline_row_detail(
    row: dict[str, Any],
    *,
    processual_enabled: bool,
    publico_enabled: bool,
    processual_not_found: set[str],
    publico_not_found: set[str],
) -> dict[str, Any]:
    detail = dict(row)
    processual_status, publico_status = _pipeline_status_for_row(
        row,
        processual_enabled=processual_enabled,
        publico_enabled=publico_enabled,
        processual_not_found=processual_not_found,
        publico_not_found=publico_not_found,
    )
    detail["processual_status"] = processual_status
    detail["publico_status"] = publico_status
    detail["processual_data"] = row.get("processual_data") or None
    detail["publico_data"] = row.get("publico_data") or None
    return detail


def _pipeline_search_blob(row: dict[str, Any]) -> str:
    processual_data = row.get("processual_data") or {}
    publico_data = row.get("publico_data") or {}
    processual_partes = " ".join(
        str(p.get("nome", ""))
        for p in processual_data.get("partes", []) or []
    )
    publico_partes = " ".join(
        str(p.get("nome", ""))
        for p in publico_data.get("partes", []) or []
    )
    publico_documentos = " ".join(
        " ".join(
            filter(
                None,
                [
                    str(d.get("documento", "")),
                    str(d.get("certidao", "")),
                    str(d.get("texto_documento", ""))[:4000],
                    str(d.get("texto_certidao", ""))[:4000],
                ],
            )
        )
        for d in publico_data.get("documentos", []) or []
    )
    values = [
        row.get("numero_processo", ""),
        row.get("classe", ""),
        row.get("orgao_julgador", ""),
        row.get("grau", ""),
        row.get("assuntos", ""),
        row.get("polo_ativo_nome", ""),
        row.get("polo_passivo_nome", ""),
        row.get("advogados", ""),
        row.get("situacao_processual", ""),
        row.get("valor_causa", ""),
        row.get("tipo_credito", ""),
        row.get("status_recebimento", ""),
        row.get("status_oportunidade", ""),
        row.get("motivos_status", ""),
        row.get("cessao_credito", ""),
        row.get("cessao_detalhes", ""),
        row.get("partes_cedentes", ""),
        row.get("partes_nao_cedentes", ""),
        row.get("situacao_pje", ""),
        row.get("orgao_julgador_pje", ""),
        processual_partes,
        publico_partes,
        publico_documentos,
    ]
    return " ".join(str(v) for v in values if v).lower()


def _normalized_process_number(raw_value: Any) -> str:
    return re.sub(r"\D", "", str(raw_value or ""))


def _yn_to_bool(value: Any) -> bool:
    return str(value or "").strip().lower() in {"sim", "yes", "true", "1"}


def _derive_receiving_status(analysis: dict[str, Any]) -> tuple[str, str]:
    tipo_credito = str(analysis.get("tipo_credito") or "")
    if tipo_credito == "Fora do foco":
        return "fora_do_foco", "Sem indício suficiente de precatório ou RPV."

    paid_signals = any(
        _yn_to_bool(analysis.get(key))
        for key in (
            "indicio_pagamento_datajud",
            "indicio_levantamento_datajud",
            "oficial_indicio_pagamento",
            "oficial_indicio_levantamento",
        )
    )
    if paid_signals:
        return "recebido_ou_em_levantamento", "Há indício de pagamento, levantamento ou alvará."

    pending_signals = any(
        _yn_to_bool(analysis.get(key))
        for key in (
            "indicio_expedicao_datajud",
            "oficial_aguardando_pagamento",
        )
    )
    if pending_signals:
        return "pendente", "Há indício de requisição expedida ou aguardando pagamento."

    return "revisar_manual", "Sem sinal suficiente para afirmar pagamento ou pendência."


def _build_processual_analysis_rows(job: dict[str, Any]) -> list[dict[str, Any]]:
    event_rows: list[dict[str, Any]] = []

    for item in job.get("processual_event_rows", []) or []:
        event_rows.append(
            {
                "numero_processo": item.get("numero_processo", ""),
                "data_hora": item.get("data", ""),
                "evento": item.get("descricao", ""),
                "documento_resumo": item.get("complemento", ""),
                "descricao": item.get("descricao", ""),
            }
        )

    for item in job.get("processual_petition_rows", []) or []:
        event_rows.append(
            {
                "numero_processo": item.get("numero_processo", ""),
                "data_hora": item.get("data_juntada", "") or item.get("data_entrada", ""),
                "evento": item.get("tipo", ""),
                "documento_resumo": item.get("complemento", ""),
                "descricao": " - ".join(
                    part
                    for part in [item.get("tipo", ""), item.get("complemento", "")]
                    if part
                ),
            }
        )

    for item in job.get("processual_document_rows", []) or []:
        event_rows.append(
            {
                "numero_processo": item.get("numero_processo", ""),
                "data_hora": item.get("data", ""),
                "evento": item.get("descricao", ""),
                "documento_resumo": item.get("descricao", ""),
                "descricao": item.get("descricao", ""),
            }
        )

    return event_rows


def _refresh_credit_analysis(job: dict[str, Any]) -> None:
    raw_sources = job.get("raw_sources") or []
    if not raw_sources:
        job["credit_analysis_rows"] = []
        return

    from datajud_app.credit_analysis import build_credit_analysis_rows
    from datajud_app.excel_utils import flatten_process, movements_rows, subjects_rows

    process_rows = [flatten_process(source) for source in raw_sources]
    movement_rows = movements_rows(raw_sources)
    subject_rows = subjects_rows(raw_sources)
    official_process_rows = job.get("official_process_rows", []) or []
    official_event_rows = job.get("official_event_rows", []) or []
    processual_event_rows = _build_processual_analysis_rows(job)
    analysis_event_rows = [*official_event_rows, *processual_event_rows]

    analysis_rows = build_credit_analysis_rows(
        datajud_process_rows=process_rows,
        datajud_movement_rows=movement_rows,
        datajud_subject_rows=subject_rows,
        official_process_rows=official_process_rows,
        official_event_rows=analysis_event_rows,
        official_consulta_rows=official_process_rows,
    )
    for analysis in analysis_rows:
        status_recebimento, motivo_recebimento = _derive_receiving_status(analysis)
        analysis["status_recebimento"] = status_recebimento
        analysis["motivo_recebimento"] = motivo_recebimento
    job["credit_analysis_rows"] = analysis_rows

    analysis_by_number = {
        _normalized_process_number(item.get("numero_processo")): item
        for item in analysis_rows
    }
    official_by_number = {
        _normalized_process_number(item.get("numero_processo")): item
        for item in official_process_rows
    }

    for row in job.get("rows", []):
        normalized = _normalized_process_number(row.get("numero_processo"))
        analysis = analysis_by_number.get(normalized, {})
        official = official_by_number.get(normalized, {})

        row["tipo_credito"] = analysis.get("tipo_credito", "")
        row["status_recebimento"] = analysis.get("status_recebimento", "")
        row["motivo_recebimento"] = analysis.get("motivo_recebimento", "")
        row["status_oportunidade"] = analysis.get("status_oportunidade", "")
        row["motivos_status"] = analysis.get("motivos_status", "")
        row["movimentos_codigos_detectados"] = analysis.get("movimentos_codigos_detectados", "")
        row["assuntos_codigos_detectados"] = analysis.get("assuntos_codigos_detectados", "")
        row["indicio_assunto_precatorio"] = analysis.get("indicio_assunto_precatorio", "")
        row["indicio_assunto_rpv"] = analysis.get("indicio_assunto_rpv", "")
        row["indicio_expedicao_datajud"] = analysis.get("indicio_expedicao_datajud", "")
        row["indicio_pagamento_datajud"] = analysis.get("indicio_pagamento_datajud", "")
        row["indicio_levantamento_datajud"] = analysis.get("indicio_levantamento_datajud", "")
        row["indicio_cessao_datajud"] = analysis.get("indicio_cessao_datajud", "")
        row["oficial_aguardando_pagamento"] = analysis.get("oficial_aguardando_pagamento", "")
        row["oficial_indicio_pagamento"] = analysis.get("oficial_indicio_pagamento", "")
        row["oficial_indicio_levantamento"] = analysis.get("oficial_indicio_levantamento", "")
        row["oficial_indicio_cessao"] = analysis.get("oficial_indicio_cessao", "")

        row["cessao_credito"] = official.get("cessao_credito", row.get("cessao_credito", ""))
        row["cessao_detalhes"] = official.get("cessao_detalhes", row.get("cessao_detalhes", ""))
        row["partes_cedentes"] = official.get("partes_cedentes", row.get("partes_cedentes", ""))
        row["partes_nao_cedentes"] = official.get(
            "partes_nao_cedentes", row.get("partes_nao_cedentes", "")
        )

        if row.get("status_oportunidade") != "descartar_pago_ou_em_levantamento":
            official_cessao = str(row.get("cessao_credito") or "").strip()
            if official_cessao in {"Sim", "Possível"}:
                row["status_oportunidade"] = "descartar_com_indicio_de_cessao"
                existing_reasons = [
                    part.strip()
                    for part in str(row.get("motivos_status") or "").split("|")
                    if part.strip()
                ]
                reason = (
                    "Fonte oficial confirmou cessão de crédito."
                    if official_cessao == "Sim"
                    else "Fonte oficial indica possível cessão de crédito."
                )
                if reason not in existing_reasons:
                    existing_reasons.append(reason)
                row["motivos_status"] = " | ".join(existing_reasons)
                row["oficial_indicio_cessao"] = "Sim"


def _run_pipeline(job_id: str) -> None:
    """Background thread that executes the full pipeline (DataJud + enrichments)."""
    import time

    job = jobs.get(job_id)
    if not job:
        return

    config = job["config"]

    try:
        tribunal_alias = (config.get("tribunal_alias") or "api_publica_trf1").strip()
        limit_raw = config.get("limit", "1000")
        limit_num = float("inf") if limit_raw == "all" else int(limit_raw or 1000)
        page_size = min(100, int(limit_num) if limit_num != float("inf") else 100)

        sort_field = config.get("sort_field", "dataHoraUltimaAtualizacao")
        sort_order = config.get("sort_order", "desc")

        # Build base search body
        must: list[dict] = []
        filters: list[dict] = []
        must_not: list[dict] = []

        numero = (config.get("numero_processo") or "").strip()
        must.extend(_numero_processo_clauses(numero))

        classe_codigo = _safe_int(config.get("classe_codigo"))
        if classe_codigo is not None:
            must.append({"term": {"classe.codigo": classe_codigo}})

        assuntos_codigos = config.get("assuntos_codigos") or []
        for code in assuntos_codigos:
            code_int = _safe_int(code)
            if code_int is not None:
                must.append({"term": {"assuntos.codigo": code_int}})

        for code in (config.get("assuntos_excluir_codigos") or []):
            code_int = _safe_int(code)
            if code_int is not None:
                must_not.append({"term": {"assuntos.codigo": code_int}})

        _apply_credit_preset_filters(
            str(config.get("credit_preset") or ""),
            must=must,
            must_not=must_not,
            default_target=config,
        )

        movimento_codigo = _safe_int(config.get("movimento_codigo"))
        if movimento_codigo is not None:
            must.append({"term": {"movimentos.codigo": movimento_codigo}})

        orgao_julgador_codigo = _safe_int(config.get("orgao_julgador_codigo"))
        if orgao_julgador_codigo is not None:
            must.append({"term": {"orgaoJulgador.codigo": orgao_julgador_codigo}})

        sistema_codigo = _safe_int(config.get("sistema_codigo"))
        if sistema_codigo is not None:
            must.append({"term": {"sistema.codigo": sistema_codigo}})

        formato_codigo = _safe_int(config.get("formato_codigo"))
        if formato_codigo is not None:
            must.append({"term": {"formato.codigo": formato_codigo}})

        grau = (config.get("grau") or "").strip()
        if grau and grau.lower() != "all" and grau != "__all__":
            must.append({"term": {"grau.keyword": grau}})

        nivel_sigilo = _safe_int(config.get("nivel_sigilo"))
        if nivel_sigilo is not None:
            must.append({"term": {"nivelSigilo": nivel_sigilo}})

        tem_assuntos = config.get("tem_assuntos")
        if tem_assuntos is True:
            filters.append({"exists": {"field": "assuntos"}})
        elif tem_assuntos is False:
            must_not.append({"exists": {"field": "assuntos"}})

        tem_movimentos = config.get("tem_movimentos")
        if tem_movimentos is True:
            filters.append({"exists": {"field": "movimentos"}})
        elif tem_movimentos is False:
            must_not.append({"exists": {"field": "movimentos"}})

        min_mov = _safe_int(config.get("min_movimentos"))
        max_mov = _safe_int(config.get("max_movimentos"))
        if min_mov is not None or max_mov is not None:
            script_parts = []
            params: dict = {}
            if min_mov is not None:
                script_parts.append(
                    "(doc.containsKey('movimentos.codigo') ? doc['movimentos.codigo'].size() : 0) >= params.minMov"
                )
                params["minMov"] = min_mov
            if max_mov is not None:
                script_parts.append(
                    "(doc.containsKey('movimentos.codigo') ? doc['movimentos.codigo'].size() : 0) <= params.maxMov"
                )
                params["maxMov"] = max_mov
            filters.append({"script": {"script": {"source": " && ".join(script_parts), "params": params}}})

        # Date ranges — normalized for compact/ISO formats
        filters.extend(_date_range_filter(
            "dataAjuizamento",
            config.get("data_ajuizamento_inicio", ""),
            config.get("data_ajuizamento_fim", ""),
        ))
        filters.extend(_date_range_filter(
            "dataHoraUltimaAtualizacao",
            config.get("data_atualizacao_inicio", ""),
            config.get("data_atualizacao_fim", ""),
        ))

        bool_query: dict[str, Any] = {}
        if must:
            bool_query["must"] = must
        if filters:
            bool_query["filter"] = filters
        if must_not:
            bool_query["must_not"] = must_not
        query_clause: dict[str, Any]
        if not bool_query:
            query_clause = {"match_all": {}}
        else:
            query_clause = {"bool": bool_query}

        # ── Stage 1: DataJud paginated collection ────────────────

        job["progress"]["stage"] = "collecting"
        search_after = None
        total_collected = 0
        first_page = True
        collected_rows: list[dict] = []

        while True:
            status = job["status"]
            if status == "stopped":
                return
            if status == "paused":
                time.sleep(0.5)
                continue

            body: dict[str, Any] = {
                "size": page_size,
                "query": query_clause,
                "sort": [{sort_field: {"order": sort_order}}],
            }
            if search_after:
                body["search_after"] = search_after

            raw = _datajud_search(tribunal_alias, body)
            total_hits = _extract_total_hits(raw)
            processos = _parse_datajud_hits(raw, tribunal_alias)
            hits = raw.get("hits", {}).get("hits", [])
            next_sa = hits[-1].get("sort") if hits else None

            if first_page:
                first_page = False
                effective_total = min(total_hits, int(limit_num)) if limit_num != float("inf") else total_hits
                job["progress"]["total_datajud"] = effective_total

            if not processos:
                break

            raw_sources_page = [h.get("_source", {}) for h in hits]

            for idx, p in enumerate(processos):
                # Build row dict with all fields
                assuntos_str = "; ".join(a.get("nome", "") for a in p.get("assuntos", []))
                movimentos = p.get("movimentos", [])
                ultima_mov = movimentos[0] if movimentos else {}
                primeira_mov = movimentos[-1] if movimentos else {}

                row = {
                    "numero_processo": p.get("numero_processo", ""),
                    "tribunal": p.get("tribunal", ""),
                    "classe": p.get("classe", ""),
                    "orgao_julgador": p.get("orgao_julgador", ""),
                    "grau": p.get("grau", ""),
                    "data_ajuizamento": p.get("data_ajuizamento", ""),
                    "ultima_atualizacao": p.get("ultima_atualizacao", ""),
                    "assuntos": assuntos_str,
                    "qtd_movimentos": len(movimentos),
                    "ultima_mov_data": ultima_mov.get("data_hora", ""),
                    "ultima_mov_nome": ultima_mov.get("nome", ""),
                    "primeira_movimentacao": f"{primeira_mov.get('data_hora', '')} {primeira_mov.get('nome', '')}".strip(),
                    "ultima_movimentacao": f"{ultima_mov.get('data_hora', '')} {ultima_mov.get('nome', '')}".strip(),
                    "datajud_movimentos": movimentos,
                    "tipo_credito": "",
                    "status_recebimento": "",
                    "motivo_recebimento": "",
                    "status_oportunidade": "",
                    "motivos_status": "",
                    "cessao_credito": "",
                    "cessao_detalhes": "",
                    "partes_cedentes": "",
                    "partes_nao_cedentes": "",
                    # TRF1 Processual fields (populated later)
                    "polo_ativo_nome": "",
                    "polo_ativo_cpf": "",
                    "polo_passivo_nome": "",
                    "polo_passivo_cnpj": "",
                    "advogados": "",
                    "situacao_processual": "",
                    # TRF1 Público fields (populated later)
                    "valor_causa": "",
                    "situacao_pje": "",
                    "orgao_julgador_pje": "",
                    "processual_data": None,
                    "publico_data": None,
                }
                collected_rows.append(row)
                job["rows"].append(row)
                # Save raw _source for Excel export
                raw_src = raw_sources_page[idx] if idx < len(raw_sources_page) else {}
                job["raw_sources"].append(raw_src)
                total_collected += 1
                job["progress"]["collected"] = total_collected

                if limit_num != float("inf") and total_collected >= int(limit_num):
                    break

            if limit_num != float("inf") and total_collected >= int(limit_num):
                break
            if not next_sa or len(processos) < page_size:
                break
            search_after = next_sa
            _persist_job(job)

        if job["status"] == "stopped":
            return

        _refresh_credit_analysis(job)
        _persist_job(job)

        # ── Stage 2: TRF1 Processual enrichment ─────────────────

        enrich_processual = config.get("enrich_processual", False)
        enrich_publico = config.get("enrich_publico", False)

        if enrich_processual:
            job["progress"]["stage"] = "enriching_processual"
            include_documents = config.get("include_documents", True)
            processual_client = TRF1Client(secao="TRF1", timeout=30)

            processual_process_rows: list[dict[str, Any]] = []
            processual_party_rows: list[dict[str, Any]] = []
            processual_event_rows: list[dict[str, Any]] = []
            processual_distribution_rows: list[dict[str, Any]] = []
            processual_petition_rows: list[dict[str, Any]] = []
            processual_document_rows: list[dict[str, Any]] = []
            processual_incident_rows: list[dict[str, Any]] = []
            processual_not_found_rows: list[dict[str, Any]] = []
            processual_errors: list[str] = []

            for index, row in enumerate(collected_rows, start=1):
                if job["status"] == "stopped":
                    return
                while job["status"] == "paused":
                    time.sleep(0.5)

                try:
                    formatted = formatar_numero_processo(row["numero_processo"])
                    proc = processual_client.buscar_por_numero(formatted)
                    if proc is None:
                        processual_not_found_rows.append(
                            {
                                "numero_processo": row["numero_processo"],
                                "tribunal": tribunal_alias,
                                "secao": "TRF1",
                            }
                        )
                    else:
                        proc_dict = proc.to_dict()
                        if not include_documents:
                            proc_dict["documentos"] = []

                        ativos, passivos = _active_passive_names(proc_dict.get("partes", []))
                        row["polo_ativo_nome"] = ativos
                        row["polo_passivo_nome"] = passivos
                        row["advogados"] = _advogado_names(proc_dict.get("partes", []))
                        row["situacao_processual"] = proc_dict.get("situacao", "")
                        row["processual_data"] = proc_dict
                        row["processual_partes"] = proc_dict.get("partes", [])
                        row["processual_movimentacoes"] = proc_dict.get("movimentacoes", [])

                        processual_process_rows.append(_flatten_processual_process(proc_dict))
                        processual_party_rows.extend(_flatten_processual_partes(proc_dict))
                        processual_event_rows.extend(_flatten_processual_movimentacoes(proc_dict))
                        processual_distribution_rows.extend(_flatten_processual_distribuicoes(proc_dict))
                        processual_petition_rows.extend(_flatten_processual_peticoes(proc_dict))
                        processual_document_rows.extend(_flatten_processual_documentos(proc_dict))
                        processual_incident_rows.extend(_flatten_processual_incidentes(proc_dict))
                except Exception as exc:
                    processual_errors.append(f"{row['numero_processo']}: {exc}")
                    job["progress"]["errors"] = job["progress"].get("errors", 0) + 1

                job["progress"]["enriched_processual"] = index
                if index == 1 or index % 5 == 0 or index == len(collected_rows):
                    _persist_job(job)

            job["processual_process_rows"] = processual_process_rows
            job["processual_party_rows"] = processual_party_rows
            job["processual_event_rows"] = processual_event_rows
            job["processual_distribution_rows"] = processual_distribution_rows
            job["processual_petition_rows"] = processual_petition_rows
            job["processual_document_rows"] = processual_document_rows
            job["processual_incident_rows"] = processual_incident_rows
            job["processual_not_found_rows"] = processual_not_found_rows
            job["progress"]["not_found_count"] = len(processual_not_found_rows)
            job["progress"]["error_details"] = processual_errors[:20]
            _persist_job(job)

        if job["status"] == "stopped":
            return

        # ── Stage 3: TRF1 Público enrichment ─────────────────────

        if enrich_publico:
            job["progress"]["stage"] = "enriching_publico"
            batch_size = max(1, int(config.get("batch_size", 8)) // 2)

            try:
                if not ENABLE_TRF1_SCRAPING:
                    raise ImportError("TRF1 scraping disabled via ENABLE_TRF1_SCRAPING")
                from datajud_app.trf1_public import TRF1PublicSearchParams, search_trf1_public_bundle
                publico_available = True
            except ImportError:
                publico_available = False

            if publico_available:
                include_documents = config.get("include_documents", True)
                public_process_rows: list[dict[str, Any]] = []
                public_party_rows: list[dict[str, Any]] = []
                public_lawyer_rows: list[dict[str, Any]] = []
                public_event_rows: list[dict[str, Any]] = []
                public_document_rows: list[dict[str, Any]] = []
                public_not_found_rows: list[dict[str, Any]] = []

                for i, row in enumerate(collected_rows):
                    if job["status"] == "stopped":
                        return
                    while job["status"] == "paused":
                        time.sleep(0.5)

                    try:
                        # Format number CNJ style
                        digits = re.sub(r"\D", "", row["numero_processo"])
                        m = re.match(r"^(\d{7})(\d{2})(\d{4})(\d{1})(\d{2})(\d{4})$", digits)
                        formatted = f"{m.group(1)}-{m.group(2)}.{m.group(3)}.{m.group(4)}.{m.group(5)}.{m.group(6)}" if m else row["numero_processo"]

                        params = TRF1PublicSearchParams(
                            process_number=formatted,
                            party_name="",
                            document_number="",
                            lawyer_name="",
                            oab_number="",
                            oab_state="",
                        )
                        bundle = search_trf1_public_bundle(params, max_details=1)
                        if bundle.process_rows:
                            pub = bundle.process_rows[0]
                            if not include_documents:
                                for document_row in bundle.document_rows:
                                    document_row.pop("texto_documento", None)
                                    document_row.pop("texto_certidao", None)

                            public_process_rows.extend(bundle.process_rows)
                            public_party_rows.extend(bundle.party_rows)
                            public_lawyer_rows.extend(bundle.lawyer_rows)
                            public_event_rows.extend(bundle.event_rows)
                            public_document_rows.extend(bundle.document_rows)

                            public_payload = _build_trf1_public_process_payload(
                                pub,
                                party_rows=bundle.party_rows,
                                lawyer_rows=bundle.lawyer_rows,
                                event_rows=bundle.event_rows,
                                document_rows=bundle.document_rows,
                            )
                            row["valor_causa"] = public_payload.get("valor_causa", "")
                            row["situacao_pje"] = public_payload.get("situacao", "")
                            row["orgao_julgador_pje"] = public_payload.get("orgao_julgador", "")
                            row["cessao_credito"] = public_payload.get("cessao_credito", "")
                            row["cessao_detalhes"] = public_payload.get("cessao_detalhes", "")
                            row["partes_cedentes"] = public_payload.get("partes_cedentes", "")
                            row["partes_nao_cedentes"] = public_payload.get("partes_nao_cedentes", "")
                            row["publico_data"] = public_payload
                            row["publico_partes"] = public_payload.get("partes", [])
                            row["publico_movimentacoes"] = public_payload.get("movimentacoes", [])
                        else:
                            public_not_found_rows.append(
                                {
                                    "numero_processo": row["numero_processo"],
                                    "tribunal": tribunal_alias,
                                    "detalhe": "Processo nao encontrado na consulta publica PJe.",
                                }
                            )
                    except Exception:
                        job["progress"]["errors"] = job["progress"].get("errors", 0) + 1

                    job["progress"]["enriched_publico"] = i + 1
                    if (i + 1) == 1 or (i + 1) % 3 == 0 or (i + 1) == len(collected_rows):
                        _persist_job(job)
                    if (i + 1) % batch_size == 0:
                        time.sleep(0.5)

                job["official_process_rows"] = public_process_rows
                job["official_party_rows"] = public_party_rows
                job["official_lawyer_rows"] = public_lawyer_rows
                job["official_event_rows"] = public_event_rows
                job["official_document_rows"] = public_document_rows
                job["official_not_found_rows"] = public_not_found_rows
                _persist_job(job)

        _refresh_credit_analysis(job)
        job["status"] = "done"
        job["progress"]["stage"] = "done"
        _persist_job(job)

    except Exception as e:
        logger.error("Pipeline %s crashed: %s\n%s", job_id, e, traceback.format_exc())
        job["status"] = "error"
        job["error"] = str(e)
        _persist_job(job)


@app.post("/api/pipeline/start")
def pipeline_start(payload: dict = Body(...)):
    """Start a pipeline job. Returns job_id immediately."""
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "status": "running",
        "created_at": datetime.utcnow().isoformat(),
        "config": payload,
        "progress": {
            "stage": "collecting",
            "collected": 0,
            "total_datajud": 0,
            "enriched_processual": 0,
            "enriched_publico": 0,
            "errors": 0,
            "not_found_count": 0,
            "error_details": [],
        },
        "rows": [],
        "raw_sources": [],
        "processual_process_rows": [],
        "processual_party_rows": [],
        "processual_event_rows": [],
        "processual_distribution_rows": [],
        "processual_petition_rows": [],
        "processual_document_rows": [],
        "processual_incident_rows": [],
        "processual_not_found_rows": [],
        "official_process_rows": [],
        "official_party_rows": [],
        "official_lawyer_rows": [],
        "official_event_rows": [],
        "official_document_rows": [],
        "official_not_found_rows": [],
        "credit_analysis_rows": [],
        "error": None,
    }
    _persist_job(jobs[job_id])
    t = threading.Thread(target=_run_pipeline, args=(job_id,), daemon=True)
    t.start()
    return {"success": True, "job_id": job_id}


@app.get("/api/pipeline/status/{job_id}")
def pipeline_status(job_id: str):
    """Poll job status and progress."""
    job = jobs.get(job_id)
    if not job:
        return {"success": False, "error": "Job not found"}
    return {
        "success": True,
        "data": {
            "status": job["status"],
            "config": job.get("config", {}),
            "progress": job["progress"],
            "row_count": len(job["rows"]),
            "preview_rows": job["rows"][-100:] if job["rows"] else [],
            "error": job.get("error"),
        }
    }


@app.get("/api/pipeline/results/{job_id}")
def pipeline_results(
    job_id: str,
    q: str = Query("", description="Filtro textual"),
    source: str = Query("all", description="all | processual | publico | both"),
    documents_only: bool = Query(False, description="Mostrar apenas processos com documentos"),
    credit_type: str = Query("all", description="Tipo de crédito"),
    receiving_status: str = Query("all", description="Situação de recebimento"),
    opportunity_status: str = Query("all", description="Classificação sintética"),
    cession_status: str = Query("all", description="Sim | Possível | Não"),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """List filtered pipeline rows with lightweight summaries for the frontend."""
    job = jobs.get(job_id)
    if not job:
        return {"success": False, "error": "Job not found"}

    processual_enabled = bool(job.get("config", {}).get("enrich_processual"))
    publico_enabled = bool(job.get("config", {}).get("enrich_publico"))
    processual_not_found = {
        str(item.get("numero_processo", ""))
        for item in job.get("processual_not_found_rows", [])
    }
    publico_not_found = {
        str(item.get("numero_processo", ""))
        for item in job.get("official_not_found_rows", [])
    }

    q_lower = q.strip().lower()
    credit_type_normalized = credit_type.strip().lower()
    receiving_status_normalized = receiving_status.strip().lower()
    opportunity_status_normalized = opportunity_status.strip().lower()
    cession_status_normalized = cession_status.strip().lower()
    rows = job.get("rows", [])
    filtered: list[dict[str, Any]] = []

    for row in rows:
        summary = _pipeline_row_summary(
            row,
            processual_enabled=processual_enabled,
            publico_enabled=publico_enabled,
            processual_not_found=processual_not_found,
            publico_not_found=publico_not_found,
        )

        if source == "processual" and summary["processual_status"] != "found":
            continue
        if source == "publico" and summary["publico_status"] != "found":
            continue
        if source == "both" and (
            summary["processual_status"] != "found" or summary["publico_status"] != "found"
        ):
            continue
        if documents_only and not (
            summary["processual_qtd_documentos"] or summary["publico_qtd_documentos"]
        ):
            continue
        if (
            credit_type_normalized
            and credit_type_normalized != "all"
            and str(summary.get("tipo_credito") or "").strip().lower() != credit_type_normalized
        ):
            continue
        if (
            receiving_status_normalized
            and receiving_status_normalized != "all"
            and str(summary.get("status_recebimento") or "").strip().lower()
            != receiving_status_normalized
        ):
            continue
        if (
            opportunity_status_normalized
            and opportunity_status_normalized != "all"
            and str(summary.get("status_oportunidade") or "").strip().lower()
            != opportunity_status_normalized
        ):
            continue
        if (
            cession_status_normalized
            and cession_status_normalized != "all"
            and str(summary.get("cessao_credito") or "").strip().lower() != cession_status_normalized
        ):
            continue
        if q_lower and q_lower not in _pipeline_search_blob(row):
            continue

        filtered.append(summary)

    total = len(filtered)
    page_rows = filtered[offset : offset + limit]

    return {
        "success": True,
        "data": {
            "job_status": job.get("status"),
            "total": total,
            "offset": offset,
            "limit": limit,
            "rows": page_rows,
            "counts": {
                "all": len(rows),
                "processual_found": sum(1 for r in filtered if r["processual_status"] == "found"),
                "publico_found": sum(1 for r in filtered if r["publico_status"] == "found"),
                "with_documents": sum(
                    1
                    for r in filtered
                    if r["processual_qtd_documentos"] or r["publico_qtd_documentos"]
                ),
                "potential": sum(
                    1
                    for r in filtered
                    if r.get("status_oportunidade") == "potencial_oportunidade"
                ),
                "cession": sum(
                    1
                    for r in filtered
                    if r.get("status_oportunidade") == "descartar_com_indicio_de_cessao"
                ),
                "paid_or_lifted": sum(
                    1
                    for r in filtered
                    if r.get("status_oportunidade") == "descartar_pago_ou_em_levantamento"
                ),
                "receiving_pending": sum(
                    1
                    for r in filtered
                    if r.get("status_recebimento") == "pendente"
                ),
                "manual_review": sum(
                    1
                    for r in filtered
                    if r.get("status_oportunidade") == "revisar_manual"
                ),
            },
        },
    }


@app.get("/api/pipeline/result/{job_id}/{numero_processo:path}")
def pipeline_result_detail(job_id: str, numero_processo: str):
    """Return the full enriched payload for a single pipeline row."""
    job = jobs.get(job_id)
    if not job:
        return {"success": False, "error": "Job not found"}

    normalized = re.sub(r"\D", "", numero_processo or "")
    processual_enabled = bool(job.get("config", {}).get("enrich_processual"))
    publico_enabled = bool(job.get("config", {}).get("enrich_publico"))
    processual_not_found = {
        str(item.get("numero_processo", ""))
        for item in job.get("processual_not_found_rows", [])
    }
    publico_not_found = {
        str(item.get("numero_processo", ""))
        for item in job.get("official_not_found_rows", [])
    }

    for row in job.get("rows", []):
        row_number = str(row.get("numero_processo", ""))
        if row_number == numero_processo or re.sub(r"\D", "", row_number) == normalized:
            return {
                "success": True,
                "data": _pipeline_row_detail(
                    row,
                    processual_enabled=processual_enabled,
                    publico_enabled=publico_enabled,
                    processual_not_found=processual_not_found,
                    publico_not_found=publico_not_found,
                ),
            }

    return {"success": False, "error": "Processo não encontrado neste job"}


@app.post("/api/pipeline/control/{job_id}")
def pipeline_control(job_id: str, payload: dict = Body(...)):
    """Pause, resume, or stop a job."""
    job = jobs.get(job_id)
    if not job:
        return {"success": False, "error": "Job not found"}
    action = payload.get("action")
    if action == "pause":
        job["status"] = "paused"
    elif action == "resume":
        job["status"] = "running"
    elif action == "stop":
        job["status"] = "stopped"
    _persist_job(job)
    return {"success": True}


@app.get("/api/pipeline/export/{job_id}")
def pipeline_export(job_id: str):
    """Export all collected rows as Excel workbook with all 14 sheets."""
    from fastapi.responses import StreamingResponse
    import io
    from datajud_app.excel_utils import (
        build_result_workbook,
        flatten_process,
        movements_rows,
        movement_complements_rows,
        subjects_rows,
        raw_rows,
    )

    job = jobs.get(job_id)
    if not job or not job.get("rows"):
        return {"success": False, "error": "No data"}

    raw_sources = job.get("raw_sources", [])

    # If raw_sources not available (old jobs), fall back to rows for basic sheets
    if raw_sources:
        process_rows = [flatten_process(s) for s in raw_sources]
        movement_rows_data = movements_rows(raw_sources)
        movement_complement_rows_data = movement_complements_rows(raw_sources)
        subject_rows_data = subjects_rows(raw_sources)
        raw_process_rows_data = raw_rows(raw_sources)
    else:
        process_rows = job["rows"]
        movement_rows_data = []
        movement_complement_rows_data = []
        subject_rows_data = []
        raw_process_rows_data = []

    official_process_rows = job.get("official_process_rows", [])
    official_party_rows = job.get("official_party_rows", [])
    official_lawyer_rows = job.get("official_lawyer_rows", [])
    official_event_rows = job.get("official_event_rows", [])
    official_document_rows = job.get("official_document_rows", [])
    official_not_found_rows = job.get("official_not_found_rows", [])
    processual_process_rows = job.get("processual_process_rows", [])
    processual_party_rows = job.get("processual_party_rows", [])
    processual_event_rows = job.get("processual_event_rows", [])
    processual_distribution_rows = job.get("processual_distribution_rows", [])
    processual_petition_rows = job.get("processual_petition_rows", [])
    processual_document_rows = job.get("processual_document_rows", [])
    processual_incident_rows = job.get("processual_incident_rows", [])
    processual_not_found_rows = job.get("processual_not_found_rows", [])

    # Build official process map for merging
    official_proc_map: dict = {}
    for op in official_process_rows:
        key = (op.get("tribunal", ""), op.get("numero_processo", ""))
        official_proc_map[key] = op

    # Build merged rows (DataJud + official side-by-side)
    merged_rows = []
    for p_row in process_rows:
        key = (p_row.get("tribunal", ""), p_row.get("numero_processo", ""))
        official_proc = official_proc_map.get(key)
        merged = dict(p_row)
        if official_proc:
            for k, v in official_proc.items():
                if k not in ("numero_processo", "tribunal"):
                    merged[f"oficial_{k}"] = v
        merged_rows.append(merged)

    excel_bytes = build_result_workbook(
        merged_rows=merged_rows,
        process_rows=process_rows,
        movement_rows=movement_rows_data,
        movement_complement_rows=movement_complement_rows_data,
        subject_rows=subject_rows_data,
        credit_analysis_rows=job.get("credit_analysis_rows", []),
        processual_process_rows=processual_process_rows,
        processual_party_rows=processual_party_rows,
        processual_event_rows=processual_event_rows,
        processual_distribution_rows=processual_distribution_rows,
        processual_petition_rows=processual_petition_rows,
        processual_document_rows=processual_document_rows,
        processual_incident_rows=processual_incident_rows,
        official_process_rows=official_process_rows,
        official_party_rows=official_party_rows,
        official_lawyer_rows=official_lawyer_rows,
        official_event_rows=official_event_rows,
        official_document_rows=official_document_rows,
        raw_process_rows=raw_process_rows_data,
        not_found_rows=processual_not_found_rows + official_not_found_rows,
    )

    return StreamingResponse(
        io.BytesIO(excel_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=pipeline_{job_id[:8]}.xlsx",
            "Content-Length": str(len(excel_bytes)),
        },
    )


@app.get("/api/pipeline/jobs")
def pipeline_list_jobs():
    """List recent jobs."""
    return {
        "success": True,
        "data": [
            {
                "id": j["id"],
                "status": j["status"],
                "created_at": j["created_at"],
                "collected": j["progress"]["collected"],
                "total": j["progress"]["total_datajud"],
                "tribunal": j.get("config", {}).get("tribunal_alias", "api_publica_trf1"),
                "numero_processo": j.get("config", {}).get("numero_processo", ""),
                "enrich_processual": bool(j.get("config", {}).get("enrich_processual")),
                "enrich_publico": bool(j.get("config", {}).get("enrich_publico")),
            }
            for j in sorted(jobs.values(), key=lambda x: x["created_at"], reverse=True)[:10]
        ],
    }


@app.delete("/api/pipeline/jobs/{job_id}")
def pipeline_delete_job(job_id: str):
    """Delete one job and mark any running worker for stop."""
    if not _delete_job(job_id):
        return {"success": False, "error": "Job not found"}
    return {"success": True}


@app.post("/api/pipeline/jobs/purge")
def pipeline_purge_jobs(payload: dict = Body(...)):
    """Delete finished jobs or force stop and delete all jobs."""
    scope = str(payload.get("scope") or "finished").strip().lower()
    if scope not in {"finished", "all"}:
        return {"success": False, "error": "Escopo inválido"}

    deleted = 0
    if scope == "all":
        for job_id in list(jobs.keys()):
            if _delete_job(job_id):
                deleted += 1
        try:
            delete_all_pipeline_jobs()
        except Exception as exc:
            logger.warning("Falha ao limpar store de jobs: %s", exc)
        return {"success": True, "deleted": deleted}

    removable_statuses = {"done", "stopped", "error", "aborted", "interrupted"}
    for job_id, job in list(jobs.items()):
        if str(job.get("status") or "").lower() in removable_statuses:
            if _delete_job(job_id):
                deleted += 1
    return {"success": True, "deleted": deleted}


if __name__ == "__main__":
    import uvicorn
    try:
        logger.info("Starting API server on port 8000")
        logger.info("TRF1 scraping: %s | proxy: %s", ENABLE_TRF1_SCRAPING, TRF1_PROXY_URL or "none")
        logger.info(
            "Playwright runtime | xvfb=%s | processual_headless=%s | public_headless=%s | ws=%s | cdp=%s",
            os.environ.get("PLAYWRIGHT_USE_XVFB", "1"),
            os.environ.get("TRF1_PROCESSUAL_HEADLESS", "auto"),
            os.environ.get("TRF1_PUBLIC_HEADLESS", "auto"),
            "configured" if os.environ.get("TRF1_PLAYWRIGHT_WS_ENDPOINT", "").strip() else "none",
            "configured" if os.environ.get("TRF1_PLAYWRIGHT_CDP_URL", "").strip() else "none",
        )
        uvicorn.run(app, host="0.0.0.0", port=8000)
    except Exception as e:
        logger.critical("API server crashed: %s\n%s", e, traceback.format_exc())
        sys.exit(1)
