"""Enriquecimento opcional por fontes oficiais do tribunal."""

from __future__ import annotations

import concurrent.futures
import json
import re
import threading
import time
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

TRF1_SEARCH_URL = (
    "https://pje1g-consultapublica.trf1.jus.br/consultapublica/ConsultaPublica/listView.seam"
)
TRF1_PROCESS_INPUT_SELECTOR = "input[id$='numProcesso-inputNumeroProcesso']"
TJGO_SEARCH_URL = "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=4&TipoConsultaProcesso=24"

SUPPORTED_OFFICIAL_SOURCES = {
    "api_publica_trf1": "TRF1 consulta publica",
    "api_publica_tjgo": "TJGO Projudi consulta publica",
}

TRF1_DETAIL_URL_RE = re.compile(
    r"DetalheProcessoConsultaPublica/listView\.seam\?ca=[^\"'\s<]+"
)
TRF1_DOCUMENT_URL_RE = re.compile(r"openPopUp\([^,]+,\s*'([^']+)'")
TRF1_CODE_SUFFIX_RE = re.compile(r"^(?P<name>.+?)\s*\((?P<code>\d+)\)\s*$")
TRF1_ROLE_RE = re.compile(r"\(([^()]+)\)")
TRF1_DOC_RE = re.compile(r"\b(CPF|CNPJ):\s*([0-9./-]+)")
TRF1_OAB_RE = re.compile(r"\bOAB\s+([A-Z]{2})?\s*([0-9A-Z./-]+)")
TRF1_OPEN_CODE_SUFFIX_RE = re.compile(r"\(\d+$")
DATED_TEXT_RE = re.compile(
    r"^(?P<date>\d{2}/\d{2}/\d{4}(?:\s+\d{2}:\d{2}:\d{2})?)\s*-\s*(?P<text>.+)$"
)
CNJ_FORMAT_RE = re.compile(r"^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$")
TJGO_FILE_REF_RE = re.compile(r"buscarArquivosMovimentacaoJSON\('([^']+)'")
TJGO_PROFILE_DIR = Path("output/playwright/tjgo-profile")

# Cessão de crédito detection keywords (normalized, sem acento)
CESSAO_DETECTION_KEYWORDS = (
    "cessao",
    "cessionario",
    "cedente",
    "cedido",
)
GARBAGE_LINE_RE = re.compile(r"^\d+$")
GARBAGE_RESULTS_RE = re.compile(r"\d+\s+resultados?\s+encontrados?", re.IGNORECASE)
CPF_NORMALIZE_RE = re.compile(r"\b(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s]?(\d{2})\b")
CNPJ_NORMALIZE_RE = re.compile(r"\b(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[/\s]?(\d{4})[-\s]?(\d{2})\b")

TJGO_EXTRACT_SCRIPT = r"""
() => {
  const clean = (value) => (value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  const lines = clean(document.body.innerText)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line);

  const getLineAfter = (label) => {
    const index = lines.findIndex((line) => line === label);
    return index >= 0 ? (lines[index + 1] || '') : '';
  };

  const getBlockAfter = (label, stopLabels) => {
    const index = lines.findIndex((line) => line === label);
    if (index < 0) {
      return [];
    }

    const values = [];
    for (let current = index + 1; current < lines.length; current += 1) {
      const line = lines[current];
      if (stopLabels.includes(line)) {
        break;
      }
      values.push(line);
    }
    return values;
  };

  const scriptText = Array.from(document.scripts)
    .map((script) => script.textContent || '')
    .join('\n');

  const parseLiteral = (pattern) => {
    const match = scriptText.match(pattern);
    if (!match) {
      return null;
    }
    try {
      return Function(`return (${match[1]});`)();
    } catch (error) {
      return null;
    }
  };

  const parseArray = (name) =>
    parseLiteral(new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`)) || [];

  const parseValue = (name) =>
    parseLiteral(new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*([^;]+);`));

  const tables = Array.from(document.querySelectorAll('table'));
  const eventTable = tables.find((table) => {
    const headers = Array.from(table.querySelectorAll('tr:first-child td, tr:first-child th'))
      .map((cell) => clean(cell.innerText));
    return headers.some((value) => value.startsWith('Movimenta')) &&
      headers.includes('Data') &&
      headers.some((value) => value.startsWith('Usu'));
  });

  const eventRows = eventTable
    ? Array.from(eventTable.querySelectorAll('tr'))
        .map((row) => {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 4) {
            return null;
          }

          const order = clean(cells[0].innerText);
          if (!/^\d+$/.test(order)) {
            return null;
          }

          const fileLink = row.querySelector("a[href*='buscarArquivosMovimentacaoJSON']");
          return {
            ordem: order,
            movimentacao: clean(cells[1].innerText),
            data_hora: clean(cells[2].innerText),
            usuario: clean(cells[3].innerText),
            arquivos: clean(cells[4] ? cells[4].innerText : ''),
            opcoes: clean(cells[5] ? cells[5].innerText : ''),
            arquivos_js: fileLink ? (fileLink.getAttribute('href') || '') : '',
          };
        })
        .filter(Boolean)
    : [];

  const partiesLink = document.querySelector("a[href*='ProcessoParte?PaginaAtual=6']");

  return {
    url: location.href,
    titulo: document.title,
    processo_id: parseValue('processoId'),
    polos_ativos: parseArray('polosAtivos'),
    polos_passivos: parseArray('polosPassivos'),
    advogados_processo: parseArray('advogadosProcesso'),
    serventia: getLineAfter('Serventia'),
    classe: getLineAfter('Classe'),
    assuntos: getBlockAfter(
      'Assunto(s)',
      [
        'Processo Originário',
        'Eventos do Processo',
        'Indice Processo',
        'Índice Processo',
        'Navegacao de Arquivo',
        'Navegação de Arquivo',
      ]
    ),
    processo_originario: getLineAfter('Processo Originário'),
    eventos: eventRows,
    linhas: lines,
    partes_url: partiesLink ? partiesLink.href : '',
  };
}
"""


def _normalize_text_for_search(value: str) -> str:
    """Normalize text for keyword search (remove accents, lowercase)."""
    nfkd = unicodedata.normalize("NFKD", str(value))
    ascii_only = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return " ".join(ascii_only.lower().strip().split())


def _text_contains_cessao(text: str) -> bool:
    """Return True if text contains any cessão-related keyword (normalized)."""
    normalized = _normalize_text_for_search(text)
    return any(kw in normalized for kw in CESSAO_DETECTION_KEYWORDS)


def _sanitize_participant_text(text: str) -> str:
    """Clean a participant cell value: strip, collapse whitespace, reject garbage."""
    cleaned = re.sub(r"[\t]+", " ", str(text))
    cleaned = re.sub(r" +", " ", cleaned).strip()
    if GARBAGE_LINE_RE.match(cleaned):
        return ""
    if GARBAGE_RESULTS_RE.search(cleaned):
        return ""
    return cleaned


def _normalize_cpf_cnpj(text: str) -> str:
    """Return a CPF/CNPJ string normalized to the standard punctuated format."""
    text = text.strip()
    cpf_m = CPF_NORMALIZE_RE.fullmatch(text)
    if cpf_m:
        return f"{cpf_m.group(1)}.{cpf_m.group(2)}.{cpf_m.group(3)}-{cpf_m.group(4)}"
    cnpj_m = CNPJ_NORMALIZE_RE.fullmatch(text)
    if cnpj_m:
        return (
            f"{cnpj_m.group(1)}.{cnpj_m.group(2)}.{cnpj_m.group(3)}"
            f"/{cnpj_m.group(4)}-{cnpj_m.group(5)}"
        )
    return text


