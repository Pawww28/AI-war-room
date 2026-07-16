import {
  cliproxyComplete,
  listModels,
  pickModelForAgent,
  candidateModelsForAgent,
} from "./providers/cliproxy.js";
import { mockComplete } from "./providers/mock.js";
import {
  serperSearch,
  serperConfigured,
  shouldSkipSearch,
  stripSearchPrefix,
} from "./providers/serper.js";
import { config } from "./config.js";

function nowIso() {
  return new Date().toISOString();
}

function wallClockLine() {
  const d = new Date();
  return `Host wall clock: ${d.toISOString()} (local offset minutes ${-d.getTimezoneOffset()})`;
}

/**
 * Build OpenAI-style messages for one agent turn (full queue after host).
 */
function buildMessages(session, agent, hostText) {
  const history = [];
  for (const t of session.transcript) {
    if (t.role === "host") {
      history.push({ role: "user", content: `[Host]: ${t.text}` });
    } else if (t.role === "web") {
      history.push({
        role: "user",
        content: `[Web search · ${t.source || "serper"}]:\n${t.text}`,
      });
    } else if (t.role === "agent") {
      history.push({
        role: "assistant",
        content: `[${t.displayName || t.agentId}]: ${t.text}`,
      });
    }
  }
  const last = session.transcript[session.transcript.length - 1];
  if (!last || (last.role !== "host" && last.role !== "web")) {
    if (hostText) {
      history.push({ role: "user", content: `[Host]: ${hostText}` });
    }
  }

  const flat = history.map((m) => m.content).join("\n\n");

  return [
    {
      role: "system",
      content:
        (agent.system || `You are ${agent.displayName}.`) +
        `\n\n${wallClockLine()}` +
        "\nYou are in a multi-agent war room (AI War Room). The transcript uses [Host], [Web search], and [Name] labels. Reply with only your own next contribution (no role prefix required).",
    },
    {
      role: "user",
      content:
        flat +
        `\n\n---\nIt is now your turn (${agent.displayName}). Respond to the host and prior speakers. Use [Web search] when present for current facts.`,
    },
  ];
}

/**
 * α: all other agents' turns after this agent's last speech
 * If never spoke: all other agents after last host (else all other agents in session)
 * β: empty focus → continue mode
 */
export function computeRespondFocus(session, agentId) {
  const transcript = session.transcript || [];
  let lastSelfIdx = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const t = transcript[i];
    if (t.role === "agent" && t.agentId === agentId) {
      lastSelfIdx = i;
      break;
    }
  }

  let startIdx;
  if (lastSelfIdx >= 0) {
    startIdx = lastSelfIdx + 1;
  } else {
    let lastHostIdx = -1;
    for (let i = transcript.length - 1; i >= 0; i--) {
      if (transcript[i].role === "host") {
        lastHostIdx = i;
        break;
      }
    }
    startIdx = lastHostIdx >= 0 ? lastHostIdx + 1 : 0;
  }

  const focusTurns = [];
  for (let i = startIdx; i < transcript.length; i++) {
    const t = transcript[i];
    if (t.role === "agent" && t.agentId !== agentId) {
      focusTurns.push(t);
    }
  }

  const names = [];
  for (const t of focusTurns) {
    const n = t.displayName || t.agentId;
    if (!names.includes(n)) names.push(n);
  }

  return {
    mode: focusTurns.length ? "reply_multi" : "continue",
    focusTurns,
    focusNames: names,
  };
}

