from __future__ import annotations

import os
import re
from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright
from playwright_runtime import launch_browser

TRF1_PROCESSUAL_BASE = "https://processual.trf1.jus.br/consultaProcessual"

SEARCH_PATHS = {
    "numero": "numeroProcesso.php",
    "nomeParte": "nomeParte.php",
    "cpfCnpj": "cpfCnpjParte.php",
    "nomeAdvogado": "nomeAdvogado.php",
    "oab": "oabAdvogado.php",
}

PROCESS_LINK_RE = re.compile(r"/consultaProcessual/processo\.php(?:\?|$)")
LISTAR_PROCESSOS_RE = re.compile(
    r"/consultaProcessual/(?:parte|advogado)/listarProcessos\.php(?:\?|$)"
)
CNJ_NUMBER_RE = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
SECURITY_BLOCK_RE = re.compile(
    r"performing security verification|just a moment|enable javascript and cookies to continue",
    re.IGNORECASE,
)
TOO_BROAD_RE = re.compile(r"mais de 500 .*? encontrad", re.IGNORECASE)

def _launch_browser(playwright: Any) -> Any:
    return launch_browser(
        playwright,
        headless_env="TRF1_PROCESSUAL_HEADLESS",
    )


def _clean_text(value: Any) -> str:
    text = str(value or "")
    text = text.replace("\xa0", " ")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _extract_lines(value: str) -> list[str]:
    lines = []
    for raw in str(value or "").replace("\xa0", " ").splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


def _label_map_from_lines(value: str, labels: dict[str, str]) -> dict[str, str]:
    found: dict[str, str] = {}
    lines = _extract_lines(value)
    for index, line in enumerate(lines):
        normalized = _clean_text(line.rstrip(":")).lower()
        key = labels.get(normalized)
        if key and index + 1 < len(lines):
            found[key] = _clean_text(lines[index + 1])
    return found


def formatar_numero_processo(numero: str) -> str:
    digits = re.sub(r"\D", "", str(numero or ""))
    if len(digits) == 20:
        return (
            f"{digits[:7]}-{digits[7:9]}.{digits[9:13]}."
            f"{digits[13:14]}.{digits[14:16]}.{digits[16:20]}"
        )
    return str(numero or "").strip()


@dataclass
class Parte:
    tipo: str = ""
    nome: str = ""
    entidade: str = ""
    oab: str = ""
    caracteristica: str = ""


@dataclass
class Movimentacao:
    data: str = ""
    codigo: str = ""
    descricao: str = ""
    complemento: str = ""


@dataclass
class Distribuicao:
    data: str = ""
    descricao: str = ""
    juiz: str = ""


@dataclass
class Peticao:
    numero: str = ""
    data_entrada: str = ""
    data_juntada: str = ""
    tipo: str = ""
    complemento: str = ""


@dataclass
class Documento:
    descricao: str = ""
    data: str = ""
    url: str = ""


@dataclass
class ProcessoTRF1:
    numero: str = ""
    nova_numeracao: str = ""
    grupo: str = ""
    assunto: str = ""
    data_autuacao: str = ""
    orgao_julgador: str = ""
    juiz_relator: str = ""
    processo_originario: str = ""
    situacao: str = ""
    url_consulta: str = ""
    url_inteiro_teor: str = ""
    secao: str = "TRF1"
    partes: list[Parte] = field(default_factory=list)
    distribuicoes: list[Distribuicao] = field(default_factory=list)
    movimentacoes: list[Movimentacao] = field(default_factory=list)
    peticoes: list[Peticao] = field(default_factory=list)
    documentos: list[Documento] = field(default_factory=list)
    incidentes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ResultadoBusca:
    numero: str = ""
    nome_parte: str = ""
    secao: str = "TRF1"
    url: str = ""
    processo_originario: str = ""


class TRF1SearchTooBroadError(RuntimeError):
    pass


def _wait_until_unblocked(page: Any, timeout_ms: int = 15000) -> None:
    deadline = timeout_ms
    waited = 0
    while waited <= deadline:
        try:
            text = page.inner_text("body")
        except Exception:
            text = ""
        if not SECURITY_BLOCK_RE.search(text):
            return
        page.wait_for_timeout(1000)
        waited += 1000
    raise RuntimeError(
        "O portal processual do TRF1 bloqueou a automacao. Em ambientes Linux, "
        "execute o navegador com interface grafica ou via Xvfb."
    )


