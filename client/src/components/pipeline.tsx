/**
 * Pipeline de Extração em Massa — DataJud → TRF1 Processual → TRF1 Público
 *
 * Passo 1: Coleta paginada de TODOS os processos do DataJud (search_after)
 * Passo 2: Enriquecimento em lote no TRF1 Processual (partes, advogados, situação)
 * Passo 3: Enriquecimento em lote TRF1 Público/PJe (valor da causa, situação PJe)
 *
 * Exportação parcial em CSV disponível a qualquer momento.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Pause,
  Square,
  Download,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  Database,
  Gavel,
  Globe,
  Filter,
  ChevronDown,
  ChevronRight,
  Zap,
  Users,
  DollarSign,
  Calendar,
  FileText,
  Building2,
  Info,
  BarChart3,
  Timer,
} from "lucide-react";
import type { TribunalOption, DataJudProcesso, Processo, TRF1PublicProcess } from "@shared/schema";

// ─── helpers ─────────────────────────────────────────────────

function formatCNJ(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 20) {
    return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`;
  }
  return raw;
}

function formatDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("pt-BR");
  } catch {
    return raw;
  }
}

function estimateTimeRemaining(
  done: number,
  total: number,
  startedAt: number,
  secondsPerItem = 1.5
): string {
  if (done === 0 || total === 0) return "—";
  const elapsed = (Date.now() - startedAt) / 1000;
  const rate = done / elapsed; // items/sec
  const remaining = total - done;
  const seconds = rate > 0 ? remaining / rate : remaining * secondsPerItem;
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} min`;
}

// Concurrency-limited batch runner
async function runBatched<T>(
  items: T[],
  batchSize: number,
  fn: (item: T, idx: number) => Promise<void>,
  shouldAbort: () => boolean
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    if (shouldAbort()) break;
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map((item, j) => fn(item, i + j)));
  }
}

// ─── types ───────────────────────────────────────────────────

type EnrichStatus = "pending" | "loading" | "found" | "not_found" | "error" | "skipped";
type Phase =
  | "idle"
  | "collecting"
  | "paused"
  | "enriching_processual"
  | "enriching_publico"
  | "done"
  | "aborted";

interface PipelineRow {
  id: string;
  // DataJud
  numero_processo: string;
  classe: string;
  orgao_julgador: string;
  data_ajuizamento: string;
  grau: string;
  assuntos: string;
  ultima_mov_data: string;
  ultima_mov_nome: string;
  tribunal: string;
  // TRF1 Processual
  processual_status: EnrichStatus;
  partes: string;
  advogados: string;
  situacao_processual: string;
  // TRF1 Público
  publico_status: EnrichStatus;
  valor_causa: string;
  situacao_publico: string;
  ultima_mov_publico: string;
}

interface PipelineConfig {
  tribunal: string;
  numero: string;
  classeCodigo: string;
  assuntoCodigo: string;
  grau: string;
  dataInicio: string;
  dataFim: string;
  movimentoCodigo: string;
  limit: string; // number string or "all"
  enrichProcessual: boolean;
  enrichPublico: boolean;
  batchSize: number;
}

interface StageState {
  status: "waiting" | "running" | "done" | "skipped";
  current: number;
  total: number;
  startedAt: number | null;
}

interface PipelineState {
  stage1: StageState;
  stage2: StageState;
  stage3: StageState;
  datajudGrandTotal: number; // Total matching in DataJud index
}

// ─── row factory ─────────────────────────────────────────────

function makeRow(p: DataJudProcesso, tribunal: string): PipelineRow {
  const sorted = [...p.movimentos].sort((a, b) =>
    (b.data_hora || "").localeCompare(a.data_hora || "")
  );
  const last = sorted[0];
  return {
    id: p.numero_processo,
    numero_processo: p.numero_processo,
    classe: p.classe,
    orgao_julgador: p.orgao_julgador,
    data_ajuizamento: formatDate(p.data_ajuizamento),
    grau: p.grau,
    assuntos: p.assuntos?.map((a) => a.nome).join("; ") ?? "",
    ultima_mov_data: last ? formatDate(last.data_hora) : "",
    ultima_mov_nome: last ? last.nome : "",
    tribunal,
    processual_status: "pending",
    partes: "",
    advogados: "",
    situacao_processual: "",
    publico_status: "pending",
    valor_causa: "",
    situacao_publico: "",
    ultima_mov_publico: "",
  };
}

function makeStage(status: StageState["status"] = "waiting"): StageState {
  return { status, current: 0, total: 0, startedAt: null };
}

const INITIAL_PIPELINE: PipelineState = {
  stage1: makeStage(),
  stage2: makeStage(),
  stage3: makeStage(),
  datajudGrandTotal: 0,
};

// ─── main component ──────────────────────────────────────────

export function PipelineTab() {
  const [tribunais, setTribunais] = useState<TribunalOption[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [config, setConfig] = useState<PipelineConfig>({
    tribunal: "api_publica_trf1",
    numero: "",
    classeCodigo: "",
    assuntoCodigo: "",
    grau: "",
    dataInicio: "",
    dataFim: "",
    movimentoCodigo: "",
    limit: "1000",
    enrichProcessual: true,
    enrichPublico: false,
    batchSize: 8,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [pipelineState, setPipelineState] = useState<PipelineState>(INITIAL_PIPELINE);
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [error, setError] = useState("");

  // Refs for async control
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const rowsRef = useRef<PipelineRow[]>([]); // always in-sync with rows state

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    apiRequest("GET", "/api/datajud/tribunais")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setTribunais(json.data);
      })
      .catch(() => {});
  }, []);

  function upd<K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }

  function updateStage(
    stage: "stage1" | "stage2" | "stage3",
    patch: Partial<StageState>
  ) {
    setPipelineState((prev) => ({
      ...prev,
      [stage]: { ...prev[stage], ...patch },
    }));
  }

  // ─── pipeline execution ──────────────────────────────────────

  const runPipeline = useCallback(async () => {
    abortRef.current = false;
    pauseRef.current = false;
    setError("");
    setRows([]);
    rowsRef.current = [];
    setPhase("collecting");

    const limitNum = config.limit === "all" ? Infinity : parseInt(config.limit) || 1000;
    const pageSize = Math.min(limitNum === Infinity ? 200 : Math.min(limitNum, 200), 200);

    // Reset pipeline state
    setPipelineState({
      stage1: { status: "running", current: 0, total: 0, startedAt: Date.now() },
      stage2: makeStage(),
      stage3: makeStage(),
      datajudGrandTotal: 0,
    });

    // Build base search body
    const baseBody: Record<string, unknown> = {
      tribunal_alias: config.tribunal,
      page_size: pageSize,
      sort_field: "dataAjuizamento",
      sort_order: "desc",
    };
    if (config.numero.trim()) baseBody.numero_processo = config.numero.trim();
    if (config.classeCodigo.trim()) baseBody.classe_codigo = parseInt(config.classeCodigo.trim());
    if (config.assuntoCodigo.trim()) baseBody.assunto_codigo = parseInt(config.assuntoCodigo.trim());
    if (config.grau && config.grau !== "all") baseBody.grau = config.grau;
    if (config.dataInicio) baseBody.data_ajuizamento_inicio = config.dataInicio;
    if (config.dataFim) baseBody.data_ajuizamento_fim = config.dataFim;
    if (config.movimentoCodigo.trim()) baseBody.movimento_codigo = parseInt(config.movimentoCodigo.trim());

    // ── STAGE 1: DataJud paginado ─────────────────────────────

    let searchAfter: unknown[] | null = null;
    let totalCollected = 0;
    let grandTotal = 0;
    let firstPage = true;
    const collectedRows: PipelineRow[] = [];

    try {
      while (true) {
        if (abortRef.current) break;

        // Check pause — wait until unpaused
        if (pauseRef.current) {
          setPhase("paused");
          await new Promise<void>((resolve) => {
            const check = setInterval(() => {
              if (!pauseRef.current || abortRef.current) {
                clearInterval(check);
                resolve();
              }
            }, 300);
          });
          if (abortRef.current) break;
          setPhase("collecting");
        }

        const body: Record<string, unknown> = { ...baseBody };
        if (searchAfter) body.search_after = searchAfter;

        const res = await apiRequest("POST", "/api/datajud/buscar", body);
        const json = await res.json();

        if (!json.success || !json.data) {
          setError(json.error || "Erro ao buscar no DataJud.");
          setPhase("idle");
          return;
        }

        const { processos, total, search_after: nextSA } = json.data as {
          processos: DataJudProcesso[];
          total: number;
          search_after: unknown[] | null;
        };

        if (firstPage) {
          grandTotal = total;
          firstPage = false;
          setPipelineState((prev) => ({
            ...prev,
            datajudGrandTotal: total,
            stage1: { ...prev.stage1, total: Math.min(total, limitNum === Infinity ? total : limitNum) },
          }));
        }

        if (!processos || processos.length === 0) break;

        const newRows = processos.map((p) => makeRow(p, config.tribunal));
        collectedRows.push(...newRows);
        totalCollected += newRows.length;

        // Append to state immediately (streaming)
        setRows((prev) => [...prev, ...newRows]);
        rowsRef.current = [...rowsRef.current, ...newRows];

        updateStage("stage1", { current: totalCollected });

        // Check limit
        if (totalCollected >= limitNum) break;

        // No more pages
        if (!nextSA || processos.length < pageSize) break;

        searchAfter = nextSA as unknown[];
      }

      if (abortRef.current) {
        setPhase("aborted");
        updateStage("stage1", { status: "done" });
        return;
      }

      updateStage("stage1", { status: "done", current: totalCollected, total: totalCollected });

      if (totalCollected === 0) {
        setError("Nenhum processo encontrado no DataJud com esses filtros.");
        setPhase("idle");
        return;
      }

      // ── STAGE 2: TRF1 Processual enrichment ───────────────

      if (config.enrichProcessual) {
        setPhase("enriching_processual");
        const startedAt = Date.now();
        updateStage("stage2", {
          status: "running",
          total: collectedRows.length,
          current: 0,
          startedAt,
        });

        // Mark all as loading initially in batches
        let enrichedCount = 0;

        await runBatched(
          collectedRows,
          config.batchSize,
          async (row, globalIdx) => {
            if (abortRef.current) return;

            // Mark as loading
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, processual_status: "loading" } : r
              )
            );

            const updates: Partial<PipelineRow> = {};
            try {
              const digits = row.numero_processo.replace(/\D/g, "");
              const r = await apiRequest(
                "GET",
                `/api/processo?numero=${encodeURIComponent(digits)}&secao=TRF1`
              );
              const pj = await r.json();

              if (pj.success && pj.data) {
                const proc: Processo = pj.data;
                const partesNomes = proc.partes
                  .filter((p) => !p.oab)
                  .map((p) => p.nome)
                  .filter(Boolean)
                  .slice(0, 5)
                  .join("; ");
                const advNomes = proc.partes
                  .filter((p) => !!p.oab)
                  .map((p) => (p.oab ? `${p.nome} (OAB: ${p.oab})` : p.nome))
                  .filter(Boolean)
                  .slice(0, 4)
                  .join("; ");
                updates.processual_status = "found";
                updates.partes = partesNomes;
                updates.advogados = advNomes;
                updates.situacao_processual = proc.situacao || "";
              } else {
                updates.processual_status = "not_found";
              }
            } catch {
              updates.processual_status = "error";
            }

            // Update row in state
            collectedRows[globalIdx] = { ...collectedRows[globalIdx], ...updates };
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, ...updates } : r
              )
            );

            enrichedCount++;
            updateStage("stage2", { current: enrichedCount });
          },
          () => abortRef.current
        );

        updateStage("stage2", {
          status: abortRef.current ? "done" : "done",
          current: enrichedCount,
        });

        if (abortRef.current) {
          setPhase("aborted");
          return;
        }
      } else {
        updateStage("stage2", { status: "skipped" });
        // Mark all as skipped
        setRows((prev) => prev.map((r) => ({ ...r, processual_status: "skipped" })));
      }

      // ── STAGE 3: TRF1 Público enrichment ──────────────────

      if (config.enrichPublico) {
        setPhase("enriching_publico");
        const startedAt = Date.now();
        updateStage("stage3", {
          status: "running",
          total: collectedRows.length,
          current: 0,
          startedAt,
        });

        let enrichedCount3 = 0;
        const batchSize3 = Math.max(1, Math.floor(config.batchSize / 2)); // slower, half batch

        await runBatched(
          collectedRows,
          batchSize3,
          async (row, globalIdx) => {
            if (abortRef.current) return;

            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, publico_status: "loading" } : r
              )
            );

            const updates: Partial<PipelineRow> = {};
            try {
              const formatted = formatCNJ(row.numero_processo);
              const r = await apiRequest(
                "GET",
                `/api/trf1publico/buscar?numero=${encodeURIComponent(formatted)}`
              );
              const pj = await r.json();

              if (pj.success && pj.data?.processos?.length > 0) {
                const pub: TRF1PublicProcess = pj.data.processos[0];
                const lastMov = pub.movimentacoes?.[0];
                updates.publico_status = "found";
                updates.valor_causa = pub.valor_causa || "";
                updates.situacao_publico = pub.situacao || "";
                updates.ultima_mov_publico = lastMov
                  ? `${lastMov.data}: ${lastMov.descricao}`
                  : "";
                // If processual was skipped, get parties from public
                if (!config.enrichProcessual) {
                  const partesAtivos = pub.partes.filter(
                    (p) => p.polo && p.polo.toUpperCase() !== "ADV"
                  );
                  const advs = pub.partes.filter(
                    (p) => p.polo?.toUpperCase() === "ADV" || !!p.advogados
                  );
                  updates.partes = partesAtivos
                    .map((p) => p.nome)
                    .filter(Boolean)
                    .slice(0, 5)
                    .join("; ");
                  updates.advogados = advs
                    .map((p) => p.advogados || p.nome)
                    .filter(Boolean)
                    .slice(0, 3)
                    .join("; ");
                }
              } else {
                updates.publico_status = "not_found";
              }
            } catch {
              updates.publico_status = "error";
            }

            collectedRows[globalIdx] = { ...collectedRows[globalIdx], ...updates };
            setRows((prev) =>
              prev.map((r) =>
                r.id === row.id ? { ...r, ...updates } : r
              )
            );

            enrichedCount3++;
            updateStage("stage3", { current: enrichedCount3 });
          },
          () => abortRef.current
        );

        updateStage("stage3", { status: "done", current: enrichedCount3 });

        if (abortRef.current) {
          setPhase("aborted");
          return;
        }
      } else {
        updateStage("stage3", { status: "skipped" });
        setRows((prev) => prev.map((r) => ({ ...r, publico_status: "skipped" })));
      }

      setPhase("done");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro de conexão.";
      setError(`Erro durante o pipeline: ${msg}`);
      setPhase("idle");
    }
  }, [config]);

  function pausePipeline() {
    pauseRef.current = !pauseRef.current;
  }

  function stopPipeline() {
    abortRef.current = true;
    pauseRef.current = false;
  }

  function resetPipeline() {
    abortRef.current = true;
    pauseRef.current = false;
    setRows([]);
    rowsRef.current = [];
    setPhase("idle");
    setError("");
    setPipelineState(INITIAL_PIPELINE);
  }

  // ─── CSV export ───────────────────────────────────────────

  function exportCSV(currentRows: PipelineRow[]) {
    if (currentRows.length === 0) return;

    const headers = [
      "numero_processo",
      "tribunal",
      "classe",
      "orgao_julgador",
      "data_ajuizamento",
      "grau",
      "assuntos",
      "ultima_mov_data_datajud",
      "ultima_mov_datajud",
      ...(config.enrichProcessual ? ["partes", "advogados", "situacao_processual"] : []),
      ...(config.enrichPublico ? ["valor_causa", "situacao_publico", "ultima_mov_publico"] : []),
      "enriquecimentos",
    ];

    const csvRows = currentRows.map((r) => {
      const enriq = ["DataJud"];
      if (r.processual_status === "found") enriq.push("TRF1 Processual");
      if (r.publico_status === "found") enriq.push("TRF1 Público");

      return [
        formatCNJ(r.numero_processo),
        r.tribunal,
        r.classe,
        r.orgao_julgador,
        r.data_ajuizamento,
        r.grau,
        r.assuntos,
        r.ultima_mov_data,
        r.ultima_mov_nome,
        ...(config.enrichProcessual ? [r.partes, r.advogados, r.situacao_processual] : []),
        ...(config.enrichPublico ? [r.valor_causa, r.situacao_publico, r.ultima_mov_publico] : []),
        enriq.join(" + "),
      ];
    });

    const csv = [
      headers.join(","),
      ...csvRows.map((row) =>
        row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline_${new Date().toISOString().slice(0, 10)}_${currentRows.length}processos.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── derived state ────────────────────────────────────────

  const isRunning = ["collecting", "enriching_processual", "enriching_publico"].includes(phase);
  const isPaused = phase === "paused";
  const hasResults = rows.length > 0;
  const isDone = phase === "done" || phase === "aborted";

  const enrichedProcessualCount = rows.filter((r) => r.processual_status === "found").length;
  const enrichedPublicoCount = rows.filter((r) => r.publico_status === "found").length;

  const previewRows = rows.slice(-20); // last 20 rows

  // Stage progress pcts
  const s1pct =
    pipelineState.stage1.total > 0
      ? Math.min(100, Math.round((pipelineState.stage1.current / pipelineState.stage1.total) * 100))
      : 0;
  const s2pct =
    pipelineState.stage2.total > 0
      ? Math.min(100, Math.round((pipelineState.stage2.current / pipelineState.stage2.total) * 100))
      : 0;
  const s3pct =
    pipelineState.stage3.total > 0
      ? Math.min(100, Math.round((pipelineState.stage3.current / pipelineState.stage3.total) * 100))
      : 0;

  // ─── render ───────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Config Card ─────────────────────────────────── */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Pipeline de Extração em Massa</h3>
          <Badge variant="secondary" className="text-[10px]">
            DataJud → TRF1 → PJe
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Coleta paginada de todos os processos do DataJud + enriquecimento em lote com partes, advogados, valor da causa.
        </p>

        {/* Main filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Tribunal</Label>
            <Select value={config.tribunal} onValueChange={(v) => upd("tribunal", v)} disabled={isRunning || isPaused}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tribunais.map((t) => (
                  <SelectItem key={t.alias} value={t.alias}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Número do Processo (opcional)</Label>
            <Input
              value={config.numero}
              onChange={(e) => upd("numero", e.target.value)}
              placeholder="Ex: 0003653-54.2020.4.01.3400"
              className="h-8 text-xs"
              disabled={isRunning || isPaused}
            />
          </div>
        </div>

        {/* Limit */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label className="text-xs text-muted-foreground">Limite de processos</Label>
            <Select value={config.limit} onValueChange={(v) => upd("limit", v)} disabled={isRunning || isPaused}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="500">500</SelectItem>
                <SelectItem value="1000">1.000</SelectItem>
                <SelectItem value="5000">5.000</SelectItem>
                <SelectItem value="10000">10.000</SelectItem>
                <SelectItem value="50000">50.000</SelectItem>
                <SelectItem value="all">Todos (sem limite)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 col-span-2 sm:col-span-1">
            <Label className="text-xs text-muted-foreground">Lote enriquecimento</Label>
            <Select
              value={String(config.batchSize)}
              onValueChange={(v) => upd("batchSize", parseInt(v))}
              disabled={isRunning || isPaused}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="3">3 (conservador)</SelectItem>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="8">8 (padrão)</SelectItem>
                <SelectItem value="10">10 (rápido)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Extra filters toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          disabled={isRunning || isPaused}
        >
          <Filter className="w-3.5 h-3.5" />
          {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Filtros adicionais (classe, assunto, grau, datas, movimentação)
        </button>

        {showFilters && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pl-3 border-l-2 border-primary/20">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Código da Classe</Label>
              <Input
                value={config.classeCodigo}
                onChange={(e) => upd("classeCodigo", e.target.value)}
                placeholder="Ex: 1116"
                className="h-7 text-xs"
                disabled={isRunning || isPaused}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Código do Assunto</Label>
              <Input
                value={config.assuntoCodigo}
                onChange={(e) => upd("assuntoCodigo", e.target.value)}
                placeholder="Ex: 10672"
                className="h-7 text-xs"
                disabled={isRunning || isPaused}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Grau</Label>
              <Select
                value={config.grau}
                onValueChange={(v) => upd("grau", v)}
                disabled={isRunning || isPaused}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="G1">1º Grau</SelectItem>
                  <SelectItem value="G2">2º Grau</SelectItem>
                  <SelectItem value="TR">Turma Recursal</SelectItem>
                  <SelectItem value="JE">Juizado Especial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Código Movimentação</Label>
              <Input
                value={config.movimentoCodigo}
                onChange={(e) => upd("movimentoCodigo", e.target.value)}
                placeholder="Ex: 22"
                className="h-7 text-xs"
                disabled={isRunning || isPaused}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Ajuizamento (de)</Label>
              <Input
                type="date"
                value={config.dataInicio}
                onChange={(e) => upd("dataInicio", e.target.value)}
                className="h-7 text-xs"
                disabled={isRunning || isPaused}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Ajuizamento (até)</Label>
              <Input
                type="date"
                value={config.dataFim}
                onChange={(e) => upd("dataFim", e.target.value)}
                className="h-7 text-xs"
                disabled={isRunning || isPaused}
              />
            </div>
          </div>
        )}

        {/* Enrichment toggles */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Switch
              id="enrich-processual"
              checked={config.enrichProcessual}
              onCheckedChange={(v) => upd("enrichProcessual", v)}
              disabled={isRunning || isPaused}
            />
            <Label htmlFor="enrich-processual" className="text-xs cursor-pointer">
              <span className="font-medium flex items-center gap-1">
                <Gavel className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                Etapa 2 — TRF1 Processual
              </span>
              <span className="text-muted-foreground">partes · advogados · situação</span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="enrich-publico"
              checked={config.enrichPublico}
              onCheckedChange={(v) => upd("enrichPublico", v)}
              disabled={isRunning || isPaused}
            />
            <Label htmlFor="enrich-publico" className="text-xs cursor-pointer">
              <span className="font-medium flex items-center gap-1">
                <Globe className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                Etapa 3 — TRF1 Público / PJe
              </span>
              <span className="text-muted-foreground">valor da causa · situação PJe</span>
            </Label>
          </div>
        </div>

        {config.enrichPublico && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-md">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              O enriquecimento TRF1 Público usa Playwright (5–15s/processo). Recomende-se ativar apenas com poucos processos ou muita paciência.
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          {!isRunning && !isPaused && (
            <Button onClick={runPipeline} className="h-9 px-5 gap-2" data-testid="button-pipeline-run">
              <Play className="w-3.5 h-3.5" />
              Iniciar Pipeline
            </Button>
          )}
          {(isRunning || isPaused) && (
            <>
              <Button
                variant="outline"
                onClick={pausePipeline}
                className="h-9 px-4 gap-2"
                data-testid="button-pipeline-pause"
              >
                {isPaused ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-emerald-500" />
                    Retomar
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    Pausar
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={stopPipeline}
                className="h-9 px-4 gap-2"
                data-testid="button-pipeline-stop"
              >
                <Square className="w-3 h-3" />
                Parar
              </Button>
            </>
          )}
          {hasResults && (
            <Button
              variant={isDone ? "default" : "outline"}
              onClick={() => exportCSV(rowsRef.current)}
              className="h-9 px-4 gap-2"
              data-testid="button-pipeline-export"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV parcial ({rows.length})
            </Button>
          )}
          {hasResults && !isRunning && !isPaused && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetPipeline}
              className="h-9 text-xs text-muted-foreground"
            >
              Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* ── 3-Stage Progress Card ───────────────────────── */}
      {(isRunning || isPaused || isDone || pipelineState.stage1.current > 0) && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Progresso do Pipeline</span>
              {isPaused && (
                <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 animate-pulse">
                  pausado
                </Badge>
              )}
            </div>
            {pipelineState.datajudGrandTotal > 0 && (
              <span className="text-xs text-muted-foreground">
                {pipelineState.datajudGrandTotal.toLocaleString("pt-BR")} registros no DataJud
              </span>
            )}
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBadge
              icon={<Database className="w-3.5 h-3.5 text-blue-500" />}
              label="Coletados"
              value={rows.length}
              color="blue"
            />
            <StatBadge
              icon={<Gavel className="w-3.5 h-3.5 text-emerald-500" />}
              label="Enriquecidos TRF1"
              value={enrichedProcessualCount}
              color="emerald"
            />
            <StatBadge
              icon={<Globe className="w-3.5 h-3.5 text-violet-500" />}
              label="Enriquecidos PJe"
              value={enrichedPublicoCount}
              color="violet"
            />
            <StatBadge
              icon={<Timer className="w-3.5 h-3.5 text-orange-400" />}
              label="Tempo restante"
              value={
                phase === "enriching_processual" && pipelineState.stage2.startedAt
                  ? estimateTimeRemaining(
                      pipelineState.stage2.current,
                      pipelineState.stage2.total,
                      pipelineState.stage2.startedAt
                    )
                  : phase === "enriching_publico" && pipelineState.stage3.startedAt
                  ? estimateTimeRemaining(
                      pipelineState.stage3.current,
                      pipelineState.stage3.total,
                      pipelineState.stage3.startedAt,
                      8
                    )
                  : isDone
                  ? "concluído"
                  : "—"
              }
              color="orange"
            />
          </div>

          {/* Stage cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StageCard
              num={1}
              label="DataJud"
              icon={<Database className="w-4 h-4" />}
              color="blue"
              state={pipelineState.stage1}
              pct={s1pct}
              description={
                phase === "collecting"
                  ? `Coletando: ${pipelineState.stage1.current.toLocaleString("pt-BR")} / ${
                      pipelineState.stage1.total > 0
                        ? pipelineState.stage1.total.toLocaleString("pt-BR")
                        : "?"
                    } processos`
                  : `${pipelineState.stage1.current.toLocaleString("pt-BR")} processos coletados`
              }
            />
            <StageCard
              num={2}
              label="TRF1 Processual"
              icon={<Gavel className="w-4 h-4" />}
              color="emerald"
              state={pipelineState.stage2}
              pct={s2pct}
              skipped={!config.enrichProcessual}
              description={
                pipelineState.stage2.status === "running"
                  ? `Enriquecendo: ${pipelineState.stage2.current} / ${pipelineState.stage2.total}`
                  : pipelineState.stage2.status === "done"
                  ? `${pipelineState.stage2.current} processos enriquecidos`
                  : !config.enrichProcessual
                  ? "desativado"
                  : "aguardando etapa 1"
              }
            />
            <StageCard
              num={3}
              label="TRF1 Público / PJe"
              icon={<Globe className="w-4 h-4" />}
              color="violet"
              state={pipelineState.stage3}
              pct={s3pct}
              skipped={!config.enrichPublico}
              description={
                pipelineState.stage3.status === "running"
                  ? `Enriquecendo: ${pipelineState.stage3.current} / ${pipelineState.stage3.total}`
                  : pipelineState.stage3.status === "done"
                  ? `${pipelineState.stage3.current} processos enriquecidos`
                  : !config.enrichPublico
                  ? "desativado"
                  : "aguardando etapa 2"
              }
            />
          </div>

          {isDone && (
            <div className="flex items-center gap-2 pt-1 text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                {phase === "done"
                  ? `Pipeline concluído — ${rows.length} processos processados`
                  : `Interrompido — ${rows.length} processos coletados`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Results Preview Table ────────────────────────── */}
      {hasResults && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Prévia — últimos {previewRows.length} de {rows.length} processos
              {pipelineState.datajudGrandTotal > rows.length && (
                <span className="ml-1 text-muted-foreground/60">
                  ({pipelineState.datajudGrandTotal.toLocaleString("pt-BR")} total no índice)
                </span>
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportCSV(rowsRef.current)}
              className="h-7 text-xs gap-1.5"
            >
              <Download className="w-3 h-3" />
              CSV ({rows.length})
            </Button>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Processo</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> Órgão</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Classe</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Ajuizamento</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Grau</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> Assuntos</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Última Mov.</th>
                  {config.enrichProcessual && (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3 text-emerald-500" /> Partes</span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Advogados</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1"><Info className="w-3 h-3 text-emerald-500" /> Situação</span>
                      </th>
                    </>
                  )}
                  {config.enrichPublico && (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1"><DollarSign className="w-3 h-3 text-violet-500" /> Valor</span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Situação PJe</th>
                    </>
                  )}
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {previewRows.map((row) => (
                  <ResultRow
                    key={row.id}
                    row={row}
                    showProcessual={config.enrichProcessual}
                    showPublico={config.enrichPublico}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isRunning && !isPaused && rows.length === 0 && phase === "idle" && !error && (
        <div className="text-center py-16 text-muted-foreground" data-testid="pipeline-empty">
          <Zap className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium">Pipeline de Extração em Massa</p>
          <p className="text-xs mt-1.5 opacity-70 max-w-md mx-auto">
            Configure os filtros, defina o limite de processos e as etapas de enriquecimento.
            O pipeline pagina automaticamente todos os resultados do DataJud.
          </p>
          <div className="flex items-center justify-center gap-4 mt-4 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1"><Database className="w-3.5 h-3.5" /> DataJud (paginado)</span>
            <span className="text-muted-foreground/30">→</span>
            <span className="flex items-center gap-1"><Gavel className="w-3.5 h-3.5" /> TRF1 Processual</span>
            <span className="text-muted-foreground/30">→</span>
            <span className="flex items-center gap-1"><Globe className="w-3.5 h-3.5" /> TRF1 Público</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function StatBadge({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  color: "blue" | "emerald" | "violet" | "orange";
}) {
  const colorMap = {
    blue: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800/40",
    emerald: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40",
    violet: "bg-violet-50 dark:bg-violet-950/30 border-violet-200 dark:border-violet-800/40",
    orange: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800/40",
  };
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${colorMap[color]}`}>
      {icon}
      <div>
        <div className="text-[10px] text-muted-foreground leading-tight">{label}</div>
        <div className="text-sm font-semibold leading-tight">
          {typeof value === "number" ? value.toLocaleString("pt-BR") : value}
        </div>
      </div>
    </div>
  );
}

function StageCard({
  num,
  label,
  icon,
  color,
  state,
  pct,
  description,
  skipped = false,
}: {
  num: number;
  label: string;
  icon: React.ReactNode;
  color: "blue" | "emerald" | "violet";
  state: StageState;
  pct: number;
  description: string;
  skipped?: boolean;
}) {
  const colorMap = {
    blue: {
      bg: "bg-blue-50 dark:bg-blue-950/20",
      border: "border-blue-200 dark:border-blue-800/40",
      bar: "bg-blue-500",
      icon: "text-blue-500",
      badge: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    },
    emerald: {
      bg: "bg-emerald-50 dark:bg-emerald-950/20",
      border: "border-emerald-200 dark:border-emerald-800/40",
      bar: "bg-emerald-500",
      icon: "text-emerald-500",
      badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    },
    violet: {
      bg: "bg-violet-50 dark:bg-violet-950/20",
      border: "border-violet-200 dark:border-violet-800/40",
      bar: "bg-violet-500",
      icon: "text-violet-500",
      badge: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    },
  };
  const c = colorMap[color];

  const statusIcon =
    skipped || state.status === "skipped" ? (
      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
        <span className="text-[8px] text-muted-foreground">—</span>
      </div>
    ) : state.status === "waiting" ? (
      <Clock className={`w-4 h-4 ${c.icon} opacity-40`} />
    ) : state.status === "running" ? (
      <Loader2 className={`w-4 h-4 ${c.icon} animate-spin`} />
    ) : (
      <CheckCircle2 className={`w-4 h-4 ${c.icon}`} />
    );

  return (
    <div
      className={`rounded-lg border p-3 space-y-2 ${c.bg} ${c.border} ${
        state.status === "waiting" || skipped ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {statusIcon}
          <span className={`text-xs font-medium ${c.icon}`}>Etapa {num}</span>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.badge}`}>
          {label}
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground leading-tight">{description}</div>
      {state.status === "running" && state.total > 0 && (
        <div className="space-y-1">
          <div className="w-full bg-background/60 rounded-full h-1.5">
            <div
              className={`${c.bar} h-1.5 rounded-full transition-all duration-500`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] text-muted-foreground text-right">{pct}%</div>
        </div>
      )}
      {state.status === "done" && state.total > 0 && (
        <div className="w-full bg-background/60 rounded-full h-1.5">
          <div className={`${c.bar} h-1.5 rounded-full w-full`} />
        </div>
      )}
    </div>
  );
}

function ResultRow({
  row,
  showProcessual,
  showPublico,
}: {
  row: PipelineRow;
  showProcessual: boolean;
  showPublico: boolean;
}) {
  const isLoading =
    row.processual_status === "loading" || row.publico_status === "loading";

  return (
    <tr className={`hover:bg-muted/20 transition-colors ${isLoading ? "animate-pulse" : ""}`}>
      <td className="px-3 py-2.5 font-mono whitespace-nowrap text-[11px]">
        {formatCNJ(row.numero_processo)}
      </td>
      <td className="px-3 py-2.5 max-w-[140px] text-muted-foreground">
        <span className="truncate block text-[11px]" title={row.orgao_julgador}>{row.orgao_julgador}</span>
      </td>
      <td className="px-3 py-2.5 max-w-[120px]">
        <span className="truncate block text-[11px]" title={row.classe}>{row.classe}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground text-[11px]">
        {row.data_ajuizamento}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {row.grau && <Badge variant="outline" className="text-[9px]">{row.grau}</Badge>}
      </td>
      <td className="px-3 py-2.5 max-w-[160px]">
        <span className="truncate block text-muted-foreground text-[11px]" title={row.assuntos}>
          {row.assuntos || <span className="opacity-30">—</span>}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-[140px]">
        <span className="truncate block text-[11px]" title={row.ultima_mov_nome}>
          {row.ultima_mov_nome || <span className="text-muted-foreground/30">—</span>}
        </span>
        {row.ultima_mov_data && (
          <span className="text-[10px] text-muted-foreground/70">{row.ultima_mov_data}</span>
        )}
      </td>
      {showProcessual && (
        <>
          <td className="px-3 py-2.5 max-w-[160px]">
            <EnrichCell status={row.processual_status} value={row.partes} />
          </td>
          <td className="px-3 py-2.5 max-w-[160px]">
            <EnrichCell status={row.processual_status} value={row.advogados} />
          </td>
          <td className="px-3 py-2.5 whitespace-nowrap">
            {row.processual_status === "found" && row.situacao_processual ? (
              <Badge variant="secondary" className="text-[9px]">{row.situacao_processual}</Badge>
            ) : (
              <EnrichCell status={row.processual_status} value="" />
            )}
          </td>
        </>
      )}
      {showPublico && (
        <>
          <td className="px-3 py-2.5 whitespace-nowrap">
            <EnrichCell status={row.publico_status} value={row.valor_causa} />
          </td>
          <td className="px-3 py-2.5 whitespace-nowrap">
            {row.publico_status === "found" && row.situacao_publico ? (
              <Badge variant="secondary" className="text-[9px]">{row.situacao_publico}</Badge>
            ) : (
              <EnrichCell status={row.publico_status} value="" />
            )}
          </td>
        </>
      )}
      <td className="px-3 py-2.5">
        <SourceBadges row={row} showProcessual={showProcessual} showPublico={showPublico} />
      </td>
    </tr>
  );
}

function EnrichCell({ status, value }: { status: EnrichStatus; value: string }) {
  if (status === "loading") return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  if (status === "pending") return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  if (status === "not_found") return <span className="text-muted-foreground/40 text-[10px]">não encontrado</span>;
  if (status === "error") return <span className="text-destructive/60 text-[10px]">erro</span>;
  if (status === "skipped") return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  if (!value) return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  return (
    <span className="truncate block max-w-[160px] text-[11px]" title={value}>
      {value}
    </span>
  );
}

function SourceBadges({
  row,
  showProcessual,
  showPublico,
}: {
  row: PipelineRow;
  showProcessual: boolean;
  showPublico: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-600 dark:text-blue-400" title="DataJud">
        DJ
      </Badge>
      {showProcessual && (
        <Badge
          variant="outline"
          className={`text-[9px] ${
            row.processual_status === "found"
              ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
              : row.processual_status === "loading"
              ? "border-primary/30 text-primary"
              : "border-border text-muted-foreground/40"
          }`}
          title="TRF1 Processual"
        >
          {row.processual_status === "loading" ? <Loader2 className="w-2 h-2 animate-spin" /> : "P1"}
        </Badge>
      )}
      {showPublico && (
        <Badge
          variant="outline"
          className={`text-[9px] ${
            row.publico_status === "found"
              ? "border-violet-500/30 text-violet-600 dark:text-violet-400"
              : row.publico_status === "loading"
              ? "border-primary/30 text-primary"
              : "border-border text-muted-foreground/40"
          }`}
          title="TRF1 Público (PJe)"
        >
          {row.publico_status === "loading" ? <Loader2 className="w-2 h-2 animate-spin" /> : "PJ"}
        </Badge>
      )}
    </div>
  );
}
