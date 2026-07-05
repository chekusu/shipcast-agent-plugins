# Shipcast Agent Plugins

Install Shipcast in local agents without pasting API keys into MCP config. The
plugin uses Shipcast's browser or headless device authorization flow and stores
only a local Shipcast agent token.

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
