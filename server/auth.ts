import type { Express, RequestHandler } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
  }
}

const MemoryStore = createMemoryStore(session);

const SESSION_SECRET =
  process.env.SESSION_SECRET || "consulta-juridica-unificada-session";
const DEFAULT_USERNAME = process.env.APP_LOGIN_USER || "admin";
const DEFAULT_PASSWORD = process.env.APP_LOGIN_PASSWORD || "admin123";

function authRequired(): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith("/auth/")) {
      return next();
    }
    if (req.session?.authenticated) {
      return next();
    }
    return res.status(401).json({
      success: false,
      error: "Autenticação necessária.",
    });
  };
}

export function registerAuth(app: Express) {
  app.use(
    session({
      name: "consulta.sid",
      secret: SESSION_SECRET,
      proxy: true,
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({
        checkPeriod: 24 * 60 * 60 * 1000,
      }),
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: "auto",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/api/auth/status", (req, res) => {
    if (!req.session?.authenticated) {
      return res.status(401).json({
        success: false,
        authenticated: false,
      });
    }
    return res.json({
      success: true,
      authenticated: true,
      username: req.session.username || DEFAULT_USERNAME,
    });
  });

  app.post("/api/auth/login", (req, res) => {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (username !== DEFAULT_USERNAME || password !== DEFAULT_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: "Usuário ou senha inválidos.",
      });
    }

    req.session.authenticated = true;
    req.session.username = DEFAULT_USERNAME;
    req.session.save((error) => {
      if (error) {
        return res.status(500).json({
          success: false,
          error: "Não foi possível iniciar a sessão.",
        });
      }
      return res.json({
        success: true,
        authenticated: true,
        username: DEFAULT_USERNAME,
      });
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((error) => {
      if (error) {
        return res.status(500).json({
          success: false,
          error: "Não foi possível encerrar a sessão.",
        });
      }
      res.clearCookie("consulta.sid");
      return res.json({ success: true });
    });
  });

  app.use("/api", authRequired());
}
