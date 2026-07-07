# Deep Research Publisher for Grok

Use this skill when Grok needs to publish a deep-research artifact through the shared CLI/MCP contract.

## Contract

Use the shared command as the only execution surface:

```sh
node bin/deep-research.mjs run --topic "<topic>" --providers <providers> --source-file <source-file> --vault-dir <vault-path> --html --mock
```

For MCP-style local use, spawn:

```sh
node /path/to/reallygood-research/bin/deep-research.mjs mcp
```

If Tavily live search is needed, ask the user for their API key and save it locally with:

```sh
node bin/deep-research.mjs setup tavily
```

Omit `--mock` only when real provider credentials are ready. Keep provider execution out of the skill. Grok should prepare the prompt, run or request the CLI/MCP call, and verify the Markdown output.
