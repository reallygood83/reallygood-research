# Deep Research Publisher for Antigravity

Use this skill when Antigravity needs to publish a deep-research artifact through the shared CLI/MCP contract.

## Contract

Delegate execution to the package command rather than duplicating CLI logic:

```sh
node bin/deep-research.mjs run --topic "<topic>" --providers <providers> --source-file <source-file> --vault-dir <vault-path> --html --mock
```

Omit `--mock` only when real provider credentials are ready. Keep Antigravity instructions focused on selecting inputs, checking saved outputs, and reporting verification evidence.
