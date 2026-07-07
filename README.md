# ReallyGood Research

Obsidian/CLI deep-research publisher for NotebookLM MCP and Tavily.

## BRAT install

1. Install the BRAT Obsidian plugin.
2. Add this repository: `reallygood83/reallygood-research`.
3. Enable `ReallyGood Research` in Obsidian.
4. Run `ReallyGood Research: Open deep research console`.

The plugin is desktop-only because it writes files directly into your local vault.

### Obsidian ribbon buttons

When the plugin is enabled, it automatically adds two ribbon buttons:

- `ReallyGood Research`: opens the deep research console.
- `Open ReallyGood HTML report`: opens the HTML report matching the active generated Markdown note, or opens the active HTML report directly.

After updating through BRAT, toggle the plugin off and on or reload Obsidian if the new ribbon button does not appear immediately.

## Quick start

### Tavily only

This is the easiest path after saving a Tavily API key.

1. Paste a Tavily API key into `Tavily API key`.
2. Click `Save key`.
3. Keep `Providers` as `tavily`.
4. Choose an output folder.
5. Run a research topic.

The plugin writes:

- a Markdown note
- an optional HTML report
- JSON history under `.deep-research-publisher/`

The key is saved to `~/.reallygood-research.env`, not to Obsidian settings. Tavily reports use the Tavily Research API; keyless Search output is not used for research notes.

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
- `antigravity`
- `custom`

Leave `AI provider` as `None` if no local AI CLI is installed or logged in.

The plugin searches common macOS/Linux paths, NVM/Bun/Cargo user bins, and Windows CLI names such as `.exe`, `.cmd`, and `.ps1`. On Windows it also checks common npm/AppData install locations. For Antigravity, both `agy` and `antigravity` command names are supported.

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
  --html
```

Outputs:

- Markdown note in the selected vault folder
- optional HTML report
- JSON history under `.deep-research-publisher/`

Use `--mock` only for local test output. Tavily mode always uses the Tavily Research API and requires `TAVILY_API_KEY`. NotebookLM mode uses the `notebooklm-mcp` stdio server from `notebooklm-cli`.

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
  --ai-provider claude
```

Supported built-in CLI providers are `codex`, `claude`, `gemini`, `grok`, and `antigravity`. The plugin resolves common Homebrew, local-bin, npm-global, Bun, Cargo, and NVM paths so Obsidian can find CLIs that your terminal can use. For any other logged-in CLI, use `--ai-provider custom --ai-command "<command>"`. The research prompt is passed through stdin.

In the Obsidian plugin, choose `AI provider` from the console or settings. This uses your existing local CLI login/OAuth session; it does not ask for or store AI provider API keys.

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

`run_research` uses Tavily Research API output for saved reports. `tavily_search` and `tavily_extract` remain utility MCP tools, but they also require the configured Tavily API key; keyless mode is not supported.