def _detect_cessao_in_trf1(
    *,
    event_rows: list[dict[str, Any]],
    document_rows: list[dict[str, Any]],
    party_rows: list[dict[str, Any]],
) -> tuple[str, str]:
    """Detect cessão de crédito in TRF1 events and documents by title only.

    Returns (cessao_credito, cessao_detalhes) where cessao_credito is
    'Sim', 'Não', or 'Possível' (multiple authors = collective process).
    """
    active_parties = [
        r for r in party_rows
        if r.get("polo") == "polo_ativo" and r.get("tipo_registro") == "parte"
    ]
    is_collective = len(active_parties) > 1

    # Search in events (movimentações do processo)
    for row in event_rows:
        event_text = str(row.get("evento") or "").strip()
        if _text_contains_cessao(event_text):
            date_text = str(row.get("data_hora") or "").strip()
            detail = f"{event_text} em {date_text}" if date_text else event_text
            return ("Possível" if is_collective else "Sim"), detail[:300]

    # Search in documents (documentos juntados)
    for row in document_rows:
        doc_text = str(row.get("documento") or "").strip()
        if _text_contains_cessao(doc_text):
            date_text = str(row.get("data_hora") or "").strip()
            detail = f"{doc_text} em {date_text}" if date_text else doc_text
            return ("Possível" if is_collective else "Sim"), detail[:300]

    return "Não", ""


# Priority keywords for document selection when opening popups
_DOC_PRIORITY_KEYWORDS = (
    "peticao intercorrente",
    "habilitacao",
    "cessao de credito",
    "cessao",
)


def _doc_open_priority(row: dict[str, Any]) -> int:
    """Return priority index for a document row (lower = higher priority)."""
    text = _normalize_text_for_search(
        str(row.get("documento") or row.get("evento") or "")
    )
    for i, kw in enumerate(_DOC_PRIORITY_KEYWORDS):
        if kw in text:
            return i
    return len(_DOC_PRIORITY_KEYWORDS)


def _analyze_documents_for_cessao(
    page: Any,
    event_rows: list[dict[str, Any]],
    document_rows: list[dict[str, Any]],
    party_names_ativo: list[str],
) -> dict[str, Any]:
    """Analyze TRF1 documents by opening popups to detect cessão de crédito.

    Phase 1 (fast path): Check titles for cessão keywords — no popup needed.
    Phase 2: Open document popups and inspect content.

    Returns:
        cessao_credito: "Sim" | "Não" | "Possível"
        cessao_detalhes: short description string
        partes_cedentes: list of party names identified as cedentes
        partes_nao_cedentes: list of active parties not found in cessão content
    """
    is_collective = len(party_names_ativo) > 1

    # ------------------------------------------------------------------
    # Phase 1: Title-based fast path
    # ------------------------------------------------------------------
    for row in event_rows:
        text = str(row.get("evento") or "").strip()
        if _text_contains_cessao(text):
            date_text = str(row.get("data_hora") or "").strip()
            detail = f"{text} em {date_text}" if date_text else text
            return {
                "cessao_credito": "Possível" if is_collective else "Sim",
                "cessao_detalhes": detail[:300],
                "partes_cedentes": [],
                "partes_nao_cedentes": [],
            }

    for row in document_rows:
        text = str(row.get("documento") or "").strip()
        if _text_contains_cessao(text):
            date_text = str(row.get("data_hora") or "").strip()
            detail = f"{text} em {date_text}" if date_text else text
            return {
                "cessao_credito": "Possível" if is_collective else "Sim",
                "cessao_detalhes": detail[:300],
                "partes_cedentes": [],
                "partes_nao_cedentes": [],
            }

    # ------------------------------------------------------------------
    # Phase 2: Open document popups and read content
    # ------------------------------------------------------------------
    candidate_docs: list[tuple[dict[str, Any], str]] = []
    for row in event_rows:
        url = str(row.get("documento_url") or "")
        if "documentoSemLoginHTML" in url:
            candidate_docs.append((row, "evento"))
    for row in document_rows:
        url = str(row.get("url_documento") or "")
        if "documentoSemLoginHTML" in url:
            candidate_docs.append((row, "documento"))

    # Sort by priority — check all documents (no cap)
    candidate_docs.sort(key=lambda x: _doc_open_priority(x[0]))

    party_names_normalized = [_normalize_text_for_search(n) for n in party_names_ativo]

    partes_cedentes: list[str] = []
    partes_nao_cedentes: list[str] = []
    cessao_found = False
    cessao_detail = ""

    for row, row_type in candidate_docs:
        doc_url = (
            str(row.get("documento_url") or "")
            if row_type == "evento"
            else str(row.get("url_documento") or "")
        )
        if not doc_url:
            continue

        popup_text: str | None = None

        # Try evaluate-based popup first
        try:
            with page.expect_popup() as popup_info:
                page.evaluate(f"openPopUp('tmpPopup', '{doc_url}')")
            popup_page = popup_info.value
            popup_page.wait_for_load_state("networkidle", timeout=15000)
            popup_text = popup_page.inner_text("body")
            popup_page.close()
        except Exception:
            popup_text = None

        # Fallback: click the element with matching onclick
        if popup_text is None:
            try:
                doc_id_match = re.search(r"idProcessoDoc=(\d+)", doc_url)
                if doc_id_match:
                    doc_id = doc_id_match.group(1)
                    element = page.locator(
                        f"[onclick*='{doc_id}'][onclick*='documentoSemLoginHTML']"
                    ).first
                    with page.expect_popup() as popup_info:
                        element.click()
                    popup_page = popup_info.value
                    popup_page.wait_for_load_state("networkidle", timeout=15000)
                    popup_text = popup_page.inner_text("body")
                    popup_page.close()
            except Exception:
                continue

        if not popup_text or not _text_contains_cessao(popup_text):
            continue

        cessao_found = True
        text_normalized = _normalize_text_for_search(popup_text)

        # Identify which active parties appear near cessão keywords
        for i, party_norm in enumerate(party_names_normalized):
            if not party_norm:
                continue
            pos = text_normalized.find(party_norm)
            if pos == -1:
                continue
            nearby = text_normalized[max(0, pos - 200) : pos + 200]
            if any(kw in nearby for kw in CESSAO_DETECTION_KEYWORDS):
                if party_names_ativo[i] not in partes_cedentes:
                    partes_cedentes.append(party_names_ativo[i])
            else:
                if party_names_ativo[i] not in partes_nao_cedentes:
                    partes_nao_cedentes.append(party_names_ativo[i])

        if not cessao_detail:
            doc_title = str(row.get("documento") or row.get("evento") or "")
            date_text = str(row.get("data_hora") or "")
            cessao_detail = f"Cessão detectada em: {doc_title}"
            if date_text:
                cessao_detail += f" ({date_text})"

        break  # Found cessão — no need to open more documents

    if not cessao_found:
        return {
            "cessao_credito": "Não",
            "cessao_detalhes": "",
            "partes_cedentes": [],
            "partes_nao_cedentes": [],
        }

    # Any active party not explicitly categorised → mark as not-cedente
    for party in party_names_ativo:
        if party not in partes_cedentes and party not in partes_nao_cedentes:
            partes_nao_cedentes.append(party)

    # Collective process with confirmed cedentes → "Sim"; otherwise "Possível"
    if is_collective:
        cessao_credito = "Sim" if partes_cedentes else "Possível"
    else:
        cessao_credito = "Sim"

    return {
        "cessao_credito": cessao_credito,
        "cessao_detalhes": cessao_detail[:300],
        "partes_cedentes": partes_cedentes,
        "partes_nao_cedentes": partes_nao_cedentes,
    }


