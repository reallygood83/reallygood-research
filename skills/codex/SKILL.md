# Deep Research Publisher for Codex

Use this skill when Codex needs to publish a deep-research artifact through the shared CLI/MCP contract.

## Contract

Run the package command instead of adding provider execution in the skill:

```sh
node bin/deep-research.mjs run --topic "<topic>" --providers <providers> --source-file <source-file> --vault-dir <vault-path> --html --mock
```

For MCP-style local use, configure Codex to spawn:

```sh
node /path/to/reallygood-research/bin/deep-research.mjs mcp
```

If Tavily live search is needed, ask the user for their API key and save it locally with:

```sh
node bin/deep-research.mjs setup tavily
```

MCP exposes `run_research`, `setup_tavily`, `tavily_search`, and `tavily_extract`. Omit `--mock` only when real provider credentials are ready. Use the CLI or MCP result as the source of truth for generated Markdown, HTML export paths, and history. Keep Codex-side work to prompt shaping, file review, and verification.
