# Deep Research Publisher for Claude Code

Use this skill when Claude Code needs to publish a deep-research artifact through the shared CLI/MCP contract.

## Contract

Call the shared command; keep browser automation and provider routing out of the skill:

```sh
node bin/deep-research.mjs run --topic "<topic>" --providers <providers> --source-file <source-file> --vault-dir <vault-path> --html --mock
```

Omit `--mock` only when real provider credentials are ready. Treat stdout and written files from the CLI as the handoff. Claude Code may edit the final Markdown only after the CLI has produced it.