def _build_party_structured_columns(
    party_rows: list[dict[str, Any]],
    lawyer_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build structured party display columns.

    Returns a dict with:
      polo_ativo_partes, polo_ativo_advogados,
      polo_passivo_partes, polo_passivo_advogados,
      quantidade_polo_ativo, quantidade_polo_passivo
    """
    active_parts: list[str] = []
    passive_parts: list[str] = []
    active_lawyers: list[str] = []
    passive_lawyers: list[str] = []

    for row in party_rows:
        polo = str(row.get("polo") or "")
        nome = _sanitize_participant_text(str(row.get("nome") or ""))
        if not nome:
            continue
        papel = str(row.get("papel") or "").strip()
        doc_tipo = str(row.get("documento_tipo") or "").strip().upper()
        doc_val = _normalize_cpf_cnpj(str(row.get("documento") or "").strip())

        formatted = nome
        if papel:
            formatted += f" ({papel})"
        if doc_tipo and doc_val:
            formatted += f" {doc_tipo}:{doc_val}"

        if polo == "polo_ativo":
            active_parts.append(formatted)
        elif polo == "polo_passivo":
            passive_parts.append(formatted)

    for row in lawyer_rows:
        polo = str(row.get("polo") or "")
        nome = _sanitize_participant_text(str(row.get("nome_advogado") or ""))
        if not nome:
            continue
        oab = str(row.get("oab_formatada") or "").strip()

        formatted = nome
        if oab:
            formatted += f" (OAB {oab})"

        if polo == "polo_ativo":
            active_lawyers.append(formatted)
        elif polo == "polo_passivo":
            passive_lawyers.append(formatted)

    return {
        "polo_ativo_partes": " | ".join(active_parts),
        "polo_ativo_advogados": " | ".join(active_lawyers),
        "polo_passivo_partes": " | ".join(passive_parts),
        "polo_passivo_advogados": " | ".join(passive_lawyers),
        "quantidade_polo_ativo": len(active_parts),
        "quantidade_polo_passivo": len(passive_parts),
    }


class OfficialSourceError(RuntimeError):
    """Erro operacional ao consultar uma fonte oficial."""


@dataclass
class OfficialEnrichmentResult:
    process_rows: list[dict[str, Any]] = field(default_factory=list)
    party_rows: list[dict[str, Any]] = field(default_factory=list)
    lawyer_rows: list[dict[str, Any]] = field(default_factory=list)
    event_rows: list[dict[str, Any]] = field(default_factory=list)
    document_rows: list[dict[str, Any]] = field(default_factory=list)
    not_found_rows: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    process_map: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)
    status_by_key: dict[tuple[str, str], dict[str, Any]] = field(default_factory=dict)

    def add_success(
        self,
        *,
        key: tuple[str, str],
        process_row: dict[str, Any],
        party_rows: list[dict[str, Any]],
        lawyer_rows: list[dict[str, Any]],
        event_rows: list[dict[str, Any]],
        document_rows: list[dict[str, Any]],
    ) -> None:
        self.process_rows.append(process_row)
        self.party_rows.extend(party_rows)
        self.lawyer_rows.extend(lawyer_rows)
        self.event_rows.extend(event_rows)
        self.document_rows.extend(document_rows)
        self.process_map[key] = process_row
        self.status_by_key[key] = {
            "status": "encontrado",
            "fonte": process_row.get("fonte_oficial"),
            "mensagem": "",
        }

    def add_not_found(
        self,
        *,
        key: tuple[str, str],
        line_number: int | None,
        source_label: str,
        detail: str = "",
    ) -> None:
        tribunal_alias, process_number = key
        self.not_found_rows.append(
            {
                "fonte": source_label,
                "numero_processo": process_number,
                "tribunal": tribunal_alias,
                "linha_origem": line_number,
                "detalhe": detail,
            }
        )
        self.status_by_key[key] = {
            "status": "nao_encontrado",
            "fonte": source_label,
            "mensagem": detail,
        }

    def add_error(
        self,
        *,
        key: tuple[str, str],
        source_label: str,
        message: str,
    ) -> None:
        tribunal_alias, process_number = key
        error_message = (
            f"{source_label}: falha ao consultar {process_number} ({tribunal_alias}) - {message}"
        )
        self.errors.append(error_message)
        self.status_by_key[key] = {
            "status": "erro",
            "fonte": source_label,
            "mensagem": message,
        }


def enrich_from_official_sources(
    query_rows: list[dict[str, Any]],
    on_progress: Any | None = None,
) -> OfficialEnrichmentResult:
    result = OfficialEnrichmentResult()
    supported_rows = _dedupe_query_rows(query_rows)

    trf1_rows = [row for row in supported_rows if row["tribunal_alias"] == "api_publica_trf1"]
    tjgo_rows = [row for row in supported_rows if row["tribunal_alias"] == "api_publica_tjgo"]

    if trf1_rows:
        _enrich_trf1(result, trf1_rows, on_progress=on_progress)
    if tjgo_rows:
        _enrich_tjgo(result, tjgo_rows)

    return result


def _dedupe_query_rows(query_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str]] = set()
    deduped: list[dict[str, Any]] = []

    for row in query_rows:
        tribunal_alias = row.get("tribunal_alias")
        process_number = row.get("numero_processo")
        if not tribunal_alias or not process_number:
            continue
        if tribunal_alias not in SUPPORTED_OFFICIAL_SOURCES:
            continue

        key = (tribunal_alias, process_number)
        if key in seen:
            continue

        seen.add(key)
        deduped.append(row)

    return deduped


def _process_single_trf1_row(row: dict[str, Any], source_label: str, _retry: int = 0) -> dict[str, Any]:
    """Processa uma única linha TRF1 usando sua própria instância Playwright.

    Retorna um dict com campos:
        status: "success" | "not_found" | "error"
        key: tuple (tribunal_alias, numero_processo)
        line_number: int | None
        detail: str (para not_found)
        message: str (para error)
        process_row, party_rows, lawyer_rows, event_rows, document_rows (para success)
    """
    import time as _time  # noqa: PLC0415
    key = (row["tribunal_alias"], row["numero_processo"])
    formatted_number = format_cnj_number(row["numero_processo"])
    line_number = row.get("linha_origem")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(locale="pt-BR")
        page = context.new_page()
        try:
            _open_trf1_search_page(page)
            page.locator(TRF1_PROCESS_INPUT_SELECTOR).fill(formatted_number)
            page.get_by_role("button", name="Pesquisar").click()
            page.wait_for_load_state("networkidle", timeout=30000)

            html = page.content()
            if "0 resultados encontrados" in html:
                return {
                    "status": "not_found",
                    "key": key,
                    "line_number": line_number,
                    "detail": "Processo nao encontrado no portal do TRF1.",
                }

            detail_match = TRF1_DETAIL_URL_RE.search(html)
            if not detail_match:
                return {
                    "status": "not_found",
                    "key": key,
                    "line_number": line_number,
                    "detail": "O portal retornou a pesquisa, mas sem link de detalhe.",
                }

            detail_url = urljoin(TRF1_SEARCH_URL, detail_match.group(0))
            page.goto(detail_url, wait_until="networkidle", timeout=60000)
            detail_html = page.content()

            extracted = _parse_trf1_detail(
                process_number=row["numero_processo"],
                tribunal_alias=row["tribunal_alias"],
                detail_url=detail_url,
                html=detail_html,
                page=page,
            )

            extra_parties, extra_lawyers = _paginate_trf1_parties(
                page,
                process_number=row["numero_processo"],
                tribunal_alias=row["tribunal_alias"],
                detail_url=detail_url,
            )
            if extra_parties or extra_lawyers:
                extracted["party_rows"].extend(extra_parties)
                extracted["lawyer_rows"].extend(extra_lawyers)
                _rebuild_party_summaries(extracted)

            # Extract full text from each document — uses openPopUp (same approach
            # as _analyze_documents_for_cessao) to ensure session context is preserved.
            for doc_row in extracted.get("document_rows", []):
                for url_field, text_field in (
                    ("url_documento", "texto_documento"),
                    ("url_certidao", "texto_certidao"),
                ):
                    doc_url = str(doc_row.get(url_field) or "").strip()
                    if not doc_url:
                        doc_row[text_field] = ""
                        continue
                    popup_text: str | None = None
                    # Abordagem 1: openPopUp via evaluate (garante contexto de sessão)
                    try:
                        with page.expect_popup() as popup_info:
                            page.evaluate(f"openPopUp('tmpPopup_{text_field}', '{doc_url}')")
                        popup_page = popup_info.value
                        popup_page.wait_for_load_state("networkidle", timeout=20000)
                        popup_text = popup_page.inner_text("body").strip()
                        popup_page.close()
                    except Exception:
                        popup_text = None
                    # Abordagem 2: navegação direta no mesmo contexto (fallback)
                    if not popup_text:
                        try:
                            fallback_page = context.new_page()
                            fallback_page.goto(doc_url, wait_until="domcontentloaded", timeout=20000)
                            popup_text = fallback_page.inner_text("body").strip()
                            fallback_page.close()
                        except Exception:
                            popup_text = ""
                    doc_row[text_field] = popup_text or ""

            extracted_for_result = {k: v for k, v in extracted.items() if k != "cessao_result"}
            return {
                "status": "success",
                "key": key,
                "line_number": line_number,
                **extracted_for_result,
            }
        except Exception as exc:  # pragma: no cover - depends on external site
            err_msg = str(exc)
            # Retry em erros de rede transitórios (ERR_EMPTY_RESPONSE, timeout) até 3 vezes
            is_transient = any(kw in err_msg for kw in (
                "ERR_EMPTY_RESPONSE", "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED",
                "net::", "TimeoutError", "timeout",
            ))
            if is_transient and _retry < 3:
                page.close()
                context.close()
                browser.close()
                _time.sleep(2 ** _retry * 2)  # 2s, 4s, 8s
                return _process_single_trf1_row(row, source_label, _retry=_retry + 1)
            return {
                "status": "error",
                "key": key,
                "line_number": line_number,
                "message": err_msg,
            }
        finally:
            page.close()
            context.close()
            browser.close()


def _enrich_trf1(result: OfficialEnrichmentResult, rows: list[dict[str, Any]], on_progress: Any | None = None) -> None:
    source_label = SUPPORTED_OFFICIAL_SOURCES["api_publica_trf1"]
    total = len(rows)

    progress_lock = threading.Lock()
    completed: list[int] = [0]

    def process_with_progress(row: dict[str, Any]) -> dict[str, Any]:
        row_result = _process_single_trf1_row(row, source_label)
        with progress_lock:
            completed[0] += 1
            if on_progress:
                try:
                    on_progress(completed[0], total, f"Consultando TRF1: processo {completed[0]}/{total}")
                except Exception:
                    pass
        return row_result

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(process_with_progress, row) for row in rows]
        row_results = [f.result() for f in futures]

    for row_result in row_results:
        key = row_result["key"]
        line_number = row_result.get("line_number")
        status = row_result["status"]
        if status == "success":
            result.add_success(
                key=key,
                process_row=row_result["process_row"],
                party_rows=row_result.get("party_rows", []),
                lawyer_rows=row_result.get("lawyer_rows", []),
                event_rows=row_result.get("event_rows", []),
                document_rows=row_result.get("document_rows", []),
            )
        elif status == "not_found":
            result.add_not_found(
                key=key,
                line_number=line_number,
                source_label=source_label,
                detail=row_result.get("detail", ""),
            )
        elif status == "error":
            result.add_error(
                key=key,
                source_label=source_label,
                message=row_result.get("message", "Erro desconhecido"),
            )


def _enrich_tjgo(result: OfficialEnrichmentResult, rows: list[dict[str, Any]]) -> None:
    source_label = SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"]
    TJGO_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser_type = playwright.chromium
        launch_kwargs = {
            "user_data_dir": str(TJGO_PROFILE_DIR.resolve()),
            "headless": False,
            "viewport": {"width": 1366, "height": 900},
        }

        try:
            context = browser_type.launch_persistent_context(channel="chrome", **launch_kwargs)
        except Exception:  # pragma: no cover - depends on local browser install
            context = browser_type.launch_persistent_context(**launch_kwargs)

        page = context.pages[0] if context.pages else context.new_page()

        for row in rows:
            key = (row["tribunal_alias"], row["numero_processo"])
            formatted_number = format_cnj_number(row["numero_processo"])
            line_number = row.get("linha_origem")

            try:
                page.goto(TJGO_SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
                _wait_for_tjgo_challenge(page)
                page.locator("#ProcessoNumero").fill(formatted_number)
                page.locator("#btnBuscar").click(timeout=15000)
                page.wait_for_load_state("networkidle", timeout=30000)

                if page.locator("text=Dados do Processo").count() == 0:
                    body_text = page.locator("body").inner_text()
                    if "processo" in body_text.lower() and "nao" in body_text.lower():
                        result.add_not_found(
                            key=key,
                            line_number=line_number,
                            source_label=source_label,
                            detail="Processo nao encontrado no portal do TJGO.",
                        )
                        continue
                    raise OfficialSourceError(
                        "A pagina de detalhe nao abriu. Se o Chrome foi exibido, conclua o desafio "
                        "manual do portal do TJGO e execute a consulta novamente."
                    )

                extracted_payload = page.evaluate(TJGO_EXTRACT_SCRIPT)
                extracted = _parse_tjgo_payload(
                    process_number=row["numero_processo"],
                    tribunal_alias=row["tribunal_alias"],
                    payload=extracted_payload,
                )
                result.add_success(key=key, **extracted)
            except Exception as exc:  # pragma: no cover - depends on external site
                result.add_error(key=key, source_label=source_label, message=str(exc))

        context.close()


def _open_trf1_search_page(page: Any, *, retries: int = 3) -> None:
    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            page.goto(TRF1_SEARCH_URL, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_selector(
                TRF1_PROCESS_INPUT_SELECTOR,
                state="visible",
                timeout=30000,
            )
            return
        except PlaywrightTimeoutError as exc:  # pragma: no cover - depends on external site
            last_error = exc
            if attempt + 1 >= retries:
                break
            page.wait_for_timeout(1500)

    raise OfficialSourceError(
        "O portal do TRF1 nao carregou o campo de numero do processo a tempo."
    ) from last_error


def _wait_for_tjgo_challenge(page: Any, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds

    while time.time() < deadline:
        try:
            disabled = page.locator("#btnBuscar").evaluate("el => el.disabled")
        except PlaywrightTimeoutError:
            page.wait_for_timeout(1000)
            continue

        if not disabled:
            return
        page.wait_for_timeout(1000)

    raise OfficialSourceError(
        "O portal do TJGO manteve a validacao anti-bot ativa. "
        "Se a janela do Chrome abriu, conclua a validacao manual e tente novamente."
    )


def _paginate_trf1_parties(
    pw_page: Any,
    *,
    process_number: str,
    tribunal_alias: str,
    detail_url: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Click through RichFaces DataScroller pages to collect additional parties."""
    extra_party_rows: list[dict[str, Any]] = []
    extra_lawyer_rows: list[dict[str, Any]] = []

    for pole_title in ["Polo ativo", "Polo Passivo", "Outros interessados"]:
        page_count = pw_page.evaluate(
            """(poleTitle) => {
            const headers = [...document.querySelectorAll('.rich-panel-header')];
            const header = headers.find(h => h.textContent.trim() === poleTitle);
            if (!header) return 0;
            const panel = header.closest('.rich-panel');
            if (!panel) return 0;
            const scroller = panel.querySelector('.rich-datascr');
            if (!scroller || scroller.style.display === 'none' || scroller.offsetParent === null)
                return 0;
            return scroller.querySelectorAll('.rich-datascr-act, .rich-datascr-inact').length;
            }""",
            pole_title,
        )

        if page_count <= 1:
            continue

        for target_page in range(2, page_count + 1):
            clicked = pw_page.evaluate(
                """([poleTitle, targetPage]) => {
                const headers = [...document.querySelectorAll('.rich-panel-header')];
                const header = headers.find(h => h.textContent.trim() === poleTitle);
                if (!header) return false;
                const panel = header.closest('.rich-panel');
                if (!panel) return false;
                const scroller = panel.querySelector('.rich-datascr');
                if (!scroller) return false;
                const cells = scroller.querySelectorAll('.rich-datascr-inact');
                for (const cell of cells) {
                    if (cell.textContent.trim() === String(targetPage)) {
                        cell.click();
                        return true;
                    }
                }
                return false;
                }""",
                [pole_title, target_page],
            )

            if not clicked:
                break

            pw_page.wait_for_load_state("networkidle", timeout=15000)

            html = pw_page.content()
            soup = BeautifulSoup(html, "html.parser")
            rows = _parse_trf1_people_panel(
                soup=soup,
                process_number=process_number,
                tribunal_alias=tribunal_alias,
                detail_url=detail_url,
                pole_title=pole_title,
            )
            for row in rows:
                if row["tipo_registro"] == "advogado":
                    extra_lawyer_rows.append(row)
                else:
                    extra_party_rows.append(row)

    return extra_party_rows, extra_lawyer_rows


def _rebuild_party_summaries(extracted: dict[str, Any]) -> None:
    """Update process_row summary fields after collecting extra parties."""
    all_parties = extracted["party_rows"]
    all_lawyers = extracted["lawyer_rows"]
    pr = extracted["process_row"]

    active_names = [r["nome"] for r in all_parties if r.get("polo") == "polo_ativo"]
    passive_names = [r["nome"] for r in all_parties if r.get("polo") == "polo_passivo"]
    other_names = [
        r["nome"]
        for r in all_parties
        if r.get("polo") not in ("polo_ativo", "polo_passivo")
    ]

    pr["polo_ativo"] = ", ".join(active_names)
    pr["polo_passivo"] = ", ".join(passive_names)
    pr["outros_interessados"] = ", ".join(other_names)
    pr["partes_resumo"] = _join_labels(
        [r["nome"] for r in all_parties if r.get("nome")]
    )
    pr["advogados_resumo"] = _join_labels(
        [
            _join_labels([r.get("nome_advogado", ""), r.get("oab_formatada", "")], " - ")
            for r in all_lawyers
        ]
    )
    pr["quantidade_partes"] = len(all_parties)
    pr["quantidade_advogados"] = len(all_lawyers)

    # Recompute cessão detection and structured party columns
    # Use stored popup-based result if available; otherwise fall back to title-based detection.
    stored_cessao = extracted.get("cessao_result") or {}
    if stored_cessao:
        cessao_credito = stored_cessao.get("cessao_credito", "Não")
        cessao_detalhes = stored_cessao.get("cessao_detalhes", "")
        partes_cedentes: list[str] = stored_cessao.get("partes_cedentes", [])
        partes_nao_cedentes: list[str] = stored_cessao.get("partes_nao_cedentes", [])
        # Recompute Possível/Sim now that we have the full party list
        if cessao_credito in ("Sim", "Possível"):
            is_collective = len(active_names) > 1
            if is_collective:
                cessao_credito = "Sim" if partes_cedentes else "Possível"
    else:
        cessao_credito, cessao_detalhes = _detect_cessao_in_trf1(
            event_rows=extracted.get("event_rows", []),
            document_rows=extracted.get("document_rows", []),
            party_rows=all_parties,
        )
        partes_cedentes = []
        partes_nao_cedentes = []

    party_struct = _build_party_structured_columns(all_parties, all_lawyers)
    pr["cessao_credito"] = cessao_credito
    pr["cessao_detalhes"] = cessao_detalhes
    pr["partes_cedentes"] = " | ".join(partes_cedentes)
    pr["partes_nao_cedentes"] = " | ".join(partes_nao_cedentes)
    pr["polo_ativo_partes"] = party_struct["polo_ativo_partes"]
    pr["polo_ativo_advogados"] = party_struct["polo_ativo_advogados"]
    pr["polo_passivo_partes"] = party_struct["polo_passivo_partes"]
    pr["polo_passivo_advogados"] = party_struct["polo_passivo_advogados"]
    pr["quantidade_polo_ativo"] = party_struct["quantidade_polo_ativo"]
    pr["quantidade_polo_passivo"] = party_struct["quantidade_polo_passivo"]


def _parse_trf1_detail(
    *,
    process_number: str,
    tribunal_alias: str,
    detail_url: str,
    html: str,
    page: Any = None,
) -> dict[str, Any]:
    soup = BeautifulSoup(html, "html.parser")
    properties = _parse_trf1_properties(soup)

    party_rows: list[dict[str, Any]] = []
    lawyer_rows: list[dict[str, Any]] = []
    active_names: list[str] = []
    passive_names: list[str] = []
    other_names: list[str] = []

    for pole_title in ["Polo ativo", "Polo Passivo", "Outros interessados"]:
        rows = _parse_trf1_people_panel(
            soup=soup,
            process_number=process_number,
            tribunal_alias=tribunal_alias,
            detail_url=detail_url,
            pole_title=pole_title,
        )
        for row in rows:
            if row["tipo_registro"] == "advogado":
                lawyer_rows.append(row)
            else:
                party_rows.append(row)
                if row["polo"] == "polo_ativo":
                    active_names.append(row["nome"])
                elif row["polo"] == "polo_passivo":
                    passive_names.append(row["nome"])
                else:
                    other_names.append(row["nome"])

    event_rows = _parse_trf1_events(
        soup=soup,
        process_number=process_number,
        tribunal_alias=tribunal_alias,
        detail_url=detail_url,
    )
    document_rows = _parse_trf1_documents(
        soup=soup,
        process_number=process_number,
        tribunal_alias=tribunal_alias,
        detail_url=detail_url,
    )

    classe_name, classe_code = _split_name_and_code(properties.get("Classe Judicial"))
    first_event = _pick_event(event_rows, reverse=False)
    last_event = _pick_event(event_rows, reverse=True)

    # Cessão de crédito analysis
    if page is not None:
        cessao_result = _analyze_documents_for_cessao(
            page,
            event_rows,
            document_rows,
            active_names,
        )
    else:
        cessao_credito_fb, cessao_detalhes_fb = _detect_cessao_in_trf1(
            event_rows=event_rows,
            document_rows=document_rows,
            party_rows=party_rows,
        )
        cessao_result = {
            "cessao_credito": cessao_credito_fb,
            "cessao_detalhes": cessao_detalhes_fb,
            "partes_cedentes": [],
            "partes_nao_cedentes": [],
        }

    cessao_credito = cessao_result["cessao_credito"]
    cessao_detalhes = cessao_result["cessao_detalhes"]
    partes_cedentes: list[str] = cessao_result["partes_cedentes"]
    partes_nao_cedentes: list[str] = cessao_result["partes_nao_cedentes"]

    party_struct = _build_party_structured_columns(party_rows, lawyer_rows)

    extracted_payload = {
        "fonte": "trf1",
        "url": detail_url,
        "propriedades": properties,
        "partes": party_rows,
        "advogados": lawyer_rows,
        "eventos": event_rows,
        "documentos": document_rows,
    }

    process_row = {
        "numero_processo": process_number,
        "tribunal": tribunal_alias,
        "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_trf1"],
        "fonte_url": detail_url,
        "classe": classe_name,
        "classe_codigo": classe_code,
        "assuntos": _normalize_trf1_subjects(properties.get("Assunto", "")),
        "jurisdicao": properties.get("Jurisdição"),
        "orgao_julgador": properties.get("Órgão Julgador"),
        "endereco_orgao_julgador": properties.get("Endereço"),
        "data_distribuicao": properties.get("Data da Distribuição"),
        "processo_referencia": properties.get("Processo referência"),
        "polo_ativo": ", ".join(active_names),
        "polo_passivo": ", ".join(passive_names),
        "outros_interessados": ", ".join(other_names),
        "partes_resumo": _join_labels(
            [row["nome"] for row in party_rows if row.get("nome")]
        ),
        "advogados_resumo": _join_labels(
            [
                _join_labels([row.get("nome_advogado", ""), row.get("oab_formatada", "")], " - ")
                for row in lawyer_rows
            ]
        ),
        "quantidade_partes": len(party_rows),
        "quantidade_advogados": len(lawyer_rows),
        "quantidade_eventos": len(event_rows),
        "quantidade_documentos": len(document_rows),
        "primeiro_evento": first_event.get("evento") if first_event else "",
        "data_primeiro_evento": first_event.get("data_hora") if first_event else "",
        "ultimo_evento": last_event.get("evento") if last_event else "",
        "data_ultimo_evento": last_event.get("data_hora") if last_event else "",
        # Cessão de crédito
        "cessao_credito": cessao_credito,
        "cessao_detalhes": cessao_detalhes,
        "partes_cedentes": " | ".join(partes_cedentes),
        "partes_nao_cedentes": " | ".join(partes_nao_cedentes),
        # Structured party display (new columns)
        "polo_ativo_partes": party_struct["polo_ativo_partes"],
        "polo_ativo_advogados": party_struct["polo_ativo_advogados"],
        "polo_passivo_partes": party_struct["polo_passivo_partes"],
        "polo_passivo_advogados": party_struct["polo_passivo_advogados"],
        "quantidade_polo_ativo": party_struct["quantidade_polo_ativo"],
        "quantidade_polo_passivo": party_struct["quantidade_polo_passivo"],
        "json_bruto": json.dumps(extracted_payload, ensure_ascii=False),
    }

    return {
        "process_row": process_row,
        "party_rows": party_rows,
        "lawyer_rows": lawyer_rows,
        "event_rows": event_rows,
        "document_rows": document_rows,
        "cessao_result": cessao_result,
    }


