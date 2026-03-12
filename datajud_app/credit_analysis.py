"""Presets e cruzamentos para precatorios e RPVs."""

from __future__ import annotations

import json
import unicodedata
from collections.abc import Iterable
from typing import Any

CREDIT_PRESET_CONFIGS: dict[str, dict[str, Any]] = {
    "precatorio_pendente": {
        "label": "Precatorio pendente",
        "description": (
            "Busca processos com assunto de precatorio e indicio de expedicao, "
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
            "Busca processos com assunto de RPV e indicio de expedicao, "
            "excluindo sinais estruturados de pagamento ou levantamento."
        ),
        "default_grau": "G1",
        "subject_codes": [10673, 14842],
        "positive_movement_codes": [12457, 15248, 12165],
        "negative_movement_codes": [12447, 1049, 12449, 12548],
        "related_classes": [12078, 15215, 156, 157],
    },
}

PRECATORIO_SUBJECT_CODES = {10672, 13506}
RPV_SUBJECT_CODES = {10673, 14842}
EXPEDITION_MOVEMENT_CODES = {12457, 15247, 15248, 12165}
PAYMENT_MOVEMENT_CODES = {12447, 1049}
LEVANTAMENTO_MOVEMENT_CODES = {12449, 12548}
PAYMENT_KEYWORDS = (
    "comprovado o pagamento",
    "noticia o pagamento",
    "pagamento efetuado",
    "pagamento realizado",
    "pagamento liberado",
    "deposito efetuado",
    "deposito realizado",
)
AWAITING_PAYMENT_KEYWORDS = (
    "aguardando pagamento",
    "remetido trf aguardando pagamento",
    "remetido ao trf aguardando pagamento",
)
LEVANTAMENTO_KEYWORDS = (
    "levantamento",
    "alvara",
)
CESSAO_KEYWORDS = (
    "cessao de credito",
    "cessao credito",
    "homologa cessao",
    "instrumento de cessao",
    "cessionario",
    "cedente",
    "cedido",
)


def get_credit_preset(preset_key: str) -> dict[str, Any] | None:
    return CREDIT_PRESET_CONFIGS.get(preset_key)


def build_credit_preset_clauses(preset_key: str) -> dict[str, Any]:
    preset = get_credit_preset(preset_key)
    if not preset:
        return {
            "extra_must": [],
            "extra_must_not": [],
            "applied_defaults": {},
        }

    extra_must = [
        {
            "bool": {
                "should": [
                    {"match": {"assuntos.codigo": code}}
                    for code in preset["subject_codes"]
                ],
                "minimum_should_match": 1,
            }
        },
        {
            "bool": {
                "should": [
                    {"match": {"movimentos.codigo": code}}
                    for code in preset["positive_movement_codes"]
                ],
                "minimum_should_match": 1,
            }
        },
    ]
    extra_must_not = [
        {"match": {"movimentos.codigo": code}}
        for code in preset["negative_movement_codes"]
    ]

    return {
        "extra_must": extra_must,
        "extra_must_not": extra_must_not,
        "applied_defaults": {
            "grau": preset.get("default_grau", ""),
        },
    }


