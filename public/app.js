import { t } from "./i18n.js";

const WP_KEY = "ai-war-room-wallpaper";
const WP_DIM_KEY = "ai-war-room-wallpaper-dim";
const LAST_SESSION_KEY = "ai-war-room-last-session";
const LANG_KEY = "ai-war-room-lang";

function lsGet(key, legacyKey) {
  return localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
}

const state = {
  lang: lsGet(LANG_KEY, "ai-meeting-lang") || "en",
  session: null,
  history: [],
  models: [],
  proxyHealth: null,
  debug: new URLSearchParams(location.search).has("debug"),
  speaking: null,
  es: null,
  webExpanded: new Map(),
  wallpapers: [],
  wallpaperId: lsGet(WP_KEY, "ai-meeting-wallpaper") || "night-city",
  wallpaperDim: Number(lsGet(WP_DIM_KEY, "ai-meeting-wallpaper-dim") || "72"),
  wallpaperPanelOpen: false,
};

const $ = (id) => document.getElementById(id);

function applyDebugClass() {
  document.body.classList.toggle("debug", state.debug);
  if (state.debug && !location.search.includes("debug")) {
    const u = new URL(location.href);
    u.searchParams.set("debug", "1");
    history.replaceState(null, "", u);
  }
}

function applyWallpaper() {
  const layer = $("wallpaper-layer");
  const item = state.wallpapers.find((w) => w.id === state.wallpaperId);
  document.documentElement.style.setProperty(
    "--wallpaper-dim",
    String(state.wallpaperDim / 100)
  );
  if ($("wallpaper-dim")) $("wallpaper-dim").value = String(state.wallpaperDim);
  if (!item || !item.file) {
    layer.style.backgroundImage = "none";
    return;
  }
  layer.style.backgroundImage = `url(/wallpapers/${item.file})`;
}

function renderWallpaperGrid() {
  const grid = $("wallpaper-grid");
  if (!grid) return;
  grid.innerHTML = "";
  for (const w of state.wallpapers) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "wallpaper-tile" +
      (w.id === state.wallpaperId ? " selected" : "") +
      (w.file ? "" : " solid");
    if (w.file) {
      btn.innerHTML = `<img src="/wallpapers/${w.file}" alt="" /><span class="wp-label">${escapeHtml(w.label)}</span>`;
    } else {
      btn.innerHTML = `<span class="wp-label">${escapeHtml(w.label)}</span>`;
    }
    btn.addEventListener("click", () => {
      state.wallpaperId = w.id;
      localStorage.setItem(WP_KEY, w.id);
      applyWallpaper();
      renderWallpaperGrid();
    });
    grid.appendChild(btn);
  }
}

async function loadWallpapers() {
  try {
    const m = await fetch("/wallpapers/manifest.json").then((r) => r.json());
    state.wallpapers = m.defaults || [];
  } catch {
    state.wallpapers = [{ id: "none", label: "None", file: null }];
  }
  if (!state.wallpapers.some((w) => w.id === state.wallpaperId)) {
    state.wallpaperId = state.wallpapers[0]?.id || "none";
  }
  applyWallpaper();
  renderWallpaperGrid();
}

function ui() {
  const L = state.lang;
  $("title-text").textContent = t(L, "title");
  $("btn-lang").textContent = t(L, "lang");
  $("btn-new").textContent = t(L, "newSession");
  $("btn-wallpaper").textContent = t(L, "wallpaper");
  $("btn-send").textContent = t(L, "sendRound");
  $("btn-search").textContent = t(L, "searchOnly");
  $("btn-search-send").textContent = t(L, "searchSend");
  $("host-input").placeholder = t(L, "hostPlaceholder");
  $("order-title").textContent = t(L, "orderTitle");
  $("order-hint").textContent = t(L, "orderHint");
  $("agents-title").textContent = t(L, "agentsTitle");
  $("agents-hint").textContent = t(L, "agentsHint");
  $("btn-refresh-models").textContent = t(L, "refreshModels");
  $("debug-title").textContent = t(L, "debugTitle");
  $("history-title").textContent = t(L, "history");
  $("history-hint").textContent = t(L, "historyHint");
  $("wallpaper-title").textContent = t(L, "wallpaper");
  $("wallpaper-dim-label").textContent = t(L, "wallpaperDim");
  renderHealth();
  renderStatus();
  renderHistory();
  renderTranscript();
  renderOrder();
  renderAgents();
  renderWallpaperGrid();
  updateLocked();
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
  return data;
}

