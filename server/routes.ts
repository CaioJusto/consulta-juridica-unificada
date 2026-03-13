import type { Express } from "express";
import { createServer, type Server } from "http";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Proxy all /api/* requests to the Python FastAPI backend on port 8000
  const PYTHON_API = process.env.PYTHON_API_URL || "http://127.0.0.1:8000";
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
      if (contentType.includes("text/csv") || contentType.includes("octet-stream")) {
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
      res.status(422).json({
        success: false,
        error: "Erro ao comunicar com o serviço de consulta. Tente novamente.",
      });
    }
  });

  return httpServer;
}