def _parse_trf1_properties(soup: BeautifulSoup) -> dict[str, str]:
    properties: dict[str, str] = {}

    for item in soup.select("div.propertyView"):
        label = _clean_text(item.select_one(".name"))
        value = _clean_text(item.select_one(".value"), separator=" | ")
        if label and value:
            properties[label] = value
            continue

        if value and "|" in value:
            pairs = [part.strip() for part in value.split("|") if part.strip()]
            for index in range(0, len(pairs) - 1, 2):
                properties[pairs[index]] = pairs[index + 1]

    return properties


def _normalize_trf1_subjects(value: str) -> str:
    subject_text = value.strip()
    if not subject_text:
        return ""
    if TRF1_OPEN_CODE_SUFFIX_RE.search(subject_text):
        return f"{subject_text})"
    return subject_text


def _parse_trf1_people_panel(
    *,
    soup: BeautifulSoup,
    process_number: str,
    tribunal_alias: str,
    detail_url: str,
    pole_title: str,
) -> list[dict[str, Any]]:
    rows_out: list[dict[str, Any]] = []
    header = _find_panel_header(soup, pole_title)
    if not header:
        return rows_out

    body = header.find_next(class_="rich-panel-body")
    if body is None:
        return rows_out

    for table_row in body.select("tbody tr"):
        cells = [
            _clean_text(cell, separator=" ")
            for cell in table_row.find_all("td")
        ]
        if len(cells) < 2:
            continue
        participant_text = _sanitize_participant_text(cells[0])
        if not participant_text:
            continue

        parsed = _parse_trf1_participant(participant_text)
        common = {
            "numero_processo": process_number,
            "tribunal": tribunal_alias,
            "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_trf1"],
            "fonte_url": detail_url,
            "polo": _slugify_pole_title(pole_title),
            "situacao": cells[1],
            "texto_original": participant_text,
            "json_bruto": json.dumps(parsed, ensure_ascii=False),
        }

        if parsed["papel"].lower() == "advogado" or parsed["oab_formatada"]:
            rows_out.append(
                {
                    **common,
                    "tipo_registro": "advogado",
                    "nome_advogado": parsed["nome"],
                    "oab_formatada": parsed["oab_formatada"],
                    "oab_uf": parsed["oab_uf"],
                    "oab_numero": parsed["oab_numero"],
                    "documento_tipo": parsed["documento_tipo"],
                    "documento": parsed["documento"],
                    "papel": parsed["papel"],
                    "observacao": parsed["observacao"],
                }
            )
            continue

        rows_out.append(
            {
                **common,
                "tipo_registro": "parte",
                "nome": parsed["nome"],
                "papel": parsed["papel"],
                "documento_tipo": parsed["documento_tipo"],
                "documento": parsed["documento"],
                "observacao": parsed["observacao"],
            }
        )

    return rows_out


