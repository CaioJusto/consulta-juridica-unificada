import { useState, useEffect, useCallback, useRef } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Loader2,
  Database,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  FileText,
  ArrowRightLeft,
  Users,
  Calendar,
  Hash,
  Building2,
  Info,
  ChevronLeft,
  ChevronLeftIcon,
  ChevronRightIcon,
  Gavel,
  Globe,
  DollarSign,
  Zap,
  CheckCircle2,
  XCircle,
  Filter,
  X,
  Plus,
  Minus,
  Settings2,
  Play,
  Square,
  Download,
  Infinity as InfinityIcon,
} from "lucide-react";
import type {
  TribunalOption,
  DataJudProcesso,
  Processo,
  TRF1PublicProcess,
  SgtItem,
} from "@shared/schema";

// ─── Helpers ────────────────────────────────────────────────────

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

function formatDateTime(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString("pt-BR");
  } catch {
    return raw;
  }
}

function extractCNJDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

// ─── Types ──────────────────────────────────────────────────────

interface SearchState {
  loading: boolean;
  error: string;
  total: number;
  processos: DataJudProcesso[];
  searchAfter: any[] | null;
  pageSize: number;
  returned: number;
  // Pagination history: list of search_after cursors per page
  pageHistory: (any[] | null)[];
  currentPage: number;
}

interface EnrichState {
  processual: { loading: boolean; data: Processo | null; error: string };
  publico: { loading: boolean; data: TRF1PublicProcess | null; error: string };
}

const defaultEnrich: EnrichState = {
  processual: { loading: false, data: null, error: "" },
  publico: { loading: false, data: null, error: "" },
};

interface SgtOption {
  codigo: string;
  nome: string;
}

interface FilterOption {
  codigo: string;
  nome: string;
}

interface CreditPresetOption {
  key: string;
  label: string;
  description: string;
  default_grau: string;
}

// ─── SGT Search Hook ────────────────────────────────────────────

function useSgtSearch(kind: string) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SgtOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiRequest(
          "GET",
          `/api/datajud/sgt?kind=${kind}&q=${encodeURIComponent(query)}`
        );
        const json = await res.json();
        if (json.success) setResults(json.data || []);
      } catch {}
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, kind]);

  return { query, setQuery, results, loading };
}

// ─── Tribunal Fallback ──────────────────────────────────────────

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

// ─── Main Component ─────────────────────────────────────────────

