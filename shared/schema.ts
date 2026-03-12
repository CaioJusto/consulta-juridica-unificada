import { z } from "zod";

// ═══════════════════════════════════════════════════════════════
// Fonte 1: TRF1 Processual (2ª Instância)
// ═══════════════════════════════════════════════════════════════

export const SECOES: Record<string, string> = {
  TRF1: "TRF 1ª Região",
  JFAC: "Justiça Federal do Acre",
  JFAM: "Justiça Federal do Amazonas",
  JFAP: "Justiça Federal do Amapá",
  JFBA: "Justiça Federal da Bahia",
  JFDF: "Justiça Federal do Distrito Federal",
  JFGO: "Justiça Federal de Goiás",
  JFMA: "Justiça Federal do Maranhão",
  JFMG: "Justiça Federal de Minas Gerais",
  JFMT: "Justiça Federal de Mato Grosso",
  JFPA: "Justiça Federal do Pará",
  JFPI: "Justiça Federal do Piauí",
  JFRO: "Justiça Federal de Rondônia",
  JFRR: "Justiça Federal de Roraima",
  JFTO: "Justiça Federal de Tocantins",
};

export const searchTypes = [
  "numero",
  "nomeParte",
  "cpfCnpj",
  "nomeAdvogado",
  "oab",
] as const;

export type SearchType = (typeof searchTypes)[number];

export const searchTypeLabels: Record<SearchType, string> = {
  numero: "Número do Processo",
  nomeParte: "Nome da Parte",
  cpfCnpj: "CPF/CNPJ da Parte",
  nomeAdvogado: "Nome do Advogado",
  oab: "Código OAB",
};

export const searchSchema = z.object({
  tipo: z.enum(searchTypes),
  valor: z.string().min(1, "Campo obrigatório"),
  secao: z.string().default("TRF1"),
  mostrarBaixados: z.boolean().default(false),
});

export type SearchInput = z.infer<typeof searchSchema>;

export interface Parte {
  tipo: string;
  nome: string;
  entidade: string;
  oab: string;
  caracteristica: string;
}

export interface Movimentacao {
  data: string;
  codigo: string;
  descricao: string;
  complemento: string;
}

export interface Distribuicao {
  data: string;
  descricao: string;
  juiz: string;
}

export interface Peticao {
  numero: string;
  data_entrada: string;
  data_juntada: string;
  tipo: string;
  complemento: string;
}

export interface Documento {
  descricao: string;
  data: string;
  url: string;
}

export interface Processo {
  numero: string;
  nova_numeracao: string;
  grupo: string;
  assunto: string;
  data_autuacao: string;
  orgao_julgador: string;
  juiz_relator: string;
  processo_originario: string;
  situacao: string;
  url_consulta: string;
  url_inteiro_teor: string;
  secao: string;
  partes: Parte[];
  distribuicoes: Distribuicao[];
  movimentacoes: Movimentacao[];
  peticoes: Peticao[];
  documentos: Documento[];
  incidentes: string[];
}

export interface ResultadoBusca {
  numero: string;
  nome_parte: string;
  secao: string;
  url: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// Fonte 2: DataJud API (CNJ)
// ═══════════════════════════════════════════════════════════════

export interface TribunalOption {
  label: string;
  alias: string;
}

export interface DataJudMovimento {
  codigo: number;
  nome: string;
  data_hora: string;
  complementos: string;
}

export interface DataJudAssunto {
  codigo: number;
  nome: string;
}

export interface DataJudProcesso {
  numero_processo: string;
  classe: string;
  classe_codigo: number;
  orgao_julgador: string;
  orgao_julgador_codigo: number;
  assuntos: DataJudAssunto[];
  movimentos: DataJudMovimento[];
  data_ajuizamento: string;
  ultima_atualizacao: string;
  grau: string;
  sistema: string;
  formato: string;
  nivel_sigilo: number;
  tribunal: string;
}

export interface DataJudSearchResult {
  total: number;
  processos: DataJudProcesso[];
  pages_fetched: number;
}

export interface SgtItem {
  codigo: string;
  nome: string;
  glossario: string;
  tipo: string;
}

// ═══════════════════════════════════════════════════════════════
// Fonte 3: TRF1 Consulta Pública 1ª Instância (PJe)
// ═══════════════════════════════════════════════════════════════

export interface TRF1PublicParty {
  nome: string;
  polo: string;
  tipo_participacao: string;
  documentos: string;
  advogados: string;
}

export interface TRF1PublicMovement {
  data: string;
  tipo: string;
  descricao: string;
  documentos: string[];
}

export interface TRF1PublicProcess {
  numero_processo: string;
  classe: string;
  assunto: string;
  orgao_julgador: string;
  data_distribuicao: string;
  valor_causa: string;
  situacao: string;
  partes: TRF1PublicParty[];
  movimentacoes: TRF1PublicMovement[];
  url_detalhes: string;
}

export interface TRF1PublicSearchResult {
  total_results: number;
  processos: TRF1PublicProcess[];
}

// ═══════════════════════════════════════════════════════════════
// Tipo de fonte ativa (para tabs do frontend)
// ═══════════════════════════════════════════════════════════════

export type FonteConsulta = "trf1_processual" | "datajud" | "trf1_publico";

export const fonteLabels: Record<FonteConsulta, string> = {
  trf1_processual: "TRF1 · 2ª Instância",
  datajud: "DataJud · CNJ",
  trf1_publico: "TRF1 · 1ª Instância",
};

export const fonteDescriptions: Record<FonteConsulta, string> = {
  trf1_processual: "Consulta processual do Tribunal (partes, documentos, movimentações)",
  datajud: "API pública do CNJ — busca por tribunal, classe, assunto, movimentos",
  trf1_publico: "Consulta pública PJe 1º Grau (partes detalhadas, advogados, OAB)",
};
