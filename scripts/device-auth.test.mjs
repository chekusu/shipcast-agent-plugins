import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const executable = fileURLToPath(new URL("../plugins/shipcast/mcp/server.mjs", import.meta.url));

async function login(t, replies, expiresIn = 15) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "shipcast-device-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let starts = 0;
  const polls = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/auth/agent/device/start") {
      starts++;
      res.end(JSON.stringify({ device_code: "sample-device", verification_uri_complete: "https://example.invalid", expires_in: expiresIn, interval: 1 }));
      return;
    }
    assert.equal(req.url, "/auth/agent/device/poll");
    let body = "";
    for await (const chunk of req) body += chunk;
    polls.push(JSON.parse(body).device_code);
    const reply = replies[polls.length - 1];
    if (!reply) {
      res.writeHead(400).end(JSON.stringify({ error: "unexpected_poll" }));
    } else if (reply === "disconnect") {
      res.destroy();
    } else {
      res.writeHead(reply[0]).end(JSON.stringify(reply[1]));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const run = exec(process.execPath, [executable, "auth", "--headless"], {
    env: { ...process.env, SHIPCAST_API_BASE_URL: `http://127.0.0.1:${server.address().port}`, SHIPCAST_MCP_AUTH_FILE: path.join(dir, "auth.json") },
    timeout: 20000,
  });
  return { run, polls, starts: () => starts, cache: () => readFile(path.join(dir, "auth.json"), "utf8") };
}

test("headless CLI resumes the same device poll across temporary failures", async (t) => {
  const session = await login(t, [
    [202, { status: "pending" }],
    [503, { error: "temporarily_unavailable" }],
    "disconnect",
    [429, { error: "slow_down" }],
    [200, { status: "authorized", token: "local-test-value", expires_at: "2099-01-01T00:00:00Z" }],
  ]);
  await session.run;
  assert.equal(session.starts(), 1);
  assert.deepEqual(session.polls, Array(5).fill("sample-device"));
  assert.equal(JSON.parse(await session.cache()).token, "local-test-value");
});

test("expired device sessions stop immediately without a cache", async (t) => {
  const session = await login(t, [[400, { error: "expired_token" }]]);
  await assert.rejects(session.run, (error) => error.code === 1 && error.stderr.includes("expired_token"));
  assert.equal(session.polls.length, 1);
  await assert.rejects(session.cache(), { code: "ENOENT" });
});

test("headless CLI stops at device expiry", async (t) => {
  const session = await login(t, [], 1);
  await assert.rejects(session.run, (error) => error.code === 1 && error.stderr.includes("Timed out"));
  assert.deepEqual(session.polls, []);
});
