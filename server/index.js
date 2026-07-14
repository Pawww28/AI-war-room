import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { createSessionStore } from "./session.js";
import { createOrchestrator } from "./orchestrator.js";
import { listModels, probeCliproxy } from "./providers/cliproxy.js";
import { pickModelForAgent } from "./providers/cliproxy.js";
import { serperConfigured } from "./providers/serper.js";
import {
  loadAgentDefaults,
  agentDefaultsFilePath,
} from "./agentDefaults.js";

const store = createSessionStore();
const orchestrator = createOrchestrator(store);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.includes("..")) {
    res.writeHead(400);
    return res.end("bad path");
  }
  const filePath = path.join(config.publicDir, rel);
  if (!filePath.startsWith(config.publicDir)) {
    res.writeHead(400);
    return res.end("bad path");
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    const probe = await probeCliproxy();
    return sendJson(res, 200, {
      ok: true,
      warRoom: { host: config.host, port: config.port },
      recordsDir: config.recordsDir,
      agentDefaultsPath: agentDefaultsFilePath(),
      agentDefaults: loadAgentDefaults(),
      cliproxy: probe,
      serper: {
        configured: serperConfigured(),
        enabled: config.serper.enabled,
      },
      mockFallback: config.mockFallback,
    });
  }

  if (req.method === "GET" && pathname === "/api/models") {
    const listed = await listModels();
    return sendJson(res, listed.ok ? 200 : 502, listed);
  }

  if (req.method === "POST" && pathname === "/api/sessions") {
    const session = store.create();
    // try auto-fill models
    const listed = await listModels();
    if (listed.ok) {
      const ids = listed.models.map((m) => m.id);
      const s = store.get(session.id);
      for (const a of s.agents) {
        if (!a.model) {
          const picked = pickModelForAgent(a, ids);
          if (picked) a.model = picked;
        }
      }
      store.persist(s);
      return sendJson(res, 201, store.publicSession(s));
    }
    return sendJson(res, 201, session);
  }

  if (req.method === "GET" && pathname === "/api/sessions") {
    return sendJson(res, 200, { sessions: store.list() });
  }

  const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)(.*)$/);
  if (sessionMatch) {
    const id = sessionMatch[1];
    const rest = sessionMatch[2] || "";

    if (req.method === "GET" && rest === "") {
      return sendJson(res, 200, store.publicSession(store.get(id)));
    }

    if (
      (req.method === "DELETE" && rest === "") ||
      (req.method === "POST" && rest === "/delete")
    ) {
      return sendJson(res, 200, store.remove(id));
    }

    if (req.method === "PUT" && rest === "/title") {
      const body = await readBody(req);
      return sendJson(res, 200, store.rename(id, body.title || body.name || ""));
    }

    if (req.method === "GET" && rest === "/events") {
      const s = store.get(id);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: session\ndata: ${JSON.stringify(store.publicSession(s))}\n\n`);
      s.clients.add(res);
      req.on("close", () => s.clients.delete(res));
      return;
    }

    if (req.method === "GET" && rest === "/debug") {
      const s = store.get(id);
      return sendJson(res, 200, {
        status: s.status,
        order: s.order,
        agents: s.agents,
        lastError: s.lastError,
        debugLog: s.debugLog,
        transcriptLength: s.transcript.length,
      });
    }

    if (req.method === "PUT" && rest === "/order") {
      const body = await readBody(req);
      return sendJson(res, 200, store.setOrder(id, body.order));
    }

    if (req.method === "PUT" && rest === "/agents") {
      const body = await readBody(req);
      return sendJson(res, 200, store.updateAgents(id, body.agents));
    }

    if (req.method === "POST" && rest === "/host") {
      const body = await readBody(req);
      try {
        const result = await orchestrator.runHostTurn(
          id,
          body.text || body.message || "",
          { search: Boolean(body.search) }
        );
        return sendJson(res, 200, result);
      } catch (err) {
        const status = err.status || 500;
        return sendJson(res, status, { error: err.message || String(err) });
      }
    }

    if (req.method === "POST" && rest === "/respond") {
      const body = await readBody(req);
      try {
        const result = await orchestrator.runRespond(
          id,
          body.agentId || body.agent || "",
          {
            hostSupplement: body.hostSupplement || body.text || body.message || "",
          }
        );
        return sendJson(res, 200, result);
      } catch (err) {
        const status = err.status || 500;
        return sendJson(res, status, { error: err.message || String(err) });
      }
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  // basic CORS for LAN tools
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      return await handleApi(req, res, url);
    }
    return serveStatic(req, res, url.pathname);
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, { error: err.message || String(err) });
    } else {
      res.end();
    }
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[AI War Room] http://127.0.0.1:${config.port}/`);
  console.log(`[AI War Room] LAN bind ${config.host}:${config.port}`);
  console.log(`[AI War Room] CLIProxy ${config.cliproxy.baseUrl}`);
  console.log(`[AI War Room] Debug UI: http://127.0.0.1:${config.port}/?debug=1`);
});
