"""Worker script para busca em background — roda fora do processo Streamlit.

Uso:
    python datajud_app/worker.py <job_id> <search_type> <params_json>

search_type suportado:
    trf1_public   — chama search_trf1_public_bundle com os params fornecidos
    datajud_main  — chama DataJudClient.search_all + enriquecimento oficial opcional
    datajud_batch — chama fetch_processes_by_numbers por tribunal + enriquecimento opcional
"""

from __future__ import annotations

import json
import os
import pickle
import shutil
import sys
from datetime import datetime
from pathlib import Path

JOBS_DIR = Path("/tmp/datajud_jobs")
JOB_MAX_AGE_SECONDS = 7200  # 2 horas


# ---------------------------------------------------------------------------
# Estado do job
# ---------------------------------------------------------------------------

def _write_state(
    job_dir: Path,
    status: str,
    progress: float,
    message: str,
    started_at: str,
    pid: int,
    error: str | None = None,
) -> None:
    """Escreve state.json de forma atômica (escreve tmp e renomeia)."""
    state = {
        "status": status,
        "progress": round(float(progress), 4),
        "message": message,
        "started_at": started_at,
        "pid": pid,
        "error": error,
    }
    tmp_file = job_dir / "state.json.tmp"
    tmp_file.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp_file.replace(job_dir / "state.json")


# ---------------------------------------------------------------------------
# Limpeza automática de jobs antigos
# ---------------------------------------------------------------------------

