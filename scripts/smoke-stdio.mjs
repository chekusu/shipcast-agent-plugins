#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverPath = fileURLToPath(
  new URL("../plugins/shipcast/mcp/server.mjs", import.meta.url)
);
const WIDGET_URI = "ui://widget/shipcast.html";
const WIDGET_MIME_TYPE = "text/html;profile=mcp-app";

const child = spawn(process.execPath, [serverPath], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    SHIPCAST_MCP_OPEN_BROWSER: "0",
  },
});

let nextId = 1;
let stderr = "";
const pending = new Map();

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

const lines = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});

lines.on("line", (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    throw new Error(`Invalid JSON-RPC line: ${line}\n${err.message}`);
  }
  const active = pending.get(message.id);
  if (!active) return;
  pending.delete(message.id);
  clearTimeout(active.timeout);
  if (message.error) {
    active.reject(new Error(message.error.message || "JSON-RPC error"));
    return;
  }
  active.resolve(message.result);
});

child.on("exit", (code, signal) => {
  for (const [id, active] of pending) {
    clearTimeout(active.timeout);
    active.reject(
      new Error(
        `MCP server exited before response ${id}; code=${code}; signal=${signal}; stderr=${stderr}`
      )
    );
  }
  pending.clear();
});

function rpc(method, params = {}) {
  const id = nextId++;
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}; stderr=${stderr}`));
    }, 5000);
    pending.set(id, { resolve, reject, timeout });
  });
}

try {
  const initialized = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "shipcast-stdio-smoke", version: "0.1.0" },
  });
  assert.equal(initialized.serverInfo.name, "Shipcast MCP");
  assert.ok(initialized.capabilities.tools);
  assert.ok(initialized.capabilities.resources);

  const listedTools = await rpc("tools/list");
  const toolNames = listedTools.tools.map((tool) => tool.name);
  for (const expected of [
    "shipcast_list_x_accounts",
    "shipcast_get_x_account",
    "shipcast_start_x_connect",
    "shipcast_disconnect_x_account",
    "shipcast_post_x",
    "shipcast_preview_product_update",
    "shipcast_publish_product_update",
    "shipcast_list_publications",
    "shipcast_render_widget",
  ]) {
    assert.ok(toolNames.includes(expected), `missing tool ${expected}`);
  }

  const renderTool = listedTools.tools.find(
    (tool) => tool.name === "shipcast_render_widget"
  );
  assert.equal(renderTool._meta.ui.resourceUri, WIDGET_URI);
  assert.equal(renderTool._meta["openai/outputTemplate"], WIDGET_URI);
  assert.equal(renderTool.outputSchema.properties.item_count.type, "integer");

  for (const tool of listedTools.tools) {
    if (tool.name === "shipcast_render_widget") continue;
    assert.equal(
      tool._meta?.ui?.resourceUri,
      undefined,
      `${tool.name} should stay data/action-only`
    );
  }

  const listedResources = await rpc("resources/list");
  const widgetResource = listedResources.resources.find(
    (resource) => resource.uri === WIDGET_URI
  );
  assert.ok(widgetResource, "missing Shipcast widget resource");
  assert.equal(widgetResource.mimeType, WIDGET_MIME_TYPE);

  const readResource = await rpc("resources/read", { uri: WIDGET_URI });
  assert.equal(readResource.contents[0].mimeType, WIDGET_MIME_TYPE);
  assert.match(readResource.contents[0].text, /ui\/notifications\/tool-result/);
  assert.match(readResource.contents[0].text, /shipcast/);

  const rendered = await rpc("tools/call", {
    name: "shipcast_render_widget",
    arguments: {
      view: "accounts",
      title: "Connected Shipcast accounts",
      summary: "Two products are ready to publish through X.",
      status: "success",
      items: [
        {
          product_id: "prod_1",
          product_name: "Launch Notes",
          x_username: "shipcast",
          connected: true,
        },
        {
          product_id: "prod_2",
          product_name: "Release Radar",
          connected: false,
        },
      ],
      detail: {
        product_id: "prod_1",
        product_name: "Launch Notes",
        x_username: "shipcast",
      },
      next_steps: ["Pick a product before posting"],
    },
  });
  assert.equal(rendered.structuredContent.view, "accounts");
  assert.equal(rendered.structuredContent.item_count, 2);
  assert.equal(rendered.structuredContent.status, "success");
  assert.equal(rendered.structuredContent.items, undefined);
  assert.equal(rendered._meta.shipcast.widget.items.length, 2);
  assert.equal(rendered._meta.shipcast.widget.next_steps.length, 1);
  assert.match(rendered.content[0].text, /Two products/);

  console.log("Shipcast MCP stdio smoke passed");
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
