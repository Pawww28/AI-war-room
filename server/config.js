import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnvFiles } from "./loadEnv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const loadedEnvFiles = loadEnvFiles(root);
if (loadedEnvFiles.length) {
  console.log(`[env] loaded: ${loadedEnvFiles.join(" | ")}`);
} else {
  console.log("[env] no .env files found (AppData Resablic / project)");
}

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

const localAppData =
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

/** Persistent chat records (survives project moves / restarts) */
const resablicWarRoomDir = path.join(localAppData, "Resablic", "ai-war-room");
const resablicLegacyDir = path.join(localAppData, "Resablic", "ai-meeting");
try {
  if (!fs.existsSync(resablicWarRoomDir) && fs.existsSync(resablicLegacyDir)) {
    fs.renameSync(resablicLegacyDir, resablicWarRoomDir);
    console.log(`[records] migrated AppData ai-meeting → ai-war-room`);
  }
} catch (err) {
  console.warn(`[records] AppData migrate skipped: ${err.message}`);
}
const chatRecordsDir = path.join(resablicWarRoomDir, "chat-records");
const agentDefaultsPath = path.join(resablicWarRoomDir, "agent-defaults.json");

export const config = {
  root,
  host: env("WAR_ROOM_HOST", env("MEETING_HOST", "0.0.0.0")),
  port: Number(env("WAR_ROOM_PORT", env("MEETING_PORT", "8787"))),
  recordsDir: env(
    "WAR_ROOM_RECORDS_DIR",
    env("MEETING_RECORDS_DIR", chatRecordsDir)
  ),
  agentDefaultsPath: env("AGENT_DEFAULTS_PATH", agentDefaultsPath),
  publicDir: path.join(root, "public"),
  cliproxy: {
    baseUrl: env("CLIPROXY_BASE_URL", "http://127.0.0.1:8317").replace(/\/$/, ""),
    apiKey: env(
      "CLIPROXY_API_KEY",
      "mtg_2a6f4c337f53a8f317fc77e172038a5c279f8f6f716de5ef"
    ),
    timeoutMs: Number(env("CLIPROXY_TIMEOUT_MS", "180000")),
  },
  serper: {
    apiKey: env("SERPER_API_KEY", ""),
    baseUrl: env("SERPER_BASE_URL", "https://google.serper.dev").replace(/\/$/, ""),
    numResults: Number(env("SERPER_NUM_RESULTS", "6")),
    timeoutMs: Number(env("SERPER_TIMEOUT_MS", "20000")),
    enabled: env("SERPER_ENABLED", "true") !== "false",
  },
  mockFallback: env("MOCK_FALLBACK", "true") !== "false",
};

console.log(`[records] ${config.recordsDir}`);
console.log(`[defaults] ${config.agentDefaultsPath}`);

export const defaultAgents = [
  {
    id: "chatgpt",
    displayName: "ChatGPT",
    providerHint: "codex",
    model: "gpt-5.6-terra",
    system:
      "You are ChatGPT in a multi-agent war room. Be clear, structured, and concise. Respond only as yourself. When asked to summarize, produce a short ops-style summary with decisions and open questions. When [Web search] context is provided, treat it as current evidence; cite it briefly; if it conflicts with your prior knowledge, prefer the search results for time-sensitive facts (prices, news, dates).",
  },
  {
    id: "grok",
    displayName: "Grok",
    providerHint: "xai",
    model: "grok-4.5",
    system:
      "You are Grok in a multi-agent war room. Be direct, skeptical when useful, and concise. Respond only as yourself. Engage with prior speakers; do not repeat their full answers. When [Web search] context is provided, use it for current facts; prefer search over outdated training guesses for news, markets, and today's date context.",
  },
  {
    id: "gemini",
    displayName: "Gemini",
    providerHint: "gemini",
    // 2.5-flash often 404 for new AI Studio keys; 3-flash-preview works (2026-07)
    model: "gemini-3-flash-preview",
    system:
      "You are Gemini in a multi-agent war room. Be clear, practical, and concise. Respond only as yourself. Engage with prior speakers; do not repeat their full answers. When [Web search] context is provided, ground time-sensitive claims in it; prefer search for news, markets, and today's date context.",
  },
  {
    id: "claude",
    displayName: "Claude",
    providerHint: "claude",
    model: "",
    system:
      "You are Claude in a multi-agent war room. Be careful, precise, and concise. Respond only as yourself. Prefer actionable points and explicit assumptions. When [Web search] context is provided, ground time-sensitive claims in it.",
  },
];
