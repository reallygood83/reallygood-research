# ReallyGood Research

Obsidian/CLI deep-research publisher for NotebookLM MCP and Tavily.

## BRAT install

1. Install the BRAT Obsidian plugin.
2. Add this repository: `reallygood83/reallygood-research`.
3. Enable `ReallyGood Research` in Obsidian.
4. Run `ReallyGood Research: Open deep research console`.

The plugin is desktop-only because it writes files directly into your local vault.

## Quick start

### Tavily only

This is the easiest path and works immediately after BRAT install.

1. Keep `Providers` as `tavily`.
2. Keep `Tavily keyless` on for a quick trial.
3. Choose an output folder.
4. Run a research topic.

The plugin writes:

- a Markdown note
- an optional HTML report
- JSON history under `.deep-research-publisher/`

For better limits and reliability, paste a Tavily API key into `Tavily API key`, click `Save key`, then turn `Tavily keyless` off. The key is saved to `~/.reallygood-research.env`, not to Obsidian settings.

### NotebookLM

NotebookLM requires the local `notebooklm-cli` tools.

```sh
uv tool install notebooklm-mcp-cli
```

Then in Obsidian settings:

```text
NotebookLM login command: nlm login
NotebookLM MCP command: notebooklm-mcp
```

Click `Run login`, approve the browser login, then set `Providers` to either:

```text
notebooklm
```

or:

```text
notebooklm,tavily
```

If `uv`, `nlm`, or `notebooklm-mcp` is not on the Obsidian shell path, use absolute paths in those two command fields.

### AI synthesis

AI synthesis is optional. It uses a local CLI that the user has already logged into, not an API key stored by this plugin.

Supported built-in choices:

- `codex`
- `claude`
- `gemini`
- `grok`
- `custom`

Leave `AI provider` as `None` if no local AI CLI is installed or logged in.

## Local checkout example

If you are developing against a local `notebooklm-cli` checkout, use commands like:

```sh
cd /path/to/notebooklm-cli && uv run nlm login
```

```sh
cd /path/to/notebooklm-cli && uv run notebooklm-mcp
```

On macOS Homebrew installs, Obsidian may not inherit `/opt/homebrew/bin`. In that case, use `/opt/homebrew/bin/uv` instead of `uv`.

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
  --notebooklm-mcp-command "notebooklm-mcp"
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