def _wait_recaptcha_token(page: Any) -> None:
    try:
        page.wait_for_function(
            "() => { const el = document.querySelector('#recaptchaResponse'); return !el || !!el.value; }",
            timeout=10000,
        )
    except Exception:
        page.wait_for_timeout(2000)


def _open_search_page(page: Any, search_type: str, secao: str) -> None:
    url = f"{TRF1_PROCESSUAL_BASE}/{SEARCH_PATHS[search_type]}?secao={secao}"
    page.goto(url, wait_until="domcontentloaded", timeout=45000)
    _wait_until_unblocked(page)
    _wait_recaptcha_token(page)


def _toggle_baixados(page: Any, checked: bool) -> None:
    locator = page.locator("input[name='mostrarBaixados']")
    if locator.count() > 0:
        locator.first.set_checked(checked)


def _extract_status_text(body_text: str) -> str:
    for line in _extract_lines(body_text):
        if re.fullmatch(r"[A-ZÇÁÉÍÓÚÃÕ /-]{5,}", line) and " / " in line:
            return line
    return ""


def _extract_process_number(link_text: str, href: str) -> str:
    match = CNJ_NUMBER_RE.search(link_text or "")
    if match:
        return match.group(0)
    query = parse_qs(urlparse(href).query)
    proc = _clean_text(query.get("proc", [""])[0])
    return formatar_numero_processo(proc) if proc else _clean_text(link_text)


def _parse_process_results(html: str, *, secao: str, default_name: str = "") -> list[ResultadoBusca]:
    soup = BeautifulSoup(html, "html.parser")
    results: list[ResultadoBusca] = []
    seen: set[tuple[str, str]] = set()

    for link in soup.find_all("a", href=True):
        href = link.get("href", "")
        if not PROCESS_LINK_RE.search(href):
            continue
        absolute_url = urljoin(f"{TRF1_PROCESSUAL_BASE}/", href)
        numero = _extract_process_number(_clean_text(link.get_text(" ", strip=True)), absolute_url)
        if not numero:
            continue

        query = parse_qs(urlparse(absolute_url).query)
        name = default_name or _clean_text(query.get("nome", [""])[0])
        processo_originario = ""

        row = link.find_parent("tr")
        if row:
            cells = row.find_all("td")
            if len(cells) >= 2:
                processo_originario = _clean_text(cells[1].get_text(" ", strip=True))

        key = (numero, absolute_url)
        if key in seen:
            continue
        seen.add(key)
        results.append(
            ResultadoBusca(
                numero=numero,
                nome_parte=name,
                secao=secao,
                url=absolute_url,
                processo_originario=processo_originario,
            )
        )

    return results


