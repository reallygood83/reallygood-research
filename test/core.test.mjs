import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvFile, runResearchPublish, saveTavilyApiKey, tavilyExtract, tavilySearch } from "../src/index.mjs";

test("mock providers save markdown, html, and history metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-core-"));
  const sourceFile = join(dir, "source.md");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(sourceFile, "# Source\n\nNotes from seed material.\n", "utf8"),
  );

  const result = await runResearchPublish({
    topic: "Agentic AI vertical market",
    providers: ["notebooklm", "tavily"],
    agent: "codex",
    sourceFile,
    vaultDir: join(dir, "vault"),
    html: true,
    mock: true,
  });

  assert.equal(result.providers.length, 2);
  assert.equal(result.providers[0].name, "notebooklm");
  assert.equal(result.providers[0].mode, "mock");
  assert.match(await readFile(result.markdownPath, "utf8"), /provider: notebooklm/);
  assert.match(await readFile(result.htmlPath, "utf8"), /Agentic AI vertical market/);

  const history = JSON.parse(await readFile(result.historyPath, "utf8"));
  assert.equal(history.topic, "Agentic AI vertical market");
  assert.deepEqual(history.providers.map((provider) => provider.name), ["notebooklm", "tavily"]);
  assert.equal(history.outputs.markdownPath, result.markdownPath);
  assert.equal(history.outputs.htmlPath, result.htmlPath);
});

test("unknown providers are rejected instead of silently falling back", async () => {
  await assert.rejects(
    () =>
      runResearchPublish({
        topic: "No fallback",
        providers: ["not-a-provider"],
        vaultDir: tmpdir(),
        mock: true,
      }),
    /Unsupported provider: not-a-provider/,
  );
});

test("tavily keyless is explicit opt-in", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-no-env-"));
  const oldKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    await assert.rejects(
      () =>
        runResearchPublish({
          topic: "No accidental credits",
          providers: ["tavily"],
          vaultDir: dir,
          envFile: join(dir, ".missing-env"),
        }),
      /TAVILY_API_KEY or --tavily-keyless/,
    );
  } finally {
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
});

test("tavily api key can be saved and loaded from local env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-env-"));
  const envFile = join(dir, ".reallygood-research.env");
  delete process.env.TAVILY_API_KEY;

  await saveTavilyApiKey("tvly-test-key", envFile);
  delete process.env.TAVILY_API_KEY;
  const loaded = await loadEnvFile(envFile);

  assert.equal(loaded.loaded, true);
  assert.equal(process.env.TAVILY_API_KEY, "tvly-test-key");
});

test("tavily extract requires explicit key or keyless mode", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-no-extract-env-"));
  delete process.env.TAVILY_API_KEY;
  await assert.rejects(
    () => tavilyExtract({ url: "https://example.com", envFile: join(dir, ".missing-env") }),
    /Tavily extract requires TAVILY_API_KEY or tavilyKeyless=true/,
  );
});

test("tavily keyless overrides a stale env key when explicitly selected", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  let headers = null;
  process.env.TAVILY_API_KEY = "tvly-stale-test-key";
  globalThis.fetch = async (_url, options) => {
    headers = options.headers;
    return {
      ok: true,
      json: async () => ({ results: [] }),
    };
  };

  try {
    await tavilySearch({ query: "keyless wins", tavilyKeyless: true });
    assert.equal(headers["X-Tavily-Access-Mode"], "keyless");
    assert.equal(headers.Authorization, undefined);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
});

test("NotebookLM provider runs through MCP research_start and research_status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-notebooklm-mcp-"));
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
  if (name === "research_start") {
    return {
      structuredContent: {
        status: "success",
        task_id: "task-1",
        notebook_id: "notebook-1",
        query: args.query,
        source: args.source,
        mode: args.mode,
        message: "started"
      }
    };
  }
  if (name === "research_status") {
    return {
      structuredContent: {
        status: "completed",
        notebook_id: args.notebook_id,
        task_id: args.task_id,
        sources_found: 1,
        imported_count: 1,
        report: "NotebookLM deep research report",
        sources: [{ title: "Notebook source", url: "https://example.com/notebook" }]
      }
    };
  }
  throw new Error("unknown tool " + name);
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

  const result = await runResearchPublish({
    topic: "NotebookLM MCP smoke",
    providers: "notebooklm",
    vaultDir: join(dir, "vault"),
    html: true,
    notebooklmMcpCommand: `${process.execPath} ${fakeMcp}`,
    notebooklmMaxWait: 1,
  });

  const markdown = await readFile(result.markdownPath, "utf8");
  assert.equal(result.providers[0].name, "notebooklm");
  assert.equal(result.providers[0].mode, "mcp");
  assert.match(markdown, /mode: mcp/);
  assert.match(markdown, /NotebookLM deep research report/);
  assert.match(markdown, /Notebook source/);
});

test("custom local AI CLI can synthesize provider results", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      answer: "Source answer",
      results: [{ title: "Source", url: "https://example.com", content: "Evidence" }],
      usage: { credits: 1 },
      request_id: "test-request",
    }),
  });

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-"));
    const command = `${process.execPath} -e "process.stdin.resume();process.stdin.on('end',()=>console.log('AI OK'))"`;
    const result = await runResearchPublish({
      topic: "AI synthesis",
      providers: "tavily",
      vaultDir: dir,
      tavilyKeyless: true,
      aiProvider: "custom",
      aiCommand: command,
    });

    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /## AI Synthesis/);
    assert.match(markdown, /AI OK/);
    assert.match(markdown, /provider: custom/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("AI CLI failure is recorded without discarding research outputs", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      answer: "Search survived",
      results: [{ title: "Source", url: "https://example.com", content: "Evidence" }],
      request_id: "ai-fail-test",
    }),
  });

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-fail-"));
    const result = await runResearchPublish({
      topic: "AI failure should not block Tavily",
      providers: "tavily",
      vaultDir: dir,
      tavilyKeyless: true,
      aiProvider: "custom",
      aiCommand: "__reallygood_missing_ai_cli__",
      html: true,
    });

    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /Search survived/);
    assert.match(markdown, /## AI Synthesis/);
    assert.match(markdown, /__reallygood_missing_ai_cli__/);
    assert.match(markdown, /not found|Command failed/i);
    assert.match(await readFile(result.htmlPath, "utf8"), /AI failure should not block Tavily/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("built-in AI providers resolve local-bin CLI paths", async () => {
  const oldFetch = globalThis.fetch;
  const oldPath = process.env.PATH;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      answer: "Search context",
      results: [{ title: "Source", url: "https://example.com", content: "Evidence" }],
      request_id: "local-bin-ai",
    }),
  });

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-path-"));
    const binDir = join(dir, "bin");
    const fakeClaude = join(binDir, "claude");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir, { recursive: true }));
    await writeFile(fakeClaude, "#!/bin/sh\ncat >/dev/null\nprintf 'LOCAL CLI OK'\n", "utf8");
    await chmod(fakeClaude, 0o755);
    process.env.PATH = binDir;

    const result = await runResearchPublish({
      topic: "Local CLI path",
      providers: "tavily",
      vaultDir: join(dir, "vault"),
      tavilyKeyless: true,
      aiProvider: "claude",
    });

    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /LOCAL CLI OK/);
    assert.match(markdown, new RegExp(fakeClaude.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    process.env.PATH = oldPath;
    globalThis.fetch = oldFetch;
  }
});