def build_credit_analysis_rows(
    *,
    datajud_process_rows: list[dict[str, Any]],
    datajud_movement_rows: list[dict[str, Any]],
    datajud_subject_rows: list[dict[str, Any]],
    official_process_rows: list[dict[str, Any]] | None = None,
    official_event_rows: list[dict[str, Any]] | None = None,
    official_consulta_rows: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    official_process_rows = official_process_rows or []
    official_event_rows = official_event_rows or []
    official_consulta_rows = official_consulta_rows or []

    datajud_process_by = _map_first_row(datajud_process_rows)
    official_process_by = _map_first_row(official_process_rows)
    official_consulta_by = _map_first_row(official_consulta_rows)
    movement_rows_by_process = _group_rows_by_process_number(datajud_movement_rows)
    subject_rows_by_process = _group_rows_by_process_number(datajud_subject_rows)
    official_event_rows_by_process = _group_rows_by_process_number(official_event_rows)

    process_numbers = _ordered_process_numbers(
        datajud_process_rows,
        official_process_rows,
        official_consulta_rows,
        datajud_movement_rows,
        datajud_subject_rows,
        official_event_rows,
    )

    rows: list[dict[str, Any]] = []
    for process_number in process_numbers:
        datajud_process = datajud_process_by.get(process_number, {})
        official_process = official_process_by.get(process_number, {})
        official_consulta = official_consulta_by.get(process_number, {})
        movement_rows = movement_rows_by_process.get(process_number, [])
        subject_rows = subject_rows_by_process.get(process_number, [])
        official_events = official_event_rows_by_process.get(process_number, [])

        subject_codes = {
            _safe_int(row.get("codigo"))
            for row in subject_rows
            if _safe_int(row.get("codigo")) is not None
        }
        movement_codes = {
            _safe_int(row.get("codigo"))
            for row in movement_rows
            if _safe_int(row.get("codigo")) is not None
        }

        relevant_datajud_events = [
            _compact_text(
                [
                    row.get("data_hora"),
                    row.get("andamento"),
                    row.get("complementos"),
                ]
            )
            for row in movement_rows
            if _is_relevant_datajud_movement_row(row)
        ]
        relevant_official_events = [
            _compact_text(
                [
                    row.get("data_hora"),
                    row.get("evento"),
                    row.get("documento_resumo"),
                ]
            )
            for row in official_events
            if _is_relevant_official_event_row(row)
        ]

        official_texts = [
            _compact_text(
                [
                    row.get("evento"),
                    row.get("documento_resumo"),
                    row.get("descricao"),
                ]
            )
            for row in official_events
        ]
        datajud_texts = [
            _compact_text([row.get("andamento"), row.get("complementos")])
            for row in movement_rows
        ]

        has_precatorio_subject = bool(subject_codes & PRECATORIO_SUBJECT_CODES)
        has_rpv_subject = bool(subject_codes & RPV_SUBJECT_CODES)
        has_expedition = bool(movement_codes & EXPEDITION_MOVEMENT_CODES) or _contains_keywords(
            datajud_texts,
            ("expedicao de precatorio", "expedicao de rpv", "requisicao de pagamento"),
        )
        has_payment = bool(movement_codes & PAYMENT_MOVEMENT_CODES) or _contains_keywords(
            datajud_texts,
            PAYMENT_KEYWORDS,
        )
        has_levantamento = bool(
            movement_codes & LEVANTAMENTO_MOVEMENT_CODES
        ) or _contains_keywords(datajud_texts, LEVANTAMENTO_KEYWORDS)
        has_datajud_cessao = _contains_keywords(datajud_texts, CESSAO_KEYWORDS)
        has_official_awaiting = _contains_keywords(official_texts, AWAITING_PAYMENT_KEYWORDS)
        has_official_payment = _contains_keywords(official_texts, PAYMENT_KEYWORDS)
        has_official_levantamento = _contains_keywords(official_texts, LEVANTAMENTO_KEYWORDS)
        has_official_cessao = _contains_keywords(official_texts, CESSAO_KEYWORDS)

        tipo_credito = _classify_credit_type(
            has_precatorio_subject=has_precatorio_subject,
            has_rpv_subject=has_rpv_subject,
            datajud_texts=datajud_texts,
            official_texts=official_texts,
        )

        status_oportunidade, motivos = _build_opportunity_status(
            tipo_credito=tipo_credito,
            has_expedition=has_expedition,
            has_payment=has_payment,
            has_levantamento=has_levantamento,
            has_official_payment=has_official_payment,
            has_official_levantamento=has_official_levantamento,
            has_datajud_cessao=has_datajud_cessao,
            has_official_cessao=has_official_cessao,
            has_official_awaiting=has_official_awaiting,
        )

        row = {
            "numero_processo": process_number,
            "tribunal": _pick_first(
                datajud_process.get("tribunal"),
                official_process.get("tribunal"),
                official_consulta.get("tribunal"),
            ),
            "tipo_credito": tipo_credito,
            "status_oportunidade": status_oportunidade,
            "motivos_status": " | ".join(motivos),
            "classe": _pick_first(
                datajud_process.get("classe"),
                official_process.get("classe"),
            ),
            "orgao_julgador": _pick_first(
                datajud_process.get("orgao_julgador"),
                official_process.get("orgao_julgador"),
            ),
            "grau": datajud_process.get("grau"),
            "sistema": datajud_process.get("sistema"),
            "formato": datajud_process.get("formato"),
            "data_ajuizamento": datajud_process.get("data_ajuizamento"),
            "ultima_atualizacao": datajud_process.get("ultima_atualizacao"),
            "assuntos": datajud_process.get("assuntos"),
            "assuntos_codigos_detectados": ", ".join(
                str(code) for code in sorted(subject_codes) if code is not None
            ),
            "movimentos_codigos_detectados": ", ".join(
                str(code) for code in sorted(movement_codes) if code is not None
            ),
            "indicio_assunto_precatorio": _yes_no(has_precatorio_subject),
            "indicio_assunto_rpv": _yes_no(has_rpv_subject),
            "indicio_expedicao_datajud": _yes_no(has_expedition),
            "indicio_pagamento_datajud": _yes_no(has_payment),
            "indicio_levantamento_datajud": _yes_no(has_levantamento),
            "indicio_cessao_datajud": _yes_no(has_datajud_cessao),
            "oficial_aguardando_pagamento": _yes_no(has_official_awaiting),
            "oficial_indicio_pagamento": _yes_no(has_official_payment),
            "oficial_indicio_levantamento": _yes_no(has_official_levantamento),
            "oficial_indicio_cessao": _yes_no(has_official_cessao),
            "ultimo_andamento_datajud": datajud_process.get("ultimo_andamento"),
            "data_ultimo_andamento_datajud": datajud_process.get("data_ultimo_andamento"),
            "ultimo_evento_oficial": official_process.get("ultimo_evento"),
            "data_ultimo_evento_oficial": official_process.get("data_ultimo_evento"),
            "polo_ativo": _pick_first(
                official_consulta.get("polo_ativo"),
                official_process.get("polo_ativo"),
            ),
            "polo_passivo": _pick_first(
                official_consulta.get("polo_passivo"),
                official_process.get("polo_passivo"),
            ),
            "documentos_polo_ativo": official_consulta.get("documentos_polo_ativo"),
            "documentos_polo_passivo": official_consulta.get("documentos_polo_passivo"),
            "documentos_cpf": official_consulta.get("documentos_cpf"),
            "documentos_cnpj": official_consulta.get("documentos_cnpj"),
            "advogados": _pick_first(
                official_consulta.get("advogados"),
                official_process.get("advogados_resumo"),
            ),
            "andamentos_datajud_relevantes": " | ".join(
                item for item in _dedupe_preserving_order(relevant_datajud_events) if item
            ),
            "eventos_oficiais_relevantes": " | ".join(
                item for item in _dedupe_preserving_order(relevant_official_events) if item
            ),
            "json_andamentos_oficiais": (
                json.dumps(official_events, ensure_ascii=False) if official_events else ""
            ),
            "json_andamentos_datajud": json.dumps(movement_rows, ensure_ascii=False),
        }
        rows.append(row)

    return rows


def _group_rows_by_process_number(
    rows: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        process_number = str(row.get("numero_processo") or "").strip()
        if not process_number:
            continue
        grouped.setdefault(process_number, []).append(row)
    return grouped


def _map_first_row(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    mapped: dict[str, dict[str, Any]] = {}
    for row in rows:
        process_number = str(row.get("numero_processo") or "").strip()
        if not process_number or process_number in mapped:
            continue
        mapped[process_number] = row
    return mapped


def _ordered_process_numbers(*row_groups: Iterable[dict[str, Any]]) -> list[str]:
    ordered: list[str] = []
    seen: set[str] = set()
    for rows in row_groups:
        for row in rows:
            process_number = str(row.get("numero_processo") or "").strip()
            if not process_number or process_number in seen:
                continue
            seen.add(process_number)
            ordered.append(process_number)
    return ordered


def _build_opportunity_status(
    *,
    tipo_credito: str,
    has_expedition: bool,
    has_payment: bool,
    has_levantamento: bool,
    has_official_payment: bool,
    has_official_levantamento: bool,
    has_datajud_cessao: bool,
    has_official_cessao: bool,
    has_official_awaiting: bool,
) -> tuple[str, list[str]]:
    motivos: list[str] = []
    if tipo_credito == "Fora do foco":
        return "fora_do_foco", ["Sem indicio suficiente de precatorio ou RPV."]

    if has_payment or has_levantamento or has_official_payment or has_official_levantamento:
        if has_payment or has_official_payment:
            motivos.append("Ha indicio de pagamento.")
        if has_levantamento or has_official_levantamento:
            motivos.append("Ha indicio de levantamento/alvara.")
        return "descartar_pago_ou_em_levantamento", motivos

    if has_datajud_cessao or has_official_cessao:
        if has_datajud_cessao:
            motivos.append("Ha indicio de cessao no DataJud.")
        if has_official_cessao:
            motivos.append("Ha indicio de cessao na fonte oficial.")
        return "descartar_com_indicio_de_cessao", motivos

    if has_expedition or has_official_awaiting:
        if has_expedition:
            motivos.append("Ha indicio de expedicao no DataJud.")
        if has_official_awaiting:
            motivos.append("Fonte oficial menciona aguardando pagamento.")
        return "potencial_oportunidade", motivos

    return "revisar_manual", ["Nao ha sinal suficiente para classificar automaticamente."]


def _classify_credit_type(
    *,
    has_precatorio_subject: bool,
    has_rpv_subject: bool,
    datajud_texts: list[str],
    official_texts: list[str],
) -> str:
    if has_precatorio_subject and has_rpv_subject:
        return "Precatorio/RPV"
    if has_precatorio_subject:
        return "Precatorio"
    if has_rpv_subject:
        return "RPV"

    if _contains_keywords(datajud_texts + official_texts, ("precatorio",)):
        return "Precatorio"
    if _contains_keywords(datajud_texts + official_texts, ("rpv", "requisicao de pequeno valor")):
        return "RPV"
    return "Fora do foco"


def _is_relevant_datajud_movement_row(row: dict[str, Any]) -> bool:
    movement_code = _safe_int(row.get("codigo"))
    if movement_code in (
        EXPEDITION_MOVEMENT_CODES
        | PAYMENT_MOVEMENT_CODES
        | LEVANTAMENTO_MOVEMENT_CODES
    ):
        return True
    text = _compact_text([row.get("andamento"), row.get("complementos")])
    return _contains_keywords(
        [text],
        PAYMENT_KEYWORDS + AWAITING_PAYMENT_KEYWORDS + LEVANTAMENTO_KEYWORDS + CESSAO_KEYWORDS,
    )


def _is_relevant_official_event_row(row: dict[str, Any]) -> bool:
    text = _compact_text([row.get("evento"), row.get("documento_resumo"), row.get("descricao")])
    return _contains_keywords(
        [text],
        PAYMENT_KEYWORDS + AWAITING_PAYMENT_KEYWORDS + LEVANTAMENTO_KEYWORDS + CESSAO_KEYWORDS,
    )


def _contains_keywords(texts: Iterable[str], keywords: Iterable[str]) -> bool:
    normalized_texts = [_normalize_text(text) for text in texts if text]
    normalized_keywords = [_normalize_text(keyword) for keyword in keywords if keyword]
    for text in normalized_texts:
        for keyword in normalized_keywords:
            if keyword and keyword in text:
                return True
    return False


def _compact_text(values: Iterable[Any]) -> str:
    return " - ".join(str(value).strip() for value in values if str(value or "").strip())


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value))
    ascii_only = "".join(char for char in normalized if not unicodedata.combining(char))
    return " ".join(ascii_only.lower().strip().split())


def _safe_int(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _pick_first(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return ""


def _yes_no(value: bool) -> str:
    return "Sim" if value else "Nao"


def _dedupe_preserving_order(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered
