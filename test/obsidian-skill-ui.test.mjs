import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const require = createRequire(import.meta.url);

test("Obsidian manifest exposes a standalone plugin shell", async () => {
  const manifest = JSON.parse(await read("manifest.json"));

  assert.equal(manifest.id, "reallygood-research");
  assert.equal(manifest.name, "ReallyGood Research");
  assert.equal(manifest.isDesktopOnly, true);
  assert.match(manifest.description, /Markdown plus HTML/i);
  assert.equal(manifest.main, "main.js");
});

test("Obsidian main.js is BRAT-standalone and registers a runnable research console", async () => {
  const source = await read("main.js");

  assert.match(source, /"run"/);
  assert.match(source, /addCommand/);
  assert.match(source, /addRibbonIcon/);
  assert.match(source, /addSettingTab/);
  assert.match(source, /runResearchPublish/);
  assert.match(source, /saveTavilyApiKey/);
  assert.match(source, /Tavily API key/);
  assert.match(source, /type", "password"/);
  assert.doesNotMatch(source, /src", "index\.mjs|pathToFileURL|getCoreModuleUrl|spawn\(process\.execPath|cliScript/);
  assert.match(source, /--providers/);
  assert.match(source, /--vault-dir/);
  assert.match(source, /vaultDir: "\."/);
  assert.match(source, /--html/);
  assert.match(source, /--mock/);
  assert.match(source, /--tavily-keyless/);
  assert.match(source, /AI provider/);
  assert.match(source, /aiCommand/);
  assert.match(source, /NotebookLM MCP command/);
  assert.match(source, /NotebookLM login command/);
  assert.match(source, /Login NotebookLM/);
  assert.match(source, /runNotebookLmLogin/);
  assert.match(source, /notebooklmMcpCommand/);
  assert.match(source, /notebooklmLoginCommand/);
  assert.doesNotMatch(source, /Odysseus/);
  assert.match(source, /createSection/);
  assert.match(source, /Copy command/);
  assert.match(source, /getSummary/);
  assert.match(source, /setProviderEnabled/);
});

test("Obsidian main.js runs after BRAT installs only manifest, main, and styles", async () => {
  const module = { exports: {} };
  const vaultDir = await mkdtemp(join(tmpdir(), "brat-plugin-"));
  const notices = [];
  class Plugin {
    async loadData() {
      return {};
    }
    async saveData(data) {
      this.savedData = data;
    }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
  }
  class Modal {}
  class PluginSettingTab {}
  class Setting {}
  const Notice = function Notice(message) {
    notices.push(message);
  };
  const requireStub = (id) => {
    if (id === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting };
    return require(id);
  };
  const source = await read("main.js");
  Function("require", "module", "exports", source)(requireStub, module, module.exports);

  const PluginClass = module.exports;
  const plugin = new PluginClass();
  plugin.app = { vault: { adapter: { getBasePath: () => vaultDir } } };
  plugin.manifest = { id: "reallygood-research", dir: ".obsidian/plugins/reallygood-research" };
  await plugin.onload();
  plugin.settings.mock = true;

  const result = await plugin.runResearch("BRAT standalone smoke", () => {});
  assert.equal(existsSync(result.markdownPath), true);
  assert.equal(existsSync(result.htmlPath), true);
  assert.equal(existsSync(result.historyPath), true);
  assert.match(await readFile(result.markdownPath, "utf8"), /BRAT standalone smoke/);
  assert.match(await readFile(result.htmlPath, "utf8"), /BRAT standalone smoke/);
});

test("Obsidian plugin migrates old demo defaults to real Tavily deep research", async () => {
  const module = { exports: {} };
  class Plugin {
    async loadData() {
      return {
        providers: "notebooklm,tavily",
        vaultDir: "000-research",
        html: true,
        mock: true,
        tavilyKeyless: false,
        aiProvider: "codex",
        aiCommand: "",
      };
    }
    async saveData(data) {
      this.savedData = data;
    }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
  }
  class Modal {}
  class PluginSettingTab {}
  class Setting {}
  const Notice = function Notice(message) {
    return message;
  };
  const requireStub = (id) => {
    if (id === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting };
    return require(id);
  };
  const source = await read("main.js");
  Function("require", "module", "exports", source)(requireStub, module, module.exports);

  const PluginClass = module.exports;
  const plugin = new PluginClass();
  plugin.app = { vault: { adapter: { getBasePath: () => "/tmp" } } };
  plugin.manifest = { id: "reallygood-research", dir: ".obsidian/plugins/reallygood-research" };
  await plugin.onload();

  assert.equal(plugin.settings.providers, "tavily");
  assert.equal(plugin.settings.mock, false);
  assert.equal(plugin.settings.tavilyKeyless, true);
  assert.equal(plugin.settings.aiProvider, "none");
  assert.equal(plugin.savedData.settingsVersion, 4);
});

test("Obsidian plugin can run the configured NotebookLM login command", async () => {
  const module = { exports: {} };
  class Plugin {
    async loadData() {
      return {
        notebooklmLoginCommand: `${process.execPath} -e "console.log('login ok')"`,
        settingsVersion: 4,
      };
    }
    async saveData(data) {
      this.savedData = data;
    }
    addRibbonIcon() {}
    addCommand() {}
    addSettingTab() {}
  }
  class Modal {}
  class PluginSettingTab {}
  class Setting {}
  const Notice = function Notice(message) {
    return message;
  };
  const requireStub = (id) => {
    if (id === "obsidian") return { Modal, Notice, Plugin, PluginSettingTab, Setting };
    return require(id);
  };
  const source = await read("main.js");
  Function("require", "module", "exports", source)(requireStub, module, module.exports);

  const PluginClass = module.exports;
  const plugin = new PluginClass();
  plugin.app = { vault: { adapter: { getBasePath: () => "/tmp" } } };
  plugin.manifest = { id: "reallygood-research", dir: ".obsidian/plugins/reallygood-research" };
  await plugin.onload();

  assert.match(await plugin.runNotebookLmLogin(), /login ok/);
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
