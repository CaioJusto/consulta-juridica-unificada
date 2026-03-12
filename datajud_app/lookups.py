"""Buscas auxiliares para selects de filtros."""

from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from typing import Any

import requests

from datajud_app.client import DataJudClient

SGT_WSDL_URL = "https://www.cnj.jus.br/sgt/sgt_ws.php"

SGT_TABLE_TYPES = {
    "classe": "C",
    "assunto": "A",
    "movimento": "M",
}

SGT_SEARCH_TYPES = {
    "nome": "N",
    "codigo": "C",
    "glossario": "G",
}

DATAJUD_FILTER_FIELDS = {
    "grau": {
        "agg_field": "grau.keyword",
        "source_fields": ["grau"],
        "value_path": "grau",
        "code_path": None,
    },
    "sistema": {
        "agg_field": "sistema.codigo",
        "source_fields": ["sistema.codigo", "sistema.nome"],
        "value_path": "sistema.nome",
        "code_path": "sistema.codigo",
    },
    "formato": {
        "agg_field": "formato.codigo",
        "source_fields": ["formato.codigo", "formato.nome"],
        "value_path": "formato.nome",
        "code_path": "formato.codigo",
    },
}

GRAU_SORT_ORDER = {
    "G1": 0,
    "G2": 1,
}

HTML_TAG_RE = re.compile(r"<[^>]+>")


class LookupError(RuntimeError):
    """Erro operacional ao carregar listas auxiliares."""


def search_sgt_items(
    kind: str,
    query: str,
    *,
    limit: int = 50,
    timeout_seconds: int = 30,
) -> list[dict[str, Any]]:
    table_type = SGT_TABLE_TYPES[kind]
    body = f"""
    <?xml version="1.0" encoding="utf-8"?>
    <soapenv:Envelope
        xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
        xmlns:tns="https://www.cnj.jus.br/sgt/sgt_ws.php">
      <soapenv:Body>
        <tns:pesquisarItemPublicoWS>
          <tipoTabela>{table_type}</tipoTabela>
          <tipoPesquisa>{SGT_SEARCH_TYPES["nome"]}</tipoPesquisa>
          <valorPesquisa>{_escape_xml(query.strip())}</valorPesquisa>
        </tns:pesquisarItemPublicoWS>
      </soapenv:Body>
    </soapenv:Envelope>
    """.strip()

    response = requests.post(
        SGT_WSDL_URL,
        data=body.encode("utf-8"),
        headers={
            "Content-Type": "text/xml; charset=utf-8",
            "SOAPAction": f"{SGT_WSDL_URL}#pesquisarItemPublicoWS",
        },
        timeout=timeout_seconds,
    )
    response.raise_for_status()

    root = ET.fromstring(response.content)
    items: list[dict[str, Any]] = []
    for item_node in root.iter():
        if _local_name(item_node.tag) != "Item":
            continue
        items.append(
            {
                "codigo": _child_text(item_node, "cod_item"),
                "codigo_pai": _child_text(item_node, "cod_item_pai"),
                "nome": _normalize_sgt_text(_child_text(item_node, "nome")),
                "glossario": _normalize_sgt_text(_child_text(item_node, "dscGlossario")),
                "tipo": kind,
            }
        )

    deduped: dict[str, dict[str, Any]] = {}
    for item in items:
        codigo = str(item.get("codigo") or "").strip()
        if not codigo or codigo in deduped:
            continue
        deduped[codigo] = item

    ordered = sorted(
        deduped.values(),
        key=lambda item: (
            str(item.get("nome") or "").casefold(),
            str(item.get("codigo") or ""),
        ),
    )
    return ordered[:limit]


def search_orgao_julgador_items(
    client: DataJudClient,
    tribunal_alias: str,
    query: str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    clean_query = query.strip()
    if not clean_query:
        return []

    response = client.search(
        tribunal_alias,
        {
            "size": 0,
            "query": {"match": {"orgaoJulgador.nome": clean_query}},
            "aggs": {
                "orgaos": {
                    "terms": {
                        "field": "orgaoJulgador.codigo",
                        "size": min(max(limit, 1), 100),
                    },
                    "aggs": {
                        "top": {
                            "top_hits": {
                                "size": 1,
                                "_source": [
                                    "orgaoJulgador.codigo",
                                    "orgaoJulgador.nome",
                                    "orgaoJulgador.codigoMunicipioIBGE",
                                ],
                            }
                        }
                    },
                }
            },
        },
    )

    items: list[dict[str, Any]] = []
    for bucket in response.get("aggregations", {}).get("orgaos", {}).get("buckets", []):
        hits = bucket.get("top", {}).get("hits", {}).get("hits", [])
        if not hits:
            continue
        orgao = hits[0].get("_source", {}).get("orgaoJulgador", {})
        codigo = orgao.get("codigo")
        nome = orgao.get("nome")
        if not codigo or not nome:
            continue
        items.append(
            {
                "codigo": codigo,
                "nome": nome,
                "codigo_municipio_ibge": orgao.get("codigoMunicipioIBGE"),
                "tipo": "orgao_julgador",
            }
        )

    return sorted(items, key=lambda item: str(item["nome"]).casefold())


def list_datajud_filter_items(
    client: DataJudClient,
    tribunal_alias: str,
    kind: str,
    *,
    limit: int = 50,
) -> list[dict[str, Any]]:
    config = DATAJUD_FILTER_FIELDS[kind]
    response = client.search(
        tribunal_alias,
        {
            "size": 0,
            "query": {"match_all": {}},
            "aggs": {
                "items": {
                    "terms": {
                        "field": config["agg_field"],
                        "size": min(max(limit, 1), 100),
                    },
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
        },
    )

    items: list[dict[str, Any]] = []
    for bucket in response.get("aggregations", {}).get("items", {}).get("buckets", []):
        hits = bucket.get("top", {}).get("hits", {}).get("hits", [])
        if not hits:
            continue

        source = hits[0].get("_source", {})
        nome = _nested_value(source, config["value_path"])
        codigo = (
            _nested_value(source, config["code_path"])
            if config["code_path"]
            else bucket.get("key")
        )
        if not nome:
            continue

        items.append(
            {
                "codigo": codigo,
                "nome": nome,
                "tipo": kind,
            }
        )

    deduped: dict[str, dict[str, Any]] = {}
    for item in items:
        key = f"{item.get('codigo')}|{item.get('nome')}"
        if key not in deduped:
            deduped[key] = item

    ordered = list(deduped.values())
    if kind == "grau":
        ordered.sort(
            key=lambda item: (
                GRAU_SORT_ORDER.get(str(item.get("nome")), 99),
                str(item.get("nome") or "").casefold(),
            )
        )
    else:
        ordered.sort(key=lambda item: str(item.get("nome") or "").casefold())
    return ordered[:limit]


def format_lookup_option(item: dict[str, Any]) -> str:
    name = str(item.get("nome") or "").strip()
    code = str(item.get("codigo") or "").strip()
    if code and code != name:
        return f"{name} ({code})"
    return name


def _normalize_sgt_text(value: str) -> str:
    cleaned = html.unescape(value or "")
    cleaned = HTML_TAG_RE.sub(" ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def _escape_xml(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(node: ET.Element, child_name: str) -> str:
    for child in node:
        if _local_name(child.tag) == child_name:
            return child.text or ""
    return ""


def _nested_value(data: dict[str, Any], path: str | None) -> Any:
    if not path:
        return None

    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current
