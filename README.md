# ReallyGood Research

Obsidian/CLI deep-research publisher for NotebookLM MCP and Tavily.

## BRAT install

1. Install the BRAT Obsidian plugin.
2. Add this repository: `reallygood83/reallygood-research`.
3. Enable `ReallyGood Research` in Obsidian.
4. Run `ReallyGood Research: Open deep research console`.

The plugin is desktop-only because it writes files directly into your local vault.

No Node path or CLI setup is required for Tavily keyless search in the Obsidian plugin. The default run mode is real Tavily keyless deep research, with Markdown, optional HTML, and history files written into the selected vault folder.

To use a Tavily API key from the plugin, open the plugin settings, paste the key into `Tavily API key`, and click `Save key`. The key is saved to `~/.reallygood-research.env`, not to Obsidian settings.

To use NotebookLM, install/authenticate `reallygood83/notebooklm-cli` first:

```sh
uv tool install notebooklm-mcp-cli
nlm login
```

If `notebooklm-mcp` is not on your PATH, set `NotebookLM MCP command` in plugin settings. For this local checkout:

```sh
cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && uv run notebooklm-mcp
```

The Obsidian settings tab also has a `Run login` button. Set `NotebookLM login command` to `cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && /opt/homebrew/bin/uv run nlm login` if you use the local checkout, then click the button instead of opening Terminal yourself.

## CLI

```sh
node bin/deep-research.mjs run \
  --topic "Agentic AI vertical market" \
  --providers notebooklm,tavily \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --tavily-keyless
```

Outputs:

- Markdown note in the selected vault folder
- optional HTML report
- JSON history under `.deep-research-publisher/`

Use `--mock` only for local test output. Tavily live mode uses `TAVILY_API_KEY`, or `--tavily-keyless` for Tavily's keyless access mode. NotebookLM mode uses the `notebooklm-mcp` stdio server from `notebooklm-cli`.

NotebookLM example with a custom MCP command:

```sh
node bin/deep-research.mjs run \
  --topic "미국 AI 에듀테크 트렌드" \
  --providers notebooklm \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --notebooklm-mcp-command "cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && uv run notebooklm-mcp"
```

To save a Tavily API key locally:

```sh
node bin/deep-research.mjs setup tavily
```

The key is saved to `~/.reallygood-research.env` with file mode `600`. You can override the path with `--env-path`.

To synthesize the research with an AI subscription you already use, call a local CLI instead of storing an API key:

```sh
node bin/deep-research.mjs run \
  --topic "AI search workflow comparison" \
  --providers tavily \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --tavily-keyless \
  --ai-provider claude
```

Supported built-in CLI providers are `codex`, `claude`, `gemini`, and `grok`. For any other logged-in CLI, use `--ai-provider custom --ai-command "<command>"`. The research prompt is passed through stdin.

In the Obsidian plugin, choose `AI provider` from the console or settings. This uses your existing local CLI login/OAuth session; it does not ask for or store AI provider API keys.

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
- `tavily_search`
- `tavily_extract`

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

`tavily_search` defaults to `searchDepth: "advanced"`, `maxResults: 5`, `chunksPerSource: 3`, and `includeAnswer: true`, matching Tavily's agent-oriented guidance for stronger source evidence. Keyless mode works for Search and Extract; Tavily Crawl, Map, and Research require an API key.
