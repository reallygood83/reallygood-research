# ReallyGood Research

Obsidian/CLI deep-research publisher for NotebookLM, Tavily, and local research lanes.

## BRAT install

1. Install the BRAT Obsidian plugin.
2. Add this repository: `reallygood83/reallygood-research`.
3. Enable `ReallyGood Research` in Obsidian.
4. Run `ReallyGood Research: Open deep research console`.

The plugin is desktop-only because it writes files directly into your local vault.

No Node path or CLI setup is required for the Obsidian plugin. The first run uses mock mode so it can create Markdown, HTML, and history files immediately after BRAT installation. For real Tavily search without an API key, turn off `Mock mode` and turn on `Tavily keyless` in the console.

## CLI

```sh
node bin/deep-research.mjs run \
  --topic "Agentic AI vertical market" \
  --providers notebooklm,tavily \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --mock
```

Outputs:

- Markdown note in the selected vault folder
- optional HTML report
- JSON history under `.deep-research-publisher/`

Omit `--mock` only when real provider credentials and adapters are configured. Tavily live mode uses `TAVILY_API_KEY`, or `--tavily-keyless` for Tavily's keyless access mode.

To save a Tavily API key locally:

```sh
node bin/deep-research.mjs setup tavily
```

The key is saved to `~/.reallygood-research.env` with file mode `600`. You can override the path with `--env-path`.

For a lightweight Tavily trial without a key:

```sh
node bin/deep-research.mjs run \
  --topic "latest AI search tools" \
  --providers tavily \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --tavily-keyless
```

## MCP

The same package can run as a local stdio MCP server:

```sh
node /path/to/reallygood-research/bin/deep-research.mjs mcp
```

It exposes:

- `run_research`
- `setup_tavily`

Example MCP server config shape:

```json
{
  "mcpServers": {
    "reallygood-research": {
      "command": "node",
      "args": ["/path/to/reallygood-research/bin/deep-research.mjs", "mcp"]
    }
  }
}
```
