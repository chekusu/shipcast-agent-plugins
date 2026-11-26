import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE_URL = "https://api.shipcast.dev";
const SERVER_NAME = "Shipcast MCP";
const SERVER_VERSION = "0.1.1";
const AUTH_SKEW_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};
const SHIPCAST_WIDGET_URI = "ui://widget/shipcast.html";
const SHIPCAST_WIDGET_MIME_TYPE = "text/html;profile=mcp-app";
const RENDER_VIEWS = [
  "accounts",
  "account",
  "preview",
  "publications",
  "action",
  "status",
];
const RENDER_STATUSES = ["ready", "success", "warning", "error", "info"];
const MCP_TOOL_RESULT = Symbol("mcpToolResult");

const SHIPCAST_WIDGET_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shipcast</title>
  <style>
    :root {
      color: #0f172a;
      background: #ffffff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color-scheme: light;
      --shipcast-blue: #2563eb;
      --shipcast-blue-dark: #1d4ed8;
      --shipcast-slate: #64748b;
      --shipcast-border: #e2e8f0;
      --shipcast-soft: #f8fafc;
      --shipcast-orange: #f97316;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #ffffff; }
    body { padding: 0; color: #0f172a; }
    .shell {
      width: 100%;
      min-height: 100%;
      padding: 18px;
      background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    }
    .topline {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .mark {
      width: 34px;
      height: 34px;
      flex: 0 0 auto;
      border-radius: 8px;
      box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
    }
    .brand-text {
      min-width: 0;
    }
    .brand-name {
      margin: 0;
      color: #111827;
      font-size: 15px;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .brand-subtitle {
      margin-top: 2px;
      color: var(--shipcast-slate);
      font-size: 12px;
      font-weight: 600;
      line-height: 1.2;
    }
    .status {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid #bfdbfe;
      border-radius: 999px;
      background: #eff6ff;
      color: var(--shipcast-blue);
      padding: 5px 9px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .hero {
      border: 1px solid var(--shipcast-border);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.92);
      padding: 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);
    }
    .hero h1 {
      margin: 0;
      color: #0f172a;
      font-size: 22px;
      line-height: 1.14;
      letter-spacing: 0;
    }
    .summary {
      margin: 8px 0 0;
      color: var(--shipcast-slate);
      font-size: 14px;
      line-height: 1.5;
    }
    .meta-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 24px;
      max-width: 100%;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
    }
    .pill.blue { background: #eff6ff; color: #1d4ed8; }
    .pill.green { background: #ecfdf5; color: #047857; }
    .pill.orange { background: #fff7ed; color: #c2410c; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
      margin-top: 12px;
    }
    .card {
      min-width: 0;
      border: 1px solid var(--shipcast-border);
      border-radius: 8px;
      background: #ffffff;
      padding: 13px;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
    }
    .card h2 {
      margin: 0;
      color: #0f172a;
      font-size: 15px;
      line-height: 1.25;
      letter-spacing: 0;
      word-break: break-word;
    }
    .card p {
      margin: 7px 0 0;
      color: var(--shipcast-slate);
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
    }
    .detail {
      display: grid;
      gap: 8px;
      margin-top: 12px;
      border: 1px solid var(--shipcast-border);
      border-radius: 8px;
      background: #ffffff;
      padding: 12px;
    }
    .kv {
      display: grid;
      grid-template-columns: minmax(86px, 0.34fr) 1fr;
      gap: 10px;
      align-items: start;
      min-width: 0;
    }
    .key {
      color: #94a3b8;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.4;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .value {
      min-width: 0;
      color: #334155;
      font-size: 13px;
      line-height: 1.45;
      word-break: break-word;
    }
    .actions, .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }
    .action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      background: #ffffff;
      color: var(--shipcast-blue-dark);
      padding: 8px 11px;
      font-size: 13px;
      font-weight: 800;
      line-height: 1.2;
      text-decoration: none;
    }
    .action.primary {
      border-color: var(--shipcast-blue);
      background: var(--shipcast-blue);
      color: #ffffff;
    }
    .empty {
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
      padding: 18px;
      color: var(--shipcast-slate);
      font-size: 14px;
      line-height: 1.5;
    }
    @media (max-width: 480px) {
      .shell { padding: 14px; }
      .topline { align-items: flex-start; }
      .status { max-width: 96px; }
      .hero h1 { font-size: 19px; }
      .grid { grid-template-columns: 1fr; }
      .kv { grid-template-columns: 1fr; gap: 3px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topline">
      <div class="brand">
        <svg class="mark" viewBox="0 0 1024 1024" aria-hidden="true">
          <defs>
            <radialGradient id="bgA" cx="22%" cy="78%" r="72%">
              <stop offset="0%" stop-color="#1D4ED8"/>
              <stop offset="48%" stop-color="#0F172A"/>
              <stop offset="100%" stop-color="#070B14"/>
            </radialGradient>
            <radialGradient id="bgB" cx="78%" cy="16%" r="64%">
              <stop offset="0%" stop-color="#7C2D12" stop-opacity=".92"/>
              <stop offset="52%" stop-color="#0F172A" stop-opacity=".18"/>
              <stop offset="100%" stop-color="#070B14" stop-opacity="0"/>
            </radialGradient>
            <linearGradient id="orange" x1="250" x2="760" y1="190" y2="860" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#FDBA74"/>
              <stop offset="40%" stop-color="#F97316"/>
              <stop offset="100%" stop-color="#C2410C"/>
            </linearGradient>
            <linearGradient id="blue" x1="248" x2="780" y1="180" y2="820" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#BAE6FD"/>
              <stop offset="48%" stop-color="#60A5FA"/>
              <stop offset="100%" stop-color="#2563EB"/>
            </linearGradient>
          </defs>
          <rect width="1024" height="1024" rx="224" fill="url(#bgA)"/>
          <rect width="1024" height="1024" rx="224" fill="url(#bgB)"/>
          <path d="M544 128 224 576h240l-48 320 384-512H560L544 128Z" fill="url(#orange)"/>
          <path d="M544 128 224 576h240l-48 320 160-416h224L560 384 544 128Z" fill="url(#blue)" opacity=".94"/>
        </svg>
        <div class="brand-text">
          <p class="brand-name">shipcast</p>
          <div class="brand-subtitle">X publishing cockpit</div>
        </div>
      </div>
      <div class="status" id="status">Ready</div>
    </header>
    <section id="root" class="empty">Waiting for Shipcast tool output.</section>
  </main>
  <script>
    (function () {
      var root = document.getElementById("root");
      var statusEl = document.getElementById("status");
      var latestInput = {};
      var fallback = {
        view: "status",
        title: "Shipcast",
        summary: "Run a Shipcast tool, then ask to render the result for an in-conversation view.",
        status: "ready",
        item_count: 0
      };

      function isObject(value) {
        return value && typeof value === "object" && !Array.isArray(value);
      }

      function text(value, fallbackValue) {
        if (value === undefined || value === null || value === "") return fallbackValue || "";
        return String(value);
      }

      function shortText(value, fallbackValue) {
        var output = text(value, fallbackValue);
        return output.length > 220 ? output.slice(0, 217) + "..." : output;
      }

      function safeHref(value) {
        var raw = text(value).trim();
        if (!raw) return "";
        try {
          var parsed = new URL(raw);
          return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
        } catch (err) {
          return "";
        }
      }

      function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
      }

      function appendText(parent, tag, className, value) {
        var el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = value;
        parent.appendChild(el);
        return el;
      }

      function pick(source, keys) {
        if (!isObject(source)) return "";
        for (var i = 0; i < keys.length; i += 1) {
          var key = keys[i];
          var value = source[key];
          if (value !== undefined && value !== null && value !== "") return value;
        }
        return "";
      }

      function nestedPick(source, paths) {
        if (!isObject(source)) return "";
        for (var i = 0; i < paths.length; i += 1) {
          var parts = paths[i].split(".");
          var current = source;
          for (var j = 0; j < parts.length; j += 1) {
            current = isObject(current) ? current[parts[j]] : undefined;
          }
          if (current !== undefined && current !== null && current !== "") return current;
        }
        return "";
      }

      function compactValue(value) {
        if (value === undefined || value === null || value === "") return "";
        if (typeof value === "boolean") return value ? "Yes" : "No";
        if (typeof value === "number") return String(value);
        if (typeof value === "string") return shortText(value);
        if (Array.isArray(value)) return value.map(function (item) { return compactValue(item); }).filter(Boolean).join(", ");
        return shortText(JSON.stringify(value));
      }

      function makePill(label, tone) {
        var pill = document.createElement("span");
        pill.className = "pill" + (tone ? " " + tone : "");
        pill.textContent = label;
        return pill;
      }

      function itemTitle(item, view) {
        if (view === "publications") {
          return text(pick(item, ["product_name", "product", "title", "name"]), "Publication");
        }
        if (view === "preview") {
          return text(pick(item, ["product_name", "product", "name", "title"]), "Product update preview");
        }
        return text(
          pick(item, ["product_name", "name", "display_name", "username", "x_username", "id"]),
          "Shipcast product"
        );
      }

      function itemDescription(item, view) {
        var direct = pick(item, ["description", "summary", "text", "tweet_text", "content", "message"]);
        if (direct) return shortText(direct);
        if (view === "accounts") {
          var repo = nestedPick(item, ["github_repo", "repo", "github_repo_owner"]);
          var account = pick(item, ["x_username", "twitter_username", "username", "screen_name"]);
          if (account) return "Connected as @" + String(account).replace(/^@/, "");
          if (repo) return "Repository: " + compactValue(repo);
        }
        return "";
      }

      function makeCard(item, view) {
        var card = document.createElement("article");
        card.className = "card";
        appendText(card, "h2", "", itemTitle(item, view));
        var description = itemDescription(item, view);
        if (description) appendText(card, "p", "", description);

        var row = document.createElement("div");
        row.className = "meta-row";
        var connected = pick(item, ["connected", "twitter_enabled", "x_connected", "has_x_account"]);
        if (connected !== "") {
          row.appendChild(makePill(connected ? "X connected" : "X not connected", connected ? "green" : ""));
        }
        var username = pick(item, ["x_username", "twitter_username", "username", "screen_name"]);
        if (username) row.appendChild(makePill("@" + String(username).replace(/^@/, ""), "blue"));
        var status = pick(item, ["status", "state"]);
        if (status) row.appendChild(makePill(compactValue(status), "orange"));
        if (row.childNodes.length) card.appendChild(row);
        return card;
      }

      function normalizedPayload(result) {
        var structured = isObject(result) && isObject(result.structuredContent)
          ? result.structuredContent
          : isObject(result) ? result : {};
        var meta = isObject(result) && isObject(result._meta) ? result._meta : {};
        var hidden = isObject(meta.shipcast) && isObject(meta.shipcast.widget)
          ? meta.shipcast.widget
          : isObject(meta.widget) ? meta.widget : {};
        var merged = Object.assign({}, latestInput || {}, structured || {}, hidden || {});
        if (!Array.isArray(merged.items)) merged.items = [];
        if (!Array.isArray(merged.actions)) merged.actions = [];
        if (!Array.isArray(merged.next_steps)) merged.next_steps = [];
        if (!isObject(merged.detail)) merged.detail = {};
        return Object.assign({}, fallback, merged);
      }

      function renderDetail(payload) {
        var detail = payload.detail || {};
        var keys = [
          "product_id",
          "product_name",
          "username",
          "x_username",
          "tweet_id",
          "published_at",
          "scheduled_at",
          "timezone",
          "status",
          "url",
          "text",
          "tweet_text",
          "summary"
        ];
        var shown = [];
        for (var i = 0; i < keys.length; i += 1) {
          var key = keys[i];
          if (detail[key] !== undefined && detail[key] !== null && detail[key] !== "") shown.push(key);
        }
        if (!shown.length) return null;
        var wrap = document.createElement("div");
        wrap.className = "detail";
        shown.slice(0, 8).forEach(function (key) {
          var row = document.createElement("div");
          row.className = "kv";
          appendText(row, "div", "key", key.replace(/_/g, " "));
          appendText(row, "div", "value", compactValue(detail[key]));
          wrap.appendChild(row);
        });
        return wrap;
      }

      function renderActions(payload) {
        var actions = payload.actions || [];
        var detail = payload.detail || {};
        var url = safeHref(pick(detail, ["authorization_url", "connect_url", "url"]));
        if (!actions.length && url) {
          actions = [{ label: "Open Shipcast link", href: String(url), primary: true }];
        }
        if (!actions.length) return null;
        var wrap = document.createElement("div");
        wrap.className = "actions";
        actions.slice(0, 4).forEach(function (action, index) {
          var href = isObject(action) ? safeHref(action.href) : "";
          var label = isObject(action) ? action.label : action;
          var node = href ? document.createElement("a") : document.createElement("span");
          node.className = "action" + (index === 0 || action.primary ? " primary" : "");
          node.textContent = shortText(label, "Open");
          if (href) {
            node.href = href;
            node.target = "_blank";
            node.rel = "noreferrer noopener";
          }
          wrap.appendChild(node);
        });
        return wrap;
      }

      function renderSteps(payload) {
        var steps = payload.next_steps || [];
        if (!steps.length) return null;
        var wrap = document.createElement("div");
        wrap.className = "steps";
        steps.slice(0, 5).forEach(function (step) {
          wrap.appendChild(makePill(shortText(step), "blue"));
        });
        return wrap;
      }

      function render(result) {
        var payload = normalizedPayload(result);
        clear(root);
        root.className = "hero";
        statusEl.textContent = text(payload.status, "ready");

        appendText(root, "h1", "", text(payload.title, "Shipcast"));
        if (payload.summary) appendText(root, "p", "summary", shortText(payload.summary));

        var metaRow = document.createElement("div");
        metaRow.className = "meta-row";
        metaRow.appendChild(makePill(text(payload.view, "status"), "blue"));
        metaRow.appendChild(makePill(String(payload.item_count || payload.items.length || 0) + " items"));
        if (payload.generated_at) metaRow.appendChild(makePill(new Date(payload.generated_at).toLocaleString()));
        root.appendChild(metaRow);

        if (payload.items.length) {
          var grid = document.createElement("div");
          grid.className = "grid";
          payload.items.slice(0, 12).forEach(function (item) {
            grid.appendChild(makeCard(isObject(item) ? item : { name: item }, payload.view));
          });
          root.appendChild(grid);
        }

        var detail = renderDetail(payload);
        if (detail) root.appendChild(detail);
        var actions = renderActions(payload);
        if (actions) root.appendChild(actions);
        var steps = renderSteps(payload);
        if (steps) root.appendChild(steps);
      }

      function receiveToolResult(toolResult) {
        render(toolResult || { structuredContent: fallback });
      }

      window.addEventListener("message", function (event) {
        if (event.source !== window.parent) return;
        var message = event.data;
        if (!message || message.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/tool-input") {
          latestInput = isObject(message.params) ? message.params : {};
        }
        if (message.method === "ui/notifications/tool-result") {
          receiveToolResult(message.params);
        }
      }, { passive: true });

      window.addEventListener("openai:set_globals", function (event) {
        var globals = event.detail && event.detail.globals ? event.detail.globals : {};
        latestInput = globals.toolInput || latestInput || {};
        receiveToolResult({
          structuredContent: globals.toolOutput || fallback,
          _meta: globals.toolResponseMetadata || globals.toolResultMetadata || {}
        });
      }, { passive: true });

      receiveToolResult({
        structuredContent: window.openai && window.openai.toolOutput ? window.openai.toolOutput : fallback,
        _meta: window.openai && window.openai.toolResponseMetadata ? window.openai.toolResponseMetadata : {}
      });
    })();
  </script>
</body>
</html>`;

export const resources = [
  {
    uri: SHIPCAST_WIDGET_URI,
    name: "shipcast_conversation_widget",
    title: "Shipcast conversation widget",
    description:
      "A low-dependency MCP Apps widget for rendering Shipcast accounts, previews, actions, and publication history inside a conversation.",
    mimeType: SHIPCAST_WIDGET_MIME_TYPE,
  },
];

export function normalizeBaseUrl(value = process.env.SHIPCAST_API_BASE_URL) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function envToken() {
  const key = process.env.SHIPCAST_API_KEY || process.env.SHIPCAST_TOKEN || "";
  return key;
}

function configDir() {
  return (
    process.env.SHIPCAST_MCP_CONFIG_DIR ||
    path.join(os.homedir(), ".shipcast")
  );
}

function authFile() {
  return (
    process.env.SHIPCAST_MCP_AUTH_FILE ||
    path.join(configDir(), "auth.json")
  );
}

async function readCachedCredential() {
  try {
    const raw = await fs.readFile(authFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.baseUrl && parsed.baseUrl !== normalizeBaseUrl()) return null;
    if (typeof parsed?.token !== "string" || !parsed.token) return null;
    const expiresAt = Date.parse(parsed.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() + AUTH_SKEW_MS) {
      return null;
    }
    return {
      source: "cache",
      token: parsed.token,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

async function saveCachedCredential(credential) {
  await fs.mkdir(path.dirname(authFile()), { recursive: true, mode: 0o700 });
  await fs.writeFile(
    authFile(),
    `${JSON.stringify(
      {
        version: 1,
        baseUrl: normalizeBaseUrl(),
        token: credential.token,
        expiresAt: credential.expiresAt,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
}

async function clearCachedCredential() {
  await fs.rm(authFile(), { force: true }).catch(() => {});
}

function authHelpMessage() {
  return [
    "Shipcast authorization is required.",
    `Run: node ${process.argv[1] || "./mcp/server.mjs"} auth`,
    "For remote terminals, run:",
    `  node ${process.argv[1] || "./mcp/server.mjs"} auth --headless`,
  ].join("\n");
}

async function credential({ interactive = true, forceLogin = false } = {}) {
  const token = envToken();
  if (token && !forceLogin) {
    return { source: "env", token };
  }

  if (!forceLogin) {
    const cached = await readCachedCredential();
    if (cached) return cached;
  }

  if (!interactive) {
    throw new Error(authHelpMessage());
  }

  return await browserAuth();
}

function buildUrl(path, query = {}) {
  const url = new URL(`${normalizeBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function requestJson(
  path,
  { method = "GET", body, query, retry = true } = {}
) {
  const activeCredential = await credential();
  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      Authorization: `Bearer ${activeCredential.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "shipcast-codex-plugin",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (
    response.status === 401 &&
    retry &&
    activeCredential.source !== "env"
  ) {
    await clearCachedCredential();
    await credential({ forceLogin: true });
    return requestJson(path, { method, body, query, retry: false });
  }

  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? data.error
        : text || response.statusText;
    throw new Error(`Shipcast API ${response.status}: ${detail}`);
  }

  return data ?? {};
}

function randomState() {
  return randomBytes(18).toString("hex");
}

function makeAgentAuthUrl({ redirectUri, state, deviceCode, client }) {
  const url = new URL("/auth/agent", normalizeBaseUrl());
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  if (state) url.searchParams.set("state", state);
  if (deviceCode) url.searchParams.set("device_code", deviceCode);
  url.searchParams.set("client", client || "Shipcast MCP");
  return url.toString();
}

function openBrowser(url) {
  if (process.env.SHIPCAST_MCP_OPEN_BROWSER === "0") return false;
  const platform = process.platform;
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const CALLBACK_LOCALE_COPY = {
  en: {
    successTitle: "Shipcast is connected",
    successEyebrow: "Authorization complete",
    successDescription:
      "Return to your terminal or agent window. This browser tab can be closed.",
    failureTitle: "Shipcast authorization failed",
    failureEyebrow: "Authorization error",
    failureDescription:
      "Return to your terminal and start the Shipcast authorization flow again.",
  },
  zh: {
    successTitle: "Shipcast 已连接",
    successEyebrow: "授权完成",
    successDescription: "请回到终端或 agent 窗口。这个浏览器标签页可以关闭。",
    failureTitle: "Shipcast 授权失败",
    failureEyebrow: "授权错误",
    failureDescription: "请回到终端，重新启动 Shipcast 授权流程。",
  },
  ja: {
    successTitle: "Shipcast に接続しました",
    successEyebrow: "認可完了",
    successDescription:
      "ターミナルまたは agent ウィンドウに戻ってください。このブラウザータブは閉じられます。",
    failureTitle: "Shipcast 認可に失敗しました",
    failureEyebrow: "認可エラー",
    failureDescription:
      "ターミナルに戻り、Shipcast 認可フローをもう一度開始してください。",
  },
};

export function callbackLocale(acceptLanguage = "") {
  const value = String(acceptLanguage || "").toLowerCase();
  if (value.startsWith("zh") || value.includes(",zh")) return "zh";
  if (value.startsWith("ja") || value.includes(",ja")) return "ja";
  return "en";
}

export function callbackHtml(kind, acceptLanguage) {
  const locale = callbackLocale(acceptLanguage);
  const copy = CALLBACK_LOCALE_COPY[locale];
  const isSuccess = kind === "success";
  const title = isSuccess ? copy.successTitle : copy.failureTitle;
  const eyebrow = isSuccess ? copy.successEyebrow : copy.failureEyebrow;
  const description = isSuccess
    ? copy.successDescription
    : copy.failureDescription;

  return `<!doctype html>
<html lang="${locale === "zh" ? "zh-CN" : locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1d1f;background:#fbfbfd}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;background:#fbfbfd;color:#1d1d1f}
    nav{height:64px;border-bottom:1px solid #f1f1f4;background:rgba(255,255,255,.82);backdrop-filter:blur(18px);display:flex;align-items:center;padding:0 max(24px,calc((100vw - 1120px)/2));position:sticky;top:0}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:0}
    .mark{width:34px;height:34px;border-radius:10px;background:#1d1d1f;color:white;display:grid;place-items:center;font-weight:900}
    main{width:min(1120px,calc(100vw - 40px));margin:0 auto;padding:84px 0 72px}
    .content{max-width:720px}
    .eyebrow{display:inline-block;border:1px solid #bfdbfe;background:#eff6ff;color:#2563eb;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800;margin:0 0 24px}
    h1{font-size:clamp(42px,7vw,72px);line-height:1.02;letter-spacing:0;margin:0 0 22px}
    p{color:#6e6e73;line-height:1.65;font-size:19px;margin:0;max-width:620px}
    .panel{margin-top:34px;background:#fff;border:1px solid #f1f1f4;border-radius:28px;padding:24px 28px;box-shadow:0 24px 70px rgba(29,29,31,.08);color:#4b5563;font-size:15px;line-height:1.55}
    @media (max-width:800px){nav{padding:0 20px}main{padding-top:56px}.brand span{display:none}h1{font-size:42px}.panel{border-radius:22px;padding:22px}}
  </style>
</head>
<body>
  <nav><div class="brand"><div class="mark">S</div><span>shipcast</span></div></nav>
  <main>
    <section class="content">
      <div class="eyebrow">${eyebrow}</div>
      <h1>${title}</h1>
      <p>${description}</p>
      <div class="panel">Shipcast MCP</div>
    </section>
  </main>
</body>
</html>`;
}

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function browserAuth() {
  const state = randomState();
  let settled = false;
  let timeout;
  let resolveAuth;
  let rejectAuth;
  const authPromise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end("Not found");
      return;
    }

    const receivedState = url.searchParams.get("state") || "";
    const token = url.searchParams.get("token") || "";
    const expiresAt = url.searchParams.get("expires_at") || "";

    if (receivedState !== state || !token || !expiresAt) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(callbackHtml("failure", req.headers["accept-language"]));
      if (!settled) {
        settled = true;
        rejectAuth(new Error("Shipcast authorization callback was invalid."));
      }
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(callbackHtml("success", req.headers["accept-language"]));
    if (!settled) {
      settled = true;
      resolveAuth({ source: "cache", token, expiresAt });
    }
  });

  const address = await listen(server);
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const url = makeAgentAuthUrl({
    redirectUri,
    state,
    client: "Shipcast MCP",
  });

  console.error(`Open this URL to authorize Shipcast MCP:\n${url}`);
  openBrowser(url);

  try {
    timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        rejectAuth(new Error("Timed out waiting for Shipcast authorization."));
      }
    }, AUTH_TIMEOUT_MS);

    const result = await authPromise;
    await saveCachedCredential(result);
    return result;
  } finally {
    clearTimeout(timeout);
    await close(server).catch(() => {});
  }
}

async function postUnauthenticated(path, body, { signal } = {}) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "shipcast-codex-plugin",
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function headlessAuth() {
  const started = await postUnauthenticated("/auth/agent/device/start", {
    client: "Shipcast MCP",
  });
  if (!started.response.ok) throw new Error(started.data?.error || started.response.statusText);
  const info = started.data;
  console.log("Open this URL in a browser to authorize Shipcast MCP:");
  console.log(info.verification_uri_complete);

  const deadline = Date.now() + (info.expires_in || 600) * 1000;
  const intervalMs = Math.max(1, info.interval || 3) * 1000;
  while (Date.now() < deadline) {
    const beforeSleep = deadline - Date.now();
    await sleep(Math.min(intervalMs, beforeSleep));
    const remaining = deadline - Date.now();
    if (intervalMs >= beforeSleep || remaining <= 0) break;

    let poll;
    try {
      poll = await postUnauthenticated("/auth/agent/device/poll", {
        device_code: info.device_code,
      }, { signal: AbortSignal.timeout(remaining) });
    } catch (error) {
      if (error.name === "TimeoutError") break;
      if (error instanceof TypeError && error.cause) continue;
      throw error;
    }
    const { status } = poll.response;
    if (status === 202 || status === 408 || status === 429 || status >= 500) continue;
    if (!poll.response.ok) throw new Error(poll.data?.error || poll.response.statusText);
    if (poll.data?.status === "authorized" && poll.data.token) {
      const result = {
        source: "cache",
        token: poll.data.token,
        expiresAt: poll.data.expires_at,
      };
      await saveCachedCredential(result);
      return result;
    }
  }
  throw new Error("Timed out waiting for Shipcast authorization.");
}

async function printStatus() {
  if (envToken()) {
    console.log(JSON.stringify({ authorized: true, source: "env" }, null, 2));
    return;
  }
  const cached = await readCachedCredential();
  console.log(
    JSON.stringify(
      cached
        ? { authorized: true, source: cached.source, expiresAt: cached.expiresAt }
        : { authorized: false, authFile: authFile() },
      null,
      2
    )
  );
}

function requireString(args, name) {
  const value = args?.[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalNumber(args, name, fallback) {
  const value = args?.[name];
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return number;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function optionalString(args, name, fallback = "") {
  const value = args?.[name];
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim();
}

function safeExternalHref(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString();
    }
  } catch {
    return "";
  }
  return "";
}

function optionalStringArray(args, name) {
  const value = args?.[name];
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .slice(0, 8);
}

function optionalObjectArray(args, name, limit = 24) {
  const value = args?.[name];
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => isPlainObject(item))
    .slice(0, limit);
}

function enumValue(args, name, allowed, fallback) {
  const value = optionalString(args, name, fallback);
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function defaultRenderTitle(view) {
  switch (view) {
    case "accounts":
      return "Shipcast X accounts";
    case "account":
      return "Shipcast X account";
    case "preview":
      return "Shipcast product update preview";
    case "publications":
      return "Shipcast publication history";
    case "action":
      return "Shipcast action result";
    default:
      return "Shipcast";
  }
}

function summarizeRenderInput({ view, itemCount, status }) {
  if (view === "accounts") {
    return `Rendered ${itemCount} Shipcast product account${
      itemCount === 1 ? "" : "s"
    }.`;
  }
  if (view === "publications") {
    return `Rendered ${itemCount} Shipcast publication${
      itemCount === 1 ? "" : "s"
    }.`;
  }
  if (view === "preview") return "Rendered a Shipcast product update preview.";
  if (view === "action") return `Rendered a Shipcast ${status} action result.`;
  return "Rendered a Shipcast status view.";
}

function sanitizeActions(args) {
  return optionalObjectArray(args, "actions", 6)
    .map((action) => ({
      label: optionalString(action, "label", "Open"),
      href: safeExternalHref(action.href),
      description: optionalString(action, "description"),
      primary: action.primary === true,
    }))
    .filter((action) => action.label);
}

function markMcpToolResult(result) {
  return Object.defineProperty(result, MCP_TOOL_RESULT, {
    value: true,
    enumerable: false,
  });
}

function isMcpToolResult(result) {
  return Boolean(result?.[MCP_TOOL_RESULT]);
}

function renderWidgetToolResult(args = {}) {
  const view = enumValue(args, "view", RENDER_VIEWS, "status");
  const status = enumValue(args, "status", RENDER_STATUSES, "ready");
  const items = optionalObjectArray(args, "items");
  const detail = isPlainObject(args.detail) ? args.detail : {};
  const actions = sanitizeActions(args);
  const nextSteps = optionalStringArray(args, "next_steps");
  const title = optionalString(args, "title", defaultRenderTitle(view));
  const summary =
    optionalString(args, "summary") ||
    summarizeRenderInput({ view, itemCount: items.length, status });
  const generatedAt = new Date().toISOString();
  const structuredContent = {
    view,
    title,
    summary,
    status,
    item_count: items.length,
    generated_at: generatedAt,
  };

  return markMcpToolResult({
    content: [
      {
        type: "text",
        text: summary,
      },
    ],
    structuredContent,
    _meta: {
      shipcast: {
        widget: {
          ...structuredContent,
          items,
          detail,
          actions,
          next_steps: nextSteps,
        },
      },
    },
  });
}

function readResource(uri) {
  if (uri !== SHIPCAST_WIDGET_URI) {
    throw new Error(`Unknown resource: ${uri}`);
  }
  return {
    contents: [
      {
        uri: SHIPCAST_WIDGET_URI,
        mimeType: SHIPCAST_WIDGET_MIME_TYPE,
        text: SHIPCAST_WIDGET_HTML,
        _meta: {
          ui: {
            prefersBorder: true,
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          "openai/widgetDescription":
            "Renders Shipcast account, preview, action, and publication cards inside the conversation.",
          "openai/widgetPrefersBorder": true,
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: [],
          },
        },
      },
    ],
  };
}

export const tools = [
  {
    name: "shipcast_list_x_accounts",
    title: "List Shipcast X Accounts",
    description:
      "List Shipcast products and the X account connected to each product for the authenticated Shipcast user.",
    inputSchema: {
      type: "object",
      properties: {
        connected_only: {
          type: "boolean",
          description: "When true, return only products that have a connected X account.",
          default: false,
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "shipcast_get_x_account",
    title: "Get Shipcast X Account",
    description:
      "Get and refresh the live X account metadata for a Shipcast product.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id whose X account should be inspected.",
        },
      },
      required: ["product_id"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "shipcast_start_x_connect",
    title: "Start X Account Connect",
    description:
      "Create a short-lived X OAuth authorization URL for connecting or reconnecting a product's X account.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id to connect to an X account.",
        },
        redirect_back: {
          type: "string",
          description:
            "Optional URL to return to after the user completes X OAuth.",
        },
      },
      required: ["product_id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "shipcast_disconnect_x_account",
    title: "Disconnect X Account",
    description:
      "Disconnect a product's X account from Shipcast and delete the stored OAuth token. Requires confirm=true.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id whose X account should be disconnected.",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to perform the disconnect.",
        },
      },
      required: ["product_id", "confirm"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "shipcast_post_x",
    title: "Post To X",
    description:
      "Post directly to X using a product's connected X account. This is an on-demand publish and follows Shipcast plan limits.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id whose connected X account should post.",
        },
        text: {
          type: "string",
          description: "Post text, up to 280 characters.",
          maxLength: 280,
        },
        reply_to_tweet_id: {
          type: "string",
          description: "Optional X post id or URL to reply to.",
        },
      },
      required: ["product_id", "text"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "shipcast_preview_product_update",
    title: "Preview Product Update",
    description:
      "Generate or refresh the Shipcast AI update preview for unpublished changes without posting to X.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id to preview.",
        },
        timezone: {
          type: "string",
          description:
            "Optional IANA timezone for choosing today's changes, such as Asia/Tokyo.",
        },
      },
      required: ["product_id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "shipcast_publish_product_update",
    title: "Publish Product Update",
    description:
      "Run Shipcast's normal manual publish flow for a product, including changelog generation and X posting.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Shipcast product id to publish.",
        },
      },
      required: ["product_id"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "shipcast_list_publications",
    title: "List Shipcast Publications",
    description:
      "List recent Shipcast publication history, optionally filtered to one product.",
    inputSchema: {
      type: "object",
      properties: {
        product_id: {
          type: "string",
          description: "Optional Shipcast product id to filter by.",
        },
        limit: {
          type: "integer",
          description: "Maximum number of publications to return. Defaults to 20.",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "integer",
          description: "Pagination offset. Defaults to 0.",
          minimum: 0,
        },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "shipcast_render_widget",
    title: "Render Shipcast Widget",
    description:
      "Render an in-conversation Shipcast widget from data already returned by Shipcast tools. First call the relevant Shipcast data/action tool, then pass selected result fields to this presentation-only tool.",
    inputSchema: {
      type: "object",
      properties: {
        view: {
          type: "string",
          enum: RENDER_VIEWS,
          description:
            "The widget layout to render: accounts, account, preview, publications, action, or status.",
        },
        title: {
          type: "string",
          description: "Short title shown at the top of the widget.",
        },
        summary: {
          type: "string",
          description:
            "One concise sentence summarizing the Shipcast result for the user.",
        },
        status: {
          type: "string",
          enum: RENDER_STATUSES,
          description:
            "Visual state for the result. Defaults to ready.",
          default: "ready",
        },
        items: {
          type: "array",
          description:
            "Cards to render, such as products, X accounts, or publications.",
          items: {
            type: "object",
            additionalProperties: true,
          },
        },
        detail: {
          type: "object",
          description:
            "Primary record or action result details. Keep secrets and raw OAuth tokens out of this field.",
          additionalProperties: true,
        },
        actions: {
          type: "array",
          description:
            "Optional safe links or next UI actions to show in the widget.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              href: { type: "string" },
              description: { type: "string" },
              primary: { type: "boolean" },
            },
            required: ["label"],
            additionalProperties: false,
          },
        },
        next_steps: {
          type: "array",
          description:
            "Optional short next steps or reminders to show as compact pills.",
          items: { type: "string" },
        },
      },
      required: ["view"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: RENDER_VIEWS },
        title: { type: "string" },
        summary: { type: "string" },
        status: { type: "string", enum: RENDER_STATUSES },
        item_count: { type: "integer", minimum: 0 },
        generated_at: { type: "string" },
      },
      required: [
        "view",
        "title",
        "summary",
        "status",
        "item_count",
        "generated_at",
      ],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    _meta: {
      ui: {
        resourceUri: SHIPCAST_WIDGET_URI,
      },
      "openai/outputTemplate": SHIPCAST_WIDGET_URI,
      "openai/toolInvocation/invoking": "Rendering Shipcast",
      "openai/toolInvocation/invoked": "Rendered Shipcast",
    },
  },
];

