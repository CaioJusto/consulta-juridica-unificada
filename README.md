# Consulta Jurídica Unificada

Interface web para busca e enriquecimento de processos judiciais, integrando três fontes:

- **DataJud** (CNJ) — Base pública de processos de todos os tribunais
- **TRF1 Processual** — API REST do sistema processual do TRF1
- **TRF1 Público (PJe)** — Consulta pública do PJe via Playwright (scraping)

## Funcionalidades

- Consulta unificada com filtros avançados (classe, assunto, movimentação, órgão julgador, grau, datas, presença, quantidade)
- Busca SGT (Sistema de Gestão de Tabelas do CNJ) para autocompletar classes, assuntos e movimentações
- Exclusão de assuntos específicos
- Paginação configurável (até 10.000 itens/página)
- **Auto-paginação**: coleta automática de múltiplas páginas (ou todas) com barra de progresso
- Exportação CSV dos resultados coletados
- Enriquecimento de processos individuais via TRF1 Processual e PJe
- Tema claro/escuro
- Responsivo (desktop + mobile)

## Arquitetura

```
┌─────────────────────────────────────────────┐
│  Frontend (React + Tailwind + shadcn/ui)    │
│  Express.js (porta 5000)                    │
├─────────────────────────────────────────────┤
│  Backend (Python FastAPI, porta 8000)       │
│  ├── DataJud API (Elasticsearch)            │
│  ├── TRF1 Processual (REST)                │
│  ├── TRF1 Público PJe (Playwright)         │
│  └── SGT CNJ (SOAP)                        │
└─────────────────────────────────────────────┘
```

## Requisitos

- Node.js 18+
- Python 3.10+
- Playwright (para consulta PJe)

## Instalação

### Backend (Python)

```bash
pip install fastapi uvicorn httpx playwright beautifulsoup4 lxml
playwright install chromium
```

### Frontend (Node.js)

```bash
npm install
```

## Execução

### 1. Iniciar o backend

```bash
python api_server.py
# Roda na porta 8000
```

### 2. Iniciar o frontend (desenvolvimento)

```bash
npm run dev
# Roda na porta 5000
```

### Produção

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

## Estrutura do Projeto

```
├── api_server.py              # Backend FastAPI (DataJud + TRF1 + SGT)
├── client/
│   └── src/
│       ├── components/
│       │   └── consulta-geral.tsx   # Componente principal
│       ├── pages/
│       │   └── home.tsx
│       └── index.css
├── server/
│   ├── index.ts               # Express server
│   ├── routes.ts              # Proxy routes para o backend Python
│   └── static.ts
├── shared/
│   └── schema.ts              # Tipos TypeScript compartilhados
├── package.json
└── README.md
```

## API Endpoints

| Endpoint | Método | Descrição |
|---|---|---|
| `/api/datajud/tribunais` | GET | Lista tribunais disponíveis |
| `/api/datajud/buscar` | POST | Busca processos no DataJud |
| `/api/datajud/sgt` | GET | Busca SGT (classes/assuntos/movimentações) |
| `/api/datajud/orgaos` | GET | Busca órgãos julgadores via aggregation |
| `/api/processo` | GET | Consulta TRF1 Processual |
| `/api/trf1publico/buscar` | GET | Consulta TRF1 Público (PJe) |

## Licença

MIT
