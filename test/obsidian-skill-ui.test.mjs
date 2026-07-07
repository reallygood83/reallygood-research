import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Obsidian manifest exposes a standalone plugin shell", async () => {
  const manifest = JSON.parse(await read("manifest.json"));

  assert.equal(manifest.id, "reallygood-research");
  assert.equal(manifest.name, "ReallyGood Research");
  assert.equal(manifest.isDesktopOnly, true);
  assert.match(manifest.description, /Markdown plus HTML/i);
  assert.equal(manifest.main, "main.js");
});

test("Obsidian main.js registers a runnable research console without provider logic", async () => {
  const source = await read("main.js");

  assert.match(source, /bin", "deep-research\.mjs/);
  assert.match(source, /"run"/);
  assert.match(source, /addCommand/);
  assert.match(source, /addRibbonIcon/);
  assert.match(source, /addSettingTab/);
  assert.match(source, /spawn\(process\.execPath/);
  assert.match(source, /--providers/);
  assert.match(source, /--vault-dir/);
  assert.match(source, /vaultDir: "\."/);
  assert.match(source, /--html/);
  assert.match(source, /--mock/);
  assert.match(source, /--tavily-keyless/);
  assert.doesNotMatch(source, /Notebook-style synthesis|Search-grounded brief|Long-form reasoning brief/);
});

test("agent skill templates call the shared CLI contract", async () => {
  const expected = {
    "codex/SKILL.md": /Codex/,
    "claude-code/SKILL.md": /Claude Code/,
    "antigravity/SKILL.md": /Antigravity/,
    "grok/SKILL.md": /Grok/,
  };

  for (const [path, label] of Object.entries(expected)) {
    const body = await read(`skills/${path}`);

    assert.match(body, label);
    assert.match(body, /node bin\/deep-research\.mjs run/);
    assert.match(body, /--providers/);
    assert.match(body, /--vault-dir/);
    assert.match(body, /--html/);
    assert.match(body, /--mock/);
    assert.match(body, /shared CLI\/MCP contract/);
    assert.doesNotMatch(body, /implement provider|provider-specific scraping/i);
  }
});