def _parse_trf1_participant(text: str) -> dict[str, str]:
    role_match = TRF1_ROLE_RE.search(text)
    role = role_match.group(1).strip() if role_match else ""
    role_text = role_match.group(0) if role_match else ""
    text_without_role = text.replace(role_text, "").strip()

    oab_match = TRF1_OAB_RE.search(text_without_role)
    oab_uf = (oab_match.group(1) or "").strip() if oab_match else ""
    oab_number = (oab_match.group(2) or "").strip() if oab_match else ""
    oab_formatted = _join_labels([oab_uf, oab_number], separator="")
    oab_marker = oab_match.group(0) if oab_match else ""

    document_match = TRF1_DOC_RE.search(text_without_role)
    document_type = document_match.group(1).strip() if document_match else ""
    document_value = document_match.group(2).strip() if document_match else ""
    document_marker = document_match.group(0) if document_match else ""

    name = text_without_role
    cut_markers = [marker for marker in [oab_marker, document_marker] if marker]
    if cut_markers:
        first_marker = min(text_without_role.find(marker) for marker in cut_markers)
        if first_marker >= 0:
            name = text_without_role[:first_marker].rstrip(" -")

    observation = text_without_role
    if name and observation.startswith(name):
        observation = observation[len(name):].lstrip(" -")
    if oab_marker:
        observation = observation.replace(oab_marker, "").strip(" -")
    if document_marker:
        observation = observation.replace(document_marker, "").strip(" -")

    return {
        "nome": name.strip(),
        "papel": role,
        "documento_tipo": document_type,
        "documento": document_value,
        "oab_uf": oab_uf,
        "oab_numero": oab_number,
        "oab_formatada": oab_formatted,
        "observacao": observation,
    }


