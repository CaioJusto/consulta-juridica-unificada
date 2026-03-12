"""Aliases de tribunais documentados na wiki do DataJud."""

from __future__ import annotations

TRIBUNAL_OPTIONS = [
    {"label": "Tribunal Superior do Trabalho", "alias": "api_publica_tst"},
    {"label": "Tribunal Superior Eleitoral", "alias": "api_publica_tse"},
    {"label": "Superior Tribunal de Justica", "alias": "api_publica_stj"},
    {"label": "Superior Tribunal Militar", "alias": "api_publica_stm"},
    {"label": "Tribunal Regional Federal da 1a Regiao", "alias": "api_publica_trf1"},
    {"label": "Tribunal Regional Federal da 2a Regiao", "alias": "api_publica_trf2"},
    {"label": "Tribunal Regional Federal da 3a Regiao", "alias": "api_publica_trf3"},
    {"label": "Tribunal Regional Federal da 4a Regiao", "alias": "api_publica_trf4"},
    {"label": "Tribunal Regional Federal da 5a Regiao", "alias": "api_publica_trf5"},
    {"label": "Tribunal Regional Federal da 6a Regiao", "alias": "api_publica_trf6"},
    {"label": "Tribunal de Justica do Acre", "alias": "api_publica_tjac"},
    {"label": "Tribunal de Justica de Alagoas", "alias": "api_publica_tjal"},
    {"label": "Tribunal de Justica do Amazonas", "alias": "api_publica_tjam"},
    {"label": "Tribunal de Justica do Amapa", "alias": "api_publica_tjap"},
    {"label": "Tribunal de Justica da Bahia", "alias": "api_publica_tjba"},
    {"label": "Tribunal de Justica do Ceara", "alias": "api_publica_tjce"},
    {"label": "TJ do Distrito Federal e Territorios", "alias": "api_publica_tjdft"},
    {"label": "Tribunal de Justica do Espirito Santo", "alias": "api_publica_tjes"},
    {"label": "Tribunal de Justica de Goias", "alias": "api_publica_tjgo"},
    {"label": "Tribunal de Justica do Maranhao", "alias": "api_publica_tjma"},
    {"label": "Tribunal de Justica de Minas Gerais", "alias": "api_publica_tjmg"},
    {"label": "TJ do Mato Grosso do Sul", "alias": "api_publica_tjms"},
    {"label": "Tribunal de Justica do Mato Grosso", "alias": "api_publica_tjmt"},
    {"label": "Tribunal de Justica do Para", "alias": "api_publica_tjpa"},
    {"label": "Tribunal de Justica da Paraiba", "alias": "api_publica_tjpb"},
    {"label": "Tribunal de Justica de Pernambuco", "alias": "api_publica_tjpe"},
    {"label": "Tribunal de Justica do Piaui", "alias": "api_publica_tjpi"},
    {"label": "Tribunal de Justica do Parana", "alias": "api_publica_tjpr"},
    {"label": "Tribunal de Justica do Rio de Janeiro", "alias": "api_publica_tjrj"},
    {"label": "Tribunal de Justica do Rio Grande do Norte", "alias": "api_publica_tjrn"},
    {"label": "Tribunal de Justica de Rondonia", "alias": "api_publica_tjro"},
    {"label": "Tribunal de Justica de Roraima", "alias": "api_publica_tjrr"},
    {"label": "Tribunal de Justica do Rio Grande do Sul", "alias": "api_publica_tjrs"},
    {"label": "Tribunal de Justica de Santa Catarina", "alias": "api_publica_tjsc"},
    {"label": "Tribunal de Justica de Sergipe", "alias": "api_publica_tjse"},
    {"label": "Tribunal de Justica de Sao Paulo", "alias": "api_publica_tjsp"},
    {"label": "Tribunal de Justica do Tocantins", "alias": "api_publica_tjto"},
    {"label": "Tribunal Regional do Trabalho da 1a Regiao", "alias": "api_publica_trt1"},
    {"label": "Tribunal Regional do Trabalho da 2a Regiao", "alias": "api_publica_trt2"},
    {"label": "Tribunal Regional do Trabalho da 3a Regiao", "alias": "api_publica_trt3"},
    {"label": "Tribunal Regional do Trabalho da 4a Regiao", "alias": "api_publica_trt4"},
    {"label": "Tribunal Regional do Trabalho da 5a Regiao", "alias": "api_publica_trt5"},
    {"label": "Tribunal Regional do Trabalho da 6a Regiao", "alias": "api_publica_trt6"},
    {"label": "Tribunal Regional do Trabalho da 7a Regiao", "alias": "api_publica_trt7"},
    {"label": "Tribunal Regional do Trabalho da 8a Regiao", "alias": "api_publica_trt8"},
    {"label": "Tribunal Regional do Trabalho da 9a Regiao", "alias": "api_publica_trt9"},
    {"label": "Tribunal Regional do Trabalho da 10a Regiao", "alias": "api_publica_trt10"},
    {"label": "Tribunal Regional do Trabalho da 11a Regiao", "alias": "api_publica_trt11"},
    {"label": "Tribunal Regional do Trabalho da 12a Regiao", "alias": "api_publica_trt12"},
    {"label": "Tribunal Regional do Trabalho da 13a Regiao", "alias": "api_publica_trt13"},
    {"label": "Tribunal Regional do Trabalho da 14a Regiao", "alias": "api_publica_trt14"},
    {"label": "Tribunal Regional do Trabalho da 15a Regiao", "alias": "api_publica_trt15"},
    {"label": "Tribunal Regional do Trabalho da 16a Regiao", "alias": "api_publica_trt16"},
    {"label": "Tribunal Regional do Trabalho da 17a Regiao", "alias": "api_publica_trt17"},
    {"label": "Tribunal Regional do Trabalho da 18a Regiao", "alias": "api_publica_trt18"},
    {"label": "Tribunal Regional do Trabalho da 19a Regiao", "alias": "api_publica_trt19"},
    {"label": "Tribunal Regional do Trabalho da 20a Regiao", "alias": "api_publica_trt20"},
    {"label": "Tribunal Regional do Trabalho da 21a Regiao", "alias": "api_publica_trt21"},
    {"label": "Tribunal Regional do Trabalho da 22a Regiao", "alias": "api_publica_trt22"},
    {"label": "Tribunal Regional do Trabalho da 23a Regiao", "alias": "api_publica_trt23"},
    {"label": "Tribunal Regional do Trabalho da 24a Regiao", "alias": "api_publica_trt24"},
    {"label": "Tribunal Regional Eleitoral do Acre", "alias": "api_publica_tre-ac"},
    {"label": "Tribunal Regional Eleitoral de Alagoas", "alias": "api_publica_tre-al"},
    {"label": "Tribunal Regional Eleitoral do Amazonas", "alias": "api_publica_tre-am"},
    {"label": "Tribunal Regional Eleitoral do Amapa", "alias": "api_publica_tre-ap"},
    {"label": "Tribunal Regional Eleitoral da Bahia", "alias": "api_publica_tre-ba"},
    {"label": "Tribunal Regional Eleitoral do Ceara", "alias": "api_publica_tre-ce"},
    {"label": "Tribunal Regional Eleitoral do Distrito Federal", "alias": "api_publica_tre-dft"},
    {"label": "Tribunal Regional Eleitoral do Espirito Santo", "alias": "api_publica_tre-es"},
    {"label": "Tribunal Regional Eleitoral de Goias", "alias": "api_publica_tre-go"},
    {"label": "Tribunal Regional Eleitoral do Maranhao", "alias": "api_publica_tre-ma"},
    {"label": "Tribunal Regional Eleitoral de Minas Gerais", "alias": "api_publica_tre-mg"},
    {"label": "Tribunal Regional Eleitoral do Mato Grosso do Sul", "alias": "api_publica_tre-ms"},
    {"label": "Tribunal Regional Eleitoral do Mato Grosso", "alias": "api_publica_tre-mt"},
    {"label": "Tribunal Regional Eleitoral do Para", "alias": "api_publica_tre-pa"},
    {"label": "Tribunal Regional Eleitoral da Paraiba", "alias": "api_publica_tre-pb"},
    {"label": "Tribunal Regional Eleitoral de Pernambuco", "alias": "api_publica_tre-pe"},
    {"label": "Tribunal Regional Eleitoral do Piaui", "alias": "api_publica_tre-pi"},
    {"label": "Tribunal Regional Eleitoral do Parana", "alias": "api_publica_tre-pr"},
    {"label": "Tribunal Regional Eleitoral do Rio de Janeiro", "alias": "api_publica_tre-rj"},
    {"label": "Tribunal Regional Eleitoral do Rio Grande do Norte", "alias": "api_publica_tre-rn"},
    {"label": "Tribunal Regional Eleitoral de Rondonia", "alias": "api_publica_tre-ro"},
    {"label": "Tribunal Regional Eleitoral de Roraima", "alias": "api_publica_tre-rr"},
    {"label": "Tribunal Regional Eleitoral do Rio Grande do Sul", "alias": "api_publica_tre-rs"},
    {"label": "Tribunal Regional Eleitoral de Santa Catarina", "alias": "api_publica_tre-sc"},
    {"label": "Tribunal Regional Eleitoral de Sergipe", "alias": "api_publica_tre-se"},
    {"label": "Tribunal Regional Eleitoral de Sao Paulo", "alias": "api_publica_tre-sp"},
    {"label": "Tribunal Regional Eleitoral do Tocantins", "alias": "api_publica_tre-to"},
    {"label": "Tribunal de Justica Militar de Minas Gerais", "alias": "api_publica_tjmmg"},
    {"label": "Tribunal de Justica Militar do Rio Grande do Sul", "alias": "api_publica_tjmrs"},
    {"label": "Tribunal de Justica Militar de Sao Paulo", "alias": "api_publica_tjmsp"},
]

TRIBUNAL_BY_ALIAS = {item["alias"]: item["label"] for item in TRIBUNAL_OPTIONS}
TRIBUNAL_LABELS = [f"{item['label']} ({item['alias']})" for item in TRIBUNAL_OPTIONS]


def alias_from_display(display_value: str) -> str:
    """Extrai o alias do valor mostrado no select."""
    return display_value.rsplit("(", 1)[-1].rstrip(")")


def normalize_tribunal_alias(raw_value: object) -> str | None:
    """Aceita alias puro, sigla curta ou URL completa do endpoint."""
    if raw_value is None:
        return None

    alias = str(raw_value).strip().lower()
    if not alias:
        return None

    alias = alias.replace("https://api-publica.datajud.cnj.jus.br/", "")
    alias = alias.replace("/_search", "")

    if alias in TRIBUNAL_BY_ALIAS:
        return alias

    if not alias.startswith("api_publica_"):
        prefixed = f"api_publica_{alias}"
        if prefixed in TRIBUNAL_BY_ALIAS:
            return prefixed

    return None
