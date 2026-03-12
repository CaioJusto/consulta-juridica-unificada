/**
 * Unified View — busca um número de processo nas 3 fontes em paralelo
 * (DataJud + TRF1 Processual + TRF1 Público) e exibe o MÁXIMO de dados de cada fonte.
 *
 * Filosofia: cada fonte mostra seus dados de forma completa e independente.
 * Não há "complementação" — DataJud mostra seus movimentos, TRF1 mostra os seus,
 * PJe mostra os seus. O usuário vê tudo.
 */
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Loader2,
  Database,
  Gavel,
  Globe,
  AlertCircle,
  Layers,
  CheckCircle2,
  XCircle,
  FileText,
  Users,
  ArrowRightLeft,
  Info,
  Hash,
  Building2,
  Calendar,
  DollarSign,
  Paperclip,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { DataJudProcesso, Processo, TRF1PublicProcess } from "@shared/schema";

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

// ─── types ──────────────────────────────────────────────────

interface SourceResult<T> {
  loading: boolean;
  data: T | null;
  error: string;
}

interface UnifiedResults {
  datajud: SourceResult<DataJudProcesso>;
  processual: SourceResult<Processo>;
  publico: SourceResult<TRF1PublicProcess>;
}

const emptySource = <T,>(): SourceResult<T> => ({ loading: false, data: null, error: "" });

// ─── main component ──────────────────────────────────────────

