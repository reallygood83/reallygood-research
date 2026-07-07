import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
