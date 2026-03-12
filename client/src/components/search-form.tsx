import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SECOES, searchTypeLabels, type SearchType } from "@shared/schema";
import { Search, RotateCcw, Loader2 } from "lucide-react";

interface SearchFormProps {
  onSearch: (tipo: SearchType, valor: string, secao: string) => void;
  onReset: () => void;
  isLoading: boolean;
}

export function SearchForm({ onSearch, onReset, isLoading }: SearchFormProps) {
  const [tipo, setTipo] = useState<SearchType>("numero");
  const [valor, setValor] = useState("");
  const [secao, setSecao] = useState("TRF1");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valor.trim()) return;
    onSearch(tipo, valor.trim(), secao);
  }

  function handleReset() {
    setValor("");
    setTipo("numero");
    setSecao("TRF1");
    onReset();
  }

  const placeholders: Record<SearchType, string> = {
    numero: "Ex: 0003653-54.2020.4.01.3400",
    nomeParte: "Ex: João da Silva",
    cpfCnpj: "Ex: 123.456.789-00",
    nomeAdvogado: "Ex: Maria Souza",
    oab: "Ex: 12345/GO",
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="search-form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="tipo" className="text-xs font-medium text-muted-foreground">
            Tipo de Busca
          </Label>
          <Select
            value={tipo}
            onValueChange={(v) => setTipo(v as SearchType)}
          >
            <SelectTrigger id="tipo" data-testid="select-search-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(searchTypeLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="secao" className="text-xs font-medium text-muted-foreground">
            Seção Judiciária
          </Label>
          <Select value={secao} onValueChange={setSecao}>
            <SelectTrigger id="secao" data-testid="select-section">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SECOES).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            id="valor"
            type="text"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            placeholder={placeholders[tipo]}
            className="h-10"
            data-testid="input-search-value"
          />
        </div>
        <Button
          type="submit"
          disabled={!valor.trim() || isLoading}
          className="h-10 px-5"
          data-testid="button-search"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Search className="w-4 h-4" />
          )}
          <span className="ml-2 hidden sm:inline">Buscar</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          className="h-10"
          data-testid="button-reset"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
      </div>
    </form>
  );
}
