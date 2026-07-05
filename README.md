# Shipcast Agent Plugins

Install Shipcast in local agents without pasting API keys into MCP config. The
plugin uses Shipcast's browser or headless device authorization flow and stores
only a local Shipcast agent token. It also exposes a dependency-free MCP Apps
widget so agents can render Shipcast account, preview, action, and publication
results directly inside the conversation.

## Codex

Install:

```bash
codex plugin marketplace add https://github.com/chekusu/shipcast-agent-plugins.git --ref main --sparse .agents/plugins --sparse plugins/shipcast
codex plugin add shipcast@shipcast
codex mcp get shipcast
node "$HOME/.codex/plugins/cache/shipcast/shipcast/0.1.0/mcp/server.mjs" auth
```

Headless login:

```bash
node "$HOME/.codex/plugins/cache/shipcast/shipcast/0.1.0/mcp/server.mjs" auth --headless
```

Update:

```bash
codex plugin marketplace upgrade shipcast
codex plugin add shipcast@shipcast
node "$HOME/.codex/plugins/cache/shipcast/shipcast/0.1.0/mcp/server.mjs" status
```

Restart the Codex session after install or update.

### In-Conversation UI

The plugin keeps the existing Shipcast data/action tools and adds one
presentation-only render tool:

- `shipcast_render_widget` uses `ui://widget/shipcast.html` as both
  `_meta.ui.resourceUri` and `openai/outputTemplate`.
- The widget resource is served through `resources/list` and `resources/read`
  as `text/html;profile=mcp-app`.
- Call the relevant Shipcast tool first, then call `shipcast_render_widget`
  with selected result fields. The render tool returns concise
  `structuredContent` for the model and sends full widget hydration data in
  tool-result `_meta`.

No `npm install` step is required; the MCP server, widget, and smoke tests use
only Node built-ins.

## Claude Code

Install:

```bash
claude plugin marketplace add https://github.com/chekusu/shipcast-agent-plugins.git
claude plugin install shipcast@shipcast
```

The Claude Code plugin manifest intentionally omits a fixed `version`, so Git
commit SHAs are used as plugin versions and each pushed change can be updated.

Then start a new Claude Code session or run `/reload-plugins`, and ask Claude to
log in to Shipcast. If a shell is available, it can run the MCP server auth
command from the installed plugin cache.

Update:

```bash
claude plugin marketplace update shipcast
claude plugin update shipcast@shipcast
```

Restart Claude Code after updating.

## Other MCP Agents

Agents that do not support Codex or Claude Code plugins can register the
Shipcast MCP server manually from `plugins/shipcast/.mcp.json` and run
`node ./mcp/server.mjs auth` or `node ./mcp/server.mjs auth --headless` before
using the tools.

## Local Smoke Test

Run the stdio smoke test from this repository:

```bash
node scripts/smoke-stdio.mjs
```

The script starts `plugins/shipcast/mcp/server.mjs` over stdio and verifies
`initialize`, `tools/list`, `resources/list`, `resources/read`, and
`shipcast_render_widget` output shape.
