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
from datetime import datetime
from typing import Any

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "trf1_consulta"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "automacao-datajud-trf1"))

import requests
from fastapi import FastAPI, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from dataclasses import asdict
from trf1_client import TRF1Client, formatar_numero_processo

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


# ═══════════════════════════════════════════════════════════════
# Health
# ═══════════════════════════════════════════════════════════════

@app.get("/api/health")
def health():
    return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# FONTE 1: TRF1 Processual (2ª Instância) — endpoints existentes
# ═══════════════════════════════════════════════════════════════

@app.get("/api/processo")
def buscar_processo(
    numero: str = Query(..., description="Número do processo"),
    secao: str = Query("TRF1", description="Seção judiciária"),
):
    try:
        client = TRF1Client(secao=secao, timeout=30)
        proc = client.buscar_por_numero(numero)
        if proc is None:
            return {"success": False, "error": "Processo não encontrado"}
        return {"success": True, "data": proc.to_dict()}
    except Exception as e:
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

        return {
            "success": True,
            "data": [asdict(r) for r in resultados],
        }
    except Exception as e:
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
        numero = payload.get("numero_processo", "").strip()
        if numero:
            numero_limpo = re.sub(r"[.\-/\s]", "", numero)
            must.append({"match": {"numeroProcesso": numero_limpo}})

        # Classe
        if payload.get("classe_codigo"):
            must.append({"match": {"classe.codigo": int(payload["classe_codigo"])}})

        # Assuntos (múltiplos — AND)
        assuntos_codigos = payload.get("assuntos_codigos") or []
        if assuntos_codigos:
            for code in assuntos_codigos:
                must.append({"match": {"assuntos.codigo": int(code)}})
        elif payload.get("assunto_codigo"):
            must.append({"match": {"assuntos.codigo": int(payload["assunto_codigo"])}})

        # Assuntos excluídos
        assuntos_excluir = payload.get("assuntos_excluir_codigos") or []
        for code in assuntos_excluir:
            must_not.append({"match": {"assuntos.codigo": int(code)}})

        # Movimentação
        if payload.get("movimento_codigo"):
            must.append({"match": {"movimentos.codigo": int(payload["movimento_codigo"])}})

        # Órgão julgador
        if payload.get("orgao_julgador_codigo"):
            must.append({"match": {"orgaoJulgador.codigo": int(payload["orgao_julgador_codigo"])}})

        # Grau
        if payload.get("grau"):
            must.append({"match": {"grau": payload["grau"]}})

        # Sistema
        if payload.get("sistema_codigo"):
            must.append({"match": {"sistema.codigo": int(payload["sistema_codigo"])}})

        # Formato
        if payload.get("formato_codigo"):
            must.append({"match": {"formato.codigo": int(payload["formato_codigo"])}})

        # Nível de sigilo
        if payload.get("nivel_sigilo") is not None and payload["nivel_sigilo"] != "":
            must.append({"match": {"nivelSigilo": int(payload["nivel_sigilo"])}})

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
        min_mov = payload.get("min_movimentos")
        max_mov = payload.get("max_movimentos")
        if min_mov is not None or max_mov is not None:
            script_parts = []
            params = {}
            if min_mov is not None:
                script_parts.append("doc['movimentos.codigo'].size() >= params.minMov")
                params["minMov"] = int(min_mov)
            if max_mov is not None:
                script_parts.append("doc['movimentos.codigo'].size() <= params.maxMov")
                params["maxMov"] = int(max_mov)
            filters.append({
                "script": {
                    "script": {
                        "source": " && ".join(script_parts),
                        "params": params,
                    }
                }
            })

        # Date ranges — ajuizamento
        date_range = {}
        if payload.get("data_ajuizamento_inicio"):
            date_range["gte"] = payload["data_ajuizamento_inicio"]
        if payload.get("data_ajuizamento_fim"):
            date_range["lte"] = payload["data_ajuizamento_fim"]
        if date_range:
            filters.append({"range": {"dataAjuizamento": date_range}})

        # Date ranges — atualização
        upd_range = {}
        if payload.get("data_atualizacao_inicio"):
            upd_range["gte"] = payload["data_atualizacao_inicio"]
        if payload.get("data_atualizacao_fim"):
            upd_range["lte"] = payload["data_atualizacao_fim"]
        if upd_range:
            filters.append({"range": {"dataHoraUltimaAtualizacao": upd_range}})

        # Construir bool query
        bool_query: dict[str, Any] = {}
        if must:
            bool_query["must"] = must
        if filters:
            bool_query["filter"] = filters
        if must_not:
            bool_query["must_not"] = must_not
        if not bool_query:
            bool_query["must"] = [{"match_all": {}}]

        # Sort
        sort_field = payload.get("sort_field", "dataHoraUltimaAtualizacao")
        sort_order = payload.get("sort_order", "desc")
        body: dict[str, Any] = {
            "size": page_size,
            "query": {"bool": bool_query},
            "sort": [{sort_field: {"order": sort_order}}],
        }

        # search_after para paginação
        search_after = payload.get("search_after")
        if search_after:
            body["search_after"] = search_after

        raw = _datajud_search(tribunal_alias, body)
        total = raw.get("hits", {}).get("total", {}).get("value", 0)
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

        processos = []
        for row in bundle.process_rows:
            partes = []
            for p in bundle.party_rows:
                if p.get("numero_processo") == row.get("numero_processo"):
                    partes.append({
                        "nome": p.get("nome", ""),
                        "polo": p.get("polo", ""),
                        "tipo_participacao": p.get("tipo_participacao", ""),
                        "documentos": p.get("documentos", ""),
                        "advogados": p.get("advogados", ""),
                    })

            movs = []
            for m in bundle.event_rows:
                if m.get("numero_processo") == row.get("numero_processo"):
                    movs.append({
                        "data": m.get("data_hora", ""),
                        "tipo": m.get("evento", ""),
                        "descricao": m.get("descricao", ""),
                        "documentos": [
                            d for d in [m.get("documento_resumo", "")]
                            if d
                        ],
                    })

            processos.append({
                "numero_processo": row.get("numero_processo", ""),
                "classe": row.get("classe", ""),
                "assunto": row.get("assunto", ""),
                "orgao_julgador": row.get("orgao_julgador", ""),
                "data_distribuicao": row.get("data_distribuicao", ""),
                "valor_causa": row.get("valor_causa", ""),
                "situacao": row.get("situacao", ""),
                "partes": partes,
                "movimentacoes": movs,
                "url_detalhes": row.get("url_detalhes", ""),
            })

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

