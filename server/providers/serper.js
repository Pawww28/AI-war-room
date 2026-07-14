import { config } from "../config.js";

/**
 * Google search via Serper.dev
 * @param {string} query
 * @returns {Promise<{ ok: boolean, query: string, text: string, organic: Array, error?: string, latencyMs: number }>}
 */
export async function serperSearch(query) {
  const q = (query || "").trim();
  const started = Date.now();
  if (!q) {
    return {
      ok: false,
      query: q,
      text: "",
      organic: [],
      error: "empty query",
      latencyMs: 0,
    };
  }
  if (!config.serper.apiKey) {
    return {
      ok: false,
      query: q,
      text: "",
      organic: [],
      error: "SERPER_API_KEY not set",
      latencyMs: 0,
    };
  }

  try {
    const res = await fetch(`${config.serper.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": config.serper.apiKey,
      },
      body: JSON.stringify({
        q,
        num: config.serper.numResults,
      }),
      signal: AbortSignal.timeout(config.serper.timeoutMs),
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
      return {
        ok: false,
        query: q,
        text: "",
        organic: [],
        error: data?.message || data?.error || `HTTP ${res.status}: ${raw.slice(0, 200)}`,
        latencyMs,
      };
    }

    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const answerBox = data?.answerBox;
    const knowledge = data?.knowledgeGraph;
    const lines = [];
    lines.push(`Search query: ${q}`);
    lines.push(`Fetched at (UTC): ${new Date().toISOString()}`);
    if (answerBox?.answer) {
      lines.push(`Answer box: ${answerBox.answer}`);
    } else if (answerBox?.snippet) {
      lines.push(`Answer box: ${answerBox.snippet}`);
    }
    if (knowledge?.title) {
      lines.push(
        `Knowledge: ${knowledge.title}${knowledge.description ? " — " + knowledge.description : ""}`
      );
    }
    const top = organic.slice(0, config.serper.numResults);
    if (top.length) {
      lines.push("Organic results:");
      top.forEach((item, i) => {
        const title = item.title || "(no title)";
        const link = item.link || "";
        const snippet = item.snippet || item.snippetHighlighted || "";
        lines.push(`${i + 1}. ${title}`);
        if (link) lines.push(`   ${link}`);
        if (snippet) lines.push(`   ${snippet}`);
      });
    } else {
      lines.push("No organic results.");
    }

    return {
      ok: true,
      query: q,
      text: lines.join("\n"),
      organic: top.map((o) => ({
        title: o.title,
        link: o.link,
        snippet: o.snippet,
      })),
      error: null,
      latencyMs,
    };
  } catch (err) {
    return {
      ok: false,
      query: q,
      text: "",
      organic: [],
      error: err.message || String(err),
      latencyMs: Date.now() - started,
    };
  }
}

export function serperConfigured() {
  return Boolean(config.serper.apiKey);
}

/** Host message prefixes that skip web search for this round */
export function shouldSkipSearch(hostText) {
  const t = (hostText || "").trim();
  return (
    t.startsWith("/local") ||
    t.startsWith("/offline") ||
    t.startsWith("/nweb") ||
    t.startsWith("!local")
  );
}

export function stripSearchPrefix(hostText) {
  return (hostText || "")
    .replace(/^\/(local|offline|nweb)\s*/i, "")
    .replace(/^!local\s*/i, "")
    .trim();
}
