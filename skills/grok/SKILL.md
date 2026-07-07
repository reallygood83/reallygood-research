# Deep Research Publisher for Grok

Use this skill when Grok needs to publish a deep-research artifact through the shared CLI/MCP contract.

## Contract

Use the shared command as the only execution surface:

```sh
node bin/deep-research.mjs run --topic "<topic>" --providers <providers> --source-file <source-file> --vault-dir <vault-path> --html --mock
```

Omit `--mock` only when real provider credentials are ready. Keep provider execution out of the skill. Grok should prepare the prompt, run or request the CLI call, and verify the Markdown output.
