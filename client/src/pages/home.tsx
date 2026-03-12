import { useState, useEffect } from "react";
import { ConsultaGeral } from "@/components/consulta-geral";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Scale, Sun, Moon } from "lucide-react";

export default function Home() {
  const [darkMode, setDarkMode] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Scale className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight" data-testid="text-app-title">
                Consulta Jurídica Unificada
              </h1>
              <p className="text-xs text-muted-foreground leading-tight">
                DataJud · TRF1 Processual · PJe 1ª Instância
              </p>
            </div>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            aria-label={`Mudar para modo ${darkMode ? "claro" : "escuro"}`}
            data-testid="button-theme-toggle"
          >
            {darkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <ConsultaGeral />
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12 py-4">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Dados de fontes públicas. Sem vinculação oficial.
          </p>
          <PerplexityAttribution />
        </div>
      </footer>
    </div>
  );
}
