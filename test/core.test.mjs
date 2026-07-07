import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadEnvFile, renderHtml, runResearchPublish, saveTavilyApiKey, tavilyExtract, tavilyResearch, tavilySearch } from "../src/index.mjs";

function installFakeTavilyResearch(report = "# Tavily Research Report\n\nResearch context survived.") {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "tvly-test-key";
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/research")) {
      return { ok: true, json: async () => ({ request_id: "research-test", status: "pending", model: "mini" }) };
    }
    if (String(url).endsWith("/research/research-test")) {
      return {
        ok: true,
        json: async () => ({
          request_id: "research-test",
          status: "completed",
          model: "mini",
          report,
          sources: [{ title: "Source", url: "https://example.com", content: "Evidence" }],
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  return () => {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  };
}

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
  const markdown = await readFile(result.markdownPath, "utf8");
  assert.match(markdown, /type: "research-note"/);
  assert.match(markdown, /providers:\n  - "notebooklm"\n  - "tavily"/);
  assert.match(markdown, /## NotebookLM Deep Research/);
  assert.doesNotMatch(markdown, /Research status/);
  assert.doesNotMatch(markdown, /Provider metadata/);
  const html = await readFile(result.htmlPath, "utf8");
  assert.match(html, /<main>/);
  assert.match(html, /<h1 id="agentic-ai-vertical-market">Agentic AI vertical market<\/h1>/);
  assert.doesNotMatch(html, /<pre>/);
  assert.doesNotMatch(html, /type: &quot;research-note&quot;/);

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

test("html report navigation uses matching ascii anchors", () => {
  const html = renderHtml(
    { topic: "네비게이션 테스트" },
    [
      "# AI가 고객 신뢰를 확보할 수 있는가?",
      "",
      "## Tavily Research Report",
      "",
      "body",
      "",
      "## 신뢰 형성을 가로막는 지표",
      "",
      "body",
    ].join("\n"),
  );

  assert.match(html, /<a href="#ai">AI가 고객 신뢰를 확보할 수 있는가\?<\/a>/);
  assert.match(html, /<h1 id="ai">AI가 고객 신뢰를 확보할 수 있는가\?<\/h1>/);
  assert.match(html, /<a href="#tavily-research-report">Tavily Research Report<\/a>/);
  assert.match(html, /<h2 id="tavily-research-report">Tavily Research Report<\/h2>/);
  assert.match(html, /<a href="#section-3">신뢰 형성을 가로막는 지표<\/a>/);
  assert.match(html, /<h2 id="section-3">신뢰 형성을 가로막는 지표<\/h2>/);
});

test("tavily provider requires an API key for Research API output", async () => {
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
      /Tavily Research requires TAVILY_API_KEY/,
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

test("tavily extract requires an API key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-no-extract-env-"));
  delete process.env.TAVILY_API_KEY;
  await assert.rejects(
    () => tavilyExtract({ url: "https://example.com", envFile: join(dir, ".missing-env") }),
    /Tavily extract requires TAVILY_API_KEY/,
  );
});

test("tavily keyless mode is rejected", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  process.env.TAVILY_API_KEY = "tvly-stale-test-key";

  try {
    await assert.rejects(
      () => tavilySearch({ query: "keyless rejected", tavilyKeyless: true }),
      /Tavily keyless mode is not supported/,
    );
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
});

test("tavily provider uses Research API when an API key is configured", async () => {
  const dir = await mkdtemp(join(tmpdir(), "drp-tavily-research-"));
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  const calls = [];
  process.env.TAVILY_API_KEY = "tvly-test-key";
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/research")) {
      return { ok: true, json: async () => ({ request_id: "research-1", status: "pending", model: "mini" }) };
    }
    if (String(url).endsWith("/research/research-1")) {
      return {
        ok: true,
        json: async () => ({
          request_id: "research-1",
          status: "completed",
          model: "mini",
          content: "# Research answer\n\nDeeper cited synthesis.",
          sources: [{ title: "Evidence", url: "https://example.com", content: "supporting source" }],
        }),
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await runResearchPublish({
      topic: "Research quality",
      providers: ["tavily"],
      vaultDir: dir,
      envFile: join(dir, ".env"),
      html: true,
    });
    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /research_mode: "Tavily deep research"/);
    assert.match(markdown, /### Tavily Research Report/);
    assert.match(markdown, /Deeper cited synthesis/);
    const history = JSON.parse(await readFile(result.historyPath, "utf8"));
    assert.ok(history.providers[0].metadata.reportChars > 0);
    assert.equal(history.providers[0].metadata.sourceCount, 1);
    assert.equal(calls[0].url, "https://api.tavily.com/research");
    assert.match(calls[1].url, /\/research\/research-1$/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.TAVILY_API_KEY;
    else process.env.TAVILY_API_KEY = oldKey;
  }
});

test("tavily research waits for completed responses to include report content", async () => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.TAVILY_API_KEY;
  let polls = 0;
  process.env.TAVILY_API_KEY = "tvly-test-key";
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith("/research")) {
      const body = JSON.parse(String(options.body || "{}"));
      assert.equal(body.model, "mini");
      assert.equal(body.output_length, "long");
      return { ok: true, json: async () => ({ request_id: "delayed-report", status: "pending" }) };
    }
    if (String(url).endsWith("/research/delayed-report")) {
      polls += 1;
      return {
        ok: true,
        json: async () => polls === 1
          ? { request_id: "delayed-report", status: "completed", sources: [{ title: "Early source", url: "https://example.com" }] }
          : { request_id: "delayed-report", status: "completed", content: "Delayed Tavily report body.", sources: [] },
      };
    }
    throw new Error(`unexpected url ${url}`);
  };

  try {
    const result = await tavilyResearch({ input: "Delayed report", maxWaitSeconds: 10, pollIntervalMs: 1 });
    assert.equal(polls, 2);
    assert.equal(result.content, "Delayed Tavily report body.");
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
  assert.doesNotMatch(markdown, /> Mode: mcp/);
  assert.match(markdown, /NotebookLM deep research report/);
  assert.match(markdown, /Notebook source/);
});

test("custom local AI CLI can synthesize provider results", async () => {
  const restore = installFakeTavilyResearch("# Source answer\n\nEvidence for synthesis.");

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-"));
    const command = `${process.execPath} -e "process.stdin.resume();process.stdin.on('end',()=>console.log('AI OK'))"`;
    const result = await runResearchPublish({
      topic: "AI synthesis",
      providers: "tavily",
      vaultDir: dir,
      aiProvider: "custom",
      aiCommand: command,
    });

    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /## Synthesized Brief/);
    assert.match(markdown, /AI OK/);
    assert.doesNotMatch(markdown, /Command:/);
    assert.match(markdown, /status: "synthesized"/);
  } finally {
    restore();
  }
});

test("AI CLI failure is recorded without discarding research outputs", async () => {
  const restore = installFakeTavilyResearch("# Research survived\n\nEvidence remains available.");

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-fail-"));
    const result = await runResearchPublish({
      topic: "AI failure should not block Tavily",
      providers: "tavily",
      vaultDir: dir,
      aiProvider: "custom",
      aiCommand: "__reallygood_missing_ai_cli__",
      html: true,
    });

    const markdown = await readFile(result.markdownPath, "utf8");
    assert.match(markdown, /Research survived/);
    assert.doesNotMatch(markdown, /## AI Synthesis/);
    assert.doesNotMatch(markdown, /__reallygood_missing_ai_cli__/);
    assert.doesNotMatch(markdown, /not found|Command failed/i);
    const history = JSON.parse(await readFile(result.historyPath, "utf8"));
    assert.match(history.synthesis.error, /not found|Command failed/i);
    assert.match(await readFile(result.htmlPath, "utf8"), /AI failure should not block Tavily/);
  } finally {
    restore();
  }
});

test("built-in AI providers resolve local-bin CLI paths", async () => {
  const restore = installFakeTavilyResearch("# Search context\n\nEvidence from research.");
  const oldPath = process.env.PATH;

  try {
    const dir = await mkdtemp(join(tmpdir(), "drp-ai-path-"));
    const binDir = join(dir, "bin");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(binDir, { recursive: true }));
    for (const name of ["codex", "claude", "gemini", "grok", "agy"]) {
      const fake = join(binDir, name);
      await writeFile(fake, `#!/bin/sh\ncat >/dev/null\nprintf '${name.toUpperCase()} OK'\n`, "utf8");
      await chmod(fake, 0o755);
    }
    process.env.PATH = binDir;

    for (const provider of ["codex", "claude", "gemini", "grok", "antigravity"]) {
      const result = await runResearchPublish({
        topic: `Local CLI path ${provider}`,
        providers: "tavily",
        vaultDir: join(dir, "vault"),
        aiProvider: provider,
      });

      const expectedName = provider === "antigravity" ? "AGY" : provider.toUpperCase();
      const markdown = await readFile(result.markdownPath, "utf8");
      assert.match(markdown, new RegExp(`${expectedName} OK`));
      const history = JSON.parse(await readFile(result.historyPath, "utf8"));
      assert.match(history.synthesis.command, new RegExp(join(binDir, provider === "antigravity" ? "agy" : provider).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  } finally {
    process.env.PATH = oldPath;
    restore();
  }
});