def _parse_trf1_events(
    *,
    soup: BeautifulSoup,
    process_number: str,
    tribunal_alias: str,
    detail_url: str,
) -> list[dict[str, Any]]:
    event_rows: list[dict[str, Any]] = []
    header = _find_panel_header(soup, "Movimentações do Processo")
    if not header:
        return event_rows

    body = header.find_next(class_="rich-panel-body")
    if body is None:
        return event_rows

    for index, table_row in enumerate(body.select("tbody tr"), start=1):
        cells = table_row.find_all("td")
        if not cells:
            continue

        movement_text = _clean_text(cells[0], separator=" ")
        if not movement_text:
            continue

        date_text, event_text = _split_dated_text(movement_text)
        document_text = _clean_text(cells[1], separator=" ") if len(cells) > 1 else ""
        document_link = table_row.find(
            "a",
            onclick=lambda value: bool(value) and "documentoSemLoginHTML" in value,
        )
        document_url = _extract_popup_url(document_link["onclick"]) if document_link else ""

        event_rows.append(
            {
                "numero_processo": process_number,
                "tribunal": tribunal_alias,
                "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_trf1"],
                "fonte_url": detail_url,
                "ordem": index,
                "evento": event_text,
                "data_hora": date_text,
                "documento_resumo": document_text,
                "documento_url": document_url,
                "json_bruto": json.dumps(
                    {
                        "movimento": movement_text,
                        "documento": document_text,
                        "documento_url": document_url,
                    },
                    ensure_ascii=False,
                ),
            }
        )

    return event_rows


