import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const PYTHON_API = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";

  // Health check — verifies Python backend is alive
  app.get("/health", async (_req, res) => {
    try {
      const response = await fetch(`${PYTHON_API}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        res.json({ ok: true, python: true });
      } else {
        res.status(503).json({ ok: false, python: false, error: "Python backend unhealthy" });
      }
    } catch {
      res.status(503).json({ ok: false, python: false, error: "Python backend unreachable" });
    }
  });

  // Proxy all /api/* requests to the Python FastAPI backend on port 8000
  app.use("/api", async (req, res) => {
    try {
      const url = new URL(req.url, PYTHON_API);
      url.pathname = "/api" + url.pathname;

      const fetchOptions: RequestInit = {
        method: req.method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      // Forward request body for POST/PUT/PATCH methods
      // Body has already been parsed by express.json() middleware,
      // so we re-serialize it from req.body
      if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(url.toString(), fetchOptions);
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("text/csv") || contentType.includes("octet-stream") || contentType.includes("spreadsheetml")) {
        // Forward binary/CSV responses directly (e.g. pipeline export)
        const buffer = await response.arrayBuffer();
        const disposition = response.headers.get("content-disposition") || "";
        res.status(response.status)
          .header("Content-Type", contentType)
          .header("Content-Disposition", disposition)
          .send(Buffer.from(buffer));
      } else {
        const data = await response.json();
        res.status(response.status).json(data);
      }
    } catch (err: any) {
      console.error("Proxy error:", err.message);
      res.status(502).json({
        success: false,
        error: "Backend Python indisponível. O serviço será reiniciado automaticamente — tente novamente em alguns segundos.",
      });
    }
  });

  return httpServer;
}
