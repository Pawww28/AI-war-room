# AI War Room

Local multi-agent **war room**: you are the Host; agents reply in a configurable order.

- UI: left chat history, center transcript, right agents / wallpaper
- Backend: Node (no npm dependencies)
- Models: [CLIProxyAPI](../CLI%20ProxyApi/) with **mock fallback**
- Optional web intel: **Search & send** (Serper)
- Reorder speak queue **only while waiting for Host**

## Where things live

| Path | Purpose |
|------|---------|
| `C:\Projects\ai-war-room\` | This app |
| `C:\Projects\CLI ProxyApi\` | CLIProxyAPI binary + config |
| `C:\Projects\CLI ProxyApi\config.yaml` | Proxy config (port **8317**, API key, debug) |
| `C:\Projects\CLI ProxyApi\data\auth\` | OAuth credentials after login |
| `%LOCALAPPDATA%\Resablic\ai-war-room\chat-records\` | Chat history (survives restart) |
| `%LOCALAPPDATA%\Resablic\ai-war-room\agent-defaults.json` | Default model per agent (auto-updated from UI) |
| `public\wallpapers\` | Default wallpaper images |

## Door / shortcuts

In this folder (`C:\Projects\ai-war-room\`):

| File | What it does |
|------|----------------|
| **`Start AI War Room.bat`** | Starts Node server + opens browser |
| **`Open AI War Room.url`** | Shortcut → `http://127.0.0.1:8787/` |
| **`Open AI War Room (debug).url`** | Shortcut → `?debug=1` |
| **`ENTER.html`** | Double-click HTML door |
| **`Open browser only.bat`** | Opens browser only (server must already run) |

Project root: `C:\Projects\AI War Room - door.bat`

## Ports

| Service | Port | Bind |
|---------|------|------|
| CLIProxyAPI | **8317** | all interfaces (LAN OK) |
| AI War Room UI/API | **8787** | all interfaces (LAN OK) |

## Debug UI

```text
http://127.0.0.1:8787/
http://127.0.0.1:8787/?debug=1
```

## API key (CLIProxy gate)

Shared secret in:

1. `CLI ProxyApi\config.yaml` → `api-keys`
2. env / `CLIPROXY_API_KEY` / server default

## One-time: CLIProxyAPI login

```powershell
cd "C:\Projects\CLI ProxyApi"
.\cli-proxy-api.exe -config .\config.yaml -codex-login
.\cli-proxy-api.exe -config .\config.yaml -xai-login
.\cli-proxy-api.exe -config .\config.yaml -claude-login
```

## Start (two processes)

Or just run **`Start AI War Room.bat`** (starts proxy if needed + War Room).

```powershell
cd "C:\Projects\CLI ProxyApi"
.\cli-proxy-api.exe -config .\config.yaml

cd "C:\Projects\ai-war-room"
node server\index.js
```

## Speak order / Search

- **Send round** — agents only  
- **Search & send** — Serper once, then agents  
- Serper key: `%LOCALAPPDATA%\Resablic\.env` → `SERPER_API_KEY`
- Gemini (AI Studio free): same `.env` → `Gemini_API_KEY`  
  → synced into `CLI ProxyApi\config.yaml` via `node scripts\sync-gemini-from-resablic.mjs` (also run by Start bat)

## Chat history

Left rail lists past ops. Stored at:

```text
%LOCALAPPDATA%\Resablic\ai-war-room\chat-records\<id>\
```

## Default agent models

Changing a model in the UI writes:

```text
%LOCALAPPDATA%\Resablic\ai-war-room\agent-defaults.json
```

Example:

```json
{
  "updatedAt": "2026-07-13T12:00:00.000Z",
  "agents": {
    "chatgpt": { "model": "gpt-5.6-terra" },
    "grok": { "model": "grok-4.5" },
    "gemini": { "model": "gemini-3-flash-preview" },
    "claude": { "model": "" }
  }
}
```

- **New session** loads these defaults  
- **Old chats** keep their own `meta.json` agents (not rewritten)

## Wallpaper

Header **Wallpaper** — Night city, Star rooftop, Otaku den, Magic library, or solid + dim slider.
