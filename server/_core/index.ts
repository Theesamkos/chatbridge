import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { sdk } from "./sdk";
import { streamHandler } from "../routes/stream";
import { toolResultHandler } from "../routes/toolResult";
import { pluginFailureHandler } from "../routes/pluginFailure";
import { scoreInvestigationHandler } from "../routes/scoreInvestigation";
import { getDb } from "../db";
import { pluginSchemas } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ── Rule 22: CSP frame-src — dynamically built from plugin_schemas.origin ──
  // Wildcard (*) is never used. Origins are fetched once at startup and cached.
  let allowedFrameOrigins: string[] = [];
  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({ origin: pluginSchemas.origin })
        .from(pluginSchemas)
        .where(eq(pluginSchemas.status, "active"));
      const originSet = new Set(rows.map(r => r.origin).filter(Boolean));
      allowedFrameOrigins = Array.from(originSet);
    }
  } catch (err) {
    console.warn("[CSP] Could not load plugin origins, frame-src will be 'self':", err);
  }
  // In development, also allow localhost variants for the embedded apps
  if (process.env.NODE_ENV === "development") {
    const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
    for (const o of devOrigins) {
      if (!allowedFrameOrigins.includes(o)) allowedFrameOrigins.push(o);
    }
  }
  const frameSrc = allowedFrameOrigins.length > 0 ? allowedFrameOrigins.join(" ") : "'self'";
  console.log(`[CSP] frame-src: ${frameSrc}`);

  app.use((_req, res, next) => {
    res.setHeader(
      "Content-Security-Policy",
      `frame-src ${frameSrc}; default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; img-src 'self' data: blob: https:; connect-src 'self' https: wss:;`,
    );
    next();
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // SSE streaming endpoint — must be registered BEFORE tRPC middleware (Decision 4).
  // Phase 2 production handler at /api/chat/stream.
  // Implementation in server/routes/stream.ts.
  app.post("/api/chat/stream", streamHandler);
  app.post("/api/chat/tool-result", toolResultHandler);
  app.post("/api/plugins/failure", pluginFailureHandler);
  app.post("/api/plugins/score-investigation", scoreInvestigationHandler);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
