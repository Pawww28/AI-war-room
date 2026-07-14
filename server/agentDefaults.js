import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/**
 * Persistent default models for new sessions.
 * Path: %LOCALAPPDATA%\Resablic\ai-war-room\agent-defaults.json
 */

function defaultsPath() {
  return (
    config.agentDefaultsPath ||
    path.join(path.dirname(config.recordsDir), "agent-defaults.json")
  );
}

/**
 * @returns {{ updatedAt: string|null, agents: Record<string, { model: string }> }}
 */
export function loadAgentDefaults() {
  const file = defaultsPath();
  try {
    if (!fs.existsSync(file)) {
      return { updatedAt: null, agents: {} };
    }
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const agents = {};
    if (raw && typeof raw.agents === "object" && raw.agents) {
      for (const [id, val] of Object.entries(raw.agents)) {
        if (typeof val === "string") {
          agents[id] = { model: val };
        } else if (val && typeof val === "object") {
          agents[id] = { model: String(val.model || "") };
        }
      }
    } else if (raw && typeof raw === "object") {
      // flat form: { chatgpt: "gpt-5.5", grok: "..." }
      for (const [id, val] of Object.entries(raw)) {
        if (id === "updatedAt") continue;
        if (typeof val === "string") agents[id] = { model: val };
      }
    }
    return { updatedAt: raw.updatedAt || null, agents };
  } catch (err) {
    console.warn(`[defaults] failed to read ${file}: ${err.message}`);
    return { updatedAt: null, agents: {} };
  }
}

/**
 * Merge saved defaults onto a cloned agent list (mutates copies only).
 */
export function applyAgentDefaults(agents) {
  const { agents: saved } = loadAgentDefaults();
  return agents.map((a) => {
    const hit = saved[a.id];
    if (!hit) return { ...a };
    // Only override model when saved has a non-empty string; empty means "auto"
    if (Object.prototype.hasOwnProperty.call(hit, "model")) {
      return { ...a, model: hit.model ?? "" };
    }
    return { ...a };
  });
}

/**
 * Update defaults from current agent list (models only).
 * Called when user changes models in UI.
 */
export function saveAgentDefaultsFromAgents(agents) {
  const file = defaultsPath();
  const prev = loadAgentDefaults();
  const nextAgents = { ...prev.agents };
  for (const a of agents || []) {
    if (!a?.id) continue;
    nextAgents[a.id] = { model: a.model != null ? String(a.model) : "" };
  }
  const payload = {
    updatedAt: new Date().toISOString(),
    agents: nextAgents,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

/**
 * Patch a single agent id's default model.
 */
export function saveAgentDefaultModel(agentId, model) {
  const file = defaultsPath();
  const prev = loadAgentDefaults();
  const nextAgents = {
    ...prev.agents,
    [agentId]: { model: model != null ? String(model) : "" },
  };
  const payload = {
    updatedAt: new Date().toISOString(),
    agents: nextAgents,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

export function agentDefaultsFilePath() {
  return defaultsPath();
}
