# ReallyGood Research

Obsidian/CLI deep-research publisher for NotebookLM, Tavily, and local research lanes.

## BRAT install

1. Install the BRAT Obsidian plugin.
2. Add this repository: `reallygood83/reallygood-research`.
3. Enable `ReallyGood Research` in Obsidian.
4. Run `ReallyGood Research: Open deep research console`.

The plugin is desktop-only because it runs the bundled Node CLI.

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

Omit `--mock` only when real provider credentials and adapters are configured. Tavily live mode requires `TAVILY_API_KEY`.

For a lightweight Tavily trial without a key:

```sh
node bin/deep-research.mjs run \
  --topic "latest AI search tools" \
  --providers tavily \
  --vault-dir "/path/to/Obsidian/Vault/Research" \
  --html \
  --tavily-keyless
```