def _parse_listar_processos_links(html: str) -> list[dict[str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    links: list[dict[str, str]] = []
    seen: set[str] = set()

    for link in soup.find_all("a", href=True):
        href = link.get("href", "")
        if not LISTAR_PROCESSOS_RE.search(href):
            continue
        absolute_url = urljoin(f"{TRF1_PROCESSUAL_BASE}/", href)
        if absolute_url in seen:
            continue
        seen.add(absolute_url)
        links.append(
            {
                "nome": _clean_text(link.get_text(" ", strip=True)),
                "url": absolute_url,
            }
        )

    return links


def _table_rows(tab: Any, expected_cols: int) -> list[list[str]]:
    if tab is None:
        return []
    rows: list[list[str]] = []
    for row in tab.find_all("tr"):
        cells = [_clean_text(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
        if len(cells) >= expected_cols:
            rows.append(cells[:expected_cols])
    return rows


def _parse_process_page(page: Any, *, secao: str, source_url: str) -> ProcessoTRF1 | None:
    body_text = page.inner_text("body")
    try:
        for tab_label in ("Distribuição", "Partes", "Movimentação", "Incidentes", "Petições", "Documentos", "Inteiro Teor"):
            link = page.get_by_role("link", name=tab_label)
            if link.count() > 0:
                link.first.click(timeout=3000)
                page.wait_for_timeout(800)
    except Exception:
        pass

    html = page.content()
    soup = BeautifulSoup(html, "html.parser")
    process_tab = soup.select_one("#aba-processo")
    if process_tab is None:
        lines = _extract_lines(body_text)
        message = next(
            (
                line
                for line in lines
                if "precatório" in line.lower() or "rpv" in line.lower() or "não encontrado" in line.lower()
            ),
            "",
        )
        fallback_number = next((line for line in lines if CNJ_NUMBER_RE.search(line)), "")
        if message or fallback_number:
            return ProcessoTRF1(
                numero="",
                nova_numeracao=CNJ_NUMBER_RE.search(fallback_number).group(0) if CNJ_NUMBER_RE.search(fallback_number) else fallback_number,
                assunto=message,
                situacao=_extract_status_text(body_text),
                url_consulta=source_url,
                secao=secao,
            )
        return None

    data = _label_map_from_lines(
        process_tab.get_text("\n", strip=True),
        {
            "processo": "numero",
            "nova numeração": "nova_numeracao",
            "grupo": "grupo",
            "assunto": "assunto",
            "data de autuação": "data_autuacao",
            "órgão julgador": "orgao_julgador",
            "juiz relator": "juiz_relator",
            "processo originário": "processo_originario",
        },
    )

    inteiro_teor_link = soup.select_one("#aba-inteiroteor a[href]")

    partes_tab = soup.select_one("#aba-partes")
    partes = [
        Parte(
            tipo=row[0],
            entidade=row[1],
            oab=row[2],
            nome=row[3],
            caracteristica=row[4],
        )
        for row in _table_rows(partes_tab, 5)
    ]

    distribuicao_tab = soup.select_one("#aba-distribuicao")
    distribuicoes = [
        Distribuicao(data=row[0], descricao=row[1], juiz=row[2])
        for row in _table_rows(distribuicao_tab, 3)
    ]

    movimentacao_tab = soup.select_one("#aba-movimentacao")
    movimentacoes = [
        Movimentacao(data=row[0], codigo=row[1], descricao=row[2], complemento=row[3])
        for row in _table_rows(movimentacao_tab, 4)
    ]

    peticoes_tab = soup.select_one("#aba-peticoes")
    peticoes = [
        Peticao(
            numero=row[0],
            data_entrada=row[1],
            data_juntada=row[2],
            tipo=row[3],
            complemento=row[4],
        )
        for row in _table_rows(peticoes_tab, 5)
    ]

    documentos: list[Documento] = []
    documentos_tab = soup.select_one("#aba-documentos")
    if documentos_tab is not None and "não há documentos digitais" not in documentos_tab.get_text(" ", strip=True).lower():
        table = documentos_tab.find("table")
        if table:
            for row in table.find_all("tr"):
                cells = [_clean_text(cell.get_text(" ", strip=True)) for cell in row.find_all("td")]
                if not cells:
                    continue
                link = row.find("a", href=True)
                date = ""
                description = ""
                for cell in cells:
                    if re.search(r"\d{2}/\d{2}/\d{4}", cell) and not date:
                        date = cell
                    elif cell:
                        description = description or cell
                if description:
                    documentos.append(
                        Documento(
                            descricao=description,
                            data=date,
                            url=urljoin(f"{TRF1_PROCESSUAL_BASE}/", link["href"]) if link else "",
                        )
                    )

    incidentes: list[str] = []
    incidentes_tab = soup.select_one("#aba-incidentes")
    if incidentes_tab is not None:
        text = _clean_text(incidentes_tab.get_text("\n", strip=True))
        if text and "nenhum registro encontrado" not in text.lower():
            lines = _extract_lines(text)
            incidentes = [line for line in lines if line.lower() != "incidentes"]

    return ProcessoTRF1(
        numero=data.get("numero", ""),
        nova_numeracao=data.get("nova_numeracao", ""),
        grupo=data.get("grupo", ""),
        assunto=data.get("assunto", ""),
        data_autuacao=data.get("data_autuacao", ""),
        orgao_julgador=data.get("orgao_julgador", ""),
        juiz_relator=data.get("juiz_relator", ""),
        processo_originario=data.get("processo_originario", ""),
        situacao=_extract_status_text(body_text),
        url_consulta=source_url,
        url_inteiro_teor=inteiro_teor_link["href"] if inteiro_teor_link else "",
        secao=secao,
        partes=partes,
        distribuicoes=distribuicoes,
        movimentacoes=movimentacoes,
        peticoes=peticoes,
        documentos=documentos,
        incidentes=incidentes,
    )


class TRF1Client:
    def __init__(self, secao: str = "TRF1", timeout: int = 30) -> None:
        self.secao = secao
        self.timeout = timeout

    def _search_results_from_form(self, search_type: str, value: str, baixados: bool = False) -> list[ResultadoBusca]:
        with sync_playwright() as playwright:
            browser = _launch_browser(playwright)
            context = browser.new_context(locale="pt-BR")
            page = context.new_page()
            try:
                _open_search_page(page, search_type, self.secao)

                selector_map = {
                    "nomeParte": "input[name='nome']",
                    "cpfCnpj": "input[name='cpf_cnpj']",
                    "nomeAdvogado": "input[name='nome']",
                    "oab": "input[name='oab']",
                }
                normalized_value = value.strip()
                if search_type == "cpfCnpj":
                    normalized_value = re.sub(r"\D", "", normalized_value)

                page.locator(selector_map[search_type]).fill(normalized_value)
                _toggle_baixados(page, baixados)
                page.get_by_role("button", name="Pesquisar").click()
                page.wait_for_load_state("domcontentloaded", timeout=45000)
                page.wait_for_timeout(1500)
                _wait_until_unblocked(page)

                html = page.content()
                body_text = page.inner_text("body")
                if TOO_BROAD_RE.search(body_text):
                    raise TRF1SearchTooBroadError(_clean_text(TOO_BROAD_RE.search(body_text).group(0)))

                results = _parse_process_results(html, secao=self.secao, default_name=value.strip())
                if results:
                    return results

                listar_links = _parse_listar_processos_links(html)
                aggregated: list[ResultadoBusca] = []
                seen: set[tuple[str, str]] = set()

                for item in listar_links[:30]:
                    list_page = context.new_page()
                    try:
                        list_page.goto(item["url"], wait_until="domcontentloaded", timeout=45000)
                        list_page.wait_for_timeout(1000)
                        sub_results = _parse_process_results(
                            list_page.content(),
                            secao=self.secao,
                            default_name=item["nome"],
                        )
                        for result in sub_results:
                            key = (result.numero, result.url)
                            if key in seen:
                                continue
                            seen.add(key)
                            aggregated.append(result)
                            if len(aggregated) >= 50:
                                return aggregated
                    finally:
                        list_page.close()

                return aggregated
            finally:
                context.close()
                browser.close()

    def buscar_por_url(self, url: str) -> ProcessoTRF1 | None:
        with sync_playwright() as playwright:
            browser = _launch_browser(playwright)
            context = browser.new_context(locale="pt-BR")
            page = context.new_page()
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45000)
                page.wait_for_timeout(1500)
                _wait_until_unblocked(page)
                return _parse_process_page(page, secao=self.secao, source_url=url)
            finally:
                context.close()
                browser.close()

    def buscar_por_numero(self, numero: str) -> ProcessoTRF1 | None:
        with sync_playwright() as playwright:
            browser = _launch_browser(playwright)
            context = browser.new_context(locale="pt-BR")
            page = context.new_page()
            try:
                _open_search_page(page, "numero", self.secao)
                page.locator("input[name='proc']").fill(numero.strip())
                page.get_by_role("button", name="Pesquisar").click()
                page.wait_for_load_state("domcontentloaded", timeout=45000)
                page.wait_for_timeout(1500)
                _wait_until_unblocked(page)
                return _parse_process_page(page, secao=self.secao, source_url=page.url)
            finally:
                context.close()
                browser.close()

    def buscar_por_nome(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        return self._search_results_from_form("nomeParte", valor, baixados)

    def buscar_por_cpf_cnpj(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        return self._search_results_from_form("cpfCnpj", valor, baixados)

    def buscar_por_advogado(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        return self._search_results_from_form("nomeAdvogado", valor, baixados)

    def buscar_por_oab(self, valor: str, baixados: bool = False) -> list[ResultadoBusca]:
        return self._search_results_from_form("oab", valor, baixados)
