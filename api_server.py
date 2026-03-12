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
        tribunal_alias = payload.get("tribunal_alias", "api_publica_trf1")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
