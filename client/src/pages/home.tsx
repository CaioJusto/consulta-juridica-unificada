import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsultaGeral } from "@/components/consulta-geral";
import { TRF1ProcessualTab } from "@/components/trf1-processual-tab";
import { TRF1PublicSearch } from "@/components/trf1-public-search";
import { UnifiedView } from "@/components/unified-view";
import { PipelineTab } from "@/components/pipeline";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Scale, Sun, Moon, Database, Gavel, Globe, Layers, Zap } from "lucide-react";

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
                DataJud · TRF1 Processual · TRF1 Público · Pipeline
              </p>
            </div>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            aria-label={`Mudar para modo ${darkMode ? "claro" : "escuro"}`}
            data-testid="button-theme-toggle"
          >
            {darkMode ? (
              <Sun className="w-[18px] h-[18px]" />
            ) : (
              <Moon className="w-[18px] h-[18px]" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="datajud" className="space-y-5">
          {/* Tab navigation */}
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1 rounded-lg w-full">
            <TabsTrigger
              value="datajud"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-datajud"
            >
              <Database className="w-3.5 h-3.5" />
              <span>DataJud</span>
            </TabsTrigger>
            <TabsTrigger
              value="processual"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-processual"
            >
              <Gavel className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">TRF1</span>
              <span className="xs:hidden">Processual</span>
              <span className="hidden xs:inline">Processual</span>
            </TabsTrigger>
            <TabsTrigger
              value="publico"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-publico"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">TRF1 </span>Público
            </TabsTrigger>
            <TabsTrigger
              value="unificada"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-unificada"
            >
              <Layers className="w-3.5 h-3.5" />
              Unificada
            </TabsTrigger>
            <TabsTrigger
              value="pipeline"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-pipeline"
            >
              <Zap className="w-3.5 h-3.5" />
              Pipeline
            </TabsTrigger>
          </TabsList>

          {/* Tab descriptions */}
          <div className="text-xs text-muted-foreground -mt-2 pl-1 hidden sm:block">
            <span className="opacity-60">
              DataJud: filtros avançados + coleta em massa ·&nbsp;
              Processual: busca no sistema TRF1 2ª instância ·&nbsp;
              Público: consulta PJe 1ª instância ·&nbsp;
              Unificada: 3 fontes em paralelo por número ·&nbsp;
              Pipeline: automação sequencial DataJud→TRF1→PJe
            </span>
          </div>

          {/* Tab content */}
          <TabsContent value="datajud" className="mt-0">
            <ConsultaGeral />
          </TabsContent>

          <TabsContent value="processual" className="mt-0">
            <TRF1ProcessualTab />
          </TabsContent>

          <TabsContent value="publico" className="mt-0">
            <TRF1PublicSearch />
          </TabsContent>

          <TabsContent value="unificada" className="mt-0">
            <UnifiedView />
          </TabsContent>

          <TabsContent value="pipeline" className="mt-0">
            <PipelineTab />
          </TabsContent>
        </Tabs>
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
