import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config, defaultAgents } from "./config.js";
import {
  applyAgentDefaults,
  saveAgentDefaultsFromAgents,
} from "./agentDefaults.js";

function nowIso() {
  return new Date().toISOString();
}

function cloneAgents() {
  const base = defaultAgents.map((a) => ({ ...a, enabled: true }));
  return applyAgentDefaults(base);
}

function titleFromTranscript(transcript) {
  const host = (transcript || []).find((t) => t.role === "host" && t.text);
  if (host?.text) {
    const t = host.text.trim().replace(/\s+/g, " ");
    return t.length > 48 ? t.slice(0, 48) + "…" : t;
  }
  return "New session";
}

function displayTitle(s) {
  if (s.customTitle && String(s.customTitle).trim()) {
    return String(s.customTitle).trim();
  }
  return titleFromTranscript(s.transcript);
}

function readTranscript(dir) {
  const file = path.join(dir, "transcript.jsonl");
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip bad line */
    }
  }
  return out;
}

export function createSessionStore() {
  /** @type {Map<string, object>} */
  const sessions = new Map();

  fs.mkdirSync(config.recordsDir, { recursive: true });

  function loadFromDisk(id) {
    const dir = path.join(config.recordsDir, id);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) return null;
    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      return null;
    }
    const transcript = readTranscript(dir);
    const agents =
      Array.isArray(meta.agents) && meta.agents.length
        ? meta.agents
        : cloneAgents();
    const order =
      Array.isArray(meta.order) && meta.order.length
        ? meta.order
        : agents.map((a) => a.id);
    const session = {
      id: meta.id || id,
      createdAt: meta.createdAt || nowIso(),
      updatedAt: meta.updatedAt || meta.createdAt || nowIso(),
      customTitle: meta.customTitle || null,
      title: meta.customTitle || meta.title || titleFromTranscript(transcript),
      status: "idle_host",
      agents,
      order,
      transcript,
      roundCount: meta.roundCount || 0,
      lastError: null,
      debugLog: [],
      clients: new Set(),
      dir,
    };
    sessions.set(session.id, session);
    return session;
  }

  function hydrateAll() {
    let entries = [];
    try {
      entries = fs.readdirSync(config.recordsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (sessions.has(ent.name)) continue;
      loadFromDisk(ent.name);
    }
  }

  hydrateAll();

  function get(id) {
    let s = sessions.get(id);
    if (!s) s = loadFromDisk(id);
    if (!s) throw Object.assign(new Error("Session not found"), { status: 404 });
    return s;
  }

  function create() {
    const id = crypto.randomBytes(6).toString("hex");
    const agents = cloneAgents();
    const session = {
      id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      customTitle: null,
      title: "New session",
      status: "idle_host",
      agents,
      order: agents.map((a) => a.id),
      transcript: [],
      roundCount: 0,
      lastError: null,
      debugLog: [],
      clients: new Set(),
      dir: path.join(config.recordsDir, id),
    };
    fs.mkdirSync(session.dir, { recursive: true });
    persist(session);
    sessions.set(id, session);
    return publicSession(session);
  }

  function list() {
    hydrateAll();
    const items = [...sessions.values()].map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt || s.createdAt,
      title: displayTitle(s),
      status: s.status,
      rounds: s.roundCount,
      preview: (() => {
        const last = [...(s.transcript || [])]
          .reverse()
          .find((t) => t.role === "host" || t.role === "agent");
        return last?.text ? String(last.text).slice(0, 80) : "";
      })(),
    }));
    items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return items;
  }

  function publicSession(s) {
    return {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      title: displayTitle(s),
      customTitle: s.customTitle || null,
      status: s.status,
      agents: s.agents,
      order: s.order,
      transcript: s.transcript,
      roundCount: s.roundCount,
      lastError: s.lastError,
    };
  }

  function persist(s) {
    s.updatedAt = nowIso();
    s.title = displayTitle(s);
    const meta = {
      id: s.id,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      title: s.title,
      customTitle: s.customTitle || null,
      agents: s.agents,
      order: s.order,
      roundCount: s.roundCount,
    };
    fs.mkdirSync(s.dir, { recursive: true });
    fs.writeFileSync(
      path.join(s.dir, "meta.json"),
      JSON.stringify(meta, null, 2),
      "utf8"
    );
    const lines = s.transcript.map((t) => JSON.stringify(t)).join("\n");
    fs.writeFileSync(
      path.join(s.dir, "transcript.jsonl"),
      lines + (lines ? "\n" : ""),
      "utf8"
    );
  }

  function appendDebug(s, entry) {
    s.debugLog.push({ ts: nowIso(), ...entry });
    if (s.debugLog.length > 200) s.debugLog.splice(0, s.debugLog.length - 200);
  }

  function broadcast(s, event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of s.clients) {
      try {
        res.write(payload);
      } catch {
        s.clients.delete(res);
      }
    }
  }

  function setOrder(id, order) {
    const s = get(id);
    if (s.status !== "idle_host") {
      throw Object.assign(
        new Error("Order can only be changed while waiting for host"),
        { status: 409 }
      );
    }
    if (!Array.isArray(order) || order.length === 0) {
      throw Object.assign(new Error("order must be a non-empty array of agent ids"), {
        status: 400,
      });
    }
    const known = new Set(s.agents.map((a) => a.id));
    for (const aid of order) {
      if (!known.has(aid)) {
        throw Object.assign(new Error(`Unknown agent id in order: ${aid}`), {
          status: 400,
        });
      }
    }
    s.order = [...order];
    persist(s);
    broadcast(s, "session", publicSession(s));
    return publicSession(s);
  }

  function updateAgents(id, agents) {
    const s = get(id);
    if (s.status !== "idle_host") {
      throw Object.assign(new Error("Agents can only be edited while waiting for host"), {
        status: 409,
      });
    }
    if (!Array.isArray(agents)) {
      throw Object.assign(new Error("agents must be an array"), { status: 400 });
    }
    s.agents = agents.map((a) => ({
      id: a.id,
      displayName: a.displayName || a.id,
      providerHint: a.providerHint || a.id,
      model: a.model || "",
      system: a.system || "",
      enabled: a.enabled !== false,
    }));
    const known = new Set(s.agents.map((x) => x.id));
    s.order = s.order.filter((x) => known.has(x));
    if (s.order.length === 0) {
      s.order = s.agents.filter((a) => a.enabled).map((a) => a.id);
    }
    // Remember models as global defaults for future new sessions
    try {
      saveAgentDefaultsFromAgents(s.agents);
    } catch (err) {
      console.warn(`[defaults] save failed: ${err.message}`);
    }
    persist(s);
    broadcast(s, "session", publicSession(s));
    return publicSession(s);
  }

  function addTurn(s, turn) {
    s.transcript.push(turn);
    persist(s);
    broadcast(s, "turn", turn);
    broadcast(s, "session", publicSession(s));
  }

  function rename(id, title) {
    const s = get(id);
    const next = String(title || "").trim();
    if (!next) {
      throw Object.assign(new Error("Title is empty"), { status: 400 });
    }
    if (next.length > 120) {
      throw Object.assign(new Error("Title too long (max 120)"), { status: 400 });
    }
    s.customTitle = next;
    s.title = next;
    persist(s);
    broadcast(s, "session", publicSession(s));
    return publicSession(s);
  }

  function remove(id) {
    const s = sessions.get(id) || loadFromDisk(id);
    if (!s) throw Object.assign(new Error("Session not found"), { status: 404 });
    for (const res of [...s.clients]) {
      try {
        res.end();
      } catch {
        /* */
      }
      s.clients.delete(res);
    }
    sessions.delete(id);
    const dir = s.dir;
    try {
      // Retry briefly — Windows can hold locks briefly after SSE close
      let lastErr;
      for (let i = 0; i < 5; i++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          const until = Date.now() + 50;
          while (Date.now() < until) {
            /* spin */
          }
        }
      }
      if (lastErr) throw lastErr;
    } catch (err) {
      throw Object.assign(new Error(`Failed to delete: ${err.message}`), {
        status: 500,
      });
    }
    return { ok: true, id };
  }

  return {
    create,
    list,
    get,
    publicSession,
    persist,
    appendDebug,
    broadcast,
    setOrder,
    updateAgents,
    addTurn,
    rename,
    remove,
    sessions,
  };
}
