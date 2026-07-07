import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = resolve("bin/deep-research.mjs");

function runCli(args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: resolve("."),
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("run command prints and creates markdown and html outputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-cli-"));
  const sourceFile = join(dir, "source.md");
  const vaultDir = join(dir, "vault");
  await writeFile(sourceFile, "# Source\n\nMarket notes.\n", "utf8");

  const result = await runCli([
    "run",
    "--topic",
    "Agentic AI vertical market",
    "--providers",
    "notebooklm,tavily",
    "--agent",
    "codex",
    "--source-file",
    sourceFile,
    "--vault-dir",
    vaultDir,
    "--html",
    "--mock",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Markdown: .+\.md/);
  assert.match(result.stdout, /HTML: .+\.html/);

  const markdownPath = result.stdout.match(/Markdown: (.+\.md)/)[1].trim();
  const htmlPath = result.stdout.match(/HTML: (.+\.html)/)[1].trim();
  assert.equal(existsSync(markdownPath), true);
  assert.equal(existsSync(htmlPath), true);
  const markdown = await readFile(markdownPath, "utf8");
  assert.match(markdown, /tags:\n  - research\n  - reallygood-research/);
  assert.match(markdown, /research_mode: "NotebookLM deep research"/);
  assert.match(markdown, /## Tavily Deep Research/);
  assert.doesNotMatch(markdown, /Research status/);
  assert.doesNotMatch(markdown, /Provider metadata/);
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /<h1 id="agentic-ai-vertical-market">Agentic AI vertical market<\/h1>/);
  assert.doesNotMatch(html, /<pre>/);
});

test("run command rejects removed Odysseus provider", async () => {
  const result = await runCli([
    "run",
    "--topic",
    "Removed provider",
    "--providers",
    "odysseus",
    "--vault-dir",
    tmpdir(),
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unsupported provider: odysseus/);
});

test("run command can drive NotebookLM through an MCP command", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-cli-mcp-"));
  const fakeMcp = join(dir, "fake-notebooklm-mcp.mjs");
  await writeFile(
    fakeMcp,
    `
process.stdin.setEncoding("utf8");
let buffer = "";
function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
function tool(name, args) {
  if (name === "research_start") return { structuredContent: { status: "success", task_id: "task-cli", notebook_id: "notebook-cli", query: args.query, mode: args.mode } };
  if (name === "research_status") return { structuredContent: { status: "completed", notebook_id: args.notebook_id, task_id: args.task_id, report: "CLI NotebookLM report", sources_found: 0, sources: [] } };
  throw new Error(name);
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      const msg = JSON.parse(line);
      if (msg.id && msg.method === "initialize") send(msg.id, { serverInfo: { name: "fake-notebooklm" }, capabilities: { tools: {} } });
      if (msg.id && msg.method === "tools/call") send(msg.id, tool(msg.params.name, msg.params.arguments || {}));
    }
    newline = buffer.indexOf("\\n");
  }
});
`,
    "utf8",
  );

  const result = await runCli([
    "run",
    "--topic",
    "CLI NotebookLM MCP",
    "--providers",
    "notebooklm",
    "--vault-dir",
    join(dir, "vault"),
    "--html",
    "--notebooklm-mcp-command",
    `${process.execPath} ${fakeMcp}`,
    "--notebooklm-max-wait",
    "1",
  ]);

  assert.equal(result.code, 0, result.stderr);
  const markdownPath = result.stdout.match(/Markdown: (.+\.md)/)[1].trim();
  assert.match(await readFile(markdownPath, "utf8"), /CLI NotebookLM report/);
});

test("setup tavily stores api key in env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-setup-"));
  const envFile = join(dir, ".env");

  const result = await new Promise((resolveRun) => {
    const child = spawn(process.execPath, [cliPath, "setup", "tavily", "--env-path", envFile], {
      cwd: resolve("."),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end("tvly-from-test\n");
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Saved Tavily API key/);
  assert.match(await readFile(envFile, "utf8"), /TAVILY_API_KEY="tvly-from-test"/);
});
