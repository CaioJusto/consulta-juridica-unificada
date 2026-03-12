"""Consulta publica do TRF1 1o grau."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from datajud_app.excel_utils import normalize_process_number
from datajud_app.official_sources import (
    TRF1_SEARCH_URL,
    _open_trf1_search_page,
    _paginate_trf1_parties,
    _parse_trf1_detail,
    _rebuild_party_summaries,
    format_cnj_number,
)

TRF1_DETAIL_URL_RE = re.compile(
    r"/consultapublica/ConsultaPublica/DetalheProcessoConsultaPublica/listView\.seam\?ca=[^\"'\s)]+"
)
TRF1_PROCESS_NUMBER_RE = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
TRF1_LAST_MOVE_RE = re.compile(r"^(?P<name>.+?)\s*\((?P<date>\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})\)$")
TRF1_SUBJECT_SEPARATOR_RE = re.compile(r"\s+-\s+")

TRF1_REFERENCE_MODE_OPTIONS = {
    "numeracao_unica": "Numeracao unica",
    "livre": "Livre",
}

TRF1_DOCUMENT_KIND_OPTIONS = {
    "cpf": "CPF",
    "cnpj": "CNPJ",
}

TRF1_UF_OPTIONS = [
    "AC",
    "AL",
    "AP",
    "AM",
    "BA",
    "CE",
    "DF",
    "ES",
    "GO",
    "MA",
    "MT",
    "MS",
    "MG",
    "PA",
    "PB",
    "PR",
    "PE",
    "PI",
    "RJ",
    "RN",
    "RS",
    "RO",
    "RR",
    "SC",
    "SE",
    "SP",
    "TO",
]


@dataclass
class TRF1PublicSearchParams:
    process_number: str = ""
    process_reference: str = ""
    process_reference_mode: str = "numeracao_unica"
    party_name: str = ""
    lawyer_name: str = ""
    class_judicial: str = ""
    document_kind: str = "cpf"
    document_number: str = ""
    oab_number: str = ""
    oab_suffix: str = ""
    oab_state: str = ""
    autuation_date_from: str = ""
    autuation_date_to: str = ""

    def has_any_filter(self) -> bool:
        return any(
            [
                self.process_number,
                self.process_reference,
                self.party_name,
                self.lawyer_name,
                self.class_judicial,
                self.document_number,
                self.oab_number,
                self.oab_suffix,
                self.oab_state,
                self.autuation_date_from,
                self.autuation_date_to,
            ]
        )


@dataclass
class TRF1PublicSearchBundle:
    search_rows: list[dict[str, Any]] = field(default_factory=list)
    process_rows: list[dict[str, Any]] = field(default_factory=list)
    subject_rows: list[dict[str, Any]] = field(default_factory=list)
    party_rows: list[dict[str, Any]] = field(default_factory=list)
    lawyer_rows: list[dict[str, Any]] = field(default_factory=list)
    event_rows: list[dict[str, Any]] = field(default_factory=list)
    document_rows: list[dict[str, Any]] = field(default_factory=list)
    raw_process_sources: list[dict[str, Any]] = field(default_factory=list)
    messages: list[str] = field(default_factory=list)
    total_results: int = 0


class TRF1PublicSearchError(RuntimeError):
    """Erro operacional na consulta publica do TRF1."""


def search_trf1_public_bundle(
    params: TRF1PublicSearchParams,
    *,
    max_details: int = 30,
    on_progress: Any | None = None,
) -> TRF1PublicSearchBundle:
    if not params.has_any_filter():
        raise TRF1PublicSearchError("Informe ao menos um filtro para pesquisar no TRF1.")

    bundle = TRF1PublicSearchBundle()

    def _report(current: int, total: int, message: str) -> None:
        if on_progress is not None:
            try:
                on_progress(current, total, message)
            except Exception:
                pass

    # total_steps will be recalculated after we know how many rows to detail
    _report(0, max_details + 2, "Abrindo o portal do TRF1...")

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(locale="pt-BR")
        search_page = context.new_page()
        try:
            _open_trf1_search_page(search_page)
            _fill_trf1_search_form(search_page, params)

            _report(1, max_details + 2, "Executando pesquisa no portal TRF1...")
            search_page.get_by_role("button", name="Pesquisar").click()
            search_page.wait_for_load_state("networkidle", timeout=30000)

            search_rows, total_results = _parse_trf1_search_results(search_page.content())
            bundle.search_rows = search_rows
            bundle.total_results = total_results

            if not search_rows:
                bundle.messages.append("Nenhum processo foi encontrado na consulta publica do TRF1.")
                _report(1, 1, "Nenhum processo encontrado.")
                return bundle

            n_to_detail = min(len(search_rows), max_details)
            total_steps = n_to_detail + 2  # initial + search + each detail

            if len(search_rows) > max_details:
                bundle.messages.append(
                    f"O portal retornou {len(search_rows)} resultados; o app detalhou os "
                    f"primeiros {max_details}."
                )

            _report(
                1,
                total_steps,
                f"Pesquisa concluída: {total_results} resultados. Detalhando {n_to_detail} processos...",
            )

            for order, search_row in enumerate(search_rows[:max_details], start=1):
                pct = round((order / n_to_detail) * 100)
                _report(
                    order + 1,
                    total_steps,
                    f"Carregando processo {order} de {n_to_detail} ({pct}%)...",
                )
                detail_page = context.new_page()
                try:
                    detail_url = search_row["url_detalhe"]
                    detail_page.goto(detail_url, wait_until="networkidle", timeout=60000)
                    detail_html = detail_page.content()

                    extracted = _parse_trf1_detail(
                        process_number=search_row["numero_processo"],
                        tribunal_alias="api_publica_trf1",
                        detail_url=detail_url,
                        html=detail_html,
                    )

                    extra_parties, extra_lawyers = _paginate_trf1_parties(
                        detail_page,
                        process_number=search_row["numero_processo"],
                        tribunal_alias="api_publica_trf1",
                        detail_url=detail_url,
                    )
                    if extra_parties or extra_lawyers:
                        extracted["party_rows"].extend(extra_parties)
                        extracted["lawyer_rows"].extend(extra_lawyers)
                        _rebuild_party_summaries(extracted)

                    # Extract full text from each document
                    for doc_row in extracted.get("document_rows", []):
                        doc_url = str(doc_row.get("url_documento") or "").strip()
                        if not doc_url:
                            doc_row["texto_documento"] = ""
                        else:
                            try:
                                doc_page = context.new_page()
                                doc_page.goto(doc_url, wait_until="domcontentloaded", timeout=20000)
                                doc_page.wait_for_load_state("networkidle", timeout=10000)
                                doc_text = doc_page.inner_text("body")
                                doc_row["texto_documento"] = doc_text.strip()
                                doc_page.close()
                            except Exception:
                                doc_row["texto_documento"] = ""

                        cert_url = str(doc_row.get("url_certidao") or "").strip()
                        if cert_url:
                            try:
                                cert_page = context.new_page()
                                cert_page.goto(cert_url, wait_until="domcontentloaded", timeout=20000)
                                cert_page.wait_for_load_state("networkidle", timeout=10000)
                                doc_row["texto_certidao"] = cert_page.inner_text("body").strip()
                                cert_page.close()
                            except Exception:
                                doc_row["texto_certidao"] = ""
                        else:
                            doc_row["texto_certidao"] = ""

                    process_row = dict(extracted["process_row"])
                    process_row["ordem_resultado"] = order
                    process_row["classe_resultado"] = search_row.get("classe_resultado")
                    process_row["titulo_resultado"] = search_row.get("titulo_resultado")
                    process_row["materia_resultado"] = search_row.get("materia_resultado")
                    process_row["ultima_movimentacao_resultado"] = search_row.get("ultima_movimentacao")
                    process_row["data_ultima_movimentacao_resultado"] = search_row.get(
                        "data_ultima_movimentacao"
                    )
                    process_row["polo_ativo_resumo_resultado"] = search_row.get(
                        "polo_ativo_resumo"
                    )
                    process_row["polo_passivo_resumo_resultado"] = search_row.get(
                        "polo_passivo_resumo"
                    )

                    bundle.process_rows.append(process_row)
                    bundle.party_rows.extend(extracted["party_rows"])
                    bundle.lawyer_rows.extend(extracted["lawyer_rows"])
                    bundle.event_rows.extend(extracted["event_rows"])
                    bundle.document_rows.extend(extracted["document_rows"])
                    bundle.subject_rows.extend(
                        _build_trf1_subject_rows(
                            process_number=search_row["numero_processo"],
                            detail_url=detail_url,
                            raw_subjects=process_row.get("assuntos", ""),
                        )
                    )
                    try:
                        bundle.raw_process_sources.append(json.loads(process_row["json_bruto"]))
                    except json.JSONDecodeError:
                        bundle.raw_process_sources.append({})
                finally:
                    detail_page.close()
        finally:
            context.close()
            browser.close()

    return bundle


def _fill_trf1_search_form(page: Any, params: TRF1PublicSearchParams) -> None:
    if params.process_number:
        page.locator("input[id$='numProcesso-inputNumeroProcesso']").fill(
            format_cnj_number(normalize_process_number(params.process_number))
        )

    if params.process_reference_mode == "livre":
        page.locator("input[name='mascaraProcessoReferenciaRadio']").nth(1).check()
    else:
        page.locator("input[name='mascaraProcessoReferenciaRadio']").nth(0).check()

    if params.process_reference:
        process_reference = params.process_reference.strip()
        if params.process_reference_mode == "numeracao_unica":
            process_reference = format_cnj_number(normalize_process_number(process_reference))
        page.locator("input[id$='processoReferenciaInput']").fill(process_reference)

    if params.party_name:
        page.locator("input[id$='nomeParte']").fill(params.party_name.strip())

    if params.lawyer_name:
        page.locator("input[id$='nomeAdv']").fill(params.lawyer_name.strip())

    if params.class_judicial:
        page.locator("input[id$='classeJudicial']").fill(params.class_judicial.strip())

    if params.document_kind == "cnpj":
        page.locator("input[name='tipoMascaraDocumento']").nth(1).check()
    else:
        page.locator("input[name='tipoMascaraDocumento']").nth(0).check()

    if params.document_number:
        page.locator("input[id$='documentoParte']").fill(
            _format_document_input(params.document_number, params.document_kind)
        )

    if params.oab_number:
        page.locator("input[id$='numeroOAB']").fill(re.sub(r"\D+", "", params.oab_number))

    if params.oab_suffix:
        page.locator("input[name='fPP:Decoration:j_id227']").fill(params.oab_suffix.strip().upper())

    if params.oab_state:
        page.locator("select[id$='estadoComboOAB']").select_option(label=params.oab_state)

    if params.autuation_date_from:
        page.locator("input[id$='dataAutuacaoInicioInputDate']").fill(
            _normalize_trf1_date(params.autuation_date_from)
        )

    if params.autuation_date_to:
        page.locator("input[id$='dataAutuacaoFimInputDate']").fill(
            _normalize_trf1_date(params.autuation_date_to)
        )


def _parse_trf1_search_results(html: str) -> tuple[list[dict[str, Any]], int]:
    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict[str, Any]] = []

    table = soup.find("table", id=re.compile(r".*processosTable$"))
    if not table:
        result_text = soup.get_text(" ", strip=True)
        count_match = re.search(r"(\d+)\s+resultados encontrados", result_text)
        return rows, int(count_match.group(1)) if count_match else 0

    footer_text = table.get_text(" ", strip=True)
    count_match = re.search(r"(\d+)\s+resultados encontrados", footer_text)
    total_results = int(count_match.group(1)) if count_match else 0

    for index, row in enumerate(table.select("tbody tr"), start=1):
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        detail_link = row.find("a", onclick=lambda value: bool(value) and "DetalheProcessoConsultaPublica" in value)
        if not detail_link:
            continue

        detail_url_match = TRF1_DETAIL_URL_RE.search(detail_link.get("onclick", ""))
        if not detail_url_match:
            continue

        summary_cell = cells[1]
        title_link = summary_cell.find("a")
        title_text = _clean_text(title_link) if title_link else ""
        summary_text = _clean_text(summary_cell, separator=" ")
        class_text = summary_text.split(title_text, 1)[0].strip() if title_text else ""
        parties_summary = summary_text.split(title_text, 1)[1].strip() if title_text and title_text in summary_text else ""
        process_number_match = TRF1_PROCESS_NUMBER_RE.search(title_text)
        formatted_number = process_number_match.group(0) if process_number_match else ""
        process_number = normalize_process_number(formatted_number)
        process_label = title_text.split(formatted_number, 1)[0].strip() if formatted_number else title_text
        materia = title_text.split(formatted_number, 1)[1].lstrip(" -") if formatted_number and formatted_number in title_text else ""
        last_move_text = _clean_text(cells[2], separator=" ")
        last_move_name, last_move_date = _split_last_move(last_move_text)
        polo_ativo_resumo, polo_passivo_resumo = _split_party_summary(parties_summary)

        rows.append(
            {
                "ordem_resultado": index,
                "numero_processo": process_number,
                "numero_processo_formatado": formatted_number,
                "classe_resultado": class_text,
                "sigla_resultado": process_label,
                "titulo_resultado": title_text,
                "materia_resultado": materia,
                "partes_resumo": parties_summary,
                "polo_ativo_resumo": polo_ativo_resumo,
                "polo_passivo_resumo": polo_passivo_resumo,
                "ultima_movimentacao": last_move_name,
                "data_ultima_movimentacao": last_move_date,
                "url_detalhe": urljoin(TRF1_SEARCH_URL, detail_url_match.group(0)),
            }
        )

    return rows, total_results


def _build_trf1_subject_rows(
    *,
    process_number: str,
    detail_url: str,
    raw_subjects: str,
) -> list[dict[str, Any]]:
    if not raw_subjects:
        return []

    parts = [
        item.strip()
        for item in TRF1_SUBJECT_SEPARATOR_RE.split(raw_subjects.replace("  -  ", " - "))
        if item.strip()
    ]
    out: list[dict[str, Any]] = []
    for index, item in enumerate(parts, start=1):
        name, code = _split_name_and_code(item)
        out.append(
            {
                "numero_processo": process_number,
                "tribunal": "api_publica_trf1",
                "fonte_oficial": "TRF1 consulta publica",
                "fonte_url": detail_url,
                "ordem": index,
                "materia": name,
                "codigo": code,
                "texto_original": item,
            }
        )
    return out


def _split_party_summary(value: str) -> tuple[str, str]:
    if " X " not in value:
        return value, ""
    left, right = value.split(" X ", 1)
    return left.strip(), right.strip()


def _split_last_move(value: str) -> tuple[str, str]:
    match = TRF1_LAST_MOVE_RE.match(value.strip())
    if not match:
        return value.strip(), ""
    return match.group("name").strip(), match.group("date").strip()


def _format_document_input(value: str, document_kind: str) -> str:
    digits = re.sub(r"\D+", "", value or "")
    if document_kind == "cnpj" and len(digits) == 14:
        return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"
    if document_kind == "cpf" and len(digits) == 11:
        return f"{digits[:3]}.{digits[3:6]}.{digits[6:9]}-{digits[9:]}"
    return value.strip()


def _normalize_trf1_date(value: str) -> str:
    clean = value.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", clean):
        year, month, day = clean.split("-")
        return f"{day}/{month}/{year}"
    return clean


def _split_name_and_code(text: str) -> tuple[str, str]:
    match = re.match(r"^(?P<name>.+?)\s*\((?P<code>\d+)\)\s*$", text)
    if not match:
        return text, ""
    return match.group("name").strip(), match.group("code").strip()


def _clean_text(node: Any, separator: str = " ") -> str:
    if node is None:
        return ""
    if hasattr(node, "stripped_strings"):
        return separator.join(part.strip() for part in node.stripped_strings if part.strip())
    return str(node).strip()
