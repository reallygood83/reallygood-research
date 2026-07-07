import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = resolve("bin/deep-research.mjs");

test("mcp server lists tools and runs mock research", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-mcp-"));
  const child = spawn(process.execPath, [cliPath, "mcp"], {
    cwd: resolve("."),
    stdio: ["pipe", "pipe", "pipe"],
  });

  const responses = [];
  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
      responses.push(JSON.parse(line));
    }
  });

  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "run_research",
        arguments: {
          topic: "MCP smoke",
          providers: "notebooklm,tavily",
          vaultDir: dir,
          html: true,
          mock: true,
        },
      },
    })}\n`,
  );
  child.stdin.end();

  await new Promise((resolveRun) => child.on("close", resolveRun));

  assert.equal(responses[0].result.serverInfo.name, "reallygood-research");
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    ["run_research", "setup_tavily"],
  );

  const payload = JSON.parse(responses[2].result.content[0].text);
  assert.equal(existsSync(payload.markdownPath), true);
  assert.equal(existsSync(payload.htmlPath), true);
  assert.match(await readFile(payload.markdownPath, "utf8"), /# MCP smoke/);
});