export function UnifiedView() {
  const [numero, setNumero] = useState("");
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<UnifiedResults>({
    datajud: emptySource(),
    processual: emptySource(),
    publico: emptySource(),
  });

  const loading = results.datajud.loading || results.processual.loading || results.publico.loading;

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const num = numero.trim();
    if (!num) return;

    setSearched(true);
    setResults({
      datajud: { loading: true, data: null, error: "" },
      processual: { loading: true, data: null, error: "" },
      publico: { loading: true, data: null, error: "" },
    });

    const digits = num.replace(/\D/g, "");
    const formatted = formatCNJ(num);

    const fetchDatajud = apiRequest("POST", "/api/datajud/buscar", {
      tribunal_alias: "api_publica_trf1",
      numero_processo: num,
      page_size: 1,
    })
      .then((r) => r.json())
      .then((json) => {
        const data =
          json.success && json.data?.processos?.length > 0
            ? (json.data.processos[0] as DataJudProcesso)
            : null;
        const error = data ? "" : json.error || "Não encontrado no DataJud";
        setResults((prev) => ({ ...prev, datajud: { loading: false, data, error } }));
      })
      .catch(() =>
        setResults((prev) => ({
          ...prev,
          datajud: { loading: false, data: null, error: "Erro ao consultar DataJud" },
        }))
      );

    const fetchProcessual = apiRequest(
      "GET",
      `/api/processo?numero=${encodeURIComponent(digits)}&secao=TRF1`
    )
      .then((r) => r.json())
      .then((json) => {
        const data = json.success && json.data ? (json.data as Processo) : null;
        const error = data ? "" : json.error || "Não encontrado no TRF1 Processual";
        setResults((prev) => ({ ...prev, processual: { loading: false, data, error } }));
      })
      .catch(() =>
        setResults((prev) => ({
          ...prev,
          processual: { loading: false, data: null, error: "Erro ao consultar TRF1 Processual" },
        }))
      );

    const fetchPublico = apiRequest(
      "GET",
      `/api/trf1publico/buscar?numero=${encodeURIComponent(formatted)}`
    )
      .then((r) => r.json())
      .then((json) => {
        const data =
          json.success && json.data?.processos?.length > 0
            ? (json.data.processos[0] as TRF1PublicProcess)
            : null;
        const error = data ? "" : json.error || "Não encontrado na Consulta Pública PJe";
        setResults((prev) => ({ ...prev, publico: { loading: false, data, error } }));
      })
      .catch(() =>
        setResults((prev) => ({
          ...prev,
          publico: { loading: false, data: null, error: "Erro ao consultar TRF1 Público" },
        }))
      );

    await Promise.allSettled([fetchDatajud, fetchProcessual, fetchPublico]);
  }

  const fontes = [
    {
      key: "datajud" as const,
      label: "DataJud · CNJ",
      icon: Database,
      color: "text-blue-600 dark:text-blue-400",
      border: "border-blue-500/20",
      bg: "bg-blue-500/5",
    },
    {
      key: "processual" as const,
      label: "TRF1 Processual",
      icon: Gavel,
      color: "text-emerald-600 dark:text-emerald-400",
      border: "border-emerald-500/20",
      bg: "bg-emerald-500/5 dark:bg-emerald-500/10",
    },
    {
      key: "publico" as const,
      label: "TRF1 Público · PJe",
      icon: Globe,
      color: "text-violet-600 dark:text-violet-400",
      border: "border-violet-500/20",
      bg: "bg-violet-500/5 dark:bg-violet-500/10",
    },
  ];

  const foundCount = fontes.filter((f) => results[f.key].data).length;

  return (
    <div>
      {/* Search form */}
      <form onSubmit={handleSearch} className="space-y-4" data-testid="unified-search-form">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2 space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Número do Processo</Label>
            <Input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="Ex: 0003653-54.2020.4.01.3400"
              className="h-10"
              data-testid="input-unified-numero"
            />
          </div>
          <Button
            type="submit"
            disabled={!numero.trim() || loading}
            className="h-10 px-5 gap-2"
            data-testid="button-unified-search"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Buscar nas 3 fontes
          </Button>
        </div>
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Layers className="w-3 h-3" />
          Consulta simultânea: DataJud · TRF1 Processual · TRF1 Público (PJe) — dados completos de cada fonte
        </p>
      </form>

      {/* Status row */}
      {searched && (
        <div className="flex flex-wrap gap-2 mt-5 mb-4">
          {fontes.map((f) => {
            const src = results[f.key];
            const Icon = f.icon;
            return (
              <div
                key={f.key}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs ${f.border} ${f.bg}`}
              >
                {src.loading ? (
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                ) : src.data ? (
                  <CheckCircle2 className={`w-3 h-3 ${f.color}`} />
                ) : (
                  <XCircle className="w-3 h-3 text-muted-foreground/50" />
                )}
                <Icon className={`w-3 h-3 ${f.color}`} />
                <span className={src.data ? f.color : "text-muted-foreground"}>{f.label}</span>
                {src.data && (
                  <Badge
                    variant="outline"
                    className={`text-[9px] border-current ${f.color} ml-1`}
                  >
                    encontrado
                  </Badge>
                )}
              </div>
            );
          })}
          {!loading && searched && foundCount > 0 && (
            <Badge variant="secondary" className="text-xs self-center ml-1">
              {foundCount}/3 {foundCount === 1 ? "fonte encontrou" : "fontes encontraram"} dados
            </Badge>
          )}
        </div>
      )}

      {/* Consolidated summary when all done */}
      {searched && !loading && foundCount > 0 && (
        <ConsolidatedSummary
          datajud={results.datajud.data}
          processual={results.processual.data}
          publico={results.publico.data}
        />
      )}

      {/* Source cards */}
      {searched && (
        <div className="space-y-4 mt-4">
          {/* DataJud */}
          {results.datajud.loading ? (
            <SourceSkeleton label="DataJud · CNJ" color="blue" />
          ) : results.datajud.data ? (
            <DataJudResult data={results.datajud.data} />
          ) : results.datajud.error ? (
            <SourceError
              label="DataJud · CNJ"
              icon={Database}
              message={results.datajud.error}
              color="text-blue-600 dark:text-blue-400"
            />
          ) : null}

          {/* TRF1 Processual */}
          {results.processual.loading ? (
            <SourceSkeleton label="TRF1 Processual" color="emerald" />
          ) : results.processual.data ? (
            <ProcessualResult data={results.processual.data} />
          ) : results.processual.error ? (
            <SourceError
              label="TRF1 Processual"
              icon={Gavel}
              message={results.processual.error}
              color="text-emerald-600 dark:text-emerald-400"
            />
          ) : null}

          {/* TRF1 Público */}
          {results.publico.loading ? (
            <SourceSkeleton label="TRF1 Público · PJe" color="violet" />
          ) : results.publico.data ? (
            <PublicoResult data={results.publico.data} />
          ) : results.publico.error ? (
            <SourceError
              label="TRF1 Público · PJe"
              icon={Globe}
              message={results.publico.error}
              color="text-violet-600 dark:text-violet-400"
            />
          ) : null}
        </div>
      )}

      {/* Empty state */}
      {!searched && (
        <div className="text-center py-16 text-muted-foreground" data-testid="unified-empty">
          <Layers className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium">Busca Unificada — Máximo de Dados</p>
          <p className="text-xs mt-1.5 opacity-70 max-w-md mx-auto">
            Consulta simultânea nas 3 fontes. Cada fonte exibe seus próprios dados de forma
            completa: movimentos do DataJud, movimentações do TRF1 e do PJe, partes de cada fonte.
          </p>
          <div className="flex items-center justify-center gap-4 mt-4 text-[11px] text-muted-foreground/60 flex-wrap">
            <span className="flex items-center gap-1">
              <Database className="w-3.5 h-3.5" /> DataJud: dados + {"{"}n{"}"} movimentos
            </span>
            <span className="text-muted-foreground/30">+</span>
            <span className="flex items-center gap-1">
              <Gavel className="w-3.5 h-3.5" /> TRF1: partes + documentos + movimentações
            </span>
            <span className="text-muted-foreground/30">+</span>
            <span className="flex items-center gap-1">
              <Globe className="w-3.5 h-3.5" /> PJe: valor + partes + movimentações
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Consolidated Summary ─────────────────────────────────────

function ConsolidatedSummary({
  datajud,
  processual,
  publico,
}: {
  datajud: DataJudProcesso | null;
  processual: Processo | null;
  publico: TRF1PublicProcess | null;
}) {
  const sorted = datajud
    ? [...datajud.movimentos].sort((a, b) =>
        (b.data_hora || "").localeCompare(a.data_hora || "")
      )
    : [];
  const lastDJ = sorted[0];

  const poloAtivo = processual
    ? processual.partes
        .filter((p) => !p.oab && p.tipo?.toUpperCase().includes("ATIVO"))
        .slice(0, 2)
        .map((p) => p.nome)
        .join(", ")
    : publico
    ? publico.partes
        .filter((p) => p.polo !== "ADV" && p.polo?.toUpperCase().includes("AT"))
        .slice(0, 2)
        .map((p) => p.nome)
        .join(", ")
    : "";

  const poloPassivo = processual
    ? processual.partes
        .filter((p) => !p.oab && p.tipo?.toUpperCase().includes("PASSIVO"))
        .slice(0, 2)
        .map((p) => p.nome)
        .join(", ")
    : publico
    ? publico.partes
        .filter((p) => p.polo !== "ADV" && p.polo?.toUpperCase().includes("PASS"))
        .slice(0, 2)
        .map((p) => p.nome)
        .join(", ")
    : "";

  const qtdMovsDJ = datajud?.movimentos.length ?? 0;
  const qtdMovsP1 = processual?.movimentacoes.length ?? 0;
  const qtdMovsPJe = publico?.movimentacoes.length ?? 0;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-semibold text-primary uppercase tracking-wider">
          Consolidado — dados combinados das 3 fontes
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        {datajud && (
          <MiniStat
            label="Classe / Grau"
            value={`${datajud.classe} · ${datajud.grau}`}
            icon={<FileText className="w-3 h-3 text-blue-500" />}
          />
        )}
        {(processual?.situacao || publico?.situacao) && (
          <MiniStat
            label="Situação"
            value={processual?.situacao || publico?.situacao || ""}
            icon={<Info className="w-3 h-3 text-emerald-500" />}
          />
        )}
        {publico?.valor_causa && (
          <MiniStat
            label="Valor da Causa"
            value={publico.valor_causa}
            icon={<DollarSign className="w-3 h-3 text-violet-500" />}
          />
        )}
        <MiniStat
          label="Movimentos totais"
          value={`DJ:${qtdMovsDJ} + P1:${qtdMovsP1} + PJe:${qtdMovsPJe}`}
          icon={<ArrowRightLeft className="w-3 h-3 text-orange-500" />}
        />
      </div>

      {(poloAtivo || poloPassivo) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-primary/10">
          {poloAtivo && (
            <div>
              <span className="text-muted-foreground font-medium">Polo Ativo: </span>
              <span>{poloAtivo}</span>
            </div>
          )}
          {poloPassivo && (
            <div>
              <span className="text-muted-foreground font-medium">Polo Passivo: </span>
              <span>{poloPassivo}</span>
            </div>
          )}
        </div>
      )}

      {lastDJ && (
        <div className="text-xs pt-1 border-t border-primary/10">
          <span className="text-muted-foreground font-medium">Última mov. DataJud: </span>
          <span>{formatDate(lastDJ.data_hora)} — {lastDJ.nome}</span>
        </div>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="mt-0.5">{icon}</div>
      <div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="font-medium leading-tight">{value}</div>
      </div>
    </div>
  );
}

// ─── DataJud result block ─────────────────────────────────────

function DataJudResult({ data }: { data: DataJudProcesso }) {
  const sorted = [...data.movimentos].sort((a, b) =>
    (b.data_hora || "").localeCompare(a.data_hora || "")
  );

  return (
    <div className="rounded-lg border border-blue-500/20 overflow-hidden" data-testid="unified-datajud">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-500/5 border-b border-blue-500/20">
        <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
          DataJud · CNJ
        </span>
        <Badge
          variant="outline"
          className="text-[10px] border-blue-500/30 text-blue-600 dark:text-blue-400 ml-auto"
        >
          encontrado
        </Badge>
      </div>
      <Tabs defaultValue="dados" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <UTabTrigger value="dados" icon={Info} label="Dados" color="blue" />
          <UTabTrigger
            value="assuntos"
            icon={FileText}
            label="Assuntos"
            count={data.assuntos.length}
            color="blue"
          />
          <UTabTrigger
            value="movimentos"
            icon={ArrowRightLeft}
            label="Movimentos"
            count={sorted.length}
            color="blue"
          />
        </TabsList>

        <TabsContent value="dados">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <UInfoRow label="Processo" value={formatCNJ(data.numero_processo)} icon={Hash} />
            <UInfoRow label="Classe" value={`${data.classe} (${data.classe_codigo})`} icon={FileText} />
            <UInfoRow label="Órgão Julgador" value={data.orgao_julgador} icon={Building2} />
            <UInfoRow label="Grau" value={data.grau} icon={Info} />
            <UInfoRow label="Ajuizamento" value={formatDate(data.data_ajuizamento)} icon={Calendar} />
            <UInfoRow
              label="Última Atualização"
              value={formatDateTime(data.ultima_atualizacao)}
              icon={Calendar}
            />
            <UInfoRow label="Tribunal" value={data.tribunal} icon={Building2} />
            <UInfoRow label="Sistema" value={data.sistema} icon={Info} />
            <UInfoRow label="Formato" value={data.formato} icon={Info} />
          </div>
        </TabsContent>

        <TabsContent value="assuntos">
          {data.assuntos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum assunto</p>
          ) : (
            <div className="space-y-1.5">
              {data.assuntos.map((a, i) => (
                <div key={i} className="flex items-center gap-3 bg-muted/30 rounded-md p-2.5">
                  <Badge variant="outline" className="font-mono text-xs">
                    {a.codigo}
                  </Badge>
                  <span className="text-sm">{a.nome}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="movimentos">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhum movimento</p>
          ) : (
            <div className="space-y-0.5 max-h-80 overflow-y-auto border border-border rounded-md">
              {sorted.map((m, i) => (
                <div
                  key={i}
                  className="flex gap-3 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/20"
                >
                  <span className="w-24 flex-shrink-0 text-xs text-muted-foreground font-mono">
                    {formatDate(m.data_hora)}
                  </span>
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

// ─── TRF1 Processual result block ────────────────────────────

function ProcessualResult({ data }: { data: Processo }) {
  const advogados = data.partes.filter((p) => !!p.oab);
  const partes = data.partes.filter((p) => !p.oab);
  const poloAtivo = partes.filter(
    (p) =>
      p.tipo?.toUpperCase().includes("ATIVO") ||
      p.caracteristica?.toUpperCase().includes("ATIVO")
  );
  const poloPassivo = partes.filter(
    (p) =>
      p.tipo?.toUpperCase().includes("PASSIVO") ||
      p.caracteristica?.toUpperCase().includes("PASSIVO")
  );

  const tabCount =
    (data.documentos?.length ?? 0) + (data.peticoes?.length ?? 0);

  return (
    <div
      className="rounded-lg border border-emerald-500/20 overflow-hidden"
      data-testid="unified-processual"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/5 dark:bg-emerald-500/10 border-b border-emerald-500/20">
        <Gavel className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          TRF1 Processual
        </span>
        <Badge
          variant="outline"
          className="text-[10px] border-emerald-500/30 text-emerald-600 dark:text-emerald-400 ml-auto"
        >
          encontrado
        </Badge>
      </div>
      <Tabs defaultValue="dados" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <UTabTrigger value="dados" icon={Info} label="Dados" color="emerald" />
          <UTabTrigger
            value="partes"
            icon={Users}
            label="Partes"
            count={data.partes.length}
            color="emerald"
          />
          <UTabTrigger
            value="movimentacoes"
            icon={ArrowRightLeft}
            label="Movimentações"
            count={data.movimentacoes.length}
            color="emerald"
          />
          {tabCount > 0 && (
            <UTabTrigger
              value="documentos"
              icon={Paperclip}
              label="Docs / Petições"
              count={tabCount}
              color="emerald"
            />
          )}
        </TabsList>

        <TabsContent value="dados">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <UInfoRow label="Processo" value={data.numero || data.nova_numeracao} icon={Hash} />
            <UInfoRow label="Assunto" value={data.assunto} icon={FileText} />
            <UInfoRow label="Órgão Julgador" value={data.orgao_julgador} icon={Building2} />
            <UInfoRow label="Juiz Relator" value={data.juiz_relator} icon={Users} />
            <UInfoRow label="Autuação" value={data.data_autuacao} icon={Calendar} />
            <UInfoRow label="Situação" value={data.situacao} icon={Info} />
            <UInfoRow label="Seção" value={data.secao} icon={Building2} />
          </div>
          {/* Polo summary */}
          {(poloAtivo.length > 0 || poloPassivo.length > 0) && (
            <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {poloAtivo.length > 0 && (
                <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-md p-2.5">
                  <div className="text-[10px] text-emerald-600 font-medium mb-1">Polo Ativo</div>
                  {poloAtivo.map((p, i) => (
                    <div key={i} className="text-xs">{p.nome}</div>
                  ))}
                </div>
              )}
              {poloPassivo.length > 0 && (
                <div className="bg-red-50 dark:bg-red-950/20 rounded-md p-2.5">
                  <div className="text-[10px] text-red-600 font-medium mb-1">Polo Passivo</div>
                  {poloPassivo.map((p, i) => (
                    <div key={i} className="text-xs">{p.nome}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="partes">
          {data.partes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma parte</p>
          ) : (
            <div className="space-y-2">
              {advogados.length > 0 && (
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="secondary" className="text-[9px]">
                    {advogados.length} advogado{advogados.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              )}
              {data.partes.map((p, i) => (
                <div key={i} className="bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {p.tipo && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          p.tipo.toUpperCase().includes("ATIVO")
                            ? "border-emerald-500/30 text-emerald-600"
                            : p.tipo.toUpperCase().includes("PASSIVO")
                            ? "border-red-500/30 text-red-600"
                            : ""
                        }`}
                      >
                        {p.tipo}
                      </Badge>
                    )}
                    {p.caracteristica && (
                      <Badge variant="secondary" className="text-[10px]">
                        {p.caracteristica}
                      </Badge>
                    )}
                    {p.oab && (
                      <Badge
                        variant="outline"
                        className="text-[10px] border-primary/30 text-primary"
                      >
                        ADV
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{p.nome}</p>
                  {p.entidade && (
                    <p className="text-xs text-muted-foreground">{p.entidade}</p>
                  )}
                  {p.oab && (
                    <p className="text-xs text-primary font-mono mt-0.5">OAB: {p.oab}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="movimentacoes">
          {data.movimentacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma movimentação</p>
          ) : (
            <div className="space-y-0.5 max-h-80 overflow-y-auto border border-border rounded-md">
              {data.movimentacoes.map((m, i) => (
                <div
                  key={i}
                  className="flex gap-3 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/20"
                >
                  <span className="w-24 flex-shrink-0 text-xs text-muted-foreground font-mono">
                    {m.data}
                  </span>
                  <div className="flex-1 min-w-0">
                    {m.codigo && (
                      <span className="text-xs text-muted-foreground mr-2">[{m.codigo}]</span>
                    )}
                    <span className="text-sm">{m.descricao}</span>
                    {m.complemento && (
                      <p className="text-xs text-muted-foreground mt-0.5">{m.complemento}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {tabCount > 0 && (
          <TabsContent value="documentos">
            {(data.peticoes?.length ?? 0) > 0 && (
              <div className="mb-4">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Petições ({data.peticoes.length})
                </p>
                <div className="space-y-1">
                  {data.peticoes.map((pet, i) => (
                    <div
                      key={i}
                      className="bg-muted/30 rounded-md px-3 py-2 text-xs flex items-start gap-3"
                    >
                      <span className="font-mono text-muted-foreground w-16 flex-shrink-0">
                        {pet.data_entrada}
                      </span>
                      <div>
                        <span className="font-medium">{pet.tipo}</span>
                        {pet.complemento && (
                          <span className="text-muted-foreground ml-1">— {pet.complemento}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {(data.documentos?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Documentos ({data.documentos.length})
                </p>
                <div className="space-y-1">
                  {data.documentos.map((doc, i) => (
                    <div
                      key={i}
                      className="bg-muted/30 rounded-md px-3 py-2 text-xs flex items-center gap-3"
                    >
                      <Paperclip className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span>{doc.descricao}</span>
                        {doc.data && (
                          <span className="text-muted-foreground ml-2 text-[10px]">
                            {doc.data}
                          </span>
                        )}
                      </div>
                      {doc.url && (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary text-[10px] hover:underline"
                        >
                          Abrir
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

// ─── TRF1 Público result block ───────────────────────────────

function PublicoResult({ data }: { data: TRF1PublicProcess }) {
  return (
    <div
      className="rounded-lg border border-violet-500/20 overflow-hidden"
      data-testid="unified-publico"
    >
      <div className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/5 dark:bg-violet-500/10 border-b border-violet-500/20">
        <Globe className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
          TRF1 Público · PJe
        </span>
        <Badge
          variant="outline"
          className="text-[10px] border-violet-500/30 text-violet-600 dark:text-violet-400 ml-auto"
        >
          encontrado
        </Badge>
      </div>
      <Tabs defaultValue="dados" className="p-4">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          <UTabTrigger value="dados" icon={Info} label="Dados" color="violet" />
          <UTabTrigger
            value="partes"
            icon={Users}
            label="Partes"
            count={data.partes.length}
            color="violet"
          />
          <UTabTrigger
            value="movimentacoes"
            icon={ArrowRightLeft}
            label="Movimentações"
            count={data.movimentacoes.length}
            color="violet"
          />
        </TabsList>

        <TabsContent value="dados">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <UInfoRow label="Processo" value={data.numero_processo} icon={Hash} />
            <UInfoRow label="Classe" value={data.classe} icon={FileText} />
            <UInfoRow label="Assunto" value={data.assunto} icon={FileText} />
            <UInfoRow label="Órgão Julgador" value={data.orgao_julgador} icon={Building2} />
            <UInfoRow label="Distribuição" value={data.data_distribuicao} icon={Calendar} />
            <UInfoRow label="Valor da Causa" value={data.valor_causa} icon={DollarSign} />
            <UInfoRow label="Situação" value={data.situacao} icon={Info} />
          </div>
          {data.url_detalhes && (
            <div className="mt-3 pt-3 border-t border-border/40">
              <a
                href={data.url_detalhes}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:underline"
              >
                Abrir processo no PJe →
              </a>
            </div>
          )}
        </TabsContent>

        <TabsContent value="partes">
          {data.partes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma parte</p>
          ) : (
            <div className="space-y-2">
              {data.partes.map((p, i) => (
                <div key={i} className="bg-muted/30 rounded-md p-3">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {p.polo && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          p.polo.toUpperCase().includes("AT")
                            ? "border-emerald-500/30 text-emerald-600"
                            : p.polo.toUpperCase().includes("PASS")
                            ? "border-red-500/30 text-red-600"
                            : p.polo.toUpperCase() === "ADV"
                            ? "border-primary/30 text-primary"
                            : ""
                        }`}
                      >
                        {p.polo}
                      </Badge>
                    )}
                    {p.tipo_participacao && (
                      <Badge variant="secondary" className="text-[10px]">
                        {p.tipo_participacao}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{p.nome}</p>
                  {p.documentos && (
                    <p className="text-xs text-muted-foreground mt-0.5">Doc: {p.documentos}</p>
                  )}
                  {p.advogados && (
                    <p className="text-xs text-primary mt-0.5">Adv: {p.advogados}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="movimentacoes">
          {data.movimentacoes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Nenhuma movimentação</p>
          ) : (
            <div className="space-y-0.5 max-h-80 overflow-y-auto border border-border rounded-md">
              {data.movimentacoes.map((m, i) => (
                <div
                  key={i}
                  className="flex gap-3 px-3 py-2 border-b border-border/50 last:border-0 hover:bg-muted/20"
                >
                  <span className="w-24 flex-shrink-0 text-xs text-muted-foreground font-mono">
                    {m.data}
                  </span>
                  <div className="flex-1 min-w-0">
                    {m.tipo && (
                      <span className="text-xs text-primary mr-2">[{m.tipo}]</span>
                    )}
                    <span className="text-sm">{m.descricao}</span>
                    {m.documentos?.length > 0 && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        📎 {m.documentos.join(", ")}
                      </p>
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

// ─── Shared atoms ──────────────────────────────────────────────

function SourceSkeleton({ label, color }: { label: string; color: string }) {
  const borderMap: Record<string, string> = {
    blue: "border-blue-500/20 bg-blue-500/5",
    emerald: "border-emerald-500/20 bg-emerald-500/5",
    violet: "border-violet-500/20 bg-violet-500/5",
  };
  const cls = borderMap[color] || "border-border bg-muted/30";
  return (
    <div className={`rounded-lg border overflow-hidden ${cls}`}>
      <div className="px-4 py-2.5 border-b border-inherit flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-current opacity-20 animate-pulse" />
        <span className="text-xs font-semibold uppercase tracking-wider opacity-50">{label}</span>
        <Loader2 className="w-3 h-3 ml-auto animate-spin opacity-40" />
      </div>
      <div className="p-4 space-y-2">
        <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
        <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
        <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
      </div>
    </div>
  );
}

function SourceError({
  label,
  icon: Icon,
  message,
  color,
}: {
  label: string;
  icon: typeof Database;
  message: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4 flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-0.5">
          {label}
        </p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function UInfoRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
}) {
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

function UTabTrigger({
  value,
  icon: Icon,
  label,
  count,
  color,
}: {
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  color: "blue" | "emerald" | "violet";
}) {
  const activeMap = {
    blue: "data-[state=active]:bg-blue-600 data-[state=active]:text-white",
    emerald: "data-[state=active]:bg-emerald-600 data-[state=active]:text-white",
    violet: "data-[state=active]:bg-violet-600 data-[state=active]:text-white",
  };
  return (
    <TabsTrigger
      value={value}
      className={`text-xs px-3 py-1.5 rounded-md data-[state=inactive]:bg-muted ${activeMap[color]}`}
    >
      <Icon className="w-3.5 h-3.5 mr-1.5" />
      {label}
      {count !== undefined && <span className="ml-1.5 opacity-70">{count}</span>}
    </TabsTrigger>
  );
}