export function ConsultaGeral() {
  // UF → tribunal quick-select mapping (state courts)
  const UF_TRIBUNAL_MAP: Record<string, string> = {
    AC: "api_publica_tjac", AL: "api_publica_tjal", AM: "api_publica_tjam",
    AP: "api_publica_tjap", BA: "api_publica_tjba", CE: "api_publica_tjce",
    DF: "api_publica_tjdft", ES: "api_publica_tjes", GO: "api_publica_tjgo",
    MA: "api_publica_tjma", MG: "api_publica_tjmg", MS: "api_publica_tjms",
    MT: "api_publica_tjmt", PA: "api_publica_tjpa", PB: "api_publica_tjpb",
    PE: "api_publica_tjpe", PI: "api_publica_tjpi", PR: "api_publica_tjpr",
    RJ: "api_publica_tjrj", RN: "api_publica_tjrn", RO: "api_publica_tjro",
    RR: "api_publica_tjrr", RS: "api_publica_tjrs", SC: "api_publica_tjsc",
    SE: "api_publica_tjse", SP: "api_publica_tjsp", TO: "api_publica_tjto",
  };
  const UF_LIST = Object.keys(UF_TRIBUNAL_MAP).sort();

  // Basic filters
  const [tribunais, setTribunais] = useState<TribunalOption[]>(TRIBUNAIS_FALLBACK);
  const [tribunal, setTribunal] = useState("api_publica_trf1");
  const [ufSelect, setUfSelect] = useState(""); // quick-select UF → auto-sets tribunal
  const [numero, setNumero] = useState("");
  const [grau, setGrau] = useState("");

  // Advanced filters
  const [showFilters, setShowFilters] = useState(false);
  const [classeCodigo, setClasseCodigo] = useState("");
  const [classeNome, setClasseNome] = useState("");
  const [assuntosCodigos, setAssuntosCodigos] = useState<SgtOption[]>([]); // multi-select up to 5
  const [assuntoCodigo, setAssuntoCodigo] = useState(""); // kept for legacy single-select compat
  const [assuntoNome, setAssuntoNome] = useState("");
  const [assuntosExcluir, setAssuntosExcluir] = useState<SgtOption[]>([]);
  const [movimentoCodigo, setMovimentoCodigo] = useState("");
  const [movimentoNome, setMovimentoNome] = useState("");
  const [orgaoJulgadorCodigo, setOrgaoJulgadorCodigo] = useState("");
  const [orgaoJulgadorNome, setOrgaoJulgadorNome] = useState("");
  const [sistemaCodigo, setSistemaCodigo] = useState("__all__");
  const [formatoCodigo, setFormatoCodigo] = useState("__all__");
  const [creditPreset, setCreditPreset] = useState("__none__");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [dataAtualizacaoInicio, setDataAtualizacaoInicio] = useState("");
  const [dataAtualizacaoFim, setDataAtualizacaoFim] = useState("");

  // Presence filters
  const [temAssuntos, setTemAssuntos] = useState<string>("any"); // "any" | "yes" | "no"
  const [temMovimentos, setTemMovimentos] = useState<string>("any");
  const [minMovimentos, setMinMovimentos] = useState("");
  const [maxMovimentos, setMaxMovimentos] = useState("");
  const [nivelSigilo, setNivelSigilo] = useState("");
  const [sortField, setSortField] = useState("dataHoraUltimaAtualizacao");
  const [sortOrder, setSortOrder] = useState("desc");

  // Pagination
  const [pageSize, setPageSize] = useState(20);
  const [maxPages, setMaxPages] = useState<string>("all"); // "1", "5", "10", "50", "all"

  // Auto-collect state
  const [autoCollecting, setAutoCollecting] = useState(false);
  const [collectProgress, setCollectProgress] = useState({ current: 0, total: 0, collected: 0 });
  const abortRef = useRef(false);
  const [allCollectedProcessos, setAllCollectedProcessos] = useState<DataJudProcesso[]>([]);
  const [showCollected, setShowCollected] = useState(false);

  // SGT searches
  const classeSgt = useSgtSearch("classe");
  const assuntoSgt = useSgtSearch("assunto");
  const movimentoSgt = useSgtSearch("movimento");
  const [assuntoExcluirSgt, setAssuntoExcluirSgt] = useState({ query: "", results: [] as SgtOption[], loading: false });
  const [sistemaOptions, setSistemaOptions] = useState<FilterOption[]>([]);
  const [formatoOptions, setFormatoOptions] = useState<FilterOption[]>([]);
  const [creditPresetOptions, setCreditPresetOptions] = useState<CreditPresetOption[]>([]);

  // Orgao julgador search
  const [orgaoQuery, setOrgaoQuery] = useState("");
  const [orgaoResults, setOrgaoResults] = useState<SgtOption[]>([]);
  const [orgaoLoading, setOrgaoLoading] = useState(false);

  useEffect(() => {
    if (orgaoQuery.length < 2) { setOrgaoResults([]); return; }
    const timer = setTimeout(async () => {
      setOrgaoLoading(true);
      try {
        const res = await apiRequest("GET", `/api/datajud/orgaos?tribunal=${tribunal}&q=${encodeURIComponent(orgaoQuery)}`);
        const json = await res.json();
        if (json.success) setOrgaoResults(json.data || []);
      } catch {}
      setOrgaoLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [orgaoQuery, tribunal]);

  // SGT for assuntos to exclude
  useEffect(() => {
    if (assuntoExcluirSgt.query.length < 2) { setAssuntoExcluirSgt(s => ({...s, results: []})); return; }
    const timer = setTimeout(async () => {
      setAssuntoExcluirSgt(s => ({...s, loading: true}));
      try {
        const res = await apiRequest("GET", `/api/datajud/sgt?kind=assunto&q=${encodeURIComponent(assuntoExcluirSgt.query)}`);
        const json = await res.json();
        if (json.success) setAssuntoExcluirSgt(s => ({...s, results: json.data || [], loading: false}));
      } catch {
        setAssuntoExcluirSgt(s => ({...s, loading: false}));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [assuntoExcluirSgt.query]);

  // Selected processo
  const [selectedProcesso, setSelectedProcesso] = useState<DataJudProcesso | null>(null);
  const [enrichState, setEnrichState] = useState<EnrichState>(defaultEnrich);

  const [state, setState] = useState<SearchState>({
    loading: false,
    error: "",
    total: 0,
    processos: [],
    searchAfter: null,
    pageSize: 20,
    returned: 0,
    pageHistory: [null],
    currentPage: 1,
  });

  // Load tribunal list
  useEffect(() => {
    apiRequest("GET", "/api/datajud/tribunais")
      .then((r) => r.json())
      .then((json) => { if (json.success) setTribunais(json.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiRequest("GET", `/api/datajud/filter-options?tribunal=${tribunal}&kind=sistema`).then((r) => r.json()).catch(() => ({ success: false })),
      apiRequest("GET", `/api/datajud/filter-options?tribunal=${tribunal}&kind=formato`).then((r) => r.json()).catch(() => ({ success: false })),
      apiRequest("GET", "/api/datajud/presets").then((r) => r.json()).catch(() => ({ success: false })),
    ]).then(([sistemas, formatos, presets]) => {
      if (cancelled) return;
      setSistemaOptions(sistemas.success ? (sistemas.data || []) : []);
      setFormatoOptions(formatos.success ? (formatos.data || []) : []);
      setCreditPresetOptions(presets.success ? (presets.data || []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [tribunal]);

  const buildSearchBody = useCallback((searchAfterCursor?: any[] | null) => {
    const body: any = {
      tribunal_alias: tribunal,
      page_size: pageSize,
      sort_field: sortField,
      sort_order: sortOrder,
    };
    if (numero.trim()) body.numero_processo = numero.trim();
    if (classeCodigo) body.classe_codigo = parseInt(classeCodigo);
    if (assuntosCodigos.length > 0) body.assuntos_codigos = assuntosCodigos.map(a => parseInt(a.codigo));
    else if (assuntoCodigo) body.assunto_codigo = parseInt(assuntoCodigo);
    if (assuntosExcluir.length > 0) body.assuntos_excluir_codigos = assuntosExcluir.map(a => parseInt(a.codigo));
    if (movimentoCodigo) body.movimento_codigo = parseInt(movimentoCodigo);
    if (orgaoJulgadorCodigo) body.orgao_julgador_codigo = parseInt(orgaoJulgadorCodigo);
    if (grau && grau !== "all") body.grau = grau;
    if (sistemaCodigo !== "__all__") body.sistema_codigo = parseInt(sistemaCodigo);
    if (formatoCodigo !== "__all__") body.formato_codigo = parseInt(formatoCodigo);
    if (creditPreset !== "__none__") body.credit_preset = creditPreset;
    if (dataInicio) body.data_ajuizamento_inicio = dataInicio;
    if (dataFim) body.data_ajuizamento_fim = dataFim;
    if (dataAtualizacaoInicio) body.data_atualizacao_inicio = dataAtualizacaoInicio;
    if (dataAtualizacaoFim) body.data_atualizacao_fim = dataAtualizacaoFim;
    if (nivelSigilo !== "" && nivelSigilo !== "__all__") body.nivel_sigilo = parseInt(nivelSigilo);
    if (temAssuntos === "yes") body.tem_assuntos = true;
    else if (temAssuntos === "no") body.tem_assuntos = false;
    if (temMovimentos === "yes") body.tem_movimentos = true;
    else if (temMovimentos === "no") body.tem_movimentos = false;
    if (minMovimentos) body.min_movimentos = parseInt(minMovimentos);
    if (maxMovimentos) body.max_movimentos = parseInt(maxMovimentos);
    if (searchAfterCursor) body.search_after = searchAfterCursor;
    return body;
  }, [tribunal, pageSize, sortField, sortOrder, numero, classeCodigo, assuntosCodigos, assuntoCodigo, assuntosExcluir, movimentoCodigo, orgaoJulgadorCodigo, grau, sistemaCodigo, formatoCodigo, creditPreset, dataInicio, dataFim, dataAtualizacaoInicio, dataAtualizacaoFim, nivelSigilo, temAssuntos, temMovimentos, minMovimentos, maxMovimentos]);

  async function executeSearch(searchAfterCursor: any[] | null, page: number, newPageHistory?: (any[] | null)[]) {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const body = buildSearchBody(searchAfterCursor);
      const res = await apiRequest("POST", "/api/datajud/buscar", body);
      const json = await res.json();

      if (json.success && json.data) {
        const processos = json.data.processos || [];
        setState((s) => ({
          loading: false,
          error: "",
          total: json.data.total,
          processos,
          searchAfter: json.data.search_after,
          pageSize: json.data.page_size,
          returned: json.data.returned,
          pageHistory: newPageHistory || s.pageHistory,
          currentPage: page,
        }));
      } else {
        setState((s) => ({ ...s, loading: false, error: json.error || "Erro na busca" }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: "Erro de conexão com o servidor" }));
    }
  }

  // ─── Auto-collect: percorrer múltiplas páginas automaticamente ──
  async function handleAutoCollect() {
    abortRef.current = false;
    setAutoCollecting(true);
    setShowCollected(false);

    const limit = maxPages === "all" ? Infinity : parseInt(maxPages);
    let cursor: any[] | null = null;
    let collected: DataJudProcesso[] = [];
    let pageNum = 0;
    let totalHits = 0;

    try {
      while (pageNum < limit) {
        if (abortRef.current) break;

        const body = buildSearchBody(cursor);
        const res = await apiRequest("POST", "/api/datajud/buscar", body);
        const json = await res.json();

        if (!json.success || !json.data) {
          setState(s => ({ ...s, error: json.error || "Erro durante coleta" }));
          break;
        }

        const processos: DataJudProcesso[] = json.data.processos || [];
        if (pageNum === 0) totalHits = json.data.total;
        collected = [...collected, ...processos];
        pageNum++;

        const totalPagesEst = Math.ceil(totalHits / pageSize);
        const targetPages = maxPages === "all" ? totalPagesEst : Math.min(parseInt(maxPages), totalPagesEst);
        setCollectProgress({ current: pageNum, total: targetPages, collected: collected.length });

        // Update the main state to show latest page
        setState(s => ({
          ...s,
          loading: false,
          error: "",
          total: totalHits,
          processos,
          searchAfter: json.data.search_after,
          pageSize: json.data.page_size,
          returned: json.data.returned,
          currentPage: pageNum,
          pageHistory: [...(s.pageHistory || [null]), json.data.search_after],
        }));

        cursor = json.data.search_after;
        if (!cursor || processos.length === 0) break; // no more pages
      }
    } catch {
      setState(s => ({ ...s, error: "Erro de conexão durante coleta" }));
    }

    setAllCollectedProcessos(collected);
    setShowCollected(true);
    setAutoCollecting(false);
  }

  function handleStopCollect() {
    abortRef.current = true;
  }

  function handleExportCSV() {
    const data = showCollected ? allCollectedProcessos : state.processos;
    if (data.length === 0) return;
    const headers = [
      "numero_processo",
      "classe",
      "orgao_julgador",
      "data_ajuizamento",
      "grau",
      "assuntos",
      "qtd_movimentos",
      "ultima_movimentacao_data",
      "ultima_movimentacao_nome",
      "tribunal",
      "fonte",
    ];
    const rows = data.map(p => {
      // Sort movements descending and take the most recent
      const sorted = [...p.movimentos].sort((a, b) =>
        (b.data_hora || "").localeCompare(a.data_hora || "")
      );
      const lastMov = sorted[0];
      return [
        formatCNJ(p.numero_processo),
        p.classe,
        p.orgao_julgador,
        formatDate(p.data_ajuizamento),
        p.grau || "",
        p.assuntos.map(a => a.nome).join("; "),
        String(p.movimentos.length),
        lastMov ? formatDate(lastMov.data_hora) : "",
        lastMov ? lastMov.nome : "",
        p.tribunal || "",
        "DataJud (CNJ)",
      ];
    });
    const csv = [
      headers.join(","),
      ...rows.map(r => r.map(c => `"${(c || "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `processos_datajud_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setSelectedProcesso(null);
    setEnrichState(defaultEnrich);
    setAllCollectedProcessos([]);
    setShowCollected(false);
    setCollectProgress({ current: 0, total: 0, collected: 0 });
    // sync legacy single assunto from multi-select if needed
    if (assuntosCodigos.length === 1) { setAssuntoCodigo(assuntosCodigos[0].codigo); setAssuntoNome(assuntosCodigos[0].nome); }
    // Reset to page 1
    executeSearch(null, 1, [null]);
  }

  function handleNextPage() {
    if (!state.searchAfter) return;
    const newHistory = [...state.pageHistory];
    // Store the searchAfter for the next page
    if (newHistory.length <= state.currentPage) {
      newHistory.push(state.searchAfter);
    } else {
      newHistory[state.currentPage] = state.searchAfter;
    }
    executeSearch(state.searchAfter, state.currentPage + 1, newHistory);
  }

  function handlePrevPage() {
    if (state.currentPage <= 1) return;
    const prevPage = state.currentPage - 1;
    const cursor = state.pageHistory[prevPage - 1] || null;
    executeSearch(cursor, prevPage);
  }

  function handleGoToPage(page: number) {
    if (page < 1 || page === state.currentPage) return;
    // Can only go to pages we've visited
    if (page <= state.pageHistory.length) {
      const cursor = state.pageHistory[page - 1] || null;
      executeSearch(cursor, page);
    }
  }

  function handleSelectProcesso(p: DataJudProcesso) {
    setSelectedProcesso(p);
    setEnrichState(defaultEnrich);
  }

  function handleBack() {
    setSelectedProcesso(null);
    setEnrichState(defaultEnrich);
  }

  // ─── Enrich functions ─────────────────────────────────────────

  async function enrichProcessual(numeroProcesso: string) {
    setEnrichState((s) => ({ ...s, processual: { loading: true, data: null, error: "" } }));
    try {
      const digits = extractCNJDigits(numeroProcesso);
      const res = await apiRequest("GET", `/api/processo?numero=${encodeURIComponent(digits)}&secao=TRF1`);
      const json = await res.json();
      if (json.success && json.data) {
        setEnrichState((s) => ({ ...s, processual: { loading: false, data: json.data, error: "" } }));
      } else {
        setEnrichState((s) => ({ ...s, processual: { loading: false, data: null, error: json.error || "Não encontrado no sistema processual do TRF1" } }));
      }
    } catch {
      setEnrichState((s) => ({ ...s, processual: { loading: false, data: null, error: "Erro de conexão" } }));
    }
  }

  async function enrichPublico(numeroProcesso: string) {
    setEnrichState((s) => ({ ...s, publico: { loading: true, data: null, error: "" } }));
    try {
      const formatted = formatCNJ(numeroProcesso);
      const res = await apiRequest("GET", `/api/trf1publico/buscar?numero=${encodeURIComponent(formatted)}`);
      const json = await res.json();
      if (json.success && json.data && json.data.processos.length > 0) {
        setEnrichState((s) => ({ ...s, publico: { loading: false, data: json.data.processos[0], error: "" } }));
      } else {
        setEnrichState((s) => ({ ...s, publico: { loading: false, data: null, error: json.error || "Não encontrado na consulta pública PJe" } }));
      }
    } catch {
      setEnrichState((s) => ({ ...s, publico: { loading: false, data: null, error: "Erro de conexão" } }));
    }
  }

  // ─── Detail view ──────────────────────────────────────────────

  if (selectedProcesso) {
    return (
      <ProcessoDetalhe
        processo={selectedProcesso}
        enrichState={enrichState}
        onBack={handleBack}
        onEnrichProcessual={() => enrichProcessual(selectedProcesso.numero_processo)}
        onEnrichPublico={() => enrichPublico(selectedProcesso.numero_processo)}
      />
    );
  }

  // Pagination info
  const totalPages = state.total > 0 ? Math.ceil(state.total / pageSize) : 0;
  const hasNextPage = state.searchAfter !== null && state.currentPage < totalPages;
  const hasPrevPage = state.currentPage > 1;
  const displayedProcessos = showCollected ? allCollectedProcessos : state.processos;
  const movementCodeBuckets = new Map<string, { codigo: string; nome: string; total: number }>();
  for (const processo of displayedProcessos) {
    for (const movimento of processo.movimentos) {
      const codigo = String(movimento.codigo || "").trim();
      if (!codigo) continue;
      const existing = movementCodeBuckets.get(codigo);
      if (existing) {
        existing.total += 1;
      } else {
        movementCodeBuckets.set(codigo, {
          codigo,
          nome: movimento.nome,
          total: 1,
        });
      }
    }
  }
  const availableMovementCodes = Array.from(movementCodeBuckets.values())
    .sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo))
    .slice(0, 18);

  // ─── Search + Results view ────────────────────────────────────

  return (
    <div>
      {/* Search form */}
      <form onSubmit={handleSearch} className="space-y-4" data-testid="consulta-geral-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Tribunal</Label>
            <Select value={tribunal} onValueChange={setTribunal}>
              <SelectTrigger data-testid="select-tribunal">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tribunais.map((t) => (
                  <SelectItem key={t.alias} value={t.alias}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Número do Processo</Label>
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ex: 0003653-54.2020.4.01.3400"
              data-testid="input-numero"
            />
          </div>
        </div>

        {/* Filters toggle */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-toggle-filters"
        >
          <Filter className="w-3.5 h-3.5" />
          {showFilters ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Filtros avançados
          {countActiveFilters() > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">{countActiveFilters()}</Badge>
          )}
        </button>

        <div className={showFilters ? "space-y-5 pl-3 border-l-2 border-primary/20" : "hidden"}>
            {/* Row 1: Classe + Assunto + Movimentação (com busca SGT) */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3 h-3" /> Classe · Assunto · Movimentação
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Classe */}
                <SgtSearchField
                  label="Classe"
                  sgt={classeSgt}
                  selectedCode={classeCodigo}
                  selectedName={classeNome}
                  onSelect={(item) => { setClasseCodigo(item.codigo); setClasseNome(item.nome); }}
                  onClear={() => { setClasseCodigo(""); setClasseNome(""); }}
                  testId="sgt-classe"
                />
                {/* Assunto (multi-select, up to 5) */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Assunto (até 5)</Label>
                  <div className="flex flex-wrap gap-1 mb-1">
                    {assuntosCodigos.map((a, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                        {a.nome} ({a.codigo})
                        <button type="button" onClick={() => setAssuntosCodigos(prev => prev.filter((_, j) => j !== i))} className="ml-0.5">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  {assuntosCodigos.length < 5 && (
                    <div className="relative">
                      <Input
                        value={assuntoSgt.query}
                        onChange={(e) => assuntoSgt.setQuery(e.target.value)}
                        placeholder="Buscar assunto..."
                        className="h-8 text-xs"
                        data-testid="input-sgt-assunto"
                      />
                      {assuntoSgt.loading && <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /></div>}
                      {assuntoSgt.results.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                          {assuntoSgt.results.map((item) => (
                            <button key={item.codigo} type="button" className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { if (!assuntosCodigos.find(a => a.codigo === item.codigo) && assuntosCodigos.length < 5) setAssuntosCodigos(prev => [...prev, item]); assuntoSgt.setQuery(""); }}>
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>{item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Movimentação */}
                <SgtSearchField
                  label="Movimentação"
                  sgt={movimentoSgt}
                  selectedCode={movimentoCodigo}
                  selectedName={movimentoNome}
                  onSelect={(item) => { setMovimentoCodigo(item.codigo); setMovimentoNome(item.nome); }}
                  onClear={() => { setMovimentoCodigo(""); setMovimentoNome(""); }}
                  testId="sgt-movimento"
                />
              </div>
            </div>

            {/* Assuntos excluídos */}
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Assuntos a Excluir</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {assuntosExcluir.map((a, i) => (
                  <Badge key={i} variant="destructive" className="text-[10px] gap-1">
                    {a.nome} ({a.codigo})
                    <button type="button" onClick={() => setAssuntosExcluir(prev => prev.filter((_, j) => j !== i))} className="ml-0.5">
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <Input
                  value={assuntoExcluirSgt.query}
                  onChange={(e) => setAssuntoExcluirSgt(s => ({...s, query: e.target.value}))}
                  placeholder="Buscar assunto para excluir..."
                  className="h-8 text-xs"
                  data-testid="input-assunto-excluir"
                />
                {assuntoExcluirSgt.results.length > 0 && (
                  <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                    {assuntoExcluirSgt.results.map((item) => (
                      <button
                        key={item.codigo}
                        type="button"
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                        onClick={() => {
                          if (!assuntosExcluir.find(a => a.codigo === item.codigo)) {
                            setAssuntosExcluir(prev => [...prev, item]);
                          }
                          setAssuntoExcluirSgt({ query: "", results: [], loading: false });
                        }}
                      >
                        <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>
                        {item.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 2: Órgão Julgador + Grau + UF */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3 h-3" /> Órgão Julgador · Grau · UF
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Órgão Julgador */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Órgão Julgador</Label>
                  {orgaoJulgadorCodigo ? (
                    <div className="flex items-center gap-2 h-8 px-2 bg-muted/50 rounded-md">
                      <span className="text-xs truncate flex-1">{orgaoJulgadorNome} ({orgaoJulgadorCodigo})</span>
                      <button type="button" onClick={() => { setOrgaoJulgadorCodigo(""); setOrgaoJulgadorNome(""); }} className="text-muted-foreground hover:text-foreground">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input
                        value={orgaoQuery}
                        onChange={(e) => setOrgaoQuery(e.target.value)}
                        placeholder="Buscar órgão julgador..."
                        className="h-8 text-xs"
                        data-testid="input-orgao"
                      />
                      {orgaoResults.length > 0 && (
                        <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-40 overflow-y-auto">
                          {orgaoResults.map((item) => (
                            <button
                              key={item.codigo}
                              type="button"
                              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                              onClick={() => { setOrgaoJulgadorCodigo(item.codigo); setOrgaoJulgadorNome(item.nome); setOrgaoQuery(""); setOrgaoResults([]); }}
                            >
                              <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>
                              {item.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* Grau */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Grau</Label>
                  <Select value={grau} onValueChange={setGrau}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-grau">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
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
                {/* UF Quick-Select (selects TJ estadual) */}
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">
                    UF (seleção rápida TJ)
                  </Label>
                  <Select
                    value={ufSelect}
                    onValueChange={(uf) => {
                      setUfSelect(uf);
                      if (uf && UF_TRIBUNAL_MAP[uf]) setTribunal(UF_TRIBUNAL_MAP[uf]);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid="select-uf">
                      <SelectValue placeholder="Selecionar UF..." />
                    </SelectTrigger>
                    <SelectContent>
                      {UF_LIST.map((uf) => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Zap className="w-3 h-3" /> Sistema · Formato · Preset
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Sistema processual</Label>
                  <Select value={sistemaCodigo} onValueChange={setSistemaCodigo}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Qualquer sistema" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Qualquer sistema</SelectItem>
                      {sistemaOptions.map((item) => (
                        <SelectItem key={item.codigo} value={String(item.codigo)}>
                          {item.nome} ({item.codigo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Formato</Label>
                  <Select value={formatoCodigo} onValueChange={setFormatoCodigo}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Qualquer formato" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Qualquer formato</SelectItem>
                      {formatoOptions.map((item) => (
                        <SelectItem key={item.codigo} value={String(item.codigo)}>
                          {item.nome} ({item.codigo})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-muted-foreground">Preset de crédito</Label>
                  <Select value={creditPreset} onValueChange={setCreditPreset}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Nenhum preset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhum preset</SelectItem>
                      {creditPresetOptions.map((preset) => (
                        <SelectItem key={preset.key} value={preset.key}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {creditPreset !== "__none__" ? (
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      {creditPresetOptions.find((preset) => preset.key === creditPreset)?.description}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Row 3: Dates */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Datas
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Ajuizamento (de)</Label>
                  <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="h-8 text-xs" data-testid="input-data-inicio" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Ajuizamento (até)</Label>
                  <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="h-8 text-xs" data-testid="input-data-fim" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Atualização (de)</Label>
                  <Input type="date" value={dataAtualizacaoInicio} onChange={(e) => setDataAtualizacaoInicio(e.target.value)} className="h-8 text-xs" data-testid="input-data-atualiz-inicio" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Atualização (até)</Label>
                  <Input type="date" value={dataAtualizacaoFim} onChange={(e) => setDataAtualizacaoFim(e.target.value)} className="h-8 text-xs" data-testid="input-data-atualiz-fim" />
                </div>
              </div>
            </div>

            {/* Row 4: Presence + Quantity */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Settings2 className="w-3 h-3" /> Presença · Quantidade
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Tem Assuntos?</Label>
                  <Select value={temAssuntos} onValueChange={setTemAssuntos}>
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
                  <Select value={temMovimentos} onValueChange={setTemMovimentos}>
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
                  <Input type="number" min="0" value={minMovimentos} onChange={(e) => setMinMovimentos(e.target.value)} placeholder="0" className="h-8 text-xs" data-testid="input-min-mov" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Máx. Movimentos</Label>
                  <Input type="number" min="0" value={maxMovimentos} onChange={(e) => setMaxMovimentos(e.target.value)} placeholder="∞" className="h-8 text-xs" data-testid="input-max-mov" />
                </div>
              </div>
            </div>

            {/* Row 5: Sigilo + Ordenação + Direção */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Filter className="w-3 h-3" /> Sigilo · Ordenação · Direção
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Nível de Sigilo</Label>
                  <Select value={nivelSigilo} onValueChange={setNivelSigilo}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-nivel-sigilo">
                      <SelectValue placeholder="Qualquer" />
                    </SelectTrigger>
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
                  <Select value={sortField} onValueChange={setSortField}>
                    <SelectTrigger className="h-8 text-xs" data-testid="select-sort-field">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dataHoraUltimaAtualizacao">Última atualização</SelectItem>
                      <SelectItem value="dataAjuizamento">Data ajuizamento</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Direção</Label>
                  <div className="flex gap-2 h-8 items-center">
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="sortOrder" value="desc" checked={sortOrder === "desc"} onChange={() => setSortOrder("desc")} className="w-3 h-3" />
                      Mais recente
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input type="radio" name="sortOrder" value="asc" checked={sortOrder === "asc"} onChange={() => setSortOrder("asc")} className="w-3 h-3" />
                      Mais antigo
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 6: Pagination config */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Database className="w-3 h-3" /> Paginação
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-3">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Itens por página</Label>
                  <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v))}>
                    <SelectTrigger className="h-8 text-xs w-32" data-testid="select-page-size">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="500">500</SelectItem>
                      <SelectItem value="1000">1.000</SelectItem>
                      <SelectItem value="5000">5.000</SelectItem>
                      <SelectItem value="10000">10.000</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">(máx: 10.000)</span>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Páginas a percorrer</Label>
                  <Select value={maxPages} onValueChange={setMaxPages}>
                    <SelectTrigger className="h-8 text-xs w-32" data-testid="select-max-pages">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="5">5</SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="all">Buscar todos (∞)</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">(automático)</span>
                </div>
              </div>
            </div>
        </div>

        {/* Search button */}
        <Button
          type="submit"
          disabled={state.loading}
          className="h-10 px-6"
          data-testid="button-search"
        >
          {state.loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
          Buscar
        </Button>
      </form>

      {/* Error */}
      {state.error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive mt-4" data-testid="search-error">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{state.error}</p>
        </div>
      )}

      {/* Results */}
      {state.total > 0 && (
        <div className="mt-6">
          {/* Results header + pagination + auto-collect */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {showCollected
                  ? `${allCollectedProcessos.length.toLocaleString("pt-BR")} coletado(s) de ${state.total.toLocaleString("pt-BR")}`
                  : `${state.total.toLocaleString("pt-BR")} processo(s)`
                }
              </span>
              <span className="text-xs text-muted-foreground">via DataJud</span>
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && !showCollected && (
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={!hasPrevPage || state.loading || autoCollecting}
                  className="h-7 w-7 p-0"
                  data-testid="button-prev-page"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5" />
                </Button>
                <span className="text-xs text-muted-foreground px-2">
                  Página {state.currentPage} de {totalPages.toLocaleString("pt-BR")}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={!hasNextPage || state.loading || autoCollecting}
                  className="h-7 w-7 p-0"
                  data-testid="button-next-page"
                >
                  <ChevronRightIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>

          {/* Auto-collect controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {!autoCollecting && !showCollected && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleAutoCollect}
                  disabled={state.loading}
                  className="h-8 text-xs gap-1.5"
                  data-testid="button-auto-collect"
                >
                  <Play className="w-3.5 h-3.5" />
                  {maxPages === "all"
                    ? "Buscar todos os resultados"
                    : `Coletar ${maxPages} página${maxPages !== "1" ? "s" : ""}`}
                </Button>
              )}
              {autoCollecting && (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleStopCollect}
                  className="h-8 text-xs gap-1.5"
                  data-testid="button-stop-collect"
                >
                  <Square className="w-3 h-3" />
                  Parar coleta
                </Button>
              )}
              {showCollected && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowCollected(false); setAllCollectedProcessos([]); }}
                    className="h-8 text-xs gap-1.5"
                  >
                    Voltar à navegação normal
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCSV}
                    className="h-8 text-xs gap-1.5"
                    data-testid="button-export-csv"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar CSV
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Progress bar during collection */}
          {autoCollecting && collectProgress.total > 0 && (
            <div className="mb-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Coletando página {collectProgress.current} de {collectProgress.total === Infinity ? "?" : collectProgress.total}...</span>
                <span>{collectProgress.collected.toLocaleString("pt-BR")} processos coletados</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${collectProgress.total === Infinity || collectProgress.total === 0 ? 50 : Math.min(100, (collectProgress.current / collectProgress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {availableMovementCodes.length > 0 && (
            <div className="mb-4 rounded-lg border border-border bg-card/60 p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-xs font-medium">Códigos de movimentação encontrados nesta busca</p>
                  <p className="text-[10px] text-muted-foreground">
                    Clique em um código para preencher o filtro oficial do DataJud e refinar a próxima consulta.
                  </p>
                </div>
                {movimentoCodigo ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Filtro atual: {movimentoNome} ({movimentoCodigo})
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {availableMovementCodes.map((item) => (
                  <button
                    key={item.codigo}
                    type="button"
                    className="rounded-full border border-border px-2.5 py-1 text-[10px] transition-colors hover:border-primary/40 hover:bg-accent"
                    onClick={() => {
                      setMovimentoCodigo(item.codigo);
                      setMovimentoNome(item.nome);
                      setShowFilters(true);
                    }}
                  >
                    <span className="font-mono text-muted-foreground">{item.codigo}</span> {item.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results list */}
          <div className="space-y-2">
            {displayedProcessos.map((p, i) => (
              <button
                key={`${p.numero_processo}-${i}`}
                onClick={() => handleSelectProcesso(p)}
                className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors"
                data-testid={`card-resultado-${i}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold font-mono">{formatCNJ(p.numero_processo)}</span>
                      {p.grau && <Badge variant="outline" className="text-[10px]">{p.grau}</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{p.classe}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.orgao_julgador}</p>
                    {p.assuntos.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.assuntos.slice(0, 3).map((a, j) => (
                          <Badge key={j} variant="secondary" className="text-[10px]">{a.nome}</Badge>
                        ))}
                        {p.assuntos.length > 3 && <Badge variant="secondary" className="text-[10px]">+{p.assuntos.length - 3}</Badge>}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground">{formatDate(p.data_ajuizamento)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{p.movimentos.length} mov.</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Bottom pagination */}
          {totalPages > 1 && !showCollected && (
            <div className="flex items-center justify-center gap-1.5 mt-4">
              <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={!hasPrevPage || state.loading || autoCollecting} className="h-8 px-3 text-xs">
                <ChevronLeftIcon className="w-3.5 h-3.5 mr-1" /> Anterior
              </Button>
              <span className="text-xs text-muted-foreground px-3">
                Página {state.currentPage} de {totalPages.toLocaleString("pt-BR")}
              </span>
              <Button variant="outline" size="sm" onClick={handleNextPage} disabled={!hasNextPage || state.loading || autoCollecting} className="h-8 px-3 text-xs">
                Próxima <ChevronRightIcon className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          )}

          {/* Bottom info for collected mode */}
          {showCollected && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <span className="text-xs text-muted-foreground">
                Mostrando {allCollectedProcessos.length.toLocaleString("pt-BR")} processos coletados
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                className="h-8 text-xs gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar CSV
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Loading initial */}
      {state.loading && state.processos.length === 0 && (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {/* Empty state */}
      {!state.loading && state.total === 0 && !state.error && state.processos.length === 0 && (
        <div className="text-center py-16 text-muted-foreground" data-testid="empty-state">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium">Consulta Geral — DataJud + TRF1</p>
          <p className="text-xs mt-1.5 opacity-70 max-w-md mx-auto">
            Busque processos pelo DataJud (base do CNJ). Depois, enriqueça os resultados
            com dados detalhados do TRF1 Processual e da Consulta Pública PJe.
          </p>
        </div>
      )}
    </div>
  );

  function countActiveFilters(): number {
    let count = 0;
    if (classeCodigo) count++;
    if (assuntosCodigos.length > 0) count++;
    if (assuntoCodigo && assuntosCodigos.length === 0) count++;
    if (assuntosExcluir.length > 0) count++;
    if (movimentoCodigo) count++;
    if (orgaoJulgadorCodigo) count++;
    if (grau && grau !== "all") count++;
    if (sistemaCodigo !== "__all__") count++;
    if (formatoCodigo !== "__all__") count++;
    if (creditPreset !== "__none__") count++;
    if (ufSelect) count++;
    if (dataInicio || dataFim) count++;
    if (dataAtualizacaoInicio || dataAtualizacaoFim) count++;
    if (nivelSigilo !== "" && nivelSigilo !== "__all__") count++;
    if (sortField !== "dataHoraUltimaAtualizacao" || sortOrder !== "desc") count++;
    if (temAssuntos !== "any") count++;
    if (temMovimentos !== "any") count++;
    if (minMovimentos || maxMovimentos) count++;
    if (pageSize !== 20) count++;
    return count;
  }
}

// ─── SGT Search Field Component ─────────────────────────────────

function SgtSearchField({
  label,
  sgt,
  selectedCode,
  selectedName,
  onSelect,
  onClear,
  testId,
}: {
  label: string;
  sgt: { query: string; setQuery: (v: string) => void; results: SgtOption[]; loading: boolean };
  selectedCode: string;
  selectedName: string;
  onSelect: (item: SgtOption) => void;
  onClear: () => void;
  testId: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      {selectedCode ? (
        <div className="flex items-center gap-2 h-8 px-2 bg-muted/50 rounded-md">
          <span className="text-xs truncate flex-1">
            {selectedName} <span className="font-mono text-muted-foreground">({selectedCode})</span>
          </span>
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Input
            value={sgt.query}
            onChange={(e) => sgt.setQuery(e.target.value)}
            placeholder={`Buscar ${label.toLowerCase()}...`}
            className="h-8 text-xs"
            data-testid={`input-${testId}`}
          />
          {sgt.loading && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            </div>
          )}
          {sgt.results.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {sgt.results.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors"
                  onClick={() => {
                    onSelect(item);
                    sgt.setQuery("");
                  }}
                >
                  <span className="font-mono text-muted-foreground mr-2">{item.codigo}</span>
                  {item.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Processo Detalhe (DataJud + enrich panels) ─────────────────

function ProcessoDetalhe({
  processo,
  enrichState,
  onBack,
  onEnrichProcessual,
  onEnrichPublico,
}: {
  processo: DataJudProcesso;
  enrichState: EnrichState;
  onBack: () => void;
  onEnrichProcessual: () => void;
  onEnrichPublico: () => void;
}) {
  return (
    <div data-testid="processo-detalhe">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors" data-testid="button-back">
        <ChevronLeft className="w-4 h-4" /> Voltar aos resultados
      </button>

      <div className="mb-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-lg font-semibold font-mono" data-testid="text-processo-numero">{formatCNJ(processo.numero_processo)}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{processo.classe}</p>
          </div>
          {processo.grau && (
            <Badge variant="outline">
              {processo.grau === "G1" ? "1º Grau" : processo.grau === "G2" ? "2º Grau" : processo.grau}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{processo.tribunal}</p>
      </div>

      {/* Enrich Buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <EnrichButton label="TRF1 Processual" sublabel="Partes · Documentos · Petições" icon={Gavel} state={enrichState.processual} onClick={onEnrichProcessual} testId="button-enrich-processual" />
        <EnrichButton label="TRF1 Público · PJe" sublabel="Partes · Movimentações · Valor" icon={Globe} state={enrichState.publico} onClick={onEnrichPublico} testId="button-enrich-publico" />
      </div>

      <div className="space-y-6">
        <DataJudSection processo={processo} />
        {enrichState.processual.loading && <EnrichLoading label="Carregando dados do TRF1 Processual..." />}
        {enrichState.processual.error && <EnrichError label="TRF1 Processual" message={enrichState.processual.error} />}
        {enrichState.processual.data && <ProcessualSection data={enrichState.processual.data} />}
        {enrichState.publico.loading && <EnrichLoading label="Carregando dados da Consulta Pública PJe..." />}
        {enrichState.publico.error && <EnrichError label="TRF1 Público (PJe)" message={enrichState.publico.error} />}
        {enrichState.publico.data && <PublicoSection data={enrichState.publico.data} />}
      </div>
    </div>
  );
}

// ─── Enrich Button ──────────────────────────────────────────────

function EnrichButton({ label, sublabel, icon: Icon, state, onClick, testId }: {
  label: string; sublabel: string; icon: typeof Gavel;
  state: { loading: boolean; data: any; error: string };
  onClick: () => void; testId: string;
}) {
  const hasData = !!state.data;
  const hasError = !!state.error;
  return (
    <button
      onClick={onClick}
      disabled={state.loading}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all
        ${hasData ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10"
          : hasError ? "border-destructive/30 bg-destructive/5 hover:border-destructive/50"
          : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"}
        ${state.loading ? "opacity-70 cursor-wait" : "cursor-pointer"}`}
      data-testid={testId}
    >
      <div className={`w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0
        ${hasData ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          : hasError ? "bg-destructive/10 text-destructive"
          : "bg-primary/10 text-primary"}`}>
        {state.loading ? <Loader2 className="w-4 h-4 animate-spin" />
          : hasData ? <CheckCircle2 className="w-4 h-4" />
          : hasError ? <XCircle className="w-4 h-4" />
          : <Icon className="w-4 h-4" />}
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {hasData && <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400">Carregado</Badge>}
        </div>
        <span className="text-xs text-muted-foreground">{sublabel}</span>
      </div>
      {!hasData && !state.loading && !hasError && <Zap className="w-3.5 h-3.5 text-muted-foreground ml-auto" />}
    </button>
  );
}

// ─── Loading & Error helpers ────────────────────────────────────

function EnrichLoading({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
        <Loader2 className="w-4 h-4 animate-spin" /> {label}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  );
}

function EnrichError({ label, message }: { label: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-sm font-medium text-destructive">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{message}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Section Components ─────────────────────────────────────────

function DataJudSection({ processo }: { processo: DataJudProcesso }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden" data-testid="section-datajud">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/50 border-b border-border">
        <Database className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">DataJud · CNJ</span>
      </div>
      <Tabs defaultValue="dados" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <TabsTrigger value="dados" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <Info className="w-3.5 h-3.5 mr-1.5" /> Dados
          </TabsTrigger>
          <TabsTrigger value="assuntos" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Assuntos <span className="ml-1.5 opacity-70">{processo.assuntos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="movimentos" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" /> Movimentos <span className="ml-1.5 opacity-70">{processo.movimentos.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="dados">
          <InfoRow label="Processo" value={formatCNJ(processo.numero_processo)} icon={Hash} />
          <InfoRow label="Classe" value={`${processo.classe} (${processo.classe_codigo})`} icon={FileText} />
          <InfoRow label="Órgão Julgador" value={`${processo.orgao_julgador} (${processo.orgao_julgador_codigo})`} icon={Building2} />
          <InfoRow label="Grau" value={processo.grau} icon={Info} />
          <InfoRow label="Ajuizamento" value={formatDate(processo.data_ajuizamento)} icon={Calendar} />
          <InfoRow label="Últ. Atualização" value={formatDateTime(processo.ultima_atualizacao)} icon={Calendar} />
          <InfoRow label="Sistema" value={processo.sistema} icon={Database} />
          <InfoRow label="Formato" value={processo.formato} icon={Info} />
          <InfoRow label="Sigilo" value={String(processo.nivel_sigilo)} icon={Info} />
          <InfoRow label="Tribunal" value={processo.tribunal} icon={Building2} />
        </TabsContent>
        <TabsContent value="assuntos">
          {processo.assuntos.length === 0 ? <EmptyTab text="Nenhum assunto" /> : (
            <div className="space-y-2">
              {processo.assuntos.map((a, i) => (
                <div key={i} className="flex items-center gap-3 bg-muted/30 rounded-md p-2.5">
                  <Badge variant="outline" className="font-mono text-xs">{a.codigo}</Badge>
                  <span className="text-sm">{a.nome}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="movimentos">
          {processo.movimentos.length === 0 ? <EmptyTab text="Nenhum movimento" /> : (
            <div className="space-y-1">
              {processo.movimentos.map((m, i) => (
                <div key={i} className="flex gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-24 flex-shrink-0"><span className="text-xs text-muted-foreground font-mono">{formatDate(m.data_hora)}</span></div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground mr-2">[{m.codigo}]</span>
                    <span className="text-sm">{m.nome}</span>
                    {m.complementos && <p className="text-xs text-muted-foreground mt-0.5">{m.complementos}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProcessualSection({ data }: { data: Processo }) {
  return (
    <div className="rounded-lg border border-emerald-500/20 overflow-hidden" data-testid="section-processual">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/5 dark:bg-emerald-500/10 border-b border-emerald-500/20">
        <Gavel className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">TRF1 Processual</span>
      </div>
      <Tabs defaultValue="partes" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <TabBtn value="partes" icon={Users} label="Partes" count={data.partes.length} />
          <TabBtn value="movimentacoes" icon={ArrowRightLeft} label="Movimentações" count={data.movimentacoes.length} />
          <TabBtn value="docs" icon={FileText} label="Documentos" count={data.documentos.length} />
          <TabBtn value="dados" icon={Info} label="Dados" />
        </TabsList>
        <TabsContent value="partes">
          {data.partes.length === 0 ? <EmptyTab text="Nenhuma parte" /> : (
            <div className="space-y-2">
              {data.partes.map((p, i) => (
                <div key={i} className="bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="outline" className="text-[10px]">{p.tipo || "Parte"}</Badge>
                    {p.caracteristica && <Badge variant="secondary" className="text-[10px]">{p.caracteristica}</Badge>}
                  </div>
                  <p className="text-sm font-medium">{p.nome}</p>
                  {p.entidade && <p className="text-xs text-muted-foreground">{p.entidade}</p>}
                  {p.oab && <p className="text-xs text-muted-foreground">OAB: {p.oab}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="movimentacoes">
          {data.movimentacoes.length === 0 ? <EmptyTab text="Nenhuma movimentação" /> : (
            <div className="space-y-1">
              {data.movimentacoes.map((m, i) => (
                <div key={i} className="flex gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-24 flex-shrink-0"><span className="text-xs text-muted-foreground font-mono">{m.data}</span></div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground mr-2">[{m.codigo}]</span>
                    <span className="text-sm">{m.descricao}</span>
                    {m.complemento && <p className="text-xs text-muted-foreground mt-0.5">{m.complemento}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="docs">
          {data.documentos.length === 0 ? <EmptyTab text="Nenhum documento" /> : (
            <div className="space-y-1">
              {data.documentos.map((d, i) => (
                <div key={i} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm">{d.descricao}</span>
                    {d.data && <span className="text-xs text-muted-foreground ml-2">{d.data}</span>}
                  </div>
                  {d.url && <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline flex-shrink-0">Abrir</a>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="dados">
          <InfoRow label="Processo" value={data.numero || data.nova_numeracao} icon={Hash} />
          <InfoRow label="Assunto" value={data.assunto} icon={FileText} />
          <InfoRow label="Órgão Julgador" value={data.orgao_julgador} icon={Building2} />
          <InfoRow label="Juiz Relator" value={data.juiz_relator} icon={Users} />
          <InfoRow label="Autuação" value={data.data_autuacao} icon={Calendar} />
          <InfoRow label="Situação" value={data.situacao} icon={Info} />
          <InfoRow label="Proc. Originário" value={data.processo_originario} icon={Hash} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PublicoSection({ data }: { data: TRF1PublicProcess }) {
  return (
    <div className="rounded-lg border border-emerald-500/20 overflow-hidden" data-testid="section-publico">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/5 dark:bg-emerald-500/10 border-b border-emerald-500/20">
        <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">TRF1 Público · PJe</span>
      </div>
      <Tabs defaultValue="partes" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <TabBtn value="partes" icon={Users} label="Partes" count={data.partes.length} />
          <TabBtn value="movimentacoes" icon={ArrowRightLeft} label="Movimentações" count={data.movimentacoes.length} />
          <TabBtn value="docs" icon={FileText} label="Documentos" count={data.documentos?.length ?? 0} />
          <TabBtn value="dados" icon={Info} label="Dados" />
        </TabsList>
        <TabsContent value="partes">
          {data.partes.length === 0 ? <EmptyTab text="Nenhuma parte" /> : (
            <div className="space-y-2">
              {data.partes.map((p, i) => (
                <div key={i} className="bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {p.polo && <Badge variant="outline" className="text-[10px]">{p.polo}</Badge>}
                    {p.tipo_participacao && <Badge variant="secondary" className="text-[10px]">{p.tipo_participacao}</Badge>}
                  </div>
                  <p className="text-sm font-medium">{p.nome}</p>
                  {p.documentos && <p className="text-xs text-muted-foreground">Doc: {p.documentos}</p>}
                  {p.advogados && <p className="text-xs text-muted-foreground">Adv: {p.advogados}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="movimentacoes">
          {data.movimentacoes.length === 0 ? <EmptyTab text="Nenhuma movimentação" /> : (
            <div className="space-y-1">
              {data.movimentacoes.map((m, i) => (
                <div key={i} className="flex gap-3 py-2 border-b border-border/50 last:border-0">
                  <div className="w-24 flex-shrink-0"><span className="text-xs text-muted-foreground font-mono">{m.data}</span></div>
                  <div className="flex-1 min-w-0">
                    {m.tipo && <span className="text-xs text-primary mr-2">[{m.tipo}]</span>}
                    <span className="text-sm">{m.descricao}</span>
                    {m.documentos && m.documentos.length > 0 && (
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {m.documentos.map((d, j) => <Badge key={j} variant="outline" className="text-[10px]">{d}</Badge>)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="docs">
          {!data.documentos || data.documentos.length === 0 ? <EmptyTab text="Nenhum documento" /> : (
            <div className="space-y-2">
              {data.documentos.map((doc, i) => (
                <div key={i} className="bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {doc.data_hora && <Badge variant="outline" className="text-[10px]">{doc.data_hora}</Badge>}
                    {doc.certidao && <Badge variant="secondary" className="text-[10px]">{doc.certidao}</Badge>}
                  </div>
                  <p className="text-sm font-medium">{doc.documento || "Documento"}</p>
                  <div className="flex gap-3 mt-1">
                    {doc.url_documento && <a href={doc.url_documento} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Abrir documento</a>}
                    {doc.url_certidao && <a href={doc.url_certidao} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Abrir certidão</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="dados">
          <InfoRow label="Processo" value={data.numero_processo} icon={Hash} />
          <InfoRow label="Classe" value={data.classe} icon={FileText} />
          <InfoRow label="Assunto" value={data.assunto} icon={FileText} />
          <InfoRow label="Órgão Julgador" value={data.orgao_julgador} icon={Building2} />
          <InfoRow label="Jurisdição" value={data.jurisdicao || ""} icon={Building2} />
          <InfoRow label="Distribuição" value={data.data_distribuicao} icon={Calendar} />
          <InfoRow label="Valor da Causa" value={data.valor_causa} icon={DollarSign} />
          <InfoRow label="Situação" value={data.situacao} icon={Info} />
          <InfoRow label="Processo referência" value={data.processo_referencia || ""} icon={Hash} />
          <InfoRow label="Polo ativo (resumo)" value={data.polo_ativo || ""} icon={Users} />
          <InfoRow label="Polo passivo (resumo)" value={data.polo_passivo || ""} icon={Users} />
          <InfoRow label="Advogados (resumo)" value={data.advogados_resumo || ""} icon={Users} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Shared UI atoms ────────────────────────────────────────────

function TabBtn({ value, icon: Icon, label, count }: { value: string; icon: typeof Info; label: string; count?: number }) {
  return (
    <TabsTrigger value={value} className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=inactive]:bg-muted">
      <Icon className="w-3.5 h-3.5 mr-1.5" /> {label}
      {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
    </TabsTrigger>
  );
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="flex items-start gap-2 w-36 flex-shrink-0">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />}
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <span className="text-sm flex-1">{value}</span>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return <div className="text-center py-8 text-muted-foreground text-sm">{text}</div>;
}