function buildRespondMessages(session, agent, hostSupplement, focus) {
  const history = [];
  for (const t of session.transcript) {
    if (t.role === "host") {
      history.push({ role: "user", content: `[Host]: ${t.text}` });
    } else if (t.role === "web") {
      history.push({
        role: "user",
        content: `[Web search · ${t.source || "serper"}]:\n${t.text}`,
      });
    } else if (t.role === "agent") {
      history.push({
        role: "assistant",
        content: `[${t.displayName || t.agentId}]: ${t.text}`,
      });
    }
  }
  const flat = history.map((m) => m.content).join("\n\n");
  const supplement = (hostSupplement || "").trim();

  let turnInstruction;
  if (focus.mode === "reply_multi") {
    const who = focus.focusNames.join(", ");
    const excerpts = focus.focusTurns
      .map(
        (t, i) =>
          `${i + 1}. [${t.displayName || t.agentId}]: ${String(t.text).slice(0, 1200)}`
      )
      .join("\n\n");
    turnInstruction =
      `It is now your turn (${agent.displayName}) via Respond.\n` +
      `Address the arguments from: ${who}. Engage each as needed; do not ignore any of them.\n\n` +
      `Focus excerpts:\n${excerpts}`;
    if (supplement) {
      turnInstruction += `\n\nAdditional host instruction for this turn:\n${supplement}`;
    }
  } else {
    turnInstruction =
      `It is now your turn (${agent.displayName}) via Respond in CONTINUE mode.\n` +
      `There is no new multi-party focus after your last speech (or you have not spoken yet with others after you). ` +
      `Continue the discussion based on the full transcript.`;
    if (supplement) {
      turnInstruction += `\n\nHost instruction for this continue turn (primary guidance):\n${supplement}`;
    } else {
      turnInstruction += `\n\nNo extra host instruction — continue naturally.`;
    }
  }

  return [
    {
      role: "system",
      content:
        (agent.system || `You are ${agent.displayName}.`) +
        `\n\n${wallClockLine()}` +
        "\nYou are in a multi-agent war room (AI War Room). Reply with only your own next contribution (no role prefix required).",
    },
    {
      role: "user",
      content: (flat ? flat + "\n\n---\n" : "") + turnInstruction,
    },
  ];
}

async function resolveModels(store, session) {
  let modelIds = [];
  const listed = await listModels();
  if (listed.ok) {
    modelIds = listed.models.map((m) => m.id);
    store.appendDebug(session, {
      type: "models",
      ok: true,
      count: modelIds.length,
      sample: modelIds.slice(0, 20),
    });
  } else {
    store.appendDebug(session, {
      type: "models",
      ok: false,
      error: listed.error,
    });
  }
  return modelIds;
}

