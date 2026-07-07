import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const cliPath = resolve("bin/deep-research.mjs");

function runCli(args, options = {}) {
  return new Promise((resolveRun) => {
    const env = { ...process.env, ...options.env };
    if (options.withoutTavilyKey) {
      delete env.TAVILY_API_KEY;
    }

    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: resolve("."),
      env,
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

test("C001 mock NotebookLM+Tavily run writes Markdown and HTML", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-c001-"));
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

  const markdownPath = result.stdout.match(/Markdown: (.+\.md)/)?.[1]?.trim();
  const htmlPath = result.stdout.match(/HTML: (.+\.html)/)?.[1]?.trim();
  assert.ok(markdownPath, `stdout did not include Markdown path:\n${result.stdout}`);
  assert.ok(htmlPath, `stdout did not include HTML path:\n${result.stdout}`);
  assert.equal(existsSync(markdownPath), true);
  assert.equal(existsSync(htmlPath), true);
  assert.match(await readFile(markdownPath, "utf8"), /provider: notebooklm/i);
  assert.match(await readFile(markdownPath, "utf8"), /provider: tavily/i);
  assert.match(await readFile(htmlPath, "utf8"), /Agentic AI vertical market/);
});

test("C002 missing TAVILY_API_KEY without --mock fails safely and creates no output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-c002-"));
  const vaultDir = join(dir, "vault");
  const homeDir = join(dir, "home");

  const result = await runCli(
    [
      "run",
      "--topic",
      "Missing key",
      "--providers",
      "tavily",
      "--source-text",
      "test",
      "--vault-dir",
      vaultDir,
      "--html",
    ],
    { withoutTavilyKey: true, env: { HOME: homeDir } },
  );

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /TAVILY_API_KEY|Tavily API key/i);
  const outputFiles = existsSync(vaultDir) ? readdirSync(vaultDir) : [];
  assert.deepEqual(outputFiles, [], `unexpected output files: ${outputFiles.join(", ")}`);

  await rm(dir, { recursive: true, force: true });
});
