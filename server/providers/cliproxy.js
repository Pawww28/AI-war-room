import { config } from "../config.js";

/**
 * List models from CLIProxyAPI (OpenAI-compatible).
 * @returns {Promise<{ ok: boolean, models: Array<{id:string}>, error?: string }>}
 */
export async function listModels() {
  const url = `${config.cliproxy.baseUrl}/v1/models`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.cliproxy.apiKey}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        models: [],
        error: `HTTP ${res.status} ${body.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    const models = (data.data || data.models || [])
      .map((m) => ({ id: m.id || m.name || String(m) }))
      .filter((m) => m.id);
    return { ok: true, models, error: null };
  } catch (err) {
    return { ok: false, models: [], error: err.message || String(err) };
  }
}

/** Preferred model name needles per seat (order = try order). Free/stable first. */
function preferredNeedles(agent) {
  switch (agent.providerHint || agent.id) {
    case "codex":
    case "chatgpt":
      return [
        "gpt-5.5",
        "gpt-5.4-mini",
        "gpt-5.4",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5",
        "codex",
        "o3",
        "o4",
        "chatgpt",
      ];
    case "xai":
    case "grok":
      return ["grok-4.5", "grok-4.3", "grok-4", "grok-3", "grok", "xai"];
    case "claude":
      return ["claude", "sonnet", "opus", "haiku"];
    case "gemini":
    case "google":
      // Free AI Studio: avoid pro-first (429 quota). Prefer flash that still works for new keys.
      return [
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash",
        "gemini-2.5-flash",
        "gemini-flash",
        "gemini-3.1-pro",
        "gemini-3-pro",
        "gemini-2.5-pro",
        "gemini",
      ];
    default:
      return [];
  }
}

/**
 * Ordered model ids to try for this agent (primary + fallbacks).
 * @param {object} agent
 * @param {string[]} modelIds
 * @returns {string[]}
 */
export function candidateModelsForAgent(agent, modelIds) {
  const list = modelIds || [];
  const lower = list.map((s) => s.toLowerCase());
  const out = [];
  const add = (id) => {
    if (id && !out.includes(id)) out.push(id);
  };

  // Configured model first (even if not in catalog yet)
  if (agent.model) add(String(agent.model).trim());

  for (const needle of preferredNeedles(agent)) {
    const n = needle.toLowerCase();
    const hit = list.find((id, i) => lower[i].includes(n));
    if (hit) add(hit);
  }

  // Drop configured model if empty string slipped in
  return out.filter(Boolean);
}

/**
 * Heuristic: map a display seat to a model id from available list.
 */
export function pickModelForAgent(agent, modelIds) {
  const cands = candidateModelsForAgent(agent, modelIds);
  if (cands.length) return cands[0];
  if (agent.model) return agent.model;
  return modelIds[0] || null;
}

/**
 * Chat completion via CLIProxyAPI.
 */
export async function cliproxyComplete({ agent, messages, model }) {
  const url = `${config.cliproxy.baseUrl}/v1/chat/completions`;
  const started = Date.now();
  const body = {
    model,
    messages,
    temperature: 0.7,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.cliproxy.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.cliproxy.timeoutMs),
  });

  const latencyMs = Date.now() - started;
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(
      data?.error?.message ||
        data?.message ||
        `CLIProxy HTTP ${res.status}: ${raw.slice(0, 300)}`
    );
    err.status = res.status;
    err.raw = raw.slice(0, 500);
    throw err;
  }

  const text =
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    data?.output_text ||
    "";

  if (!text) {
    throw new Error("CLIProxy returned empty content");
  }

  return {
    text: typeof text === "string" ? text : JSON.stringify(text),
    model: data?.model || model,
    source: "cliproxy",
    latencyMs,
    usage: data?.usage || null,
  };
}

export async function probeCliproxy() {
  const models = await listModels();
  return {
    baseUrl: config.cliproxy.baseUrl,
    modelsOk: models.ok,
    modelCount: models.models.length,
    models: models.models.map((m) => m.id),
    error: models.error,
  };
}
