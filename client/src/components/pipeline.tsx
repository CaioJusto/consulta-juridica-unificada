/**
 * Pipeline de Automação — busca sequencial multi-fonte
 *
 * Passo 1: Busca no DataJud com filtros configuráveis
 * Passo 2: Para cada processo encontrado → enriquece no TRF1 Processual (partes, situação)
 * Passo 3: Para cada processo → enriquece na Consulta Pública TRF1/PJe (valor da causa, situação PJe)
 *
 * Resultado: tabela consolidada exportável em CSV com dados das 3 fontes.
 */

import { useState, useRef, useEffect } from "react";
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
  Square,
  Download,
  CheckCircle2,
  XCircle,
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
} from "lucide-react";
import type { TribunalOption, DataJudProcesso, Processo, TRF1PublicProcess } from "@shared/schema";

// ─── helpers ──────────────────────────────────────────────────

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

// ─── types ────────────────────────────────────────────────────

type EnrichStatus = "pending" | "loading" | "found" | "not_found" | "error" | "skipped";

interface PipelineRow {
  idx: number;
  // From DataJud
  numero_processo: string;
  classe: string;
  orgao_julgador: string;
  data_ajuizamento: string;
  grau: string;
  assuntos: string;
  ultima_mov_data: string;
  ultima_mov_nome: string;
  // From TRF1 Processual
  processual_status: EnrichStatus;
  partes: string;
  advogados: string;
  situacao_processual: string;
  // From TRF1 Público
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
  pageSize: number;
  enrichProcessual: boolean;
  enrichPublico: boolean;
}

type Phase = "idle" | "datajud" | "enriching" | "done" | "aborted";

// ─── row factory ─────────────────────────────────────────────