def _parse_trf1_documents(
    *,
    soup: BeautifulSoup,
    process_number: str,
    tribunal_alias: str,
    detail_url: str,
) -> list[dict[str, Any]]:
    document_rows: list[dict[str, Any]] = []
    header = _find_panel_header(soup, "Documentos juntados ao processo")
    if not header:
        return document_rows

    body = header.find_next(class_="rich-panel-body")
    if body is None:
        return document_rows

    for index, table_row in enumerate(body.select("tbody tr"), start=1):
        cells = table_row.find_all("td")
        if len(cells) < 2:
            continue

        document_text = _clean_text(cells[0], separator=" ")
        if not document_text:
            continue

        clean_text = document_text.replace("Visualizar documentos", "", 1).strip()
        date_text, description = _split_dated_text(clean_text)

        document_link = cells[0].find("a")
        cert_link = cells[1].find("a")

        document_rows.append(
            {
                "numero_processo": process_number,
                "tribunal": tribunal_alias,
                "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_trf1"],
                "fonte_url": detail_url,
                "ordem": index,
                "documento": description,
                "data_hora": date_text,
                "url_documento": _extract_popup_url(document_link.get("onclick", "")) if document_link else "",
                "certidao": _clean_text(cells[1], separator=" "),
                "url_certidao": _extract_popup_url(cert_link.get("onclick", "")) if cert_link else "",
                "json_bruto": json.dumps(
                    {
                        "documento": document_text,
                        "certidao": _clean_text(cells[1], separator=" "),
                    },
                    ensure_ascii=False,
                ),
            }
        )

    return document_rows


