import type { ResultadoBusca } from "@shared/schema";
import { ChevronRight, FileText } from "lucide-react";

interface ResultadosListProps {
  resultados: ResultadoBusca[];
  onSelect: (r: ResultadoBusca) => void;
}

export function ResultadosList({ resultados, onSelect }: ResultadosListProps) {
  return (
    <div data-testid="resultados-list">
      <h2 className="text-sm font-semibold text-muted-foreground mb-3">
        {resultados.length} {resultados.length === 1 ? "resultado encontrado" : "resultados encontrados"}
      </h2>
      <div className="space-y-2">
        {resultados.map((r, i) => (
          <button
            key={`${r.numero}-${i}`}
            onClick={() => onSelect(r)}
            className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors flex items-center gap-3 group"
            data-testid={`button-resultado-${i}`}
          >
            <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
              <FileText className="w-4 h-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{r.numero}</p>
              {r.nome_parte && (
                <p className="text-xs text-muted-foreground truncate">{r.nome_parte}</p>
              )}
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}
