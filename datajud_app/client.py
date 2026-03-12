"""Cliente HTTP para a API publica do DataJud."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import requests

DEFAULT_BASE_URL = "https://api-publica.datajud.cnj.jus.br"
DEFAULT_PUBLIC_API_KEY = (
    "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw=="
)


class DataJudError(RuntimeError):
    """Erro operacional ao consultar a API do DataJud."""


class DataJudClient:
    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        timeout_seconds: int = 60,
    ) -> None:
        self.api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"APIKey {self.api_key}",
            "Content-Type": "application/json",
        }

    def endpoint_url(self, tribunal_alias: str) -> str:
        return f"{self.base_url}/{tribunal_alias}/_search"

    def search(self, tribunal_alias: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.session.post(
            self.endpoint_url(tribunal_alias),
            headers=self._headers(),
            json=body,
            timeout=self.timeout_seconds,
        )

        if response.status_code >= 400:
            raise DataJudError(
                f"Falha HTTP {response.status_code} ao consultar {tribunal_alias}: "
                f"{response.text[:400]}"
            )

        try:
            data = response.json()
        except json.JSONDecodeError as exc:
            raise DataJudError(
                f"Resposta não-JSON da API ({response.status_code}): "
                f"{response.text[:400]}"
            ) from exc
        if data.get("error"):
            raise DataJudError(json.dumps(data["error"], ensure_ascii=False))

        return data

    def search_all(
        self,
        tribunal_alias: str,
        body: dict[str, Any],
        *,
        page_size: int = 100,
        max_records: int = 0,
        max_pages: int | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        query = deepcopy(body)
        query["size"] = max(1, min(page_size, 10_000))
        query.setdefault("sort", [{"@timestamp": {"order": "asc"}}])

        unlimited = max_records <= 0
        hits_out: list[dict[str, Any]] = []
        search_after: list[Any] | None = None
        page = 0

        while unlimited or len(hits_out) < max_records:
            if search_after:
                query["search_after"] = search_after
            else:
                query.pop("search_after", None)

            data = self.search(tribunal_alias, query)
            hits = data.get("hits", {}).get("hits", [])
            if not hits:
                break

            hits_out.extend(hit.get("_source", {}) for hit in hits)
            page += 1

            if not unlimited and len(hits_out) >= max_records:
                break

            search_after = hits[-1].get("sort")
            if not search_after or len(hits) < query["size"]:
                break

            if max_pages is not None and page >= max_pages:
                break

        if not unlimited:
            return hits_out[:max_records], page
        return hits_out, page

    def fetch_processes_by_numbers(
        self,
        tribunal_alias: str,
        process_numbers: list[str],
        *,
        batch_size: int = 200,
    ) -> dict[str, dict[str, Any]]:
        results: dict[str, dict[str, Any]] = {}
        unique_numbers = list(dict.fromkeys(process_numbers))
        batch_size = max(1, min(batch_size, 500))

        for start in range(0, len(unique_numbers), batch_size):
            batch = unique_numbers[start : start + batch_size]
            data = self.search(
                tribunal_alias,
                {
                    "size": len(batch),
                    "sort": [{"@timestamp": {"order": "asc"}}],
                    "query": {"terms": {"numeroProcesso.keyword": batch}},
                },
            )
            for hit in data.get("hits", {}).get("hits", []):
                source = hit.get("_source", {})
                process_number = source.get("numeroProcesso")
                if process_number:
                    results[process_number] = source

        return results