def cleanup_old_jobs(max_age_seconds: int = JOB_MAX_AGE_SECONDS) -> None:
    """Remove diretórios de jobs com mais de max_age_seconds."""
    if not JOBS_DIR.exists():
        return
    now = datetime.now().timestamp()
    for job_dir in JOBS_DIR.iterdir():
        if not job_dir.is_dir():
            continue
        state_file = job_dir / "state.json"
        if not state_file.exists():
            continue
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
            started_at = state.get("started_at", "")
            if not started_at:
                continue
            started_ts = datetime.fromisoformat(started_at).timestamp()
            if now - started_ts > max_age_seconds:
                shutil.rmtree(job_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Runners por tipo de busca
# ---------------------------------------------------------------------------

def run_trf1_public(job_id: str, params_dict: dict) -> None:
    """Executa search_trf1_public_bundle e salva resultado em result.pkl."""
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now().isoformat()
    pid = os.getpid()

    def update_state(
        status: str,
        progress: float,
        message: str,
        error: str | None = None,
    ) -> None:
        _write_state(job_dir, status, progress, message, started_at, pid, error)

    update_state("running", 0.0, "Inicializando worker...")

    try:
        # Import aqui para evitar problemas de path quando rodando como subprocess
        from datajud_app.trf1_public import (  # noqa: PLC0415
            TRF1PublicSearchParams,
            search_trf1_public_bundle,
        )

        max_details = int(params_dict.pop("max_details", 30))
        params = TRF1PublicSearchParams(**params_dict)

        def on_progress(current: int, total: int, message: str) -> None:
            progress = current / total if total > 0 else 0.0
            update_state("running", progress, message)

        bundle = search_trf1_public_bundle(
            params,
            max_details=max_details,
            on_progress=on_progress,
        )

        result_file = job_dir / "result.pkl"
        result_file.write_bytes(pickle.dumps(bundle))

        update_state(
            "done",
            1.0,
            (
                f"Concluído: {bundle.total_results} resultados na grade, "
                f"{len(bundle.process_rows)} processos detalhados."
            ),
        )

    except Exception as exc:
        import traceback

        error_detail = traceback.format_exc()
        update_state("error", 0.0, f"Erro: {exc}", error=error_detail)
        sys.exit(1)


# ---------------------------------------------------------------------------
# Runner: datajud_main (search_all + enriquecimento opcional)
# ---------------------------------------------------------------------------

def run_datajud_main(job_id: str, params_dict: dict) -> None:
    """Executa DataJud search_all + enriquecimento oficial opcional e salva resultado."""
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now().isoformat()
    pid = os.getpid()

    # Escreve meta.json com job_type para que o app saiba como processar o resultado
    meta = {
        "job_type": "datajud_main",
        "result_state_key": "filters_result",
    }
    (job_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    def update_state(
        status: str,
        progress: float,
        message: str,
        error: str | None = None,
    ) -> None:
        _write_state(job_dir, status, progress, message, started_at, pid, error)

    update_state("running", 0.0, "📡 Consultando DataJud...")

    try:
        from datajud_app.client import DataJudClient  # noqa: PLC0415
        from datajud_app.official_sources import enrich_from_official_sources  # noqa: PLC0415

        tribunal_alias = params_dict["tribunal_alias"]
        query_body = params_dict["query_body"]
        page_size = int(params_dict.get("page_size", 100))
        max_records = int(params_dict.get("max_records", 5000))
        _max_pages_raw = params_dict.get("max_pages")
        max_pages = int(_max_pages_raw) if _max_pages_raw is not None else None
        api_key = params_dict["api_key"]
        enrich_official = bool(params_dict.get("enrich_official", False))
        official_limit = int(params_dict.get("official_limit", 20))
        source_name = str(params_dict.get("source_name", "consulta_filtros"))

        client = DataJudClient(api_key)
        processes, pages_fetched = client.search_all(
            tribunal_alias,
            query_body,
            page_size=page_size,
            max_records=max_records,
            max_pages=max_pages,
        )

        msg = f"📡 DataJud: {len(processes)} processo(s) em {pages_fetched} página(s)."
        update_state(
            "running",
            0.2,
            msg + (" Enriquecendo com fonte oficial..." if enrich_official else ""),
        )

        official_result = None
        if enrich_official and processes:
            query_rows = [
                {
                    "source_row": {"numero_processo": p.get("numeroProcesso")},
                    "linha_origem": i,
                    "numero_processo": p.get("numeroProcesso"),
                    "tribunal_alias": tribunal_alias,
                    "tribunal_alias_informado": tribunal_alias,
                }
                for i, p in enumerate(processes[:official_limit], start=1)
            ]

            def on_progress_main(current: int, total: int, message: str) -> None:
                pct = current / total if total > 0 else 0.0
                progress = 0.2 + 0.8 * pct
                update_state("running", progress, f"⚖️ {message} ({current}/{total})")

            official_result = enrich_from_official_sources(
                query_rows,
                on_progress=on_progress_main,
            )

        result = {
            "job_type": "datajud_main",
            "processes": processes,
            "official_result_data": official_result,
            "source_name": source_name,
            "tribunal_alias": tribunal_alias,
            "result_state_key": "filters_result",
        }
        (job_dir / "result.pkl").write_bytes(pickle.dumps(result))

        official_msg = (
            f" + {len(official_result.process_rows)} enriquecido(s)"
            if official_result
            else ""
        )
        update_state(
            "done",
            1.0,
            f"✅ {len(processes)} processo(s) encontrado(s){official_msg}.",
        )

    except Exception as exc:
        import traceback  # noqa: PLC0415

        update_state("error", 0.0, f"Erro: {exc}", error=traceback.format_exc())
        sys.exit(1)


# ---------------------------------------------------------------------------
# Runner: datajud_batch (fetch_processes_by_numbers + enriquecimento opcional)
# ---------------------------------------------------------------------------

def run_datajud_batch(job_id: str, params_dict: dict) -> None:
    """Executa busca por lote de processos (planilha/manual) em background."""
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    started_at = datetime.now().isoformat()
    pid = os.getpid()

    meta = {
        "job_type": "datajud_batch",
        "result_state_key": "spreadsheet_result",
    }
    (job_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    def update_state(
        status: str,
        progress: float,
        message: str,
        error: str | None = None,
    ) -> None:
        _write_state(job_dir, status, progress, message, started_at, pid, error)

    update_state("running", 0.0, "📡 Iniciando consulta por lote...")

    try:
        from datajud_app.client import DataJudClient  # noqa: PLC0415
        from datajud_app.official_sources import enrich_from_official_sources  # noqa: PLC0415

        api_key = params_dict["api_key"]
        enrich_official = bool(params_dict.get("enrich_official", False))
        source_name = str(params_dict.get("source_name", "consulta_lote"))

        # query_rows foram salvos em pickle pelo app.py antes de spawnar o worker
        query_rows_file = job_dir / "query_rows.pkl"
        query_rows: list[dict] = pickle.loads(query_rows_file.read_bytes())

        valid_query_rows = [row for row in query_rows if row.get("numero_processo")]

        # Agrupa por tribunal
        grouped: dict[str, list] = {}
        for row in valid_query_rows:
            alias = row.get("tribunal_alias")
            if alias:
                grouped.setdefault(alias, []).append(row)

        client = DataJudClient(api_key)
        results_by_key: dict[tuple[str, str], dict] = {}

        total_groups = max(len(grouped), 1)
        for group_idx, (tribunal_alias, rows) in enumerate(grouped.items()):
            numbers = [row["numero_processo"] for row in rows]
            update_state(
                "running",
                0.05 + 0.15 * (group_idx / total_groups),
                f"📡 Consultando {tribunal_alias} ({len(numbers)} processo(s))...",
            )
            tribunal_results = client.fetch_processes_by_numbers(tribunal_alias, numbers)
            for process_number, source in tribunal_results.items():
                results_by_key[(tribunal_alias, process_number)] = source

        found = len(results_by_key)
        update_state(
            "running",
            0.2,
            f"📡 {found} processo(s) encontrado(s)."
            + (" Enriquecendo com fonte oficial..." if enrich_official else ""),
        )

        official_result = None
        if enrich_official and valid_query_rows:
            def on_progress_batch(current: int, total: int, message: str) -> None:
                pct = current / total if total > 0 else 0.0
                progress = 0.2 + 0.8 * pct
                update_state("running", progress, f"⚖️ {message} ({current}/{total})")

            official_result = enrich_from_official_sources(
                valid_query_rows,
                on_progress=on_progress_batch,
            )

        result = {
            "job_type": "datajud_batch",
            "query_rows": query_rows,
            "results_by_key": results_by_key,
            "official_result_data": official_result,
            "enrich_official": enrich_official,
            "source_name": source_name,
            "result_state_key": "spreadsheet_result",
        }
        (job_dir / "result.pkl").write_bytes(pickle.dumps(result))

        official_msg = (
            f" + {len(official_result.process_rows)} enriquecido(s)"
            if official_result
            else ""
        )
        update_state(
            "done",
            1.0,
            f"✅ {found} processo(s) encontrado(s){official_msg}.",
        )

    except Exception as exc:
        import traceback  # noqa: PLC0415

        update_state("error", 0.0, f"Erro: {exc}", error=traceback.format_exc())
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(
            "Uso: python datajud_app/worker.py <job_id> <search_type> <params_json>",
            file=sys.stderr,
        )
        sys.exit(1)

    _job_id = sys.argv[1]
    _search_type = sys.argv[2]
    _params_json = sys.argv[3]

    _params = json.loads(_params_json)

    if _search_type == "trf1_public":
        run_trf1_public(_job_id, _params)
    elif _search_type == "datajud_main":
        run_datajud_main(_job_id, _params)
    elif _search_type == "datajud_batch":
        run_datajud_batch(_job_id, _params)
    else:
        print(f"Tipo de busca desconhecido: {_search_type}", file=sys.stderr)
        sys.exit(1)
