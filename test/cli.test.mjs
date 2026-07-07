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
  assert.match(await readFile(markdownPath, "utf8"), /provider: tavily/);
  assert.match(await readFile(htmlPath, "utf8"), /Agentic AI vertical market/);
});

test("run command rejects non-mock provider execution", async () => {
  const result = await runCli([
    "run",
    "--topic",
    "Real provider",
    "--providers",
    "odysseus",
    "--vault-dir",
    tmpdir(),
  ]);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Provider odysseus requires an integration/);
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