function makeInitialRow(p: DataJudProcesso, idx: number): PipelineRow {
  const sorted = [...p.movimentos].sort((a, b) =>
    (b.data_hora || "").localeCompare(a.data_hora || "")
  );
  const last = sorted[0];
  return {
    idx,
    numero_processo: p.numero_processo,
    classe: p.classe,
    orgao_julgador: p.orgao_julgador,
    data_ajuizamento: formatDate(p.data_ajuizamento),
    grau: p.grau,
    assuntos: p.assuntos.map((a) => a.nome).join("; "),
    ultima_mov_data: last ? formatDate(last.data_hora) : "",
    ultima_mov_nome: last ? last.nome : "",
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
    pageSize: 20,
    enrichProcessual: true,
    enrichPublico: false,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [rows, setRows] = useState<PipelineRow[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0, datajudTotal: 0 });
  const [pipelineError, setPipelineError] = useState("");
  const abortRef = useRef(false);

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

  // ─── pipeline execution ──────────────────────────────────

  async function runPipeline() {
    abortRef.current = false;
    setPipelineError("");
    setRows([]);
    setPhase("datajud");
    setProgress({ current: 0, total: 0, datajudTotal: 0 });

    // ── Step 1: DataJud search ───────────────────────────────
    try {
      const body: Record<string, unknown> = {
        tribunal_alias: config.tribunal,
        page_size: Math.min(Math.max(1, config.pageSize), 100),
      };
      if (config.numero.trim()) body.numero_processo = config.numero.trim();
      if (config.classeCodigo.trim()) body.classe_codigo = parseInt(config.classeCodigo.trim());
      if (config.assuntoCodigo.trim()) body.assunto_codigo = parseInt(config.assuntoCodigo.trim());
      if (config.grau && config.grau !== "all") body.grau = config.grau;
      if (config.dataInicio) body.data_ajuizamento_inicio = config.dataInicio;
      if (config.dataFim) body.data_ajuizamento_fim = config.dataFim;

      const res = await apiRequest("POST", "/api/datajud/buscar", body);
      const json = await res.json();

      if (!json.success || !json.data) {
        setPipelineError(json.error || "Erro ao buscar no DataJud");
        setPhase("idle");
        return;
      }

      const processos: DataJudProcesso[] = json.data.processos || [];
      if (processos.length === 0) {
        setPipelineError("Nenhum processo encontrado no DataJud com esses filtros.");
        setPhase("idle");
        return;
      }

      const initialRows = processos.map((p, i) => makeInitialRow(p, i));
      setRows(initialRows);
      setProgress({ current: 0, total: initialRows.length, datajudTotal: json.data.total });

      // No enrichment requested → done
      if (!config.enrichProcessual && !config.enrichPublico) {
        setPhase("done");
        return;
      }

      setPhase("enriching");

      // ── Step 2+3: Enrich each process sequentially ─────────
      for (let i = 0; i < initialRows.length; i++) {
        if (abortRef.current) break;

        const row = initialRows[i];
        setProgress((p) => ({ ...p, current: i + 1 }));

        // Mark row as actively loading
        setRows((prev) =>
          prev.map((r, idx) =>
            idx === i
              ? {
                  ...r,
                  processual_status: config.enrichProcessual ? "loading" : "skipped",
                  publico_status: config.enrichPublico ? "loading" : "skipped",
                }
              : r
          )
        );

        const updates: Partial<PipelineRow> = {};

        // ── TRF1 Processual ─────────────────────────────────
        if (config.enrichProcessual && !abortRef.current) {
          try {
            const digits = row.numero_processo.replace(/\D/g, "");
            const r = await apiRequest(
              "GET",
              `/api/processo?numero=${encodeURIComponent(digits)}&secao=TRF1`
            );
            const pj = await r.json();

            if (pj.success && pj.data) {
              const proc: Processo = pj.data;

              // Separate parties from lawyers
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
        } else if (!config.enrichProcessual) {
          updates.processual_status = "skipped";
        }

        // ── TRF1 Público ─────────────────────────────────────
        if (config.enrichPublico && !abortRef.current) {
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

              // If processual was skipped, pull parties from TRF1 Público
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
        } else if (!config.enrichPublico) {
          updates.publico_status = "skipped";
        }

        // Apply updates to row
        setRows((prev) =>
          prev.map((r, idx) => (idx === i ? { ...r, ...updates } : r))
        );
      }

      setPhase(abortRef.current ? "aborted" : "done");
    } catch {
      setPipelineError("Erro de conexão durante o pipeline.");
      setPhase("idle");
    }
  }

  function stopPipeline() {
    abortRef.current = true;
  }

  // ─── CSV export ──────────────────────────────────────────

  function exportCSV() {
    if (rows.length === 0) return;

    const headers = [
      "numero_processo",
      "classe",
      "orgao_julgador",
      "data_ajuizamento",
      "grau",
      "assuntos",
      "ultima_mov_data_datajud",
      "ultima_mov_datajud",
      ...(config.enrichProcessual ? ["partes", "advogados", "situacao_processual"] : []),
      ...(config.enrichPublico ? ["valor_causa", "situacao_publico", "ultima_mov_publico"] : []),
      "fonte",
    ];

    const csvRows = rows.map((r) => {
      const fontes = ["DataJud"];
      if (r.processual_status === "found") fontes.push("TRF1 Processual");
      if (r.publico_status === "found") fontes.push("TRF1 Público");

      return [
        formatCNJ(r.numero_processo),
        r.classe,
        r.orgao_julgador,
        r.data_ajuizamento,
        r.grau,
        r.assuntos,
        r.ultima_mov_data,
        r.ultima_mov_nome,
        ...(config.enrichProcessual ? [r.partes, r.advogados, r.situacao_processual] : []),
        ...(config.enrichPublico ? [r.valor_causa, r.situacao_publico, r.ultima_mov_publico] : []),
        fontes.join(" + "),
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
    a.download = `pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const running = phase === "datajud" || phase === "enriching";
  const hasResults = rows.length > 0;
  const progressPct =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  // ─── render ───────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Config card */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Pipeline de Automação</h3>
            <Badge variant="secondary" className="text-[10px]">
              DataJud → TRF1 Processual → TRF1 Público
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Busca processos no DataJud e enriquece sequencialmente cada resultado com partes,
            advogados, valor da causa e situação processual.
          </p>
        </div>

        {/* DataJud filter form */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Tribunal</Label>
              <Select
                value={config.tribunal}
                onValueChange={(v) => upd("tribunal", v)}
                disabled={running}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="pipeline-select-tribunal">
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
              <Label className="text-xs font-medium text-muted-foreground">Número do Processo</Label>
              <Input
                value={config.numero}
                onChange={(e) => upd("numero", e.target.value)}
                placeholder="Ex: 0003653-54.2020.4.01.3400"
                className="h-8 text-xs"
                disabled={running}
                data-testid="pipeline-input-numero"
              />
            </div>
          </div>

          {/* Extra filters toggle */}
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            disabled={running}
          >
            <Filter className="w-3.5 h-3.5" />
            {showFilters ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            Filtros adicionais
          </button>

          {showFilters && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pl-3 border-l-2 border-primary/20">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Código da Classe</Label>
                <Input
                  value={config.classeCodigo}
                  onChange={(e) => upd("classeCodigo", e.target.value)}
                  placeholder="Ex: 1116"
                  className="h-7 text-xs"
                  disabled={running}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Código do Assunto</Label>
                <Input
                  value={config.assuntoCodigo}
                  onChange={(e) => upd("assuntoCodigo", e.target.value)}
                  placeholder="Ex: 10672"
                  className="h-7 text-xs"
                  disabled={running}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Grau</Label>
                <Select
                  value={config.grau}
                  onValueChange={(v) => upd("grau", v)}
                  disabled={running}
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
                <Label className="text-[10px] text-muted-foreground">Qtd. Processos (máx 100)</Label>
                <Select
                  value={String(config.pageSize)}
                  onValueChange={(v) => upd("pageSize", parseInt(v))}
                  disabled={running}
                >
                  <SelectTrigger className="h-7 text-xs" data-testid="pipeline-select-pagesize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5</SelectItem>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                    <SelectItem value="100">100</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-[10px] text-muted-foreground">
                  Ajuizamento (de)
                </Label>
                <Input
                  type="date"
                  value={config.dataInicio}
                  onChange={(e) => upd("dataInicio", e.target.value)}
                  className="h-7 text-xs"
                  disabled={running}
                  data-testid="pipeline-input-data-inicio"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-[10px] text-muted-foreground">
                  Ajuizamento (até)
                </Label>
                <Input
                  type="date"
                  value={config.dataFim}
                  onChange={(e) => upd("dataFim", e.target.value)}
                  className="h-7 text-xs"
                  disabled={running}
                  data-testid="pipeline-input-data-fim"
                />
              </div>
            </div>
          )}
        </div>

        {/* Enrichment toggles */}
        <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Switch
              id="pipe-enrich-processual"
              checked={config.enrichProcessual}
              onCheckedChange={(v) => upd("enrichProcessual", v)}
              disabled={running}
            />
            <Label htmlFor="pipe-enrich-processual" className="text-xs cursor-pointer">
              <span className="font-medium flex items-center gap-1">
                <Gavel className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                TRF1 Processual
              </span>
              <span className="text-muted-foreground">partes · advogados · situação</span>
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="pipe-enrich-publico"
              checked={config.enrichPublico}
              onCheckedChange={(v) => upd("enrichPublico", v)}
              disabled={running}
            />
            <Label htmlFor="pipe-enrich-publico" className="text-xs cursor-pointer">
              <span className="font-medium flex items-center gap-1">
                <Globe className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                TRF1 Público · PJe
              </span>
              <span className="text-muted-foreground">valor da causa · situação PJe</span>
            </Label>
          </div>
        </div>

        {config.enrichPublico && (
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 px-3 py-2 rounded-md">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              O enriquecimento TRF1 Público usa navegação automatizada (Playwright) e pode
              levar 5–15 segundos por processo. Recomenda-se usar com ≤ 10 processos.
            </span>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2 pt-1">
          {!running && (
            <Button
              onClick={runPipeline}
              className="h-9 px-5 gap-2"
              data-testid="button-pipeline-run"
            >
              <Play className="w-3.5 h-3.5" />
              Iniciar Pipeline
            </Button>
          )}
          {running && (
            <Button
              variant="destructive"
              onClick={stopPipeline}
              className="h-9 px-5 gap-2"
              data-testid="button-pipeline-stop"
            >
              <Square className="w-3 h-3" />
              Parar
            </Button>
          )}
          {hasResults && (phase === "done" || phase === "aborted") && (
            <Button
              variant="outline"
              onClick={exportCSV}
              className="h-9 px-4 gap-2"
              data-testid="button-pipeline-export"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </Button>
          )}
          {hasResults && !running && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRows([]);
                setPhase("idle");
                setPipelineError("");
                setProgress({ current: 0, total: 0, datajudTotal: 0 });
              }}
              className="h-9 text-xs text-muted-foreground"
            >
              Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {pipelineError && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{pipelineError}</p>
        </div>
      )}

      {/* Progress indicator */}
      {(running || phase === "done" || phase === "aborted") && (
        <div className="bg-card border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              {phase === "datajud" && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span>Buscando no DataJud...</span>
                </>
              )}
              {phase === "enriching" && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  <span>
                    Enriquecendo processo {progress.current} de {progress.total}
                    {config.enrichPublico && (
                      <span className="text-xs text-muted-foreground ml-1">(pode ser lento)</span>
                    )}
                  </span>
                </>
              )}
              {phase === "done" && (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Pipeline concluído — {rows.length} processo(s) processado(s)
                  </span>
                  {progress.datajudTotal > rows.length && (
                    <span className="text-xs text-muted-foreground">
                      ({progress.datajudTotal.toLocaleString("pt-BR")} total no DataJud)
                    </span>
                  )}
                </>
              )}
              {phase === "aborted" && (
                <>
                  <XCircle className="w-3.5 h-3.5 text-orange-500" />
                  <span className="text-orange-600 dark:text-orange-400 font-medium">
                    Interrompido em {progress.current} de {progress.total}
                  </span>
                </>
              )}
            </div>
            {(phase === "enriching" || phase === "datajud") && progress.total > 0 && (
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                {progressPct}%
              </span>
            )}
          </div>

          {/* Progress bar */}
          {(phase === "enriching") && progress.total > 0 && (
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          {/* Source legends */}
          {(phase === "enriching" || phase === "done" || phase === "aborted") && (
            <div className="flex items-center gap-3 pt-1">
              <span className="text-[10px] text-muted-foreground">Fontes:</span>
              <span className="flex items-center gap-1 text-[10px]">
                <Database className="w-3 h-3 text-blue-500" />
                <Badge variant="outline" className="text-[9px] border-blue-500/30 text-blue-600 dark:text-blue-400">
                  DJ
                </Badge>
                DataJud
              </span>
              {config.enrichProcessual && (
                <span className="flex items-center gap-1 text-[10px]">
                  <Gavel className="w-3 h-3 text-emerald-500" />
                  <Badge variant="outline" className="text-[9px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
                    P1
                  </Badge>
                  Processual
                </span>
              )}
              {config.enrichPublico && (
                <span className="flex items-center gap-1 text-[10px]">
                  <Globe className="w-3 h-3 text-violet-500" />
                  <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600 dark:text-violet-400">
                    PJ
                  </Badge>
                  PJe
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Results table */}
      {hasResults && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-3 py-2 bg-muted/50 border-b border-border flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {rows.length} processo(s)
              {progress.datajudTotal > 0 && progress.datajudTotal > rows.length && (
                <span className="ml-1">
                  · {progress.datajudTotal.toLocaleString("pt-BR")} total no DataJud
                </span>
              )}
            </span>
            {(phase === "done" || phase === "aborted") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={exportCSV}
                className="h-7 text-xs gap-1.5"
              >
                <Download className="w-3 h-3" />
                CSV
              </Button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Processo
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Classe
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" /> Órgão
                    </span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" /> Ajuizamento
                    </span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Grau
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" /> Assuntos
                    </span>
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Última Mov. (DataJud)
                  </th>
                  {config.enrichProcessual && (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-emerald-500" /> Partes
                        </span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3 text-emerald-500" /> Advogados
                        </span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Info className="w-3 h-3 text-emerald-500" /> Situação (P1)
                        </span>
                      </th>
                    </>
                  )}
                  {config.enrichPublico && (
                    <>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3 text-violet-500" /> Valor da Causa
                        </span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <Info className="w-3 h-3 text-violet-500" /> Situação (PJe)
                        </span>
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                        Última Mov. (PJe)
                      </th>
                    </>
                  )}
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((row, i) => (
                  <PipelineTableRow
                    key={i}
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
      {!running && rows.length === 0 && phase === "idle" && !pipelineError && (
        <div className="text-center py-16 text-muted-foreground" data-testid="pipeline-empty">
          <Zap className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium">Pipeline de Automação</p>
          <p className="text-xs mt-1.5 opacity-70 max-w-md mx-auto">
            Configure os filtros do DataJud, ative as fontes de enriquecimento e clique em
            "Iniciar Pipeline". Os resultados são consolidados em tabela exportável em CSV.
          </p>
          <div className="flex items-center justify-center gap-4 mt-4 text-[11px] text-muted-foreground/60">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" /> DataJud
            </span>
            <span className="text-muted-foreground/30">→</span>
            <span className="flex items-center gap-1">
              <Gavel className="w-3.5 h-3.5" /> TRF1 Processual
            </span>
            <span className="text-muted-foreground/30">→</span>
            <span className="flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> TRF1 Público
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Table row component ──────────────────────────────────────

function PipelineTableRow({
  row,
  showProcessual,
  showPublico,
}: {
  row: PipelineRow;
  showProcessual: boolean;
  showPublico: boolean;
}) {
  const isEnriching =
    row.processual_status === "loading" || row.publico_status === "loading";

  return (
    <tr className={`hover:bg-muted/20 transition-colors ${isEnriching ? "animate-pulse" : ""}`}>
      <td className="px-3 py-2.5 font-mono whitespace-nowrap text-[11px]">
        {formatCNJ(row.numero_processo)}
      </td>
      <td className="px-3 py-2.5 max-w-[140px]">
        <span className="truncate block" title={row.classe}>
          {row.classe}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-[160px] text-muted-foreground">
        <span className="truncate block" title={row.orgao_julgador}>
          {row.orgao_julgador}
        </span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
        {row.data_ajuizamento}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        {row.grau && (
          <Badge variant="outline" className="text-[9px]">
            {row.grau}
          </Badge>
        )}
      </td>
      <td className="px-3 py-2.5 max-w-[180px]">
        <span className="truncate block text-muted-foreground" title={row.assuntos}>
          {row.assuntos || <span className="opacity-30">—</span>}
        </span>
      </td>
      <td className="px-3 py-2.5 max-w-[160px]">
        <span className="truncate block" title={row.ultima_mov_nome}>
          {row.ultima_mov_nome || <span className="text-muted-foreground/30">—</span>}
        </span>
        {row.ultima_mov_data && (
          <span className="text-[10px] text-muted-foreground/70">{row.ultima_mov_data}</span>
        )}
      </td>

      {showProcessual && (
        <>
          <td className="px-3 py-2.5 max-w-[180px]">
            <EnrichCell status={row.processual_status} value={row.partes} />
          </td>
          <td className="px-3 py-2.5 max-w-[180px]">
            <EnrichCell status={row.processual_status} value={row.advogados} />
          </td>
          <td className="px-3 py-2.5 whitespace-nowrap">
            {row.processual_status === "found" && row.situacao_processual ? (
              <Badge variant="secondary" className="text-[9px]">
                {row.situacao_processual}
              </Badge>
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
              <Badge variant="secondary" className="text-[9px]">
                {row.situacao_publico}
              </Badge>
            ) : (
              <EnrichCell status={row.publico_status} value="" />
            )}
          </td>
          <td className="px-3 py-2.5 max-w-[160px]">
            <EnrichCell status={row.publico_status} value={row.ultima_mov_publico} />
          </td>
        </>
      )}

      <td className="px-3 py-2.5">
        <SourceBadges row={row} showProcessual={showProcessual} showPublico={showPublico} />
      </td>
    </tr>
  );
}

// ─── Enrichment cell ─────────────────────────────────────────

function EnrichCell({ status, value }: { status: EnrichStatus; value: string }) {
  if (status === "loading") {
    return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
  }
  if (status === "pending") {
    return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  }
  if (status === "not_found") {
    return <span className="text-muted-foreground/40 text-[10px]">não encontrado</span>;
  }
  if (status === "error") {
    return <span className="text-destructive/60 text-[10px]">erro</span>;
  }
  if (status === "skipped") {
    return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  }
  if (!value) return <span className="text-muted-foreground/30 text-[10px]">—</span>;
  return (
    <span className="truncate block max-w-[180px]" title={value}>
      {value}
    </span>
  );
}

// ─── Source status badges ─────────────────────────────────────

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
      <Badge
        variant="outline"
        className="text-[9px] border-blue-500/30 text-blue-600 dark:text-blue-400"
        title="DataJud"
      >
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
          {row.processual_status === "loading" ? (
            <Loader2 className="w-2 h-2 animate-spin" />
          ) : (
            "P1"
          )}
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
          {row.publico_status === "loading" ? (
            <Loader2 className="w-2 h-2 animate-spin" />
          ) : (
            "PJ"
          )}
        </Badge>
      )}
    </div>
  );
}
