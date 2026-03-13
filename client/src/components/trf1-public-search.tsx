import { useState } from "react";
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
  Globe,
  AlertCircle,
  ChevronLeft,
  Users,
  ArrowRightLeft,
  Info,
  Hash,
  Building2,
  Calendar,
  FileText,
  DollarSign,
} from "lucide-react";
import type { TRF1PublicProcess } from "@shared/schema";

const UFS = [
  "AC","AL","AM","AP","BA","CE","DF","ES","GO","MA","MG","MS","MT",
  "PA","PB","PE","PI","PR","RJ","RN","RO","RR","RS","SC","SE","SP","TO"
];

type SearchMode = "numero" | "parte" | "documento" | "advogado" | "oab";

const searchModeLabels: Record<SearchMode, string> = {
  numero: "Número do Processo",
  parte: "Nome da Parte",
  documento: "CPF/CNPJ",
  advogado: "Nome do Advogado",
  oab: "Número OAB",
};

interface SearchState {
  loading: boolean;
  error: string;
  total: number;
  processos: TRF1PublicProcess[];
}

export function TRF1PublicSearch() {
  const [mode, setMode] = useState<SearchMode>("numero");
  const [valor, setValor] = useState("");
  const [oabUf, setOabUf] = useState("");
  const [selected, setSelected] = useState<TRF1PublicProcess | null>(null);
  const [state, setState] = useState<SearchState>({
    loading: false,
    error: "",
    total: 0,
    processos: [],
  });

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!valor.trim()) return;

    setState({ loading: true, error: "", total: 0, processos: [] });

    try {
      const params = new URLSearchParams();
      if (mode === "numero") params.set("numero", valor.trim());
      else if (mode === "parte") params.set("nome_parte", valor.trim());
      else if (mode === "documento") params.set("documento", valor.trim());
      else if (mode === "advogado") params.set("nome_advogado", valor.trim());
      else if (mode === "oab") {
        params.set("oab", valor.trim());
        if (oabUf) params.set("oab_uf", oabUf);
      }

      const res = await apiRequest("GET", `/api/trf1publico/buscar?${params.toString()}`);
      const json = await res.json();

      if (json.success && json.data) {
        setState({
          loading: false,
          error: "",
          total: json.data.total_results,
          processos: json.data.processos,
        });
      } else {
        setState({ loading: false, error: json.error || "Erro na busca", total: 0, processos: [] });
      }
    } catch (err: any) {
      const msg = err?.message?.includes("503")
        ? "Enriquecimento TRF1 indisponível neste ambiente. O scraper Playwright pode estar bloqueado neste servidor."
        : "Erro de conexão com o servidor";
      setState({ loading: false, error: msg, total: 0, processos: [] });
    }
  }

  if (selected) {
    return (
      <TRF1PublicProcessoView
        processo={selected}
        onBack={() => setSelected(null)}
      />
    );
  }

  const placeholders: Record<SearchMode, string> = {
    numero: "Ex: 0003653-54.2020.4.01.3400",
    parte: "Ex: João da Silva",
    documento: "Ex: 123.456.789-00",
    advogado: "Ex: Maria Souza",
    oab: "Ex: 12345",
  };

  return (
    <div>
      <form onSubmit={handleSearch} className="space-y-4" data-testid="trf1pub-search-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Tipo de Busca</Label>
            <Select value={mode} onValueChange={(v) => setMode(v as SearchMode)}>
              <SelectTrigger data-testid="select-trf1pub-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(searchModeLabels).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === "oab" && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">UF da OAB</Label>
              <Select value={oabUf} onValueChange={setOabUf}>
                <SelectTrigger data-testid="select-oab-uf">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {UFS.map((uf) => (
                    <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              placeholder={placeholders[mode]}
              className="h-10"
              data-testid="input-trf1pub-valor"
            />
          </div>
          <Button
            type="submit"
            disabled={!valor.trim() || state.loading}
            className="h-10 px-5"
            data-testid="button-trf1pub-search"
          >
            {state.loading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Search className="w-4 h-4 mr-2" />
            )}
            Buscar
          </Button>
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Globe className="w-3 h-3" />
          Consulta pública do PJe 1º Grau — TRF1. Pode levar alguns segundos (navegação automatizada).
        </p>
      </form>

      {/* Error */}
      {state.error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive mt-4" data-testid="trf1pub-error">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{state.error}</p>
        </div>
      )}

      {/* Loading */}
      {state.loading && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Consultando o PJe do TRF1 (1ª Instância)...
          </div>
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {/* Results */}
      {!state.loading && state.processos.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              {state.total > 0 ? `${state.total} resultado(s)` : `${state.processos.length} processo(s)`}
            </span>
          </div>

          <div className="space-y-2">
            {state.processos.map((p, i) => (
              <button
                key={`${p.numero_processo}-${i}`}
                onClick={() => setSelected(p)}
                className="w-full text-left bg-card border border-border rounded-lg p-4 hover:border-primary/40 hover:bg-accent/30 transition-colors"
                data-testid={`card-trf1pub-${i}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold font-mono">
                      {p.numero_processo}
                    </span>
                    <p className="text-sm text-muted-foreground mt-1">{p.classe}</p>
                    {p.assunto && (
                      <p className="text-xs text-muted-foreground mt-0.5">{p.assunto}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">{p.orgao_julgador}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    {p.situacao && <Badge variant="secondary" className="text-[10px]">{p.situacao}</Badge>}
                    {p.data_distribuicao && (
                      <p className="text-xs text-muted-foreground mt-1">{p.data_distribuicao}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!state.loading && state.processos.length === 0 && !state.error && (
        <div className="text-center py-16 text-muted-foreground" data-testid="trf1pub-empty">
          <Globe className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm">Consulta pública do PJe — 1ª instância TRF1.</p>
          <p className="text-xs mt-1 opacity-70">
            Busque por número do processo, nome da parte, CPF/CNPJ, advogado ou OAB.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Detalhe TRF1 Público ───────────────────────────────────────

function TRF1PublicProcessoView({
  processo,
  onBack,
}: {
  processo: TRF1PublicProcess;
  onBack: () => void;
}) {
  return (
    <div data-testid="trf1pub-processo-view">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        data-testid="button-back-trf1pub"
      >
        <ChevronLeft className="w-4 h-4" />
        Voltar aos resultados
      </button>

      {/* Header */}
      <div className="mb-5">
        <h2 className="text-lg font-semibold font-mono" data-testid="text-trf1pub-numero">
          {processo.numero_processo}
        </h2>
        <p className="text-sm text-muted-foreground mt-0.5">{processo.classe}</p>
        {processo.situacao && (
          <Badge variant="secondary" className="mt-1">{processo.situacao}</Badge>
        )}
      </div>

      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <TabsTrigger value="dados" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <Info className="w-3.5 h-3.5 mr-1.5" />
            Dados
          </TabsTrigger>
          <TabsTrigger value="partes" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <Users className="w-3.5 h-3.5 mr-1.5" />
            Partes
            <span className="ml-1.5 opacity-70">{processo.partes.length}</span>
          </TabsTrigger>
          <TabsTrigger value="movimentacoes" className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted">
            <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
            Movimentações
            <span className="ml-1.5 opacity-70">{processo.movimentacoes.length}</span>
          </TabsTrigger>
        </TabsList>

        {/* Dados */}
        <TabsContent value="dados">
          <div className="bg-card border border-border rounded-lg p-4">
            <PubInfoRow label="Processo" value={processo.numero_processo} icon={Hash} />
            <PubInfoRow label="Classe" value={processo.classe} icon={FileText} />
            <PubInfoRow label="Assunto" value={processo.assunto} icon={FileText} />
            <PubInfoRow label="Órgão Julgador" value={processo.orgao_julgador} icon={Building2} />
            <PubInfoRow label="Distribuição" value={processo.data_distribuicao} icon={Calendar} />
            <PubInfoRow label="Valor da Causa" value={processo.valor_causa} icon={DollarSign} />
            <PubInfoRow label="Situação" value={processo.situacao} icon={Info} />
          </div>
        </TabsContent>

        {/* Partes */}
        <TabsContent value="partes">
          {processo.partes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma parte encontrada</div>
          ) : (
            <div className="space-y-2">
              {processo.partes.map((p, i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-3" data-testid={`card-trf1pub-parte-${i}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Users className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.polo && <Badge variant="outline" className="text-[10px]">{p.polo}</Badge>}
                        {p.tipo_participacao && <Badge variant="secondary" className="text-[10px]">{p.tipo_participacao}</Badge>}
                      </div>
                      <p className="text-sm font-medium mt-1">{p.nome}</p>
                      {p.documentos && <p className="text-xs text-muted-foreground mt-0.5">Doc: {p.documentos}</p>}
                      {p.advogados && <p className="text-xs text-muted-foreground mt-0.5">Adv: {p.advogados}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Movimentações */}
        <TabsContent value="movimentacoes">
          {processo.movimentacoes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma movimentação</div>
          ) : (
            <div className="space-y-1">
              {processo.movimentacoes.map((m, i) => (
                <div key={i} className="flex gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`row-trf1pub-mov-${i}`}>
                  <div className="w-24 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-mono">{m.data}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {m.tipo && <span className="text-xs text-primary mr-2">[{m.tipo}]</span>}
                    <span className="text-sm">{m.descricao}</span>
                    {m.documentos && m.documentos.length > 0 && (
                      <div className="mt-1 flex gap-1 flex-wrap">
                        {m.documentos.map((d, j) => (
                          <Badge key={j} variant="outline" className="text-[10px]">{d}</Badge>
                        ))}
                      </div>
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

function PubInfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
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
