/**
 * Deterministic local replies for offline / fallback demos.
 */
export async function mockComplete({ agent, messages, roundIndex, reason }) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const snippet = (lastUser?.content || "").slice(0, 160);
  const name = agent.displayName || agent.id;
  const why = reason
    ? String(reason).slice(0, 400)
    : "CLIProxyAPI unavailable or no model assigned";
  const text = [
    `[MOCK · ${name}]`,
    `Round context index: ${roundIndex ?? 0}.`,
    `I received the latest host/context cue:`,
    snippet ? `"${snippet}${snippet.length >= 160 ? "…" : ""}"` : "(empty)",
    "",
    "Position: Placeholder — live completion failed; this is not a real model reply.",
    `Cause: ${why}`,
    "Agree/Disagree: n/a (mock)",
    "Questions: Check model id (e.g. Gemini free tier: gemini-3-flash-preview), quota, and CLIProxyAPI.",
  ].join("\n");

  await sleep(200 + Math.floor(Math.random() * 300));
  return {
    text,
    model: "mock-local",
    source: "mock",
    latencyMs: 0,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