jobs: dict[str, dict] = {}  # job_id -> job state

# ── Persistent job state (survives server restarts) ──────────────────────────
import json as _json
import atexit as _atexit
JOBS_FILE = "/tmp/pipeline_jobs.json"

def _load_jobs() -> None:
    """Load completed/done jobs from disk on startup."""
    try:
        if os.path.exists(JOBS_FILE):
            with open(JOBS_FILE) as f:
                saved = _json.load(f)
            for jid, jdata in saved.items():
                # Only restore done/error jobs (running ones are dead)
                if jdata.get("status") in ("done", "error", "stopped"):
                    jobs[jid] = jdata
    except Exception:
        pass

def _save_jobs() -> None:
    """Persist finished jobs to disk."""
    try:
        to_save = {jid: j for jid, j in jobs.items() if j.get("status") in ("done", "error", "stopped")}
        with open(JOBS_FILE, "w") as f:
            _json.dump(to_save, f, default=str)
    except Exception:
        pass

_load_jobs()
_atexit.register(_save_jobs)


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
        page_size = min(200, int(limit_num) if limit_num != float("inf") else 200)

        sort_field = config.get("sort_field", "dataHoraUltimaAtualizacao")
        sort_order = config.get("sort_order", "desc")

        # Build base search body
        must: list[dict] = []
        filters: list[dict] = []
        must_not: list[dict] = []

        numero = (config.get("numero_processo") or "").strip()
        if numero:
            numero_limpo = re.sub(r"[.\-/\s]", "", numero)
            must.append({"match": {"numeroProcesso": numero_limpo}})

        if config.get("classe_codigo"):
            must.append({"match": {"classe.codigo": int(config["classe_codigo"])}})

        assuntos_codigos = config.get("assuntos_codigos") or []
        for code in assuntos_codigos:
            must.append({"match": {"assuntos.codigo": int(code)}})

        for code in (config.get("assuntos_excluir_codigos") or []):
            must_not.append({"match": {"assuntos.codigo": int(code)}})

        if config.get("movimento_codigo"):
            must.append({"match": {"movimentos.codigo": int(config["movimento_codigo"])}})

        if config.get("orgao_julgador_codigo"):
            must.append({"match": {"orgaoJulgador.codigo": int(config["orgao_julgador_codigo"])}})

        if config.get("grau"):
            must.append({"match": {"grau": config["grau"]}})

        if config.get("nivel_sigilo") is not None and config["nivel_sigilo"] != "":
            must.append({"match": {"nivelSigilo": int(config["nivel_sigilo"])}})

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

        min_mov = config.get("min_movimentos")
        max_mov = config.get("max_movimentos")
        if min_mov is not None or max_mov is not None:
            script_parts = []
            params: dict = {}
            if min_mov is not None:
                script_parts.append("doc['movimentos.codigo'].size() >= params.minMov")
                params["minMov"] = int(min_mov)
            if max_mov is not None:
                script_parts.append("doc['movimentos.codigo'].size() <= params.maxMov")
                params["maxMov"] = int(max_mov)
            filters.append({"script": {"script": {"source": " && ".join(script_parts), "params": params}}})

        date_range: dict = {}
        if config.get("data_ajuizamento_inicio"):
            date_range["gte"] = config["data_ajuizamento_inicio"]
        if config.get("data_ajuizamento_fim"):
            date_range["lte"] = config["data_ajuizamento_fim"]
        if date_range:
            filters.append({"range": {"dataAjuizamento": date_range}})

        upd_range: dict = {}
        if config.get("data_atualizacao_inicio"):
            upd_range["gte"] = config["data_atualizacao_inicio"]
        if config.get("data_atualizacao_fim"):
            upd_range["lte"] = config["data_atualizacao_fim"]
        if upd_range:
            filters.append({"range": {"dataHoraUltimaAtualizacao": upd_range}})

        bool_query: dict[str, Any] = {}
        if must:
            bool_query["must"] = must
        if filters:
            bool_query["filter"] = filters
        if must_not:
            bool_query["must_not"] = must_not
        if not bool_query:
            bool_query["must"] = [{"match_all": {}}]

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
                "query": {"bool": bool_query},
                "sort": [{sort_field: {"order": sort_order}}],
            }
            if search_after:
                body["search_after"] = search_after

            raw = _datajud_search(tribunal_alias, body)
            total_hits = raw.get("hits", {}).get("total", {}).get("value", 0)
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
                    "ultima_movimentacao": f"{ultima_mov.get('data_hora', '')} {ultima_mov.get('nome', '')}".strip(),
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

        if job["status"] == "stopped":
            return

        # ── Stage 2: TRF1 Processual enrichment ─────────────────

        enrich_processual = config.get("enrich_processual", False)
        enrich_publico = config.get("enrich_publico", False)

        if enrich_processual:
            job["progress"]["stage"] = "enriching"
            from datajud_app.official_sources import enrich_from_official_sources

            query_rows_official = [
                {
                    "source_row": {"numero_processo": row["numero_processo"]},
                    "linha_origem": i,
                    "numero_processo": row["numero_processo"],
                    "tribunal_alias": tribunal_alias,
                    "tribunal_alias_informado": tribunal_alias,
                }
                for i, row in enumerate(collected_rows, start=1)
            ]

            prog_lock = threading.Lock()

            def on_enrich_progress(current: int, total: int, message: str) -> None:
                with prog_lock:
                    job["progress"]["enriched_processual"] = current

            official_result = enrich_from_official_sources(
                query_rows_official,
                on_progress=on_enrich_progress,
            )

            # Persist result lists in job (JSON-serializable dicts)
            job["official_process_rows"] = official_result.process_rows
            job["official_party_rows"] = official_result.party_rows
            job["official_lawyer_rows"] = official_result.lawyer_rows
            job["official_event_rows"] = official_result.event_rows
            job["official_document_rows"] = official_result.document_rows
            job["official_not_found_rows"] = official_result.not_found_rows
            job["progress"]["enriched_processual"] = len(official_result.process_rows)
            job["progress"]["errors"] = job["progress"].get("errors", 0) + len(official_result.errors)

            # Update preview rows with official data
            for row in collected_rows:
                key = (tribunal_alias, row["numero_processo"])
                official_proc = official_result.process_map.get(key)
                if official_proc:
                    row["polo_ativo_nome"] = official_proc.get("polo_ativo", "") or ""
                    row["polo_passivo_nome"] = official_proc.get("polo_passivo", "") or ""
                    row["advogados"] = official_proc.get("advogados_resumo", "") or ""
                    # TRF1 doesn't have explicit situação — use last event as proxy
                    row["situacao_processual"] = official_proc.get("ultimo_evento", "") or ""

        if job["status"] == "stopped":
            return

        # ── Stage 3: TRF1 Público enrichment ─────────────────────

        if enrich_publico:
            job["progress"]["stage"] = "enriching"
            batch_size = max(1, int(config.get("batch_size", 8)) // 2)

            try:
                from datajud_app.trf1_public import TRF1PublicSearchParams, search_trf1_public_bundle
                publico_available = True
            except ImportError:
                publico_available = False

            if publico_available:
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
                            row["valor_causa"] = pub.get("valor_causa", "")
                            row["situacao_pje"] = pub.get("situacao", "")
                            row["orgao_julgador_pje"] = pub.get("orgao_julgador", "")
                    except Exception:
                        job["progress"]["errors"] = job["progress"].get("errors", 0) + 1

                    job["progress"]["enriched_publico"] = i + 1
                    if (i + 1) % batch_size == 0:
                        time.sleep(0.5)

        job["status"] = "done"
        job["progress"]["stage"] = "done"
        _save_jobs()

    except Exception as e:
        job["status"] = "error"
        job["error"] = str(e)
        _save_jobs()


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
        },
        "rows": [],
        "raw_sources": [],
        "official_process_rows": [],
        "official_party_rows": [],
        "official_lawyer_rows": [],
        "official_event_rows": [],
        "official_document_rows": [],
        "official_not_found_rows": [],
        "error": None,
    }
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
            "progress": job["progress"],
            "row_count": len(job["rows"]),
            "preview_rows": job["rows"][-20:] if job["rows"] else [],
            "error": job.get("error"),
        }
    }


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
        official_process_rows=official_process_rows,
        official_party_rows=official_party_rows,
        official_lawyer_rows=official_lawyer_rows,
        official_event_rows=official_event_rows,
        official_document_rows=official_document_rows,
        raw_process_rows=raw_process_rows_data,
        not_found_rows=official_not_found_rows,
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
            }
            for j in sorted(jobs.values(), key=lambda x: x["created_at"], reverse=True)[:10]
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
