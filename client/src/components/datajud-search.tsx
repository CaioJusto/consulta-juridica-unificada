import { useState, useEffect } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "lucide-react";
import type { TribunalOption, DataJudProcesso } from "@shared/schema";

function formatCNJ(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 20) {
    return `${digits.slice(0,7)}-${digits.slice(7,9)}.${digits.slice(9,13)}.${digits.slice(13,14)}.${digits.slice(14,16)}.${digits.slice(16,20)}`;
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

interface SearchState {
  loading: boolean;
  error: string;
  total: number;
  processos: DataJudProcesso[];
  searchAfter: any[] | null;
  hasMore: boolean;
}

export function DataJudSearch() {
  const TRIBUNAIS_FALLBACK: TribunalOption[] = [
    { label: "TRF da 1ª Região", alias: "api_publica_trf1" },
    { label: "TRF da 2ª Região", alias: "api_publica_trf2" },
    { label: "TRF da 3ª Região", alias: "api_publica_trf3" },
    { label: "TRF da 4ª Região", alias: "api_publica_trf4" },
    { label: "TRF da 5ª Região", alias: "api_publica_trf5" },
    { label: "TRF da 6ª Região", alias: "api_publica_trf6" },
    { label: "Superior Tribunal de Justiça", alias: "api_publica_stj" },
    { label: "TST", alias: "api_publica_tst" },
    { label: "TSE", alias: "api_publica_tse" },
    { label: "STM", alias: "api_publica_stm" },
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
  ];
  const [tribunais, setTribunais] = useState<TribunalOption[]>(TRIBUNAIS_FALLBACK);
  const [tribunal, setTribunal] = useState("api_publica_trf1");
  const [numero, setNumero] = useState("");
  const [classeCodigo, setClasseCodigo] = useState("");
  const [assuntoCodigo, setAssuntoCodigo] = useState("");
  const [grau, setGrau] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedProcesso, setSelectedProcesso] = useState<DataJudProcesso | null>(null);

  const [state, setState] = useState<SearchState>({
    loading: false,
    error: "",
    total: 0,
    processos: [],
    searchAfter: null,
    hasMore: false,
  });

  // Carregar tribunais
  useEffect(() => {
    apiRequest("GET", "/api/datajud/tribunais")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setTribunais(json.data);
      })
      .catch(() => {});
  }, []);

  async function handleSearch(e?: React.FormEvent, loadMore = false) {
    if (e) e.preventDefault();
    if (!loadMore) {
      setState({ loading: true, error: "", total: 0, processos: [], searchAfter: null, hasMore: false });
    } else {
      setState((s) => ({ ...s, loading: true, error: "" }));
    }

    try {
      const body: any = {
        tribunal_alias: tribunal,
        page_size: 20,
      };
      if (numero.trim()) body.numero_processo = numero.trim();
      if (classeCodigo.trim()) body.classe_codigo = parseInt(classeCodigo.trim());
      if (assuntoCodigo.trim()) body.assunto_codigo = parseInt(assuntoCodigo.trim());
      if (grau && grau !== "all" && grau !== "__all__") body.grau = grau;
      if (dataInicio) body.data_ajuizamento_inicio = dataInicio;
      if (dataFim) body.data_ajuizamento_fim = dataFim;
      if (loadMore && state.searchAfter) body.search_after = state.searchAfter;

      const res = await apiRequest("POST", "/api/datajud/buscar", body);
      const json = await res.json();

      if (json.success && json.data) {
        const newProcessos = json.data.processos || [];
        setState((s) => ({
          loading: false,
          error: "",
          total: json.data.total,
          processos: loadMore ? [...s.processos, ...newProcessos] : newProcessos,
          searchAfter: json.data.search_after,
          hasMore: newProcessos.length >= 20,
        }));
      } else {
        setState((s) => ({ ...s, loading: false, error: json.error || "Erro na busca" }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: "Erro de conexão com o servidor" }));
    }
  }

  if (selectedProcesso) {
    return (
      <DataJudProcessoView
        processo={selectedProcesso}
        onBack={() => setSelectedProcesso(null)}
      />
    );
  }

  return (
    <div>
      {/* Search form */}
      <form onSubmit={handleSearch} className="space-y-4" data-testid="datajud-search-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Tribunal</Label>
            <Select value={tribunal} onValueChange={setTribunal}>
              <SelectTrigger data-testid="select-tribunal">
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
            <Label className="text-xs font-medium text-muted-foreground">
              Número do Processo
            </Label>
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ex: 0003653-54.2020.4.01.3400"
              data-testid="input-datajud-numero"
            />
          </div>
        </div>

        {/* Expandable filters */}
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          data-testid="button-toggle-filters"
        >
          {showFilters ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Filtros avançados
        </button>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pl-2 border-l-2 border-primary/20">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Código da Classe</Label>
              <Input
                value={classeCodigo}
                onChange={(e) => setClasseCodigo(e.target.value)}
                placeholder="Ex: 1116"
                data-testid="input-classe-codigo"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Código do Assunto</Label>
              <Input
                value={assuntoCodigo}
                onChange={(e) => setAssuntoCodigo(e.target.value)}
                placeholder="Ex: 10672"
                data-testid="input-assunto-codigo"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Grau</Label>
              <Select value={grau} onValueChange={setGrau}>
                <SelectTrigger data-testid="select-grau">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="G1">1º Grau</SelectItem>
                  <SelectItem value="G2">2º Grau</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Data Ajuizamento (de)</Label>
              <Input
                type="date"
                value={dataInicio}
                onChange={(e) => setDataInicio(e.target.value)}
                data-testid="input-data-inicio"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Data Ajuizamento (até)</Label>
              <Input
                type="date"
                value={dataFim}
                onChange={(e) => setDataFim(e.target.value)}
                data-testid="input-data-fim"
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            type="submit"
            disabled={state.loading}
            className="h-10 px-5"
            data-testid="button-datajud-search"
          >
            {state.loading && !state.processos.length ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Buscar no DataJud
          </Button>
        </div>
      </form>

      {/* Error */}
      {state.error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive mt-4" data-testid="datajud-error">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{state.error}</p>
        </div>
      )}

      {/* Results */}
      {state.total > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {state.total.toLocaleString("pt-BR")} processo(s) encontrado(s)
            </span>
          </div>

          <div className="space-y-2">
            {state.processos.map((p, i) => (
              <button
                key={`${p.numero_processo}-${i}`}
                onClick={() => setSelectedProcesso(p)}
                className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors"
                data-testid={`card-datajud-${i}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold font-mono">
                        {formatCNJ(p.numero_processo)}
                      </span>
                      {p.grau && (
                        <Badge variant="outline" className="text-[10px]">
                          {p.grau}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{p.classe}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.orgao_julgador}
                    </p>
                    {p.assuntos.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.assuntos.slice(0, 3).map((a, j) => (
                          <Badge key={j} variant="secondary" className="text-[10px]">
                            {a.nome}
                          </Badge>
                        ))}
                        {p.assuntos.length > 3 && (
                          <Badge variant="secondary" className="text-[10px]">
                            +{p.assuntos.length - 3}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs text-muted-foreground">
                      {formatDate(p.data_ajuizamento)}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {p.movimentos.length} mov.
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Load more */}
          {state.hasMore && (
            <div className="mt-4 text-center">
              <Button
                variant="outline"
                onClick={() => handleSearch(undefined, true)}
                disabled={state.loading}
                data-testid="button-load-more"
              >
                {state.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : null}
                Carregar mais resultados
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
        <div className="text-center py-16 text-muted-foreground" data-testid="datajud-empty">
          <Database className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm">API pública do DataJud — base de dados do CNJ.</p>
          <p className="text-xs mt-1 opacity-70">
            Busque por número do processo, classe, assunto ou período.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Detalhe do processo DataJud ────────────────────────────────

function DataJudProcessoView({
  processo,
  onBack,
}: {
  processo: DataJudProcesso;
  onBack: () => void;
}) {
  return (
    <div data-testid="datajud-processo-view">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        data-testid="button-back-datajud"
      >
        <ChevronLeft className="w-4 h-4" />
        Voltar aos resultados
      </button>

      {/* Header */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-lg font-semibold font-mono" data-testid="text-datajud-numero">
              {formatCNJ(processo.numero_processo)}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">{processo.classe}</p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {processo.grau && (
              <Badge variant="outline">
                {processo.grau === "G1" ? "1º Grau" : processo.grau === "G2" ? "2º Grau" : processo.grau}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{processo.tribunal}</p>
      </div>

      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <TabsTrigger value="dados" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <Info className="w-3.5 h-3.5 mr-1.5" />
            Dados
          </TabsTrigger>
          <TabsTrigger value="assuntos" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Assuntos
            <span className="ml-1.5 opacity-70">{processo.assuntos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="movimentos" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
            Movimentos
            <span className="ml-1.5 opacity-70">{processo.movimentos.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* Dados */}
        <TabsContent value="dados">
          <div className="bg-card border border-border rounded-lg p-4">
            <DJInfoRow label="Processo" value={formatCNJ(processo.numero_processo)} icon={Hash} />
            <DJInfoRow label="Classe" value={`${processo.classe} (${processo.classe_codigo})`} icon={FileText} />
            <DJInfoRow label="Órgão Julgador" value={`${processo.orgao_julgador} (${processo.orgao_julgador_codigo})`} icon={Building2} />
            <DJInfoRow label="Grau" value={processo.grau} icon={Info} />
            <DJInfoRow label="Ajuizamento" value={formatDate(processo.data_ajuizamento)} icon={Calendar} />
            <DJInfoRow label="Última Atualização" value={formatDateTime(processo.ultima_atualizacao)} icon={Calendar} />
            <DJInfoRow label="Sistema" value={processo.sistema} icon={Database} />
            <DJInfoRow label="Formato" value={processo.formato} icon={Info} />
            <DJInfoRow label="Nível Sigilo" value={String(processo.nivel_sigilo)} icon={Info} />
            <DJInfoRow label="Tribunal" value={processo.tribunal} icon={Building2} />
          </div>
        </TabsContent>

        {/* Assuntos */}
        <TabsContent value="assuntos">
          {processo.assuntos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhum assunto</div>
          ) : (
            <div className="space-y-2">
              {processo.assuntos.map((a, i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3" data-testid={`card-assunto-${i}`}>
                  <Badge variant="outline" className="font-mono text-xs">{a.codigo}</Badge>
                  <span className="text-sm">{a.nome}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Movimentos */}
        <TabsContent value="movimentos">
          {processo.movimentos.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhum movimento</div>
          ) : (
            <div className="space-y-1">
              {processo.movimentos.map((m, i) => (
                <div key={i} className="flex gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`row-dj-mov-${i}`}>
                  <div className="w-24 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDate(m.data_hora)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted-foreground mr-2">[{m.codigo}]</span>
                    <span className="text-sm">{m.nome}</span>
                    {m.complementos && (
                      <p className="text-xs text-muted-foreground mt-0.5">{m.complementos}</p>
                    )}
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

function DJInfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2 border-b border-border/50 last:border-0">
      <div className="flex items-start gap-2 w-40 flex-shrink-0">
        {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5" />}
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <span className="text-sm flex-1">{value}</span>
    </div>
  );
}
