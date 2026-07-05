---
name: shipcast
description: Use when the user wants to operate Shipcast from a local agent, post to X through a connected Shipcast product account, connect or disconnect X accounts, preview/publish Shipcast updates, or inspect Shipcast publication history.
---

# Shipcast

Use the Shipcast MCP tools first when a task is about the user's Shipcast products or X accounts connected inside Shipcast.

## Runtime configuration

The local MCP server authorizes through Shipcast's browser/device flow:

- `node mcp/server.mjs auth`: browser callback flow.
- `node mcp/server.mjs auth --headless`: remote/headless device flow.
- `SHIPCAST_API_BASE_URL`: optional; defaults to `https://api.shipcast.dev`.

Do not ask for Shipcast API keys, X access tokens, or refresh tokens. Shipcast stores connected X OAuth tokens server-side per product, and the local MCP bridge caches only a short-lived Shipcast agent token.

## Workflow

1. For reads, call `shipcast_list_x_accounts` or `shipcast_list_publications` before answering from assumptions.
2. Before a write to X, identify the target `product_id` and connected `twitter_username`. If the user did not specify a product and more than one connected account exists, ask which product to use.
3. For direct posts, call `shipcast_post_x` with the final text. This follows Shipcast plan limits.
4. For product changelog posts, use `shipcast_preview_product_update` first unless the user explicitly asks to publish immediately, then call `shipcast_publish_product_update`.
5. To connect or reconnect X, call `shipcast_start_x_connect` and show the returned `auth_url` for the user to open.
6. To disconnect X, call `shipcast_disconnect_x_account` only after the user clearly asks for disconnection.

## X MCP compatibility

Shipcast's plugin MCP server covers Shipcast-owned workflows. For broad X API work outside Shipcast, use X's official MCP bridge with `xurl mcp https://api.x.com/mcp`, or on Sandbank machines use the existing `vas x mcp` wrapper. That path requires the user's own X Developer app credentials or an already cached `xurl` OAuth login.
