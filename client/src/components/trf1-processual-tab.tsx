import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { SearchForm } from "@/components/search-form";
import { ResultadosList } from "@/components/resultados-list";
import { ProcessoView } from "@/components/processo-view";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ChevronLeft, Gavel } from "lucide-react";
import type { Processo, ResultadoBusca, SearchType } from "@shared/schema";

interface State {
  loading: boolean;
  error: string;
  resultados: ResultadoBusca[];
  processo: Processo | null;
}

export function TRF1ProcessualTab() {
  const [state, setState] = useState<State>({
    loading: false,
    error: "",
    resultados: [],
    processo: null,
  });

  async function handleSearch(tipo: SearchType, valor: string, secao: string) {
    setState({ loading: true, error: "", resultados: [], processo: null });
    try {
      if (tipo === "numero") {
        const res = await apiRequest(
          "GET",
          `/api/processo?numero=${encodeURIComponent(valor)}&secao=${encodeURIComponent(secao)}`
        );
        const json = await res.json();
        if (json.success && json.data) {
          setState({ loading: false, error: "", resultados: [], processo: json.data });
        } else {
          setState({
            loading: false,
            error: json.error || "Processo não encontrado",
            resultados: [],
            processo: null,
          });
        }
      } else {
        const res = await apiRequest(
          "GET",
          `/api/buscar?tipo=${encodeURIComponent(tipo)}&valor=${encodeURIComponent(valor)}&secao=${encodeURIComponent(secao)}`
        );
        const json = await res.json();
        if (json.success && json.data) {
          setState({ loading: false, error: "", resultados: json.data, processo: null });
        } else {
          setState({
            loading: false,
            error: json.error || "Nenhum resultado encontrado",
            resultados: [],
            processo: null,
          });
        }
      }
    } catch (err: any) {
      const msg = err?.message?.includes("503")
        ? "Enriquecimento TRF1 indisponível neste ambiente. O serviço pode estar bloqueado ou temporariamente fora do ar."
        : "Erro de conexão com o servidor";
      setState({ loading: false, error: msg, resultados: [], processo: null });
    }
  }

  async function handleSelectResultado(r: ResultadoBusca) {
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const res = await apiRequest(
        "GET",
        `/api/processo?numero=${encodeURIComponent(r.numero)}&secao=${encodeURIComponent(r.secao || "TRF1")}`
      );
      const json = await res.json();
      if (json.success && json.data) {
        setState((s) => ({ ...s, loading: false, processo: json.data }));
      } else {
        setState((s) => ({ ...s, loading: false, error: json.error || "Erro ao carregar processo" }));
      }
    } catch {
      setState((s) => ({ ...s, loading: false, error: "Erro de conexão" }));
    }
  }

  if (state.loading) {
    return (
      <div className="space-y-4 mt-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Gavel className="w-4 h-4 animate-pulse" />
          Consultando TRF1 Processual...
        </div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (state.processo) {
    return (
      <div>
        <button
          onClick={() => setState((s) => ({ ...s, processo: null }))}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          data-testid="button-back-processual"
        >
          <ChevronLeft className="w-4 h-4" /> Voltar
        </button>
        <ProcessoView processo={state.processo} />
      </div>
    );
  }

  return (
    <div>
      <SearchForm
        onSearch={handleSearch}
        onReset={() => setState({ loading: false, error: "", resultados: [], processo: null })}
        isLoading={state.loading}
      />
      {state.error && (
        <div
          className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 text-destructive mt-4"
          data-testid="processual-error"
        >
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p className="text-sm">{state.error}</p>
        </div>
      )}
      {state.resultados.length > 0 && (
        <div className="mt-6">
          <ResultadosList resultados={state.resultados} onSelect={handleSelectResultado} />
        </div>
      )}
      {!state.loading && state.resultados.length === 0 && !state.processo && !state.error && (
        <div className="text-center py-16 text-muted-foreground" data-testid="processual-empty">
          <Gavel className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium">TRF1 Processual — 2ª Instância</p>
          <p className="text-xs mt-1.5 opacity-70 max-w-md mx-auto">
            Busque processos no sistema processual do TRF1 por número, parte, CPF/CNPJ, advogado ou OAB.
          </p>
        </div>
      )}
    </div>
  );
}