export async function callTool(name, args = {}) {
  switch (name) {
    case "shipcast_list_x_accounts":
      return requestJson("/api/agent/x/accounts", {
        query: { connected_only: args.connected_only === true ? "true" : "" },
      });
    case "shipcast_get_x_account":
      return requestJson(
        `/api/agent/x/accounts/${encodeURIComponent(
          requireString(args, "product_id")
        )}`
      );
    case "shipcast_start_x_connect":
      return requestJson(
        `/api/agent/x/accounts/${encodeURIComponent(
          requireString(args, "product_id")
        )}/connect`,
        {
          method: "POST",
          body: { redirect_back: args.redirect_back },
        }
      );
    case "shipcast_disconnect_x_account": {
      if (args.confirm !== true) {
        throw new Error("confirm must be true to disconnect an X account.");
      }
      return requestJson(
        `/api/agent/x/accounts/${encodeURIComponent(
          requireString(args, "product_id")
        )}`,
        { method: "DELETE" }
      );
    }
    case "shipcast_post_x":
      return requestJson("/api/agent/x/posts", {
        method: "POST",
        body: {
          product_id: requireString(args, "product_id"),
          text: requireString(args, "text"),
          reply_to_tweet_id: args.reply_to_tweet_id,
        },
      });
    case "shipcast_preview_product_update":
      return requestJson(
        `/api/tweet-preview/${encodeURIComponent(
          requireString(args, "product_id")
        )}`,
        {
          method: "POST",
          query: { tz: args.timezone },
        }
      );
    case "shipcast_publish_product_update":
      return requestJson(
        `/api/publish/${encodeURIComponent(requireString(args, "product_id"))}`,
        { method: "POST" }
      );
    case "shipcast_list_publications":
      return requestJson("/api/history", {
        query: {
          product_id: args.product_id,
          limit: optionalNumber(args, "limit", 20),
          offset: optionalNumber(args, "offset", 0),
        },
      });
    case "shipcast_render_widget":
      return renderWidgetToolResult(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(data) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function toToolResult(data) {
  return isMcpToolResult(data) ? data : toolResult(data);
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {}, resources: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions:
        "Use Shipcast tools to inspect connected X accounts, start X account connect flows, post directly to X through a connected product account, preview product updates, and run Shipcast's normal manual publish flow. Before posting, confirm which product_id and X account should be used. When the user would benefit from a visual result, first call the relevant Shipcast data/action tool, then call shipcast_render_widget with the model-checked result.",
    });
    return;
  }

  if (method === "ping") {
    sendResult(id, {});
    return;
  }

  if (method === "tools/list") {
    sendResult(id, { tools });
    return;
  }

  if (method === "resources/list") {
    sendResult(id, { resources });
    return;
  }

  if (method === "resources/read") {
    try {
      sendResult(id, readResource(params?.uri));
    } catch (err) {
      sendError(
        id,
        JsonRpcError.INVALID_PARAMS,
        err instanceof Error ? err.message : String(err)
      );
    }
    return;
  }

  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments ?? {});
      sendResult(id, toToolResult(result));
    } catch (err) {
      sendError(
        id,
        JsonRpcError.INVALID_PARAMS,
        err instanceof Error ? err.message : String(err)
      );
    }
    return;
  }

  if (id !== undefined) {
    sendError(id, JsonRpcError.METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

export function startStdio() {
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  lines.on("line", (line) => {
    if (line.trim().length === 0) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    void handleRequest(message).catch((err) => {
      if (message.id !== undefined) {
        sendError(
          message.id,
          JsonRpcError.INTERNAL_ERROR,
          err instanceof Error ? err.message : String(err)
        );
      }
    });
  });
}

function usage() {
  console.log(`Usage:
  node mcp/server.mjs                 # start stdio MCP server
  node mcp/server.mjs auth            # authorize with browser callback
  node mcp/server.mjs auth --headless # authorize with a browser URL and polling
  node mcp/server.mjs status          # show cached authorization status
  node mcp/server.mjs logout          # remove cached authorization

Environment:
  SHIPCAST_API_BASE_URL  Defaults to https://api.shipcast.dev
  SHIPCAST_MCP_CONFIG_DIR Override local credential cache directory
  SHIPCAST_MCP_OPEN_BROWSER=0 prints the auth URL without launching a browser`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command) {
    startStdio();
    return;
  }
  if (command === "-h" || command === "--help" || command === "help") {
    usage();
    return;
  }
  if (command === "auth") {
    const result = args.includes("--headless")
      ? await headlessAuth()
      : await browserAuth();
    console.log(`Authorized. Token cached at ${authFile()}`);
    if (result.expiresAt) console.log(`Expires at ${result.expiresAt}`);
    return;
  }
  if (command === "status") {
    await printStatus();
    return;
  }
  if (command === "logout") {
    await clearCachedCredential();
    console.log(`Removed cached Shipcast authorization at ${authFile()}`);
    return;
  }

  usage();
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