function renderHealth() {
  const el = $("proxy-badge");
  const h = state.proxyHealth;
  if (!h) {
    el.textContent = t(state.lang, "proxyUnknown");
    el.className = "badge";
    return;
  }
  if (h.cliproxy?.modelsOk) {
    el.textContent = `${t(state.lang, "proxyOk")} · ${h.cliproxy.modelCount} ${t(state.lang, "models")}`;
    el.className = "badge ok";
  } else {
    el.textContent = `${t(state.lang, "proxyBad")}${h.cliproxy?.error ? " · " + h.cliproxy.error.slice(0, 40) : ""}`;
    el.className = "badge bad";
  }
  const se = $("serper-badge");
  if (se) {
    if (h.serper?.configured && h.serper?.enabled) {
      se.textContent = t(state.lang, "serperOk");
      se.className = "badge ok";
    } else {
      se.textContent = t(state.lang, "serperBad");
      se.className = "badge warn";
    }
  }
}

function renderStatus() {
  const el = $("status-badge");
  if (!state.session) {
    el.textContent = "—";
    el.className = "badge";
    return;
  }
  const running = state.session.status === "running_queue";
  el.textContent = running
    ? t(state.lang, "statusRunning")
    : t(state.lang, "statusIdle");
  el.className = running ? "badge warn" : "badge ok";

  const sp = $("speaking-line");
  if (state.speaking && (running || state.speaking.searchOnly)) {
    sp.textContent = `${t(state.lang, "speaking")}: ${state.speaking.displayName} (${state.speaking.index + 1}/${state.speaking.total})`;
  } else {
    sp.textContent = "";
  }
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(state.lang === "zh" ? "zh-TW" : "en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function closeAllChatMenus() {
  document.querySelectorAll(".chat-menu.open").forEach((m) => m.classList.remove("open"));
}

function renderHistory() {
  const ul = $("history-list");
  if (!ul) return;
  ul.innerHTML = "";
  if (!state.history.length) {
    ul.innerHTML = `<li class="hint" style="padding:8px">${t(state.lang, "historyEmpty")}</li>`;
    return;
  }
  for (const item of state.history) {
    const li = document.createElement("li");
    li.className =
      "history-item" + (state.session?.id === item.id ? " active" : "");
    li.innerHTML = `
      <button type="button" class="open" data-id="${escapeHtml(item.id)}">
        <span class="h-title">${escapeHtml(item.title || t(state.lang, "newSession"))}</span>
        <span class="h-meta">${escapeHtml(formatWhen(item.updatedAt || item.createdAt))}${item.rounds ? " · R" + item.rounds : ""}</span>
      </button>
      <div class="chat-menu-wrap">
        <button type="button" class="menu-btn" data-menu="${escapeHtml(item.id)}" aria-label="menu">⋯</button>
        <div class="chat-menu" data-menu-panel="${escapeHtml(item.id)}">
          <button type="button" class="menu-item" data-rename="${escapeHtml(item.id)}">${escapeHtml(t(state.lang, "rename"))}</button>
          <button type="button" class="menu-item danger" data-del="${escapeHtml(item.id)}">${escapeHtml(t(state.lang, "delete"))}</button>
        </div>
      </div>
    `;
    ul.appendChild(li);
  }
  ul.querySelectorAll("button.open").forEach((btn) => {
    btn.addEventListener("click", () => openSession(btn.dataset.id).catch(showErr));
  });
  ul.querySelectorAll("button.menu-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.menu;
      const panel = ul.querySelector(`[data-menu-panel="${CSS.escape(id)}"]`);
      const wasOpen = panel?.classList.contains("open");
      closeAllChatMenus();
      if (panel && !wasOpen) panel.classList.add("open");
    });
  });
  ul.querySelectorAll("button[data-rename]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllChatMenus();
      const id = btn.dataset.rename;
      const cur = state.history.find((h) => h.id === id)?.title || "";
      const next = prompt(t(state.lang, "renamePrompt"), cur);
      if (next == null) return;
      const title = next.trim();
      if (!title) return;
      try {
        await api(`/api/sessions/${id}/title`, {
          method: "PUT",
          body: JSON.stringify({ title }),
        });
        if (state.session?.id === id) {
          state.session.title = title;
          state.session.customTitle = title;
        }
        await refreshHistory();
      } catch (err) {
        showErr(err);
      }
    });
  });
  ul.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllChatMenus();
      const id = btn.dataset.del;
      if (!confirm(t(state.lang, "deleteConfirm"))) return;
      try {
        // Close SSE first if deleting active chat (avoids Windows file locks)
        if (state.session?.id === id && state.es) {
          state.es.close();
          state.es = null;
        }
        // POST /delete is more reliable than DELETE on some stacks
        await api(`/api/sessions/${id}/delete`, { method: "POST", body: "{}" });
        if (state.session?.id === id) {
          localStorage.removeItem(LAST_SESSION_KEY);
          state.session = null;
          await newSession();
        } else {
          await refreshHistory();
        }
      } catch (err) {
        showErr(err);
      }
    });
  });
}

