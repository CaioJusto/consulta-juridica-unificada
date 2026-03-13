/**
 * Pipeline de Extração em Massa — DataJud → TRF1 Processual → TRF1 Público
 *
 * Passo 1: Coleta paginada de TODOS os processos do DataJud (search_after)
 * Passo 2: Enriquecimento em lote no TRF1 Processual (partes, advogados, situação)
 * Passo 3: Enriquecimento em lote TRF1 Público/PJe (valor da causa, situação PJe)
 *
 * Filosofia: máximo de dados de CADA fonte, exibidos independentemente.
 * Exportação parcial em CSV disponível a qualquer momento.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  ArrowRightLeft,
  Hash,
  Eye,
  X,
} from "lucide-react";
import type {
  TribunalOption,
  DataJudProcesso,
  DataJudMovimento,
  Processo,
  Parte,
  Movimentacao,
  TRF1PublicProcess,
  TRF1PublicParty,
  TRF1PublicMovement,
} from "@shared/schema";

// ─── Tribunal Fallback ────────────────────────────────────────

const TRIBUNAIS_FALLBACK: TribunalOption[] = [
  { label: "Superior Tribunal de Justiça", alias: "api_publica_stj" },
  { label: "TRF da 1ª Região", alias: "api_publica_trf1" },
  { label: "TRF da 2ª Região", alias: "api_publica_trf2" },
  { label: "TRF da 3ª Região", alias: "api_publica_trf3" },
  { label: "TRF da 4ª Região", alias: "api_publica_trf4" },
  { label: "TRF da 5ª Região", alias: "api_publica_trf5" },
  { label: "TRF da 6ª Região", alias: "api_publica_trf6" },
  { label: "TJ do Acre", alias: "api_publica_tjac" },
  { label: "TJ de Alagoas", alias: "api_publica_tjal" },
  { label: "TJ do Amazonas", alias: "api_publica_tjam" },
  { label: "TJ do Amapá", alias: "api_publica_tjap" },
  { label: "TJ da Bahia", alias: "api_publica_tjba" },
  { label: "TJ do Ceará", alias: "api_publica_tjce" },
  { label: "TJ do DF e Territórios", alias: "api_publica_tjdft" },
  { label: "TJ do Espírito Santo", alias: "api_publica_tjes" },
  { label: "TJ de Goiás", alias: "api_publica_tjgo" },
  { label: "TJ do Maranhão", alias: "api_publica_tjma" },
  { label: "TJ de Minas Gerais", alias: "api_publica_tjmg" },
  { label: "TJ de Mato Grosso do Sul", alias: "api_publica_tjms" },
  { label: "TJ de Mato Grosso", alias: "api_publica_tjmt" },
  { label: "TJ do Pará", alias: "api_publica_tjpa" },
  { label: "TJ da Paraíba", alias: "api_publica_tjpb" },
  { label: "TJ de Pernambuco", alias: "api_publica_tjpe" },
  { label: "TJ do Piauí", alias: "api_publica_tjpi" },
  { label: "TJ do Paraná", alias: "api_publica_tjpr" },
  { label: "TJ do Rio de Janeiro", alias: "api_publica_tjrj" },
  { label: "TJ do Rio Grande do Norte", alias: "api_publica_tjrn" },
  { label: "TJ de Rondônia", alias: "api_publica_tjro" },
  { label: "TJ de Roraima", alias: "api_publica_tjrr" },
  { label: "TJ do Rio Grande do Sul", alias: "api_publica_tjrs" },
  { label: "TJ de Santa Catarina", alias: "api_publica_tjsc" },
  { label: "TJ de Sergipe", alias: "api_publica_tjse" },
  { label: "TJ de São Paulo", alias: "api_publica_tjsp" },
  { label: "TJ de Tocantins", alias: "api_publica_tjto" },
  { label: "TST", alias: "api_publica_tst" },
  { label: "TSE", alias: "api_publica_tse" },
  { label: "STM", alias: "api_publica_stm" },
];

// ─── SGT types ────────────────────────────────────────────────

interface SgtOption {
  codigo: string;
  nome: string;
}

// ─── helpers ─────────────────────────────────────────────────

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

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
  const rate = done / elapsed;
  const remaining = total - done;
  const seconds = rate > 0 ? remaining / rate : remaining * secondsPerItem;
  if (seconds < 60) return `~${Math.ceil(seconds)}s`;
  const minutes = Math.ceil(seconds / 60);
  return `~${minutes} min`;
}

/** Fetch with AbortController timeout (ms). Returns Response. */
async function fetchWithTimeout(url: string, timeoutMs = 45000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${url}`, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
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
  // ── DataJud ──────────────────────────────────────────────
  numero_processo: string;
  classe: string;
  orgao_julgador: string;
  data_ajuizamento: string;
  ultima_atualizacao: string;
  grau: string;
  assuntos: string;
  ultima_mov_data: string;
  ultima_mov_nome: string;
  primeira_movimentacao: string;
  qtd_movimentos: number;
  tribunal: string;
  datajud_movimentos: DataJudMovimento[]; // raw for detail panel
  // ── TRF1 Processual ──────────────────────────────────────
  processual_status: EnrichStatus;
  polo_ativo_nome: string;
  polo_ativo_cpf: string;
  polo_passivo_nome: string;
  polo_passivo_cnpj: string;
  partes: string;        // CSV-friendly: top 5 partes
  advogados: string;     // CSV-friendly: top 4 advogados
  qtd_partes: number;
  qtd_advogados: number;
  situacao_processual: string;
  processual_partes: Parte[];            // full for detail panel
  processual_movimentacoes: Movimentacao[]; // full for detail panel
  // ── TRF1 Público ─────────────────────────────────────────
  publico_status: EnrichStatus;
  valor_causa: string;
  situacao_publico: string;
  orgao_julgador_pje: string;
  data_distribuicao_pje: string;
  ultima_mov_publico: string;
  publico_partes: TRF1PublicParty[];       // full for detail panel
  publico_movimentacoes: TRF1PublicMovement[]; // full for detail panel
}

interface PipelineConfig {
  tribunal: string;
  numero: string;
  classeCodigo: string;
  classeNome: string;
  assuntosCodigos: SgtOption[]; // multi-select up to 5
  assuntosExcluir: SgtOption[]; // multi-select
  orgaoJulgadorCodigo: string;
  orgaoJulgadorNome: string;
  grau: string;
  dataInicio: string;
  dataFim: string;
  dataAtualizacaoInicio: string;
  dataAtualizacaoFim: string;
  movimentoCodigo: string;
  movimentoNome: string;
  minMovimentos: string;
  maxMovimentos: string;
  nivelSigilo: string;
  temAssuntos: string; // "any" | "yes" | "no"
  temMovimentos: string; // "any" | "yes" | "no"
  sortField: string;
  sortOrder: string;
  limit: string;
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
  datajudGrandTotal: number;
}

// ─── row factory ─────────────────────────────────────────────

function makeRow(p: DataJudProcesso, tribunal: string): PipelineRow {
  const sorted = [...p.movimentos].sort((a, b) =>
    (b.data_hora || "").localeCompare(a.data_hora || "")
  );
  const last = sorted[0];
  const first = sorted[sorted.length - 1];
  return {
    id: p.numero_processo,
    numero_processo: p.numero_processo,
    classe: p.classe,
    orgao_julgador: p.orgao_julgador,
    data_ajuizamento: formatDate(p.data_ajuizamento),
    ultima_atualizacao: formatDate(p.ultima_atualizacao),
    grau: p.grau,
    assuntos: p.assuntos?.map((a) => a.nome).join("; ") ?? "",
    ultima_mov_data: last ? formatDate(last.data_hora) : "",
    ultima_mov_nome: last ? last.nome : "",
    primeira_movimentacao: first ? `${formatDate(first.data_hora)}: ${first.nome}` : "",
    qtd_movimentos: p.movimentos.length,
    tribunal,
    datajud_movimentos: sorted,
    // TRF1 Processual
    processual_status: "pending",
    polo_ativo_nome: "",
    polo_ativo_cpf: "",
    polo_passivo_nome: "",
    polo_passivo_cnpj: "",
    partes: "",
    advogados: "",
    qtd_partes: 0,
    qtd_advogados: 0,
    situacao_processual: "",
    processual_partes: [],
    processual_movimentacoes: [],
    // TRF1 Público
    publico_status: "pending",
    valor_causa: "",
    situacao_publico: "",
    orgao_julgador_pje: "",
    data_distribuicao_pje: "",
    ultima_mov_publico: "",
    publico_partes: [],
    publico_movimentacoes: [],
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
  const [tribunais, setTribunais] = useState<TribunalOption[]>(TRIBUNAIS_FALLBACK);
  const [showFilters, setShowFilters] = useState(false);
  const [config, setConfig] = useState<PipelineConfig>({
    tribunal: "api_publica_trf1",
    numero: "",
    classeCodigo: "",
    classeNome: "",
    assuntosCodigos: [],
    assuntosExcluir: [],
    orgaoJulgadorCodigo: "",
    orgaoJulgadorNome: "",
    grau: "",
    dataInicio: "",
    dataFim: "",
    dataAtualizacaoInicio: "",
    dataAtualizacaoFim: "",
    movimentoCodigo: "",
    movimentoNome: "",
    minMovimentos: "",
    maxMovimentos: "",
    nivelSigilo: "",
    temAssuntos: "any",
    temMovimentos: "any",
    sortField: "dataHoraUltimaAtualizacao",
    sortOrder: "desc",
    limit: "1000",
    enrichProcessual: true,
    enrichPublico: false,
    batchSize: 8,
  });

  // SGT autocomplete states for pipeline
  const [classeQuery, setClasseQuery] = useState("");
  const [classeResults, setClasseResults] = useState<SgtOption[]>([]);
  const [classeLoading, setClasseLoading] = useState(false);
  const [assuntoQuery, setAssuntoQuery] = useState("");
  const [assuntoResults, setAssuntoResults] = useState<SgtOption[]>([]);
  const [assuntoLoading, setAssuntoLoading] = useState(false);
  const [assuntoExcluirQuery, setAssuntoExcluirQuery] = useState("");
  const [assuntoExcluirResults, setAssuntoExcluirResults] = useState<SgtOption[]>([]);
  const [assuntoExcluirLoading, setAssuntoExcluirLoading] = useState(false);
  const [movimentoQuery, setMovimentoQuery] = useState("");
  const [movimentoResults, setMovimentoResults] = useState<SgtOption[]>([]);
  const [movimentoLoading, setMovimentoLoading] = useState(false);
  const [orgaoQuery, setOrgaoQuery] = useState("");
  const [orgaoResults, setOrgaoResults] = useState<SgtOption[]>([]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [pipelineState, setPipelineState] = useState<PipelineState>(INITIAL_PIPELINE);
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState<PipelineRow | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: resume polling if there's an active job in localStorage
  useEffect(() => {
    const savedJobId = localStorage.getItem("activeJobId");
    if (savedJobId) {
      setJobId(savedJobId);
    }
  }, []);

  // Poll server for job status
  useEffect(() => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    const poll = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/pipeline/status/${jobId}`);
        const j = await r.json();
        if (!j.success) {
          // Job not found (server restart?) — clear
          localStorage.removeItem("activeJobId");
          setJobId(null);
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        const data = j.data;
        const progress = data.progress;

        // Map server status to phase
        const statusMap: Record<string, Phase> = {
          running: progress.stage === "collecting" ? "collecting"
            : progress.enriched_processual > 0 && progress.enriched_publico === 0 ? "enriching_processual"
            : progress.enriched_publico > 0 ? "enriching_publico"
            : "collecting",
          paused: "paused",
          stopped: "aborted",
          done: "done",
          error: "idle",
        };
        setPhase(statusMap[data.status] || "idle");

        // Update progress bars
        const collected = progress.collected || 0;
        const total = progress.total_datajud || 0;
        const enrichedP = progress.enriched_processual || 0;
        const enrichedPub = progress.enriched_publico || 0;

        setPipelineState({
          datajudGrandTotal: total,
          stage1: {
            status: data.status === "done" ? "done" : data.status === "running" ? "running" : "done",
            current: collected,
            total: total,
            startedAt: 0,
          },
          stage2: {
            status: !config.enrichProcessual ? "skipped"
              : data.status === "done" ? (enrichedP > 0 ? "done" : "skipped")
              : enrichedP > 0 ? "running"
              : progress.stage === "enriching" ? "running"
              : collected > 0 && progress.stage === "collecting" ? "waiting"
              : "waiting",
            current: enrichedP,
            total: collected,
            startedAt: 0,
          },
          stage3: {
            status: !config.enrichPublico ? "skipped"
              : data.status === "done" ? (enrichedPub > 0 ? "done" : "skipped")
              : enrichedPub > 0 ? "running"
              : "waiting",
            current: enrichedPub,
            total: collected,
            startedAt: 0,
          },
        });

        setRowCount(data.row_count || 0);

        // Show preview rows (last 20 from server)
        if (data.preview_rows && data.preview_rows.length > 0) {
          // Convert server row format to PipelineRow for display
          const serverRows: PipelineRow[] = data.preview_rows.map((r: Record<string, unknown>, i: number) => ({
            id: `${jobId}-${i}`,
            numero_processo: String(r.numero_processo || ""),
            tribunal: String(r.tribunal || ""),
            classe: String(r.classe || ""),
            orgao_julgador: String(r.orgao_julgador || ""),
            grau: String(r.grau || ""),
            data_ajuizamento: String(r.data_ajuizamento || ""),
            ultima_atualizacao: String(r.ultima_atualizacao || ""),
            assuntos: String(r.assuntos || ""),
            qtd_movimentos: Number(r.qtd_movimentos || 0),
            primeira_movimentacao: "",
            ultima_mov_data: "",
            ultima_mov_nome: String(r.ultima_movimentacao || ""),
            polo_ativo_nome: String(r.polo_ativo_nome || ""),
            polo_ativo_cpf: String(r.polo_ativo_cpf || ""),
            polo_passivo_nome: String(r.polo_passivo_nome || ""),
            polo_passivo_cnpj: String(r.polo_passivo_cnpj || ""),
            partes: "",
            advogados: String(r.advogados || ""),
            qtd_partes: 0,
            qtd_advogados: 0,
            situacao_processual: String(r.situacao_processual || ""),
            valor_causa: String(r.valor_causa || ""),
            situacao_publico: String(r.situacao_pje || ""),
            orgao_julgador_pje: String(r.orgao_julgador_pje || ""),
            data_distribuicao_pje: "",
            ultima_mov_publico: "",
            processual_status: r.polo_ativo_nome ? "found" : "skipped",
            publico_status: r.valor_causa ? "found" : "skipped",
            datajud_movimentos: [],
            processual_partes: [],
            processual_movimentacoes: [],
            publico_partes: [],
            publico_movimentacoes: [],
          }));
          setRows(serverRows);
        }

        if (data.error) setError(data.error);

        // Stop polling when terminal state reached
        if (["done", "stopped", "error"].includes(data.status)) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === "done" || data.status === "stopped") {
            localStorage.removeItem("activeJobId");
          }
        }
      } catch {
        // Network error — keep polling
      }
    };

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId]);

  // SGT debounced searches
  useEffect(() => {
    if (classeQuery.length < 2) { setClasseResults([]); return; }
    setClasseLoading(true);
    const t = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/api/datajud/sgt?kind=classe&q=${encodeURIComponent(classeQuery)}`); const j = await r.json(); if (j.success) setClasseResults(j.data || []); } catch {}
      setClasseLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [classeQuery]);

  useEffect(() => {
    if (assuntoQuery.length < 2) { setAssuntoResults([]); return; }
    setAssuntoLoading(true);
    const t = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/api/datajud/sgt?kind=assunto&q=${encodeURIComponent(assuntoQuery)}`); const j = await r.json(); if (j.success) setAssuntoResults(j.data || []); } catch {}
      setAssuntoLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [assuntoQuery]);

  useEffect(() => {
    if (assuntoExcluirQuery.length < 2) { setAssuntoExcluirResults([]); return; }
    setAssuntoExcluirLoading(true);
    const t = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/api/datajud/sgt?kind=assunto&q=${encodeURIComponent(assuntoExcluirQuery)}`); const j = await r.json(); if (j.success) setAssuntoExcluirResults(j.data || []); } catch {}
      setAssuntoExcluirLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [assuntoExcluirQuery]);

  useEffect(() => {
    if (movimentoQuery.length < 2) { setMovimentoResults([]); return; }
    setMovimentoLoading(true);
    const t = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/api/datajud/sgt?kind=movimento&q=${encodeURIComponent(movimentoQuery)}`); const j = await r.json(); if (j.success) setMovimentoResults(j.data || []); } catch {}
      setMovimentoLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [movimentoQuery]);

  useEffect(() => {
    if (orgaoQuery.length < 2) { setOrgaoResults([]); return; }
    const t = setTimeout(async () => {
      try { const r = await fetch(`${API_BASE}/api/datajud/orgaos?tribunal=${config.tribunal}&q=${encodeURIComponent(orgaoQuery)}`); const j = await r.json(); if (j.success) setOrgaoResults(j.data || []); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [orgaoQuery, config.tribunal]);

  useEffect(() => {
    fetch(`${API_BASE}/api/datajud/tribunais`)
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

  // ─── pipeline execution (server-side) ─────────────────────────

  const runPipeline = async () => {
    setError("");
    setRows([]);
    setSelectedRow(null);
    setPhase("collecting");
    setPipelineState(INITIAL_PIPELINE);
    setRowCount(0);

    // Build payload for backend
    const payload: Record<string, unknown> = {
      tribunal_alias: config.tribunal,
      limit: config.limit,
      sort_field: config.sortField || "dataHoraUltimaAtualizacao",
      sort_order: config.sortOrder || "desc",
      enrich_processual: config.enrichProcessual,
      enrich_publico: config.enrichPublico,
      batch_size: config.batchSize,
    };
    if (config.numero.trim()) payload.numero_processo = config.numero.trim();
    if (config.classeCodigo.trim()) payload.classe_codigo = parseInt(config.classeCodigo.trim());
    if (config.assuntosCodigos.length > 0) payload.assuntos_codigos = config.assuntosCodigos.map(a => parseInt(a.codigo));
    if (config.assuntosExcluir.length > 0) payload.assuntos_excluir_codigos = config.assuntosExcluir.map(a => parseInt(a.codigo));
    if (config.orgaoJulgadorCodigo.trim()) payload.orgao_julgador_codigo = parseInt(config.orgaoJulgadorCodigo.trim());
    if (config.grau && config.grau !== "all" && config.grau !== "__all__") payload.grau = config.grau;
    if (config.dataInicio) payload.data_ajuizamento_inicio = config.dataInicio;
    if (config.dataFim) payload.data_ajuizamento_fim = config.dataFim;
    if (config.dataAtualizacaoInicio) payload.data_atualizacao_inicio = config.dataAtualizacaoInicio;
    if (config.dataAtualizacaoFim) payload.data_atualizacao_fim = config.dataAtualizacaoFim;
    if (config.movimentoCodigo.trim()) payload.movimento_codigo = parseInt(config.movimentoCodigo.trim());
    if (config.minMovimentos) payload.min_movimentos = parseInt(config.minMovimentos);
    if (config.maxMovimentos) payload.max_movimentos = parseInt(config.maxMovimentos);
    if (config.nivelSigilo !== "" && config.nivelSigilo !== "__all__") payload.nivel_sigilo = parseInt(config.nivelSigilo);
    if (config.temAssuntos === "yes") payload.tem_assuntos = true;
    else if (config.temAssuntos === "no") payload.tem_assuntos = false;
    if (config.temMovimentos === "yes") payload.tem_movimentos = true;
    else if (config.temMovimentos === "no") payload.tem_movimentos = false;

    try {
      const res = await fetch(`${API_BASE}/api/pipeline/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        setError(json.error || "Erro ao iniciar pipeline.");
        setPhase("idle");
        return;
      }
      const newJobId: string = json.job_id;
      localStorage.setItem("activeJobId", newJobId);
      setJobId(newJobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro de conexão.";
      setError(`Erro ao iniciar pipeline: ${msg}`);
      setPhase("idle");
    }
  };

  async function pausePipeline() {
    if (!jobId) return;
    const action = phase === "paused" ? "resume" : "pause";
    await fetch(`${API_BASE}/api/pipeline/control/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  }

  async function stopPipeline() {
    if (!jobId) return;
    await fetch(`${API_BASE}/api/pipeline/control/${jobId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    });
  }

  function resetPipeline() {
    if (pollRef.current) clearInterval(pollRef.current);
    localStorage.removeItem("activeJobId");
    setJobId(null);
    setRows([]);
    setPhase("idle");
    setError("");
    setPipelineState(INITIAL_PIPELINE);
    setSelectedRow(null);
    setRowCount(0);
  }

  // ─── CSV export (server-side) ─────────────────────────────

  async function exportCSV(_currentRows: PipelineRow[]) {
    if (!jobId) return;
    try {
      const res = await fetch(`${API_BASE}/api/pipeline/export/${jobId}`);
      if (!res.ok) { setError("Sem dados para exportar."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pipeline_${new Date().toISOString().slice(0, 10)}_${rowCount}processos.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Erro ao exportar CSV.");
    }
  }
  // ─── count active pipeline filters ───────────────────────

  function countPipelineFilters(): number {
    let count = 0;
    if (config.classeCodigo) count++;
    if (config.assuntosCodigos.length > 0) count++;
    if (config.assuntosExcluir.length > 0) count++;
    if (config.orgaoJulgadorCodigo) count++;
    if (config.grau && config.grau !== "all" && config.grau !== "__all__") count++;
    if (config.dataInicio || config.dataFim) count++;
    if (config.dataAtualizacaoInicio || config.dataAtualizacaoFim) count++;
    if (config.movimentoCodigo) count++;
    if (config.minMovimentos || config.maxMovimentos) count++;
    if (config.nivelSigilo !== "" && config.nivelSigilo !== "__all__") count++;
    if (config.temAssuntos !== "any") count++;
    if (config.temMovimentos !== "any") count++;
    if (config.sortField !== "dataHoraUltimaAtualizacao" || config.sortOrder !== "desc") count++;
    return count;
  }

  // ─── derived state ────────────────────────────────────────

  const isRunning = ["collecting", "enriching_processual", "enriching_publico"].includes(phase);
  const isPaused = phase === "paused";
  const hasResults = rowCount > 0 || rows.length > 0;
  const isDone = phase === "done" || phase === "aborted";

  const enrichedProcessualCount = pipelineState.stage2.current || 0;
  const enrichedPublicoCount = pipelineState.stage3.current || 0;

  const previewRows = rows;

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
      {/* ── Config Card ──────────────────────────────────── */}
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
          Dados completos de cada fonte exibidos independentemente.
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

        {/* Limit + batch */}
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
                <SelectItem value="20">20 (muito rápido)</SelectItem>
                <SelectItem value="30">30 (máximo)</SelectItem>
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
          Filtros avançados
          {countPipelineFilters() > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">{countPipelineFilters()}</Badge>
          )}
        </button>

        <div className={showFilters ? "space-y-5 pl-3 border-l-2 border-primary/20" : "hidden"}>
            {/* Classe + Assunto + Movimentação */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Classe · Assunto · Movimentação
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Classe */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Classe Judicial</Label>
                  {config.classeCodigo ? (
                    <div className="flex items-center gap-2 h-8 px-2 bg-muted/50 rounded-md">
                      <span className="text-xs truncate flex-1">{config.classeNome} ({config.classeCodigo})</span>
                      <button type="button" onClick={() => { upd("classeCodigo", ""); upd("classeNome", ""); setClasseQuery(""); }} className="text-muted-foreground hover:text-foreground" disabled={isRunning}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input value={classeQuery} onChange={(e) => setClasseQuery(e.target.value)} placeholder="Buscar classe..." className="h-8 text-xs" disabled={isRunning || isPaused} />
                      {classeLoading && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>}
                      {classeResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {classeResults.map((item) => (
                            <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { upd("classeCodigo", item.codigo); upd("classeNome", item.nome); setClasseQuery(""); setClasseResults([]); }}>
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Assunto multi-select */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Assunto (até 5)</Label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {config.assuntosCodigos.map((a, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                        {a.nome} ({a.codigo})
                        <button type="button" onClick={() => upd("assuntosCodigos", config.assuntosCodigos.filter((_, j) => j !== i))} disabled={isRunning}>
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {config.assuntosCodigos.length < 5 && (
                    <div className="relative">
                      <Input value={assuntoQuery} onChange={(e) => setAssuntoQuery(e.target.value)} placeholder="Buscar assunto..." className="h-8 text-xs" disabled={isRunning || isPaused} />
                      {assuntoLoading && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>}
                      {assuntoResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {assuntoResults.map((item) => (
                            <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { if (!config.assuntosCodigos.find(a => a.codigo === item.codigo) && config.assuntosCodigos.length < 5) upd("assuntosCodigos", [...config.assuntosCodigos, item]); setAssuntoQuery(""); setAssuntoResults([]); }}>
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Movimentação */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Movimentação</Label>
                  {config.movimentoCodigo ? (
                    <div className="flex items-center gap-2 h-8 px-2 bg-muted/50 rounded-md">
                      <span className="text-xs truncate flex-1">{config.movimentoNome} ({config.movimentoCodigo})</span>
                      <button type="button" onClick={() => { upd("movimentoCodigo", ""); upd("movimentoNome", ""); setMovimentoQuery(""); }} className="text-muted-foreground hover:text-foreground" disabled={isRunning}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input value={movimentoQuery} onChange={(e) => setMovimentoQuery(e.target.value)} placeholder="Buscar movimentação..." className="h-8 text-xs" disabled={isRunning || isPaused} />
                      {movimentoLoading && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>}
                      {movimentoResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {movimentoResults.map((item) => (
                            <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { upd("movimentoCodigo", item.codigo); upd("movimentoNome", item.nome); setMovimentoQuery(""); setMovimentoResults([]); }}>
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Assuntos a excluir */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Assuntos a Excluir</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {config.assuntosExcluir.map((a, i) => (
                  <Badge key={i} variant="destructive" className="text-[10px] gap-1">
                    {a.nome} ({a.codigo})
                    <button type="button" onClick={() => upd("assuntosExcluir", config.assuntosExcluir.filter((_, j) => j !== i))} disabled={isRunning}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="relative max-w-xs">
                <Input value={assuntoExcluirQuery} onChange={(e) => setAssuntoExcluirQuery(e.target.value)} placeholder="Buscar assunto para excluir..." className="h-8 text-xs" disabled={isRunning || isPaused} />
                {assuntoExcluirLoading && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>}
                {assuntoExcluirResults.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {assuntoExcluirResults.map((item) => (
                      <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                        onClick={() => { if (!config.assuntosExcluir.find(a => a.codigo === item.codigo)) upd("assuntosExcluir", [...config.assuntosExcluir, item]); setAssuntoExcluirQuery(""); setAssuntoExcluirResults([]); }}>
                        <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Órgão Julgador + Grau */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> Órgão Julgador · Grau
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Órgão Julgador</Label>
                  {config.orgaoJulgadorCodigo ? (
                    <div className="flex items-center gap-2 h-8 px-2 bg-muted/50 rounded-md">
                      <span className="text-xs truncate flex-1">{config.orgaoJulgadorNome} ({config.orgaoJulgadorCodigo})</span>
                      <button type="button" onClick={() => { upd("orgaoJulgadorCodigo", ""); upd("orgaoJulgadorNome", ""); setOrgaoQuery(""); }} className="text-muted-foreground hover:text-foreground" disabled={isRunning}>
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input value={orgaoQuery} onChange={(e) => setOrgaoQuery(e.target.value)} placeholder="Buscar órgão julgador..." className="h-8 text-xs" disabled={isRunning || isPaused} />
                      {orgaoResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {orgaoResults.map((item) => (
                            <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { upd("orgaoJulgadorCodigo", item.codigo); upd("orgaoJulgadorNome", item.nome); setOrgaoQuery(""); setOrgaoResults([]); }}>
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Grau</Label>
                  <Select value={config.grau} onValueChange={(v) => upd("grau", v)} disabled={isRunning || isPaused}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Todos" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="G1">1º Grau</SelectItem>
                      <SelectItem value="G2">2º Grau</SelectItem>
                      <SelectItem value="TR">Turma Recursal</SelectItem>
                      <SelectItem value="JE">Juizado Especial</SelectItem>
                      <SelectItem value="SUP">Superior</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Datas */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Datas
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Ajuizamento (de)</Label>
                  <Input type="date" value={config.dataInicio} onChange={(e) => upd("dataInicio", e.target.value)} className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Ajuizamento (até)</Label>
                  <Input type="date" value={config.dataFim} onChange={(e) => upd("dataFim", e.target.value)} className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Atualização (de)</Label>
                  <Input type="date" value={config.dataAtualizacaoInicio} onChange={(e) => upd("dataAtualizacaoInicio", e.target.value)} className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Atualização (até)</Label>
                  <Input type="date" value={config.dataAtualizacaoFim} onChange={(e) => upd("dataAtualizacaoFim", e.target.value)} className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
              </div>
            </div>

            {/* Presença + Quantidade + Sigilo */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Info className="w-3 h-3" /> Presença · Quantidade · Sigilo
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Tem Assuntos?</Label>
                  <Select value={config.temAssuntos} onValueChange={(v) => upd("temAssuntos", v)} disabled={isRunning || isPaused}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Tanto faz</SelectItem>
                      <SelectItem value="yes">Sim</SelectItem>
                      <SelectItem value="no">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Tem Movimentos?</Label>
                  <Select value={config.temMovimentos} onValueChange={(v) => upd("temMovimentos", v)} disabled={isRunning || isPaused}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Tanto faz</SelectItem>
                      <SelectItem value="yes">Sim</SelectItem>
                      <SelectItem value="no">Não</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Mín. Movimentos</Label>
                  <Input type="number" min="0" value={config.minMovimentos} onChange={(e) => upd("minMovimentos", e.target.value)} placeholder="0" className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Máx. Movimentos</Label>
                  <Input type="number" min="0" value={config.maxMovimentos} onChange={(e) => upd("maxMovimentos", e.target.value)} placeholder="∞" className="h-8 text-xs" disabled={isRunning || isPaused} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Nível de Sigilo</Label>
                  <Select value={config.nivelSigilo} onValueChange={(v) => upd("nivelSigilo", v)} disabled={isRunning || isPaused}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Qualquer" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Qualquer</SelectItem>
                      <SelectItem value="0">Público (0)</SelectItem>
                      <SelectItem value="1">Segredo de Justiça (1)</SelectItem>
                      <SelectItem value="2">Nível 2</SelectItem>
                      <SelectItem value="5">Mínimo (5)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Ordenação</Label>
                  <Select value={config.sortField} onValueChange={(v) => upd("sortField", v)} disabled={isRunning || isPaused}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dataHoraUltimaAtualizacao">Última atualização</SelectItem>
                      <SelectItem value="dataAjuizamento">Data ajuizamento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Direção</Label>
                  <div className="flex gap-3 h-8 items-center">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="pipelineSortOrder" value="desc" checked={config.sortOrder === "desc"} onChange={() => upd("sortOrder", "desc")} disabled={isRunning || isPaused} className="w-3 h-3" />
                      Mais recente
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="pipelineSortOrder" value="asc" checked={config.sortOrder === "asc"} onChange={() => upd("sortOrder", "asc")} disabled={isRunning || isPaused} className="w-3 h-3" />
                      Mais antigo
                    </label>
                  </div>
                </div>
              </div>
            </div>
        </div>

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
              <span className="text-muted-foreground">partes · advogados · movimentações</span>
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
              <span className="text-muted-foreground">valor da causa · situação PJe · movimentações</span>
            </Label>
          </div>
        </div>

        {/* Warnings */}
        {config.enrichProcessual && config.batchSize > 5 && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-md">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              Atenção: lotes maiores que 5 podem sobrecarregar o servidor ao usar TRF1 Processual (Playwright).
            </span>
          </div>
        )}

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
              onClick={() => exportCSV(rows)}
              className="h-9 px-4 gap-2"
              data-testid="button-pipeline-export"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV ({rowCount || rows.length})
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
              value={rowCount || rows.length}
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
                  ? `Pipeline concluído — ${rowCount || rows.length} processos processados`
                  : `Interrompido — ${rowCount || rows.length} processos coletados`}
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
              Prévia — últimos {previewRows.length} de {rowCount || rows.length} processos
              {pipelineState.datajudGrandTotal > (rowCount || rows.length) && (
                <span className="ml-1 text-muted-foreground/60">
                  ({pipelineState.datajudGrandTotal.toLocaleString("pt-BR")} total no índice)
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground hidden sm:block">
                Clique em uma linha para ver detalhes completos
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => exportCSV(rows)}
                className="h-7 text-xs gap-1.5"
              >
                <Download className="w-3 h-3" />
                CSV ({rowCount || rows.length})
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" /></span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Processo</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Building2 className="w-3 h-3" /> Órgão</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Classe</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Ajuiz.</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Grau</th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1"><ArrowRightLeft className="w-3 h-3" /> Movs.</span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Última Mov.</th>
                  {config.enrichProcessual && (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3 text-emerald-500" /> Polo Ativo</span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Polo Passivo</th>
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
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Órgão PJe</th>
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
                    onSelect={() => setSelectedRow(row)}
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

      {/* ── Row Detail Dialog ────────────────────────────── */}
      <RowDetailDialog
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
        showProcessual={config.enrichProcessual}
        showPublico={config.enrichPublico}
      />
    </div>
  );
}

// ─── Row Detail Dialog ────────────────────────────────────────

function RowDetailDialog({
  row,
  onClose,
  showProcessual,
  showPublico,
}: {
  row: PipelineRow | null;
  onClose: () => void;
  showProcessual: boolean;
  showPublico: boolean;
}) {
  if (!row) return null;

  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-mono">
            <Hash className="w-4 h-4 text-primary" />
            {formatCNJ(row.numero_processo)}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="datajud" className="mt-2">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1 rounded-lg">
            <TabsTrigger value="datajud" className="text-xs gap-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white">
              <Database className="w-3 h-3" /> DataJud
              <span className="opacity-60 ml-1">{row.qtd_movimentos}</span>
            </TabsTrigger>
            {showProcessual && (
              <TabsTrigger value="processual" className="text-xs gap-1 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
                <Gavel className="w-3 h-3" /> TRF1 Processual
                <span className="opacity-60 ml-1">{row.processual_status}</span>
              </TabsTrigger>
            )}
            {showPublico && (
              <TabsTrigger value="publico" className="text-xs gap-1 data-[state=active]:bg-violet-600 data-[state=active]:text-white">
                <Globe className="w-3 h-3" /> TRF1 Público / PJe
                <span className="opacity-60 ml-1">{row.publico_status}</span>
              </TabsTrigger>
            )}
          </TabsList>

          {/* DataJud tab */}
          <TabsContent value="datajud" className="space-y-4 mt-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                DataJud · CNJ
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4">
              <DInfoRow label="Classe" value={row.classe} />
              <DInfoRow label="Grau" value={row.grau} />
              <DInfoRow label="Órgão Julgador" value={row.orgao_julgador} />
              <DInfoRow label="Tribunal" value={row.tribunal} />
              <DInfoRow label="Ajuizamento" value={row.data_ajuizamento} />
              <DInfoRow label="Última Atualiz." value={row.ultima_atualizacao} />
            </div>
            {row.assuntos && (
              <div className="text-xs">
                <span className="text-muted-foreground font-medium">Assuntos: </span>
                <span>{row.assuntos}</span>
              </div>
            )}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">
                  Movimentações DataJud ({row.datajud_movimentos.length})
                </span>
              </div>
              {row.datajud_movimentos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma movimentação</p>
              ) : (
                <div className="space-y-0.5 max-h-60 overflow-y-auto border border-border rounded-md">
                  {row.datajud_movimentos.map((m, i) => (
                    <div key={i} className="flex gap-3 px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20">
                      <span className="w-20 flex-shrink-0 text-[10px] text-muted-foreground font-mono">
                        {formatDate(m.data_hora)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] text-muted-foreground mr-1.5">[{m.codigo}]</span>
                        <span className="text-xs">{m.nome}</span>
                        {m.complementos && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{m.complementos}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* TRF1 Processual tab */}
          {showProcessual && (
            <TabsContent value="processual" className="space-y-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <Gavel className="w-3.5 h-3.5 text-emerald-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  TRF1 Processual
                </span>
                <EnrichBadge status={row.processual_status} />
              </div>

              {row.processual_status === "found" ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4">
                    <DInfoRow label="Situação" value={row.situacao_processual} />
                    <DInfoRow label="Qtd. Partes" value={String(row.qtd_partes)} />
                    <DInfoRow label="Polo Ativo" value={row.polo_ativo_nome} />
                    <DInfoRow label="Polo Passivo" value={row.polo_passivo_nome} />
                  </div>

                  {/* Partes */}
                  {row.processual_partes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">
                          Partes ({row.processual_partes.length})
                        </span>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto border border-border rounded-md">
                        {row.processual_partes.map((p, i) => (
                          <div key={i} className="flex gap-2 items-start px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {p.tipo && <Badge variant="outline" className="text-[9px]">{p.tipo}</Badge>}
                                {p.caracteristica && <Badge variant="secondary" className="text-[9px]">{p.caracteristica}</Badge>}
                              </div>
                              <p className="text-xs font-medium mt-0.5">{p.nome}</p>
                              {p.entidade && <p className="text-[10px] text-muted-foreground">{p.entidade}</p>}
                              {p.oab && <p className="text-[10px] text-primary">OAB: {p.oab}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Movimentações */}
                  {row.processual_movimentacoes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">
                          Movimentações TRF1 ({row.processual_movimentacoes.length})
                        </span>
                      </div>
                      <div className="space-y-0.5 max-h-60 overflow-y-auto border border-border rounded-md">
                        {row.processual_movimentacoes.map((m, i) => (
                          <div key={i} className="flex gap-3 px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20">
                            <span className="w-20 flex-shrink-0 text-[10px] text-muted-foreground font-mono">{m.data}</span>
                            <div className="flex-1 min-w-0">
                              {m.codigo && <span className="text-[10px] text-muted-foreground mr-1.5">[{m.codigo}]</span>}
                              <span className="text-xs">{m.descricao}</span>
                              {m.complemento && <p className="text-[10px] text-muted-foreground mt-0.5">{m.complemento}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Gavel className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-xs">
                    {row.processual_status === "not_found"
                      ? "Processo não encontrado no TRF1 Processual"
                      : row.processual_status === "error"
                      ? "Erro ao consultar TRF1 Processual"
                      : row.processual_status === "loading"
                      ? "Consultando..."
                      : "Enriquecimento pendente"}
                  </p>
                </div>
              )}
            </TabsContent>
          )}

          {/* TRF1 Público tab */}
          {showPublico && (
            <TabsContent value="publico" className="space-y-4 mt-4">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="w-3.5 h-3.5 text-violet-500" />
                <span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  TRF1 Público · PJe
                </span>
                <EnrichBadge status={row.publico_status} />
              </div>

              {row.publico_status === "found" ? (
                <>
                  <div className="grid grid-cols-2 gap-x-4">
                    <DInfoRow label="Valor da Causa" value={row.valor_causa} />
                    <DInfoRow label="Situação PJe" value={row.situacao_publico} />
                    <DInfoRow label="Órgão Julgador" value={row.orgao_julgador_pje} />
                    <DInfoRow label="Distribuição" value={row.data_distribuicao_pje} />
                  </div>

                  {/* Partes PJe */}
                  {row.publico_partes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Users className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">
                          Partes PJe ({row.publico_partes.length})
                        </span>
                      </div>
                      <div className="space-y-0.5 max-h-48 overflow-y-auto border border-border rounded-md">
                        {row.publico_partes.map((p, i) => (
                          <div key={i} className="flex gap-2 items-start px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {p.polo && <Badge variant="outline" className="text-[9px]">{p.polo}</Badge>}
                                {p.tipo_participacao && <Badge variant="secondary" className="text-[9px]">{p.tipo_participacao}</Badge>}
                              </div>
                              <p className="text-xs font-medium mt-0.5">{p.nome}</p>
                              {p.documentos && <p className="text-[10px] text-muted-foreground">Doc: {p.documentos}</p>}
                              {p.advogados && <p className="text-[10px] text-primary">Adv: {p.advogados}</p>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Movimentações PJe */}
                  {row.publico_movimentacoes.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <ArrowRightLeft className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs font-medium">
                          Movimentações PJe ({row.publico_movimentacoes.length})
                        </span>
                      </div>
                      <div className="space-y-0.5 max-h-60 overflow-y-auto border border-border rounded-md">
                        {row.publico_movimentacoes.map((m, i) => (
                          <div key={i} className="flex gap-3 px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/20">
                            <span className="w-20 flex-shrink-0 text-[10px] text-muted-foreground font-mono">{m.data}</span>
                            <div className="flex-1 min-w-0">
                              {m.tipo && <span className="text-[10px] text-primary mr-1.5">[{m.tipo}]</span>}
                              <span className="text-xs">{m.descricao}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Globe className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p className="text-xs">
                    {row.publico_status === "not_found"
                      ? "Processo não encontrado na consulta pública PJe"
                      : row.publico_status === "error"
                      ? "Erro ao consultar TRF1 Público"
                      : row.publico_status === "loading"
                      ? "Consultando..."
                      : "Enriquecimento pendente"}
                  </p>
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function EnrichBadge({ status }: { status: EnrichStatus }) {
  if (status === "found")
    return <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600">encontrado</Badge>;
  if (status === "not_found")
    return <Badge variant="outline" className="text-[9px] text-muted-foreground">não encontrado</Badge>;
  if (status === "error")
    return <Badge variant="destructive" className="text-[9px]">erro</Badge>;
  if (status === "loading")
    return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  return null;
}

function DInfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="py-1.5 border-b border-border/30 last:border-0">
      <span className="text-[10px] text-muted-foreground block">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}

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
  onSelect,
}: {
  row: PipelineRow;
  showProcessual: boolean;
  showPublico: boolean;
  onSelect: () => void;
}) {
  const isLoading =
    row.processual_status === "loading" || row.publico_status === "loading";

  return (
    <tr
      className={`hover:bg-primary/5 cursor-pointer transition-colors ${isLoading ? "animate-pulse" : ""}`}
      onClick={onSelect}
    >
      <td className="px-3 py-2.5 text-muted-foreground/50">
        <Eye className="w-3 h-3" />
      </td>
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
      <td className="px-3 py-2.5 whitespace-nowrap text-center text-muted-foreground text-[11px]">
        {row.qtd_movimentos > 0 ? row.qtd_movimentos : "—"}
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
            <EnrichCell status={row.processual_status} value={row.polo_ativo_nome} />
          </td>
          <td className="px-3 py-2.5 max-w-[160px]">
            <EnrichCell status={row.processual_status} value={row.polo_passivo_nome} />
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
          <td className="px-3 py-2.5 max-w-[120px]">
            <EnrichCell status={row.publico_status} value={row.orgao_julgador_pje} />
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
