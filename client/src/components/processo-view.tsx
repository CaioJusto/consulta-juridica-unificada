import type { Processo } from "@shared/schema";
import { SECOES } from "@shared/schema";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Users,
  ArrowRightLeft,
  Gavel,
  File,
  BookOpen,
  AlertTriangle,
  ExternalLink,
  Calendar,
  Hash,
  Building2,
  User,
  Scale,
  Info,
} from "lucide-react";

interface ProcessoViewProps {
  processo: Processo;
}

function InfoRow({ label, value, icon: Icon }: { label: string; value: string; icon?: any }) {
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

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {count !== undefined && count > 0 && (
        <Badge variant="secondary" className="text-xs">
          {count}
        </Badge>
      )}
    </div>
  );
}

export function ProcessoView({ processo }: ProcessoViewProps) {
  const secaoNome = SECOES[processo.secao] || processo.secao;

  const tabs = [
    { id: "dados", label: "Dados", icon: Info, show: true },
    { id: "partes", label: "Partes", icon: Users, count: processo.partes.length, show: true },
    { id: "movimentacao", label: "Movimentação", icon: ArrowRightLeft, count: processo.movimentacoes.length, show: true },
    { id: "distribuicao", label: "Distribuição", icon: Calendar, count: processo.distribuicoes.length, show: processo.distribuicoes.length > 0 },
    { id: "peticoes", label: "Petições", icon: Gavel, count: processo.peticoes.length, show: processo.peticoes.length > 0 },
    { id: "documentos", label: "Documentos", icon: File, count: processo.documentos.length, show: processo.documentos.length > 0 },
    { id: "incidentes", label: "Incidentes", icon: AlertTriangle, count: processo.incidentes.length, show: processo.incidentes.length > 0 },
  ].filter(t => t.show);

  return (
    <div data-testid="processo-view">
      {/* Process header */}
      <div className="mb-5">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div>
            <h2 className="text-lg font-semibold" data-testid="text-processo-numero">
              {processo.numero || processo.nova_numeracao || "Processo"}
            </h2>
            {processo.nova_numeracao && processo.numero !== processo.nova_numeracao && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Nova Numeração: {processo.nova_numeracao}
              </p>
            )}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {processo.situacao && (
              <Badge variant={processo.situacao.toLowerCase().includes("baixa") ? "secondary" : "default"}>
                {processo.situacao}
              </Badge>
            )}
          </div>
        </div>
        {processo.assunto && (
          <p className="text-sm text-muted-foreground">{processo.assunto}</p>
        )}
        <p className="text-xs text-muted-foreground mt-1">{secaoNome}</p>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="dados">
        <TabsList className="flex flex-wrap h-auto gap-1 bg-transparent p-0 mb-4">
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="text-xs px-3 py-1.5 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=inactive]:bg-muted"
              data-testid={`tab-${tab.id}`}
            >
              <tab.icon className="w-3.5 h-3.5 mr-1.5" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="ml-1.5 opacity-70">{tab.count}</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Dados tab */}
        <TabsContent value="dados" data-testid="tab-content-dados">
          <div className="bg-card border border-border rounded-lg p-4">
            <InfoRow label="Processo" value={processo.numero} icon={Hash} />
            <InfoRow label="Nova Numeração" value={processo.nova_numeracao} icon={Hash} />
            <InfoRow label="Grupo" value={processo.grupo} icon={FileText} />
            <InfoRow label="Assunto" value={processo.assunto} icon={Scale} />
            <InfoRow label="Autuação" value={processo.data_autuacao} icon={Calendar} />
            <InfoRow label="Órgão Julgador" value={processo.orgao_julgador} icon={Building2} />
            <InfoRow label="Juiz Relator" value={processo.juiz_relator} icon={User} />
            <InfoRow label="Proc. Originário" value={processo.processo_originario} icon={FileText} />
            <InfoRow label="Situação" value={processo.situacao} icon={Info} />
            {processo.url_inteiro_teor && (
              <div className="mt-3 pt-3 border-t border-border">
                <a
                  href={processo.url_inteiro_teor}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  data-testid="link-inteiro-teor"
                >
                  <BookOpen className="w-4 h-4" />
                  Acessar Inteiro Teor
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Partes tab */}
        <TabsContent value="partes" data-testid="tab-content-partes">
          <SectionHeader title="Partes do Processo" count={processo.partes.length} />
          {processo.partes.length === 0 ? (
            <EmptyTab message="Nenhuma parte encontrada" />
          ) : (
            <div className="space-y-2">
              {processo.partes.map((p, i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-3" data-testid={`card-parte-${i}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Users className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {p.tipo && <Badge variant="outline" className="text-[10px]">{p.tipo}</Badge>}
                        {p.caracteristica && <Badge variant="secondary" className="text-[10px]">{p.caracteristica}</Badge>}
                      </div>
                      {p.nome && <p className="text-sm font-medium mt-1">{p.nome}</p>}
                      {p.entidade && <p className="text-xs text-muted-foreground">{p.entidade}</p>}
                      {p.oab && <p className="text-xs text-muted-foreground">OAB: {p.oab}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Movimentação tab */}
        <TabsContent value="movimentacao" data-testid="tab-content-movimentacao">
          <SectionHeader title="Movimentações" count={processo.movimentacoes.length} />
          {processo.movimentacoes.length === 0 ? (
            <EmptyTab message="Nenhuma movimentação encontrada" />
          ) : (
            <div className="space-y-1">
              {processo.movimentacoes.map((m, i) => (
                <div key={i} className="flex gap-3 py-2.5 border-b border-border/50 last:border-0" data-testid={`row-mov-${i}`}>
                  <div className="w-20 flex-shrink-0">
                    <span className="text-xs text-muted-foreground font-mono">{m.data}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {m.codigo && <span className="text-xs text-muted-foreground mr-2">[{m.codigo}]</span>}
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

        {/* Distribuição tab */}
        <TabsContent value="distribuicao" data-testid="tab-content-distribuicao">
          <SectionHeader title="Distribuição" count={processo.distribuicoes.length} />
          {processo.distribuicoes.length === 0 ? (
            <EmptyTab message="Nenhuma distribuição encontrada" />
          ) : (
            <div className="space-y-2">
              {processo.distribuicoes.map((d, i) => (
                <div key={i} className="bg-card border border-border rounded-lg p-3" data-testid={`card-dist-${i}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <Calendar className="w-3 h-3" />
                    {d.data}
                  </div>
                  <p className="text-sm">{d.descricao}</p>
                  {d.juiz && <p className="text-xs text-muted-foreground mt-1">Juiz: {d.juiz}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Petições tab */}
        <TabsContent value="peticoes" data-testid="tab-content-peticoes">
          <SectionHeader title="Petições" count={processo.peticoes.length} />
          {processo.peticoes.length === 0 ? (
            <EmptyTab message="Nenhuma petição encontrada" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="table-peticoes">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground">Nº</th>
                    <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground">Entrada</th>
                    <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground">Juntada</th>
                    <th className="text-left py-2 pr-3 text-xs font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left py-2 text-xs font-medium text-muted-foreground">Complemento</th>
                  </tr>
                </thead>
                <tbody>
                  {processo.peticoes.map((p, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0" data-testid={`row-pet-${i}`}>
                      <td className="py-2 pr-3 text-xs font-mono">{p.numero}</td>
                      <td className="py-2 pr-3 text-xs">{p.data_entrada}</td>
                      <td className="py-2 pr-3 text-xs">{p.data_juntada}</td>
                      <td className="py-2 pr-3 text-xs">{p.tipo}</td>
                      <td className="py-2 text-xs text-muted-foreground">{p.complemento}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Documentos tab */}
        <TabsContent value="documentos" data-testid="tab-content-documentos">
          <SectionHeader title="Documentos" count={processo.documentos.length} />
          {processo.documentos.length === 0 ? (
            <EmptyTab message="Nenhum documento encontrado" />
          ) : (
            <div className="space-y-1.5">
              {processo.documentos.map((d, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0" data-testid={`row-doc-${i}`}>
                  <File className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline truncate block"
                      >
                        {d.descricao}
                      </a>
                    ) : (
                      <span className="text-sm truncate block">{d.descricao}</span>
                    )}
                    {d.data && <span className="text-xs text-muted-foreground">{d.data}</span>}
                  </div>
                  {d.url && <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Incidentes tab */}
        <TabsContent value="incidentes" data-testid="tab-content-incidentes">
          <SectionHeader title="Incidentes" count={processo.incidentes.length} />
          {processo.incidentes.length === 0 ? (
            <EmptyTab message="Nenhum incidente encontrado" />
          ) : (
            <div className="space-y-1">
              {processo.incidentes.map((inc, i) => (
                <div key={i} className="py-2 border-b border-border/50 last:border-0" data-testid={`row-inc-${i}`}>
                  <p className="text-sm">{inc}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="text-center py-8 text-muted-foreground" data-testid="text-empty-tab">
      <p className="text-sm">{message}</p>
    </div>
  );
}
