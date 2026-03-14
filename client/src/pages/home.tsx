import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConsultaGeral } from "@/components/consulta-geral";
import { TRF1ProcessualTab } from "@/components/trf1-processual-tab";
import { TRF1PublicSearch } from "@/components/trf1-public-search";
import { PipelineTab } from "@/components/pipeline";
import { PerplexityAttribution } from "@/components/PerplexityAttribution";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Scale, Sun, Moon, Database, Gavel, Globe, Zap, LogOut } from "lucide-react";
import { useAuth } from "@/auth";

function SourceIntro({
  site,
  detail,
}: {
  site: string;
  detail: string;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-border bg-card/70 px-4 py-3">
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <Badge variant="outline" className="text-[10px]">{site}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export default function Home() {
  const { username, logout } = useAuth();
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
                Pipeline de automação · API pública DataJud · PJe TRF1 · Site Processual TRF1
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Sessão</span>
              <span className="text-xs font-medium">{username || "admin"}</span>
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
            <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void logout()}>
              <LogOut className="h-3.5 w-3.5" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Tabs defaultValue="pipeline" className="space-y-5">
          {/* Tab navigation */}
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/60 p-1 rounded-lg w-full">
            <TabsTrigger
              value="pipeline"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-pipeline"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Pipeline de Automação</span>
            </TabsTrigger>
            <TabsTrigger
              value="datajud"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-datajud"
            >
              <Database className="w-3.5 h-3.5" />
              <span>Consulta DataJud</span>
            </TabsTrigger>
            <TabsTrigger
              value="publico"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-publico"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>PJe (TRF1)</span>
            </TabsTrigger>
            <TabsTrigger
              value="processual"
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm flex-1 sm:flex-none"
              data-testid="tab-processual"
            >
              <Gavel className="w-3.5 h-3.5" />
              <span>Site TRF1</span>
            </TabsTrigger>
          </TabsList>

          {/* Tab descriptions */}
          <div className="text-xs text-muted-foreground -mt-2 pl-1 hidden sm:block">
            <span className="opacity-60">
              Pipeline: automação sequencial e persistida em background ·&nbsp;
              DataJud: filtros avançados na API pública do CNJ ·&nbsp;
              PJe: consulta pública do TRF1 ·&nbsp;
              Site TRF1: sistema processual oficial da 2ª instância
            </span>
          </div>

          {/* Tab content */}
          <TabsContent value="pipeline" className="mt-0">
            <SourceIntro
              site="Fontes combinadas"
              detail="Executa a automação sequencial usando DataJud (CNJ), Site Processual do TRF1 e PJe do TRF1. O job roda no backend e pode ser retomado pela lista de jobs recentes."
            />
            <PipelineTab />
          </TabsContent>

          <TabsContent value="datajud" className="mt-0">
            <SourceIntro
              site="API pública DataJud · CNJ"
              detail="Consulta diretamente a base pública do DataJud, com paginação por search_after, filtros SGT, órgãos julgadores, sistema, formato e presets de movimentação para crédito."
            />
            <ConsultaGeral />
          </TabsContent>

          <TabsContent value="publico" className="mt-0">
            <SourceIntro
              site="PJe consulta pública · TRF1"
              detail="Extrai dados do portal público do PJe do TRF1, incluindo partes, movimentações, documentos e o texto público disponível nos HTMLs dos documentos."
            />
            <TRF1PublicSearch />
          </TabsContent>

          <TabsContent value="processual" className="mt-0">
            <SourceIntro
              site="Site Processual · TRF1"
              detail="Consulta o portal processual do TRF1 para obter dados da 2ª instância, partes, petições, distribuições, incidentes, documentos e movimentações públicas."
            />
            <TRF1ProcessualTab />
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