def _parse_tjgo_payload(
    *,
    process_number: str,
    tribunal_alias: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    active_parties = payload.get("polos_ativos") or []
    passive_parties = payload.get("polos_passivos") or []
    lawyers_payload = payload.get("advogados_processo") or []
    event_payload = payload.get("eventos") or []

    party_name_by_id = {
        str(_first_non_empty(item, "id", "idParte", "parteId", "idParteProcesso")): _first_non_empty(
            item,
            "nomeParte",
            "nome",
            "parte",
        )
        for item in active_parties + passive_parties
        if _first_non_empty(item, "nomeParte", "nome", "parte")
    }

    party_rows: list[dict[str, Any]] = []
    for pole_name, items in [
        ("polo_ativo", active_parties),
        ("polo_passivo", passive_parties),
    ]:
        for item in items:
            party_rows.append(
                {
                    "numero_processo": process_number,
                    "tribunal": tribunal_alias,
                    "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"],
                    "fonte_url": payload.get("url"),
                    "polo": pole_name,
                    "tipo_registro": "parte",
                    "nome": _first_non_empty(item, "nomeParte", "nome", "parte"),
                    "papel": "requerente" if pole_name == "polo_ativo" else "requerido",
                    "id_parte": _first_non_empty(item, "id", "idParte", "parteId", "idParteProcesso"),
                    "texto_original": _first_non_empty(item, "nomeParte", "nome", "parte"),
                    "json_bruto": json.dumps(item, ensure_ascii=False),
                }
            )

    lawyer_rows: list[dict[str, Any]] = []
    for item in lawyers_payload:
        linked_party_id = str(
            _first_non_empty(
                item,
                "idParte",
                "parteId",
                "idParteProcesso",
                "idPessoaProcessoParte",
                "idParteRelacionada",
            )
        )
        lawyer_rows.append(
            {
                "numero_processo": process_number,
                "tribunal": tribunal_alias,
                "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"],
                "fonte_url": payload.get("url"),
                "polo": "",
                "tipo_registro": "advogado",
                "nome_advogado": _first_non_empty(
                    item,
                    "nomeAdvogado",
                    "nome",
                    "nomePessoa",
                    "nomeParte",
                ),
                "oab_uf": _first_non_empty(item, "ufOab", "oabUf", "uf"),
                "oab_numero": _first_non_empty(item, "numeroOab", "oabNumero", "oab"),
                "oab_complemento": _first_non_empty(
                    item,
                    "complementoOab",
                    "oabComplemento",
                    "complemento",
                ),
                "oab_formatada": _format_oab_from_payload(item),
                "id_parte_relacionada": linked_party_id if linked_party_id != "None" else "",
                "parte_relacionada": party_name_by_id.get(linked_party_id, ""),
                "json_bruto": json.dumps(item, ensure_ascii=False),
            }
        )

    event_rows: list[dict[str, Any]] = []
    document_rows: list[dict[str, Any]] = []
    for item in event_payload:
        file_reference = _extract_tjgo_file_reference(item.get("arquivos_js"))
        event_row = {
            "numero_processo": process_number,
            "tribunal": tribunal_alias,
            "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"],
            "fonte_url": payload.get("url"),
            "ordem": item.get("ordem"),
            "evento": item.get("movimentacao"),
            "data_hora": item.get("data_hora"),
            "usuario": item.get("usuario"),
            "arquivos": item.get("arquivos"),
            "arquivo_referencia": file_reference,
            "arquivo_acao_js": item.get("arquivos_js"),
            "json_bruto": json.dumps(item, ensure_ascii=False),
        }
        event_rows.append(event_row)

        if file_reference:
            document_rows.append(
                {
                    "numero_processo": process_number,
                    "tribunal": tribunal_alias,
                    "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"],
                    "fonte_url": payload.get("url"),
                    "ordem": item.get("ordem"),
                    "documento": item.get("movimentacao"),
                    "data_hora": item.get("data_hora"),
                    "url_documento": "",
                    "certidao": "",
                    "url_certidao": "",
                    "arquivo_referencia": file_reference,
                    "arquivo_acao_js": item.get("arquivos_js"),
                    "json_bruto": json.dumps(item, ensure_ascii=False),
                }
            )

    first_event = _pick_event(event_rows, reverse=False)
    last_event = _pick_event(event_rows, reverse=True)

    extracted_payload = {
        "fonte": "tjgo",
        "url": payload.get("url"),
        "processo_id": payload.get("processo_id"),
        "classe": payload.get("classe"),
        "serventia": payload.get("serventia"),
        "assuntos": payload.get("assuntos"),
        "processo_originario": payload.get("processo_originario"),
        "partes": party_rows,
        "advogados": lawyer_rows,
        "eventos": event_rows,
        "documentos": document_rows,
        "linhas": payload.get("linhas"),
    }

    process_row = {
        "numero_processo": process_number,
        "tribunal": tribunal_alias,
        "fonte_oficial": SUPPORTED_OFFICIAL_SOURCES["api_publica_tjgo"],
        "fonte_url": payload.get("url"),
        "classe": payload.get("classe"),
        "classe_codigo": _extract_prefix_code(payload.get("classe")),
        "assuntos": _join_labels(payload.get("assuntos") or []),
        "jurisdicao": "",
        "orgao_julgador": payload.get("serventia"),
        "endereco_orgao_julgador": "",
        "data_distribuicao": "",
        "processo_referencia": payload.get("processo_originario"),
        "processo_id": payload.get("processo_id"),
        "partes_url": payload.get("partes_url"),
        "polo_ativo": _join_labels(
            [_first_non_empty(item, "nomeParte", "nome", "parte") for item in active_parties]
        ),
        "polo_passivo": _join_labels(
            [_first_non_empty(item, "nomeParte", "nome", "parte") for item in passive_parties]
        ),
        "outros_interessados": "",
        "partes_resumo": _join_labels(
            [_first_non_empty(item, "nomeParte", "nome", "parte") for item in active_parties + passive_parties]
        ),
        "advogados_resumo": _join_labels(
            [
                _join_labels(
                    [
                        row.get("nome_advogado", ""),
                        row.get("oab_formatada", ""),
                    ],
                    " - ",
                )
                for row in lawyer_rows
            ]
        ),
        "quantidade_partes": len(party_rows),
        "quantidade_advogados": len(lawyer_rows),
        "quantidade_eventos": len(event_rows),
        "quantidade_documentos": len(document_rows),
        "primeiro_evento": first_event.get("evento") if first_event else "",
        "data_primeiro_evento": first_event.get("data_hora") if first_event else "",
        "ultimo_evento": last_event.get("evento") if last_event else "",
        "data_ultimo_evento": last_event.get("data_hora") if last_event else "",
        "json_bruto": json.dumps(extracted_payload, ensure_ascii=False),
    }

    return {
        "process_row": process_row,
        "party_rows": party_rows,
        "lawyer_rows": lawyer_rows,
        "event_rows": event_rows,
        "document_rows": document_rows,
    }


def format_cnj_number(process_number: str) -> str:
    match = CNJ_FORMAT_RE.match(process_number)
    if not match:
        return process_number
    return (
        f"{match.group(1)}-{match.group(2)}.{match.group(3)}."
        f"{match.group(4)}.{match.group(5)}.{match.group(6)}"
    )


def merge_official_columns(
    row: dict[str, Any],
    official_process: dict[str, Any] | None,
    official_status: dict[str, Any] | None,
) -> dict[str, Any]:
    merged = dict(row)

    if official_status:
        merged["oficial_status"] = official_status.get("status")
        merged["oficial_fonte"] = official_status.get("fonte")
        merged["oficial_mensagem"] = official_status.get("mensagem")

    if not official_process:
        return merged

    for key, value in official_process.items():
        if key in {"numero_processo", "tribunal"}:
            continue
        merged[f"oficial_{key}"] = value

    return merged


def _find_panel_header(soup: BeautifulSoup, label: str) -> Any:
    for header in soup.select(".rich-panel-header"):
        if _clean_text(header) == label:
            return header
    return None


def _clean_text(node: Any, separator: str = " ") -> str:
    if node is None:
        return ""
    if hasattr(node, "stripped_strings"):
        return separator.join(part.strip() for part in node.stripped_strings if part.strip())
    return str(node).strip()


def _split_name_and_code(text: str | None) -> tuple[str, str]:
    if not text:
        return "", ""
    match = TRF1_CODE_SUFFIX_RE.match(text)
    if not match:
        return text, ""
    return match.group("name").strip(), match.group("code").strip()


def _split_dated_text(text: str) -> tuple[str, str]:
    match = DATED_TEXT_RE.match(text.strip())
    if not match:
        return "", text.strip()
    return match.group("date").strip(), match.group("text").strip()


def _extract_popup_url(onclick_text: str) -> str:
    match = TRF1_DOCUMENT_URL_RE.search(onclick_text or "")
    return match.group(1) if match else ""


def _pick_event(events: list[dict[str, Any]], *, reverse: bool) -> dict[str, Any] | None:
    comparable = [event for event in events if event.get("data_hora")]
    if not comparable:
        return None
    return sorted(
        comparable,
        key=lambda event: _parse_possible_datetime(event.get("data_hora", "")) or datetime.min,
        reverse=reverse,
    )[0]


def _parse_possible_datetime(value: str) -> datetime | None:
    for fmt in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _slugify_pole_title(text: str) -> str:
    normalized = (
        text.lower()
        .replace(" ", "_")
        .replace("ó", "o")
        .replace("í", "i")
        .replace("á", "a")
        .replace("é", "e")
    )
    return normalized


def _join_labels(values: list[str], separator: str = ", ") -> str:
    cleaned = [str(value).strip() for value in values if str(value or "").strip()]
    return separator.join(cleaned)


def _first_non_empty(mapping: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = mapping.get(key)
        if value not in (None, "", []):
            return value
    return ""


def _format_oab_from_payload(item: dict[str, Any]) -> str:
    uf = _first_non_empty(item, "ufOab", "oabUf", "uf")
    number = _first_non_empty(item, "numeroOab", "oabNumero", "oab")
    complement = _first_non_empty(item, "complementoOab", "oabComplemento", "complemento")
    suffix = _join_labels([str(number), str(complement)], separator="/")
    return _join_labels([str(uf), suffix], separator="")


def _extract_prefix_code(value: str | None) -> str:
    if not value:
        return ""
    prefix = value.split(" - ", 1)[0].strip()
    return prefix if prefix.isdigit() else ""


def _extract_tjgo_file_reference(raw_value: str | None) -> str:
    match = TJGO_FILE_REF_RE.search(raw_value or "")
    return match.group(1) if match else ""
