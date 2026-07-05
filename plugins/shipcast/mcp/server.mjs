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
const SERVER_VERSION = "0.1.0";
const AUTH_SKEW_MS = 5 * 60 * 1000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const JsonRpcError = {
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

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

async function postUnauthenticated(path, body) {
  const response = await fetch(buildUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "shipcast-codex-plugin",
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    throw new Error(data?.error || response.statusText);
  }
  return { status: response.status, data };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function headlessAuth() {
  const started = await postUnauthenticated("/auth/agent/device/start", {
    client: "Shipcast MCP",
  });
  const info = started.data;
  console.log("Open this URL in a browser to authorize Shipcast MCP:");
  console.log(info.verification_uri_complete);

  const deadline = Date.now() + (info.expires_in || 600) * 1000;
  const intervalMs = Math.max(1, info.interval || 3) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const poll = await postUnauthenticated("/auth/agent/device/poll", {
      device_code: info.device_code,
    });
    if (poll.status === 202) continue;
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

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    sendResult(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
      instructions:
        "Use Shipcast tools to inspect connected X accounts, start X account connect flows, post directly to X through a connected product account, preview product updates, and run Shipcast's normal manual publish flow. Before posting, confirm which product_id and X account should be used.",
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

  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments ?? {});
      sendResult(id, toolResult(result));
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