function webSummary(turn) {
  if (turn.error) return t(state.lang, "webFailed");
  const q = turn.query || "";
  const lines = (turn.text || "").split("\n");
  const organic = lines.filter((l) => /^\d+\.\s/.test(l.trim())).length;
  const base = turn.searchOnly
    ? t(state.lang, "webSearchOnlyHint")
    : t(state.lang, "webCollapsedHint");
  if (q && organic) {
    return `${base} · “${q.slice(0, 80)}${q.length > 80 ? "…" : ""}” · ${organic} ${t(state.lang, "webHits")}`;
  }
  if (q) {
    return `${base} · “${q.slice(0, 100)}${q.length > 100 ? "…" : ""}”`;
  }
  return base;
}

function renderTranscript() {
  const root = $("transcript");
  const list = state.session?.transcript || [];
  if (!list.length) {
    root.innerHTML = `<div class="empty">${t(state.lang, "emptyTranscript")}</div>`;
    return;
  }
  const wrap = $("transcript-wrap");
  const prevScroll = wrap.scrollTop;
  const nearBottom = wrap.scrollHeight - prevScroll - wrap.clientHeight < 80;
  root.innerHTML = "";
  for (const turn of list) {
    const div = document.createElement("div");
    const roleClass =
      turn.role === "host" ? "host" : turn.role === "web" ? "web" : "agent";
    div.className = `bubble ${roleClass}`;
    const who =
      turn.role === "host"
        ? t(state.lang, "host")
        : turn.role === "web"
          ? t(state.lang, "web")
          : turn.displayName || turn.agentId;
    const tags = [];
    if (turn.round != null) tags.push(`${t(state.lang, "round")} ${turn.round}`);
    if (turn.model) tags.push(turn.model);
    if (turn.source === "serper") tags.push("serper");
    if (turn.source === "mock")
      tags.push(`<span class="tag-mock">${t(state.lang, "mock")}</span>`);
    if (turn.fallbackFrom)
      tags.push(
        `<span class="tag-mock" title="${escapeHtml(turn.fallbackFrom)}">${escapeHtml(
          t(state.lang, "fallbackHint")
        )}</span>`
      );
    if (turn.error) tags.push("failed");

    if (turn.role === "web") {
      const expanded = state.webExpanded.get(turn.id) === true;
      const toggleLabel = expanded ? t(state.lang, "hide") : t(state.lang, "show");
      div.classList.add(expanded ? "web-expanded" : "web-collapsed");
      div.innerHTML = `
        <div class="who">
          <strong>${escapeHtml(who)}</strong> ${tags.join(" · ")}
          <button type="button" class="web-toggle secondary" data-web-id="${escapeHtml(turn.id)}">${escapeHtml(toggleLabel)}</button>
        </div>
        <div class="web-summary">${escapeHtml(webSummary(turn))}</div>
        <div class="body web-body"${expanded ? "" : " hidden"}>${escapeHtml(turn.text)}</div>
      `;
      div.querySelector(".web-toggle").addEventListener("click", (e) => {
        e.stopPropagation();
        const id = e.currentTarget.dataset.webId;
        state.webExpanded.set(id, !(state.webExpanded.get(id) === true));
        renderTranscript();
      });
    } else {
      div.innerHTML = `
        <div class="who"><strong>${escapeHtml(who)}</strong> ${tags.join(" · ")}</div>
        <div class="body">${escapeHtml(turn.text)}</div>
      `;
    }
    root.appendChild(div);
  }
  if (nearBottom) wrap.scrollTop = wrap.scrollHeight;
  else wrap.scrollTop = prevScroll;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function idle() {
  return state.session && state.session.status === "idle_host";
}

function updateLocked() {
  const locked = !idle();
  $("btn-send").disabled = locked || !state.session;
  $("btn-search").disabled = locked || !state.session;
  $("btn-search-send").disabled = locked || !state.session;
  $("host-input").disabled = locked || !state.session;
  $("lock-hint").textContent =
    locked && state.session ? t(state.lang, "locked") : "";
  document.querySelectorAll("[data-need-idle]").forEach((el) => {
    el.disabled = locked;
  });
}

function renderOrder() {
  const ul = $("order-list");
  ul.innerHTML = "";
  if (!state.session) return;
  const order = state.session.order || [];
  order.forEach((agentId, index) => {
    const agent = state.session.agents.find((a) => a.id === agentId);
    const li = document.createElement("li");
    li.className = "order-item";
    li.innerHTML = `
      <span class="idx">${index + 1}</span>
      <span class="name">${escapeHtml(agent?.displayName || agentId)}</span>
      <span class="tools">
        <button type="button" class="icon secondary" data-need-idle data-act="up" data-i="${index}">↑</button>
        <button type="button" class="icon secondary" data-need-idle data-act="down" data-i="${index}">↓</button>
        <button type="button" class="icon secondary" data-need-idle data-act="rm" data-i="${index}">×</button>
      </span>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!idle()) return;
      const i = Number(btn.dataset.i);
      const act = btn.dataset.act;
      const next = [...state.session.order];
      if (act === "up" && i > 0) [next[i - 1], next[i]] = [next[i], next[i - 1]];
      if (act === "down" && i < next.length - 1)
        [next[i + 1], next[i]] = [next[i], next[i + 1]];
      if (act === "rm") next.splice(i, 1);
      if (!next.length) return;
      state.session = await api(`/api/sessions/${state.session.id}/order`, {
        method: "PUT",
        body: JSON.stringify({ order: next }),
      });
      renderOrder();
      updateLocked();
      refreshHistory();
    });
  });
  updateLocked();
}

function renderAgents() {
  const ul = $("agent-list");
  ul.innerHTML = "";
  if (!state.session) return;
  for (const agent of state.session.agents) {
    const li = document.createElement("li");
    li.className = "agent-item";
    const options = modelOptionsHtml(agent.model);
    li.innerHTML = `
      <div class="row">
        <strong>${escapeHtml(agent.displayName)}</strong>
        <div class="agent-actions">
          <button type="button" class="secondary" data-need-idle data-respond="${agent.id}">${t(state.lang, "respond")}</button>
          <button type="button" class="secondary" data-need-idle data-add="${agent.id}">${t(state.lang, "addToOrder")}</button>
        </div>
      </div>
      <label>${t(state.lang, "model")}</label>
      <select data-need-idle data-model-for="${agent.id}">${options}</select>
    `;
    ul.appendChild(li);
  }
  ul.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!idle()) return;
      const next = [...state.session.order, btn.dataset.add];
      state.session = await api(`/api/sessions/${state.session.id}/order`, {
        method: "PUT",
        body: JSON.stringify({ order: next }),
      });
      renderOrder();
    });
  });
  ul.querySelectorAll("[data-respond]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!idle()) return;
      respondAs(btn.dataset.respond).catch(showErr);
    });
  });
  ul.querySelectorAll("[data-model-for]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      if (!idle()) return;
      const id = sel.dataset.modelFor;
      const agents = state.session.agents.map((a) =>
        a.id === id ? { ...a, model: sel.value } : a
      );
      state.session = await api(`/api/sessions/${state.session.id}/agents`, {
        method: "PUT",
        body: JSON.stringify({ agents }),
      });
      renderAgents();
    });
  });
  updateLocked();
}

async function respondAs(agentId) {
  if (!idle() || !agentId) return;
  const hostSupplement = $("host-input").value.trim();
  $("error-line").textContent = "";
  $("btn-send").disabled = true;
  $("btn-search-send").disabled = true;
  document.querySelectorAll("[data-respond]").forEach((b) => {
    b.disabled = true;
  });
  try {
    state.session = await api(`/api/sessions/${state.session.id}/respond`, {
      method: "POST",
      body: JSON.stringify({ agentId, hostSupplement }),
    });
    // Always clear host box after Respond (aligned)
    $("host-input").value = "";
    renderTranscript();
    renderStatus();
    updateLocked();
    await refreshHistory();
  } catch (err) {
    $("error-line").textContent = `${t(state.lang, "error")}: ${err.message}`;
  } finally {
    updateLocked();
    if (state.debug) refreshDebug();
  }
}

function modelOptionsHtml(selected) {
  const ids = new Set(state.models.map((m) => m.id || m));
  if (selected) ids.add(selected);
  const list = [...ids];
  if (!list.length) return `<option value="">(auto / mock)</option>`;
  let html = `<option value="">(auto)</option>`;
  for (const id of list.sort()) {
    html += `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(id)}</option>`;
  }
  return html;
}

async function refreshHealth() {
  try {
    state.proxyHealth = await api("/api/health");
  } catch {
    state.proxyHealth = {
      cliproxy: { modelsOk: false, error: "war room server?" },
    };
  }
  renderHealth();
}

async function refreshModels() {
  try {
    const listed = await api("/api/models");
    state.models = listed.models || [];
  } catch {
    state.models = [];
  }
  renderAgents();
  if (state.debug) refreshDebug();
}

async function refreshHistory() {
  try {
    const data = await api("/api/sessions");
    state.history = data.sessions || [];
  } catch {
    state.history = [];
  }
  renderHistory();
}

function connectEvents(id) {
  if (state.es) state.es.close();
  const es = new EventSource(`/api/sessions/${id}/events`);
  state.es = es;
  es.addEventListener("session", (ev) => {
    state.session = JSON.parse(ev.data);
    renderTranscript();
    renderOrder();
    renderAgents();
    renderStatus();
    updateLocked();
    refreshHistory();
  });
  es.addEventListener("turn", (ev) => {
    const turn = JSON.parse(ev.data);
    if (!state.session) return;
    const exists = state.session.transcript.some((t) => t.id === turn.id);
    if (!exists) {
      state.session.transcript = [...state.session.transcript, turn];
      renderTranscript();
    }
  });
  es.addEventListener("speaking", (ev) => {
    state.speaking = JSON.parse(ev.data);
    renderStatus();
  });
  es.addEventListener("status", (ev) => {
    const st = JSON.parse(ev.data);
    if (state.session) state.session.status = st.status;
    if (st.status === "idle_host") state.speaking = null;
    renderStatus();
    updateLocked();
    if (state.debug) refreshDebug();
    refreshHistory();
  });
  es.addEventListener("error", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      $("error-line").textContent = `${t(state.lang, "error")}: ${data.message}`;
    } catch {
      /* sse reconnect */
    }
  });
}

async function openSession(id) {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.session = await api(`/api/sessions/${id}`);
  localStorage.setItem(LAST_SESSION_KEY, id);
  state.speaking = null;
  connectEvents(id);
  ui();
  await refreshModels();
  await refreshHistory();
}

async function newSession() {
  if (state.es) {
    state.es.close();
    state.es = null;
  }
  state.session = await api("/api/sessions", { method: "POST" });
  localStorage.setItem(LAST_SESSION_KEY, state.session.id);
  state.speaking = null;
  connectEvents(state.session.id);
  ui();
  await refreshModels();
  await refreshHistory();
  if (state.debug) refreshDebug();
}

async function sendRound(withSearch) {
  if (!idle()) return;
  const text = $("host-input").value.trim();
  if (!text) return;
  $("error-line").textContent = "";
  $("btn-send").disabled = true;
  $("btn-search").disabled = true;
  $("btn-search-send").disabled = true;
  try {
    state.session = await api(`/api/sessions/${state.session.id}/host`, {
      method: "POST",
      body: JSON.stringify({ text, search: Boolean(withSearch) }),
    });
    $("host-input").value = "";
    renderTranscript();
    renderStatus();
    updateLocked();
    await refreshHistory();
  } catch (err) {
    $("error-line").textContent = `${t(state.lang, "error")}: ${err.message}`;
  } finally {
    updateLocked();
    if (state.debug) refreshDebug();
  }
}

/** Call Serper only — append web results, no host turn / agent queue. Keeps input. */
async function searchOnly() {
  if (!idle()) return;
  const text = $("host-input").value.trim();
  if (!text) return;
  $("error-line").textContent = "";
  $("btn-send").disabled = true;
  $("btn-search").disabled = true;
  $("btn-search-send").disabled = true;
  try {
    state.session = await api(`/api/sessions/${state.session.id}/search`, {
      method: "POST",
      body: JSON.stringify({ query: text }),
    });
    renderTranscript();
    renderStatus();
    updateLocked();
    await refreshHistory();
  } catch (err) {
    $("error-line").textContent = `${t(state.lang, "error")}: ${err.message}`;
  } finally {
    updateLocked();
    if (state.debug) refreshDebug();
  }
}

async function refreshDebug() {
  if (!state.debug || !state.session) {
    $("debug-pre").textContent = state.debug ? "No session yet." : "";
    return;
  }
  try {
    const d = await api(`/api/sessions/${state.session.id}/debug`);
    $("debug-pre").textContent = JSON.stringify(
      { health: state.proxyHealth, models: state.models.slice(0, 50), sessionDebug: d },
      null,
      2
    );
  } catch (err) {
    $("debug-pre").textContent = String(err);
  }
}

function wire() {
  document.addEventListener("click", () => closeAllChatMenus());
  $("btn-lang").addEventListener("click", () => {
    state.lang = state.lang === "en" ? "zh" : "en";
    localStorage.setItem(LANG_KEY, state.lang);
    ui();
  });
  $("btn-new").addEventListener("click", () => newSession().catch(showErr));
  $("btn-new-side").addEventListener("click", () => newSession().catch(showErr));
  $("btn-send").addEventListener("click", () => sendRound(false));
  $("btn-search").addEventListener("click", () => searchOnly());
  $("btn-search-send").addEventListener("click", () => sendRound(true));
  $("btn-wallpaper").addEventListener("click", () => {
    state.wallpaperPanelOpen = !state.wallpaperPanelOpen;
    $("wallpaper-panel").hidden = !state.wallpaperPanelOpen;
  });
  $("wallpaper-dim").addEventListener("input", () => {
    state.wallpaperDim = Number($("wallpaper-dim").value);
    localStorage.setItem(WP_DIM_KEY, String(state.wallpaperDim));
    applyWallpaper();
  });
  $("host-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendRound(false);
    }
  });
  $("btn-refresh-models").addEventListener("click", () =>
    refreshModels().catch(showErr)
  );
}

function showErr(err) {
  $("error-line").textContent = String(err.message || err);
}

async function boot() {
  applyDebugClass();
  wire();
  await loadWallpapers();
  ui();
  await refreshHealth();
  await refreshHistory();

  const last = localStorage.getItem(LAST_SESSION_KEY);
  let opened = false;
  if (last && state.history.some((h) => h.id === last)) {
    try {
      await openSession(last);
      opened = true;
    } catch {
      /* fall through */
    }
  }
  if (!opened && state.history.length) {
    try {
      await openSession(state.history[0].id);
      opened = true;
    } catch {
      /* fall through */
    }
  }
  if (!opened) await newSession();
  setInterval(refreshHealth, 15000);
  if (state.debug) setInterval(refreshDebug, 5000);
}

boot().catch(showErr);