export function createOrchestrator(store) {
  async function runAgentCompletion(session, agent, messages, round, index, modelIds) {
    let result;
    const candidates = candidateModelsForAgent(agent, modelIds);
    if (!candidates.length && modelIds.length) {
      const picked = pickModelForAgent(agent, modelIds);
      if (picked) candidates.push(picked);
    }

    const errors = [];
    if (candidates.length) {
      for (const usedModel of candidates) {
        try {
          result = await cliproxyComplete({
            agent,
            messages,
            model: usedModel,
          });
          store.appendDebug(session, {
            type: "completion",
            agentId: agent.id,
            model: usedModel,
            source: "cliproxy",
            latencyMs: result.latencyMs,
            ok: true,
            tried: candidates,
          });
          // Stick to a working model for later rounds in this session
          if (result.source === "cliproxy" && usedModel) {
            agent.model = usedModel;
          }
          break;
        } catch (err) {
          errors.push(`${usedModel}: ${err.message}`);
          store.appendDebug(session, {
            type: "completion",
            agentId: agent.id,
            model: usedModel,
            source: "cliproxy",
            ok: false,
            error: err.message,
          });
        }
      }
    }

    if (!result) {
      const errSummary =
        errors.join(" | ") || "no model id / proxy models unavailable";
      if (!config.mockFallback) {
        throw new Error(
          `No live model for ${agent.displayName}: ${errSummary}`
        );
      }
      result = await mockComplete({
        agent,
        messages,
        roundIndex: index,
        reason: errSummary,
      });
      result.fallbackFrom = errSummary;
      store.appendDebug(session, {
        type: "completion",
        agentId: agent.id,
        model: "mock-local",
        source: "mock",
        ok: true,
        reason: errSummary,
      });
    }

    const agentTurn = {
      id: `t_${Date.now()}_${agent.id}_${index}`,
      role: "agent",
      agentId: agent.id,
      displayName: agent.displayName,
      text: result.text,
      ts: nowIso(),
      round,
      model: result.model,
      source: result.source,
      latencyMs: result.latencyMs ?? null,
      fallbackFrom: result.fallbackFrom || null,
    };
    store.addTurn(session, agentTurn);
    return agentTurn;
  }

  /**
   * Search-only: call Serper, append a web turn, do not post host or run agents.
   * @param {string} sessionId
   * @param {string} query
   */
  async function runSearchOnly(sessionId, query) {
    const session = store.get(sessionId);
    if (session.status !== "idle_host") {
      throw Object.assign(new Error("A round is already running"), { status: 409 });
    }
    const raw = (query || "").trim();
    if (!raw) {
      throw Object.assign(new Error("Search query is empty"), { status: 400 });
    }
    if (!config.serper.enabled || !serperConfigured()) {
      throw Object.assign(
        new Error(
          !serperConfigured()
            ? "SERPER_API_KEY not set"
            : "Serper is disabled"
        ),
        { status: 503 }
      );
    }

    const q = stripSearchPrefix(raw) || raw;
    const round = session.roundCount || 0;

    store.broadcast(session, "speaking", {
      agentId: "web",
      displayName: "Web (Serper)",
      index: 0,
      total: 1,
      searchOnly: true,
    });

    const search = await serperSearch(q);
    store.appendDebug(session, {
      type: "serper",
      ok: search.ok,
      query: search.query,
      latencyMs: search.latencyMs,
      error: search.error,
      hits: search.organic?.length ?? 0,
      searchOnly: true,
    });

    if (search.ok) {
      store.addTurn(session, {
        id: `t_${Date.now()}_web`,
        role: "web",
        text: search.text,
        query: search.query,
        source: "serper",
        ts: nowIso(),
        round,
        searchOnly: true,
        latencyMs: search.latencyMs,
      });
    } else {
      store.addTurn(session, {
        id: `t_${Date.now()}_web_fail`,
        role: "web",
        text: `(Search failed: ${search.error})`,
        query: search.query,
        source: "serper",
        ts: nowIso(),
        round,
        searchOnly: true,
        error: search.error,
        latencyMs: search.latencyMs,
      });
    }

    store.broadcast(session, "speaking", null);
    store.broadcast(session, "session", store.publicSession(session));
    store.broadcast(session, "status", {
      status: "idle_host",
      round: session.roundCount,
    });
    return store.publicSession(session);
  }

  /**
   * @param {string} sessionId
   * @param {string} hostText
   * @param {{ search?: boolean }} [options]
   */
  async function runHostTurn(sessionId, hostText, options = {}) {
    const session = store.get(sessionId);
    if (session.status !== "idle_host") {
      throw Object.assign(new Error("A round is already running"), { status: 409 });
    }
    const rawText = (hostText || "").trim();
    if (!rawText) {
      throw Object.assign(new Error("Host message is empty"), { status: 400 });
    }
    if (!session.order.length) {
      throw Object.assign(new Error("Speak order is empty"), { status: 400 });
    }

    const wantSearch = Boolean(options.search);
    const skipWeb = shouldSkipSearch(rawText);
    const text = stripSearchPrefix(rawText) || rawText;
    const doSearch =
      wantSearch &&
      config.serper.enabled &&
      serperConfigured() &&
      !skipWeb;

    session.status = "running_queue";
    session.lastError = null;
    session.roundCount += 1;
    const round = session.roundCount;
    store.broadcast(session, "session", store.publicSession(session));
    store.broadcast(session, "status", { status: "running_queue", round });

    store.addTurn(session, {
      id: `t_${Date.now()}_host`,
      role: "host",
      text,
      ts: nowIso(),
      round,
      searchRequested: wantSearch,
    });

    if (doSearch) {
      store.broadcast(session, "speaking", {
        agentId: "web",
        displayName: "Web (Serper)",
        index: 0,
        total: session.order.length + 1,
      });
      const search = await serperSearch(text);
      store.appendDebug(session, {
        type: "serper",
        ok: search.ok,
        query: search.query,
        latencyMs: search.latencyMs,
        error: search.error,
        hits: search.organic?.length ?? 0,
      });
      if (search.ok) {
        store.addTurn(session, {
          id: `t_${Date.now()}_web`,
          role: "web",
          text: search.text,
          query: search.query,
          source: "serper",
          ts: nowIso(),
          round,
          latencyMs: search.latencyMs,
        });
      } else {
        store.addTurn(session, {
          id: `t_${Date.now()}_web_fail`,
          role: "web",
          text: `(Search failed: ${search.error}. Agents have no fresh web results this round.)`,
          query: search.query,
          source: "serper",
          ts: nowIso(),
          round,
          error: search.error,
          latencyMs: search.latencyMs,
        });
      }
    } else {
      store.appendDebug(session, {
        type: "serper",
        ok: false,
        skipped: true,
        reason: !wantSearch
          ? "send round without search"
          : skipWeb
            ? "host requested offline (/local|/offline|/nweb)"
            : !serperConfigured()
              ? "no SERPER_API_KEY"
              : "serper disabled",
      });
    }

    const modelIds = await resolveModels(store, session);

    try {
      for (let i = 0; i < session.order.length; i++) {
        const agentId = session.order[i];
        const agent = session.agents.find((a) => a.id === agentId);
        if (!agent) continue;

        store.broadcast(session, "speaking", {
          agentId: agent.id,
          displayName: agent.displayName,
          index: i,
          total: session.order.length,
        });

        const messages = buildMessages(session, agent, text);
        await runAgentCompletion(session, agent, messages, round, i, modelIds);
      }
    } catch (err) {
      session.lastError = err.message || String(err);
      session.status = "idle_host";
      store.persist(session);
      store.broadcast(session, "error", { message: session.lastError });
      store.broadcast(session, "session", store.publicSession(session));
      store.broadcast(session, "status", { status: "idle_host", round });
      throw err;
    }

    session.status = "idle_host";
    store.persist(session);
    store.broadcast(session, "session", store.publicSession(session));
    store.broadcast(session, "status", { status: "idle_host", round });
    return store.publicSession(session);
  }

  /**
   * Single-agent Respond (α multi-focus or β continue).
   * @param {string} sessionId
   * @param {string} agentId
   * @param {{ hostSupplement?: string }} [options]
   */
  async function runRespond(sessionId, agentId, options = {}) {
    const session = store.get(sessionId);
    if (session.status !== "idle_host") {
      throw Object.assign(new Error("A round is already running"), { status: 409 });
    }
    const agent = session.agents.find((a) => a.id === agentId);
    if (!agent) {
      throw Object.assign(new Error(`Unknown agent: ${agentId}`), { status: 400 });
    }

    const hostSupplement = (options.hostSupplement || options.hostText || "").trim();
    const focus = computeRespondFocus(session, agentId);

    session.status = "running_queue";
    session.lastError = null;
    // Respond does not increment host roundCount as a full host round;
    // use current round or bump lightly for tagging
    const round = session.roundCount || 1;
    store.broadcast(session, "session", store.publicSession(session));
    store.broadcast(session, "status", { status: "running_queue", round });
    store.broadcast(session, "speaking", {
      agentId: agent.id,
      displayName: agent.displayName,
      index: 0,
      total: 1,
      respondMode: focus.mode,
    });

    store.appendDebug(session, {
      type: "respond",
      agentId,
      mode: focus.mode,
      focusNames: focus.focusNames,
      hasHostSupplement: Boolean(hostSupplement),
    });

    // Optional: inject host supplement as a host turn only when non-empty
    if (hostSupplement) {
      store.addTurn(session, {
        id: `t_${Date.now()}_host_sup`,
        role: "host",
        text: hostSupplement,
        ts: nowIso(),
        round,
        respondSupplement: true,
      });
    }

    const modelIds = await resolveModels(store, session);
    // Recompute focus after optional host turn — α focus is agent-only after lastSelf,
    // host supplement shouldn't clear multi focus. compute before host add was correct for α;
    // if we added host, focus for reply_multi was computed before — good, we still have focus variable.

    try {
      const messages = buildRespondMessages(
        session,
        agent,
        hostSupplement,
        focus
      );
      await runAgentCompletion(session, agent, messages, round, 0, modelIds);
    } catch (err) {
      session.lastError = err.message || String(err);
      session.status = "idle_host";
      store.persist(session);
      store.broadcast(session, "error", { message: session.lastError });
      store.broadcast(session, "session", store.publicSession(session));
      store.broadcast(session, "status", { status: "idle_host", round });
      throw err;
    }

    session.status = "idle_host";
    store.persist(session);
    store.broadcast(session, "session", store.publicSession(session));
    store.broadcast(session, "status", { status: "idle_host", round });
    return store.publicSession(session);
  }

  return { runHostTurn, runSearchOnly, runRespond, computeRespondFocus };
}
