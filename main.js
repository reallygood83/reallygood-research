const { Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { chmod, mkdir, readFile, writeFile } = require("node:fs/promises");
const { dirname, isAbsolute, join } = require("node:path");
const { existsSync, readdirSync, statSync } = require("node:fs");
const { spawn } = require("node:child_process");

const PROVIDER_OPTIONS = [
  ["notebooklm", "NotebookLM MCP"],
  ["tavily", "Tavily"],
];
const SETTINGS_VERSION = 8;
const AI_CLI_PROVIDERS = {
  codex: { label: "Codex CLI", names: ["codex"], args: "exec -" },
  claude: { label: "Claude Code CLI", names: ["claude"], args: "-p" },
  gemini: { label: "Gemini CLI", names: ["gemini"], args: "-p" },
  grok: { label: "Grok CLI", names: ["grok"], args: '-p "$(cat)"' },
  antigravity: { label: "Antigravity CLI", names: ["antigravity"], args: "-p" },
};

const DEFAULT_SETTINGS = {
  providers: "tavily",
  vaultDir: ".",
  html: true,
  mock: false,
  tavilyKeyless: true,
  aiProvider: "none",
  aiCommand: "",
  notebooklmMcpCommand: "notebooklm-mcp",
  notebooklmLoginCommand: "nlm login",
  notebooklmMode: "deep",
  notebooklmMaxWait: 900,
  settingsVersion: SETTINGS_VERSION,
};

module.exports = class ReallyGoodResearchPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = migrateSettings(Object.assign({}, DEFAULT_SETTINGS, savedSettings || {}), savedSettings || {});
    if (this.settings.settingsVersion !== savedSettings?.settingsVersion) {
      await this.saveSettings();
    }

    this.addRibbonIcon("search", "ReallyGood Research", () => {
      new ResearchModal(this.app, this).open();
    });

    this.addCommand({
      id: "open-research-console",
      name: "Open deep research console",
      callback: () => new ResearchModal(this.app, this).open(),
    });

    this.addCommand({
      id: "copy-research-command",
      name: "Copy deep research command",
      callback: async () => {
        await navigator.clipboard.writeText(this.buildCommandPreview("Research topic"));
        new Notice("ReallyGood Research command copied.");
      },
    });

    this.addSettingTab(new ResearchSettingTab(this.app, this));
  }

  getVaultBasePath() {
    return this.app.vault.adapter.getBasePath?.() || ".";
  }

  getPluginDir() {
    const dir = this.manifest.dir || `.obsidian/plugins/${this.manifest.id}`;
    return isAbsolute(dir) ? dir : join(this.getVaultBasePath(), dir);
  }

  getOutputDir() {
    const dir = this.settings.vaultDir.trim() || DEFAULT_SETTINGS.vaultDir;
    return isAbsolute(dir) ? dir : join(this.getVaultBasePath(), dir);
  }

  buildRequest(topic) {
    return {
      topic,
      providers: this.settings.providers.trim() || DEFAULT_SETTINGS.providers,
      agent: "obsidian",
      vaultDir: this.getOutputDir(),
      html: this.settings.html,
      mock: this.settings.mock,
      tavilyKeyless: this.settings.tavilyKeyless,
      aiProvider: this.settings.aiProvider || DEFAULT_SETTINGS.aiProvider,
      aiCommand: this.settings.aiCommand || DEFAULT_SETTINGS.aiCommand,
      notebooklmMcpCommand: this.settings.notebooklmMcpCommand || DEFAULT_SETTINGS.notebooklmMcpCommand,
      notebooklmMode: this.settings.notebooklmMode || DEFAULT_SETTINGS.notebooklmMode,
      notebooklmMaxWait: this.settings.notebooklmMaxWait || DEFAULT_SETTINGS.notebooklmMaxWait,
    };
  }

  getProviderSet() {
    return new Set(normalizeProviders(this.settings.providers || DEFAULT_SETTINGS.providers));
  }

  async setProviderEnabled(provider, enabled) {
    const providers = this.getProviderSet();
    if (enabled) providers.add(provider);
    else providers.delete(provider);
    if (!providers.size) providers.add("tavily");
    this.settings.providers = [...providers].filter((name) => SUPPORTED_PROVIDERS.has(name)).join(",");
    await this.saveSettings();
  }

  async saveTavilyApiKey(apiKey) {
    return saveTavilyApiKey(apiKey);
  }

  async testTavilyApiKey(apiKey) {
    return testTavilyApiKey(apiKey);
  }

  async runNotebookLmLogin() {
    return runShellCommandUntil(
      this.settings.notebooklmLoginCommand || DEFAULT_SETTINGS.notebooklmLoginCommand,
      /Successfully authenticated|Authentication valid|Notebooks found/,
      300000,
    );
  }

  buildCommandPreview(topic) {
    const args = [
      "node",
      "bin/deep-research.mjs",
      "run",
      "--topic",
      quote(topic),
      "--providers",
      quote(this.settings.providers.trim() || DEFAULT_SETTINGS.providers),
      "--agent",
      "obsidian",
      "--vault-dir",
      quote(this.getOutputDir()),
    ];

    if (this.settings.html) args.push("--html");
    if (this.settings.mock) args.push("--mock");
    if (this.settings.tavilyKeyless) args.push("--tavily-keyless");
    if (this.settings.aiProvider && this.settings.aiProvider !== "none") {
      args.push("--ai-provider", this.settings.aiProvider);
      if (this.settings.aiCommand) args.push("--ai-command", quote(this.settings.aiCommand));
    }
    if (this.settings.notebooklmMcpCommand !== DEFAULT_SETTINGS.notebooklmMcpCommand) {
      args.push("--notebooklm-mcp-command", quote(this.settings.notebooklmMcpCommand));
    }
    return args.join(" ");
  }

  async runResearch(topic, onData) {
    const result = await runResearchPublish(this.buildRequest(topic));
    onData(`Markdown: ${result.markdownPath}\n`);
    if (result.htmlPath) onData(`HTML: ${result.htmlPath}\n`);
    onData(`History: ${result.historyPath}\n`);
    return result;
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};

class ResearchModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.topic = "";
    this.output = "";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("reallygood-research-modal");
    this.output = "";

    const header = contentEl.createDiv({ cls: "reallygood-research-header" });
    header.createEl("h2", { text: "ReallyGood Research" });
    header.createEl("p", { text: "Deep research to Markdown and HTML inside this vault." });

    const topicSection = createSection(contentEl, "Research");
    new Setting(topicSection)
      .setName("Topic")
      .setDesc("Research question or brief.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Agentic AI가 vertical AI 산업에 미칠 영향")
          .onChange((value) => {
            this.topic = value.trim();
          }),
      );

    const providerSection = createSection(contentEl, "Providers");
    for (const [provider, label] of PROVIDER_OPTIONS) {
      new Setting(providerSection)
        .setName(label)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.getProviderSet().has(provider)).onChange(async (value) => {
            await this.plugin.setProviderEnabled(provider, value);
            summaryEl.setText(this.getSummary());
          }),
        );
    }

    const outputSection = createSection(contentEl, "Output");
    new Setting(outputSection)
      .setName("Folder")
      .setDesc("Relative to the vault, or an absolute path.")
      .addText((text) =>
        text
          .setPlaceholder("300-Creator/350-NewsInsight")
          .setValue(this.plugin.settings.vaultDir)
          .onChange(async (value) => {
            this.plugin.settings.vaultDir = value.trim() || DEFAULT_SETTINGS.vaultDir;
            await this.plugin.saveSettings();
            summaryEl.setText(this.getSummary());
          }),
      );

    new Setting(outputSection)
      .setName("Export HTML")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.html).onChange(async (value) => {
          this.plugin.settings.html = value;
          await this.plugin.saveSettings();
          summaryEl.setText(this.getSummary());
        }),
      );

    const runSection = createSection(contentEl, "Run mode");
    new Setting(runSection)
      .setName("Test mode")
      .setDesc("Creates fake local output only. Turn this off for deep research.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mock).onChange(async (value) => {
          this.plugin.settings.mock = value;
          await this.plugin.saveSettings();
          summaryEl.setText(this.getSummary());
        }),
      );

    new Setting(runSection)
      .setName("Tavily keyless")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tavilyKeyless).onChange(async (value) => {
          this.plugin.settings.tavilyKeyless = value;
          await this.plugin.saveSettings();
          summaryEl.setText(this.getSummary());
        }),
      );

    const notebookSection = createSection(contentEl, "NotebookLM MCP");
    new Setting(notebookSection)
      .setName("MCP command")
      .setDesc("Default: notebooklm-mcp. Run nlm login before using NotebookLM.")
      .addText((text) =>
        text
          .setPlaceholder("notebooklm-mcp")
          .setValue(this.plugin.settings.notebooklmMcpCommand || DEFAULT_SETTINGS.notebooklmMcpCommand)
          .onChange(async (value) => {
            this.plugin.settings.notebooklmMcpCommand = value.trim() || DEFAULT_SETTINGS.notebooklmMcpCommand;
            await this.plugin.saveSettings();
            summaryEl.setText(this.getSummary());
          }),
      );

    new Setting(notebookSection)
      .setName("Login")
      .setDesc("Runs the configured nlm login command from Obsidian.")
      .addButton((button) =>
        button.setButtonText("Login NotebookLM").onClick(async () => {
          button.setDisabled(true);
          try {
            const output = await this.plugin.runNotebookLmLogin();
            new Notice(output.trim() || "NotebookLM login finished.");
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    const aiSection = createSection(contentEl, "AI synthesis");
    new Setting(aiSection)
      .setName("AI provider")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "None")
          .addOption("codex", "Codex CLI")
          .addOption("claude", "Claude Code CLI")
          .addOption("gemini", "Gemini CLI")
          .addOption("grok", "Grok CLI")
          .addOption("antigravity", "Antigravity CLI")
          .addOption("custom", "Custom CLI")
          .setValue(this.plugin.settings.aiProvider || DEFAULT_SETTINGS.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value;
            await this.plugin.saveSettings();
            summaryEl.setText(this.getSummary());
          }),
      );

    new Setting(aiSection)
      .setName("Custom command")
      .setDesc("Used only when AI provider is Custom CLI.")
      .addText((text) =>
        text
          .setPlaceholder('claude -p')
          .setValue(this.plugin.settings.aiCommand || "")
          .onChange(async (value) => {
            this.plugin.settings.aiCommand = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    const summaryEl = contentEl.createDiv({ cls: "reallygood-research-summary", text: this.getSummary() });
    const logEl = contentEl.createEl("pre", { cls: "reallygood-research-log" });
    logEl.setText("Ready.");

    const actionsEl = contentEl.createDiv({ cls: "reallygood-research-actions" });
    new Setting(actionsEl)
      .addButton((button) =>
        button
          .setButtonText("Copy command")
          .onClick(async () => {
            await navigator.clipboard.writeText(this.plugin.buildCommandPreview(this.topic || "Research topic"));
            new Notice("ReallyGood Research command copied.");
          }),
      )
      .addButton((button) =>
        button
          .setButtonText("Start")
          .setCta()
          .onClick(async () => {
          if (!this.topic) {
            new Notice("Enter a research topic first.");
            return;
          }

          button.setDisabled(true);
          this.output = `Running...\n${this.getSummary()}\n\n`;
          logEl.setText(this.output);

          try {
            await this.plugin.runResearch(this.topic, (line) => {
              this.output += line;
              logEl.setText(this.output);
            });
            new Notice("ReallyGood Research finished.");
          } catch (error) {
            logEl.setText(`${this.output}\n${error.message}`);
            new Notice(error.message);
          } finally {
            button.setDisabled(false);
          }
        }),
      );
  }

  onClose() {
    this.contentEl.empty();
  }

  getSummary() {
    return [
      `Providers: ${this.plugin.settings.providers}`,
      `Folder: ${this.plugin.settings.vaultDir || DEFAULT_SETTINGS.vaultDir}`,
      `HTML: ${this.plugin.settings.html ? "on" : "off"}`,
      `Mode: ${this.plugin.settings.mock ? "test/mock" : "deep research"}`,
      `Tavily: ${this.plugin.settings.tavilyKeyless ? "keyless" : "env/API key"}`,
      `NotebookLM: ${this.plugin.settings.notebooklmMcpCommand || DEFAULT_SETTINGS.notebooklmMcpCommand}`,
      `AI: ${this.plugin.settings.aiProvider || "none"}`,
    ].join(" | ");
  }
}

class ResearchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "ReallyGood Research" });
    let tavilyApiKey = "";

    new Setting(containerEl)
      .setName("Providers")
      .setDesc("Comma-separated: notebooklm,tavily.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.providers)
          .onChange(async (value) => {
            this.plugin.settings.providers = value.trim() || DEFAULT_SETTINGS.providers;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("NotebookLM MCP command")
      .setDesc("Default: notebooklm-mcp. If using the local checkout, use: cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && uv run notebooklm-mcp")
      .addText((text) =>
        text
          .setPlaceholder("notebooklm-mcp")
          .setValue(this.plugin.settings.notebooklmMcpCommand || DEFAULT_SETTINGS.notebooklmMcpCommand)
          .onChange(async (value) => {
            this.plugin.settings.notebooklmMcpCommand = value.trim() || DEFAULT_SETTINGS.notebooklmMcpCommand;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("NotebookLM login command")
      .setDesc("Default: nlm login. If using the local checkout, use: cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && uv run nlm login")
      .addText((text) =>
        text
          .setPlaceholder("nlm login")
          .setValue(this.plugin.settings.notebooklmLoginCommand || DEFAULT_SETTINGS.notebooklmLoginCommand)
          .onChange(async (value) => {
            this.plugin.settings.notebooklmLoginCommand = value.trim() || DEFAULT_SETTINGS.notebooklmLoginCommand;
            await this.plugin.saveSettings();
          }),
      )
      .addButton((button) =>
        button.setButtonText("Run login").onClick(async () => {
          button.setDisabled(true);
          try {
            const output = await this.plugin.runNotebookLmLogin();
            new Notice(output.trim() || "NotebookLM login finished.");
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          } finally {
            button.setDisabled(false);
          }
        }),
      );

    new Setting(containerEl)
      .setName("NotebookLM max wait")
      .setDesc("Seconds to wait for NotebookLM deep research completion.")
      .addText((text) =>
        text
          .setPlaceholder("900")
          .setValue(String(this.plugin.settings.notebooklmMaxWait || DEFAULT_SETTINGS.notebooklmMaxWait))
          .onChange(async (value) => {
            const parsed = Number(value);
            this.plugin.settings.notebooklmMaxWait = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SETTINGS.notebooklmMaxWait;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc("Relative to the vault, or an absolute path.")
      .addText((text) =>
        text
          .setPlaceholder("300-Creator/350-NewsInsight")
          .setValue(this.plugin.settings.vaultDir)
          .onChange(async (value) => {
            this.plugin.settings.vaultDir = value.trim() || DEFAULT_SETTINGS.vaultDir;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Tavily keyless")
      .setDesc("Use Tavily's keyless Search API when TAVILY_API_KEY is not configured.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tavilyKeyless).onChange(async (value) => {
          this.plugin.settings.tavilyKeyless = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Tavily API key")
      .setDesc("Saved to ~/.reallygood-research.env, not to Obsidian settings.")
      .addText((text) => {
        text
          .setPlaceholder("tvly-...")
          .onChange((value) => {
            tavilyApiKey = value.trim();
          });
        text.inputEl.setAttribute("type", "password");
      })
      .addButton((button) =>
        button.setButtonText("Save key").onClick(async () => {
          try {
            const result = await this.plugin.saveTavilyApiKey(tavilyApiKey);
            let suffix = "";
            try {
              await this.plugin.testTavilyApiKey(tavilyApiKey);
              suffix = " and verified";
            } catch (error) {
              suffix = `. Saved locally, but test failed: ${error instanceof Error ? error.message : String(error)}`;
            }
            tavilyApiKey = "";
            new Notice(`Saved Tavily API key to ${result.envFile}${suffix}`);
          } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
          }
        }),
      );

    new Setting(containerEl)
      .setName("AI provider")
      .setDesc("Uses an already logged-in local CLI/OAuth session, not an API key.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "None")
          .addOption("codex", "Codex CLI")
          .addOption("claude", "Claude Code CLI")
          .addOption("gemini", "Gemini CLI")
          .addOption("grok", "Grok CLI")
          .addOption("antigravity", "Antigravity CLI")
          .addOption("custom", "Custom CLI")
          .setValue(this.plugin.settings.aiProvider || DEFAULT_SETTINGS.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("AI CLI command")
      .setDesc("Optional custom command. The research prompt is passed through stdin.")
      .addText((text) =>
        text
          .setPlaceholder('claude -p')
          .setValue(this.plugin.settings.aiCommand || "")
          .onChange(async (value) => {
            this.plugin.settings.aiCommand = value.trim();
            await this.plugin.saveSettings();
          }),
      );
  }
}

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function createSection(parent, heading) {
  const section = parent.createDiv({ cls: "reallygood-research-section" });
  section.createEl("h3", { text: heading });
  return section;
}

function migrateSettings(settings, savedSettings) {
  if (!savedSettings.settingsVersion) {
    const oldDemoDefaults =
      settings.mock === true &&
      !settings.tavilyKeyless &&
      normalizeProviders(settings.providers).join(",") === "notebooklm,tavily";

    if (oldDemoDefaults) {
      settings.providers = "tavily";
      settings.mock = false;
      settings.tavilyKeyless = true;
      if (settings.aiProvider === "codex" && !settings.aiCommand) {
        settings.aiProvider = "none";
      }
    }
  }
  if ((savedSettings.settingsVersion || 0) < 6) {
    settings.notebooklmMcpCommand = normalizeLocalNotebookLmCommand(settings.notebooklmMcpCommand, "notebooklm-mcp");
    settings.notebooklmLoginCommand = normalizeLocalNotebookLmCommand(settings.notebooklmLoginCommand, "nlm login");
  }
  if ((savedSettings.settingsVersion || 0) < 8 && settings.aiProvider === "codex" && !settings.aiCommand) {
    settings.aiProvider = "none";
  }
  settings.settingsVersion = SETTINGS_VERSION;
  return settings;
}

function normalizeLocalNotebookLmCommand(command, tool) {
  const value = stringValue(command);
  if (!value) return value;
  return value.replace(
    "cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && uv run ",
    "cd /Users/moon/Documents/NoteBookLM/notebooklm-cli && /opt/homebrew/bin/uv run ",
  ) || tool;
}

const SUPPORTED_PROVIDERS = new Set(["notebooklm", "tavily"]);

async function runResearchPublish(input) {
  const request = validateResearchRequest(input);
  await loadEnvFile(request.envFile);
  const providerResults = await Promise.all(
    request.providers.map((provider) => runProvider(provider, request)),
  );
  const synthesis = await runAiSynthesisSafely(request, providerResults);

  const now = new Date();
  const slug = slugify(request.topic);
  const stamp = now.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  await mkdir(request.vaultDir, { recursive: true });

  const markdownPath = join(request.vaultDir, `${stamp}-${slug}.md`);
  const markdown = renderMarkdown(request, providerResults, now, synthesis);
  await writeFile(markdownPath, markdown, "utf8");

  let htmlPath = null;
  if (request.html) {
    htmlPath = join(request.vaultDir, `${stamp}-${slug}.html`);
    await writeFile(htmlPath, renderHtml(request, markdown), "utf8");
  }

  const historyDir = join(request.vaultDir, ".deep-research-publisher");
  await mkdir(historyDir, { recursive: true });
  const historyPath = join(historyDir, `${stamp}-${slug}.json`);
  await writeFile(
    historyPath,
    `${JSON.stringify({
      topic: request.topic,
      agent: request.agent,
      mock: request.mock,
      createdAt: now.toISOString(),
      providers: providerResults.map(({ name, mode, metadata }) => ({ name, mode, metadata })),
      synthesis: synthesis
        ? { provider: synthesis.provider, command: synthesis.command, error: synthesis.error || null }
        : null,
      outputs: { markdownPath, htmlPath },
    }, null, 2)}\n`,
    "utf8",
  );

  return { topic: request.topic, markdownPath, htmlPath, historyPath, providers: providerResults };
}

function validateResearchRequest(input) {
  const topic = stringValue(input.topic);
  if (!topic) throw new Error("Missing required option: topic");
  const vaultDir = stringValue(input.vaultDir);
  if (!vaultDir) throw new Error("Missing required option: vaultDir");

  const providers = normalizeProviders(input.providers);
  for (const provider of providers) {
    if (!SUPPORTED_PROVIDERS.has(provider)) throw new Error(`Unsupported provider: ${provider}`);
  }

  return {
    topic,
    providers,
    agent: stringValue(input.agent) || "obsidian",
    vaultDir,
    html: Boolean(input.html),
    mock: Boolean(input.mock),
    tavilyKeyless: Boolean(input.tavilyKeyless),
    envFile: stringValue(input.envFile) || defaultEnvFile(),
    searchDepth: stringValue(input.searchDepth) || "advanced",
    maxResults: numberValue(input.maxResults, 5),
    chunksPerSource: numberValue(input.chunksPerSource, 3),
    includeAnswer: input.includeAnswer === undefined ? true : Boolean(input.includeAnswer),
    aiProvider: stringValue(input.aiProvider) || "none",
    aiCommand: stringValue(input.aiCommand),
    notebooklmMcpCommand: stringValue(input.notebooklmMcpCommand) || "notebooklm-mcp",
    notebooklmMode: stringValue(input.notebooklmMode) || "deep",
    notebooklmMaxWait: numberValue(input.notebooklmMaxWait, 900),
  };
}

async function runProvider(name, request) {
  if (!request.mock) {
    if (name === "tavily") return runTavilyProvider(request);
    if (name === "notebooklm") return runNotebookLmProvider(request);
    throw new Error(`Provider ${name} requires an integration; rerun with Mock mode for local mock mode`);
  }

  return {
    name,
    mode: "mock",
    metadata: { topic: request.topic, agent: request.agent },
    content: mockProviderContent(name, request.topic),
  };
}

async function runNotebookLmProvider(request) {
  const session = createMcpSession(request.notebooklmMcpCommand, request.notebooklmMaxWait * 1000 + 30000);
  try {
    await session.start();
    const start = normalizeMcpToolPayload(
      await session.callTool("research_start", {
        query: request.topic,
        source: "web",
        mode: request.notebooklmMode,
        title: truncateTitle(`ReallyGood Research - ${request.topic}`),
      }),
    );
    assertNotebookLmSuccess(start, "research_start");

    const notebookId = stringValue(start.notebook_id);
    const taskId = stringValue(start.task_id);
    if (!notebookId) throw new Error("NotebookLM MCP research_start did not return notebook_id");

    const status = normalizeMcpToolPayload(
      await session.callTool("research_status", {
        notebook_id: notebookId,
        task_id: taskId || undefined,
        query: request.topic,
        auto_import: true,
        compact: false,
        max_wait: request.notebooklmMaxWait,
        poll_interval: 15,
      }),
    );
    assertNotebookLmSuccess(status, "research_status");

    return {
      name: "notebooklm",
      mode: "mcp",
      metadata: {
        notebookId,
        taskId: stringValue(status.task_id) || taskId || null,
        status: status.status || null,
        sourcesFound: status.sources_found ?? null,
        importedCount: status.imported_count ?? null,
        command: request.notebooklmMcpCommand,
        researchMode: request.notebooklmMode,
      },
      content: renderNotebookLmContent(start, status),
    };
  } finally {
    session.stop();
  }
}

function createMcpSession(command, timeoutMs) {
  let child = null;
  let stdout = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  function start() {
    return new Promise((resolve, reject) => {
      child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"], env: shellEnv() });
      const timer = setTimeout(() => reject(new Error(`NotebookLM MCP did not initialize: ${command}`)), 30000);
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
        drainStdout();
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`NotebookLM MCP failed to start: ${error.message}`));
      });
      child.on("close", (code) => {
        const error = new Error(`NotebookLM MCP exited (${code}): ${stderr.trim() || command}`);
        for (const { reject: rejectPending } of pending.values()) rejectPending(error);
        pending.clear();
      });

      send("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "reallygood-research", version: "0.1.5" },
      })
        .then(() => {
          clearTimeout(timer);
          write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
          resolve();
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  function callTool(name, args) {
    return send("tools/call", { name, arguments: removeUndefined(args) });
  }

  function send(method, params) {
    if (!child) return Promise.reject(new Error("NotebookLM MCP session is not started"));
    const id = nextId;
    nextId += 1;
    let reject;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`NotebookLM MCP timed out during ${method}: ${stderr.trim() || command}`));
    }, timeoutMs);
    const promise = new Promise((resolve, rejectPromise) => {
      reject = rejectPromise;
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          rejectPromise(error);
        },
      });
    });
    write({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  function write(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function drainStdout() {
    let newline = stdout.indexOf("\n");
    while (newline !== -1) {
      const line = stdout.slice(0, newline).trim();
      stdout = stdout.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const waiting = pending.get(message.id);
          if (waiting) {
            pending.delete(message.id);
            if (message.error) waiting.reject(new Error(message.error.message || JSON.stringify(message.error)));
            else waiting.resolve(message.result);
          }
        } catch {
          stderr += `\n${line}`;
        }
      }
      newline = stdout.indexOf("\n");
    }
  }

  function stop() {
    if (child && !child.killed) child.kill("SIGTERM");
  }

  return { start, callTool, stop };
}

function normalizeMcpToolPayload(result) {
  if (result?.structuredContent && Object.keys(result.structuredContent).length) return result.structuredContent;
  const text = Array.isArray(result?.content)
    ? result.content.map((item) => (item?.type === "text" ? item.text : "")).join("\n").trim()
    : "";
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return { status: "success", text };
    }
  }
  return result || {};
}

function assertNotebookLmSuccess(payload, tool) {
  if (payload?.status === "error") {
    const hint = payload.hint ? ` Hint: ${payload.hint}` : "";
    throw new Error(`NotebookLM MCP ${tool} failed: ${payload.error || payload.message || "unknown error"}${hint}`);
  }
}

function renderNotebookLmContent(start, status) {
  const lines = [];
  if (status.report) lines.push(String(status.report).trim(), "");
  if (status.message) lines.push(`Message: ${status.message}`, "");
  const sources = Array.isArray(status.sources) ? status.sources : [];
  if (sources.length) {
    lines.push("Sources:");
    for (const [index, source] of sources.entries()) {
      const title = source?.title || source?.url || `Source ${index + 1}`;
      const url = source?.url ? ` - ${source.url}` : "";
      lines.push(`- ${title}${url}`);
    }
  }
  if (!lines.length) lines.push(start.message || "NotebookLM research completed without a report payload.");
  return lines.join("\n").trim();
}

async function runTavilyProvider(request) {
  const payload = await tavilySearch({
    query: request.topic,
    searchDepth: request.searchDepth,
    maxResults: request.maxResults,
    chunksPerSource: request.chunksPerSource,
    includeAnswer: request.includeAnswer,
    tavilyKeyless: request.tavilyKeyless,
    envFile: request.envFile,
  });
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    name: "tavily",
    mode: request.tavilyKeyless ? "keyless" : "live",
    metadata: {
      topic: request.topic,
      resultCount: results.length,
      requestId: payload.request_id || null,
      credits: payload.usage?.credits ?? null,
      searchDepth: request.searchDepth,
    },
    content: renderTavilyContent(payload, results),
  };
}

async function tavilySearch(input) {
  const query = stringValue(input?.query);
  if (!query) throw new Error("Missing required option: query");
  await loadEnvFile(stringValue(input.envFile) || defaultEnvFile());
  const headers = { "Content-Type": "application/json" };
  if (input.tavilyKeyless) {
    headers["X-Tavily-Access-Mode"] = "keyless";
  } else if (process.env.TAVILY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TAVILY_API_KEY}`;
  } else {
    throw new Error("Tavily provider requires TAVILY_API_KEY or Tavily keyless; rerun with Mock mode for local mock mode");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      search_depth: stringValue(input.searchDepth) || "advanced",
      max_results: numberValue(input.maxResults, 5),
      chunks_per_source: numberValue(input.chunksPerSource, 3),
      include_answer: input.includeAnswer === undefined ? true : Boolean(input.includeAnswer),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}): ${payload.error || payload.message || response.statusText}`);
  }
  return payload;
}

async function runAiSynthesis(request, providerResults) {
  if (request.mock || request.aiProvider === "none") return null;
  const context = providerResults
    .map((result) => `## ${result.name}\nmode: ${result.mode}\nmetadata: ${JSON.stringify(result.metadata)}\n\n${result.content}`)
    .join("\n\n");
  const prompt = [
    "You are writing a concise Korean research report from supplied research context.",
    "Do not invent facts beyond the supplied context. Preserve source URLs and caveats.",
    "",
    `Topic: ${request.topic}`,
    "Research provider context:",
    context,
    "",
    "Write sections: 핵심 결론, 근거, 리스크/불확실성, 다음 액션.",
  ].join("\n\n");
  const command = resolveAiCommand(request.aiProvider, request.aiCommand);
  const content = await runAiCommand(command, prompt);
  return { provider: request.aiProvider, command, content: content.trim() };
}

async function runAiSynthesisSafely(request, providerResults) {
  try {
    return await runAiSynthesis(request, providerResults);
  } catch (error) {
    return {
      provider: request.aiProvider,
      command: resolveAiCommand(request.aiProvider, request.aiCommand),
      error: error instanceof Error ? error.message : String(error),
      content: "",
    };
  }
}

function resolveAiCommand(provider, aiCommand) {
  if (aiCommand) return aiCommand;
  const config = AI_CLI_PROVIDERS[provider];
  if (!config) throw new Error(`Unsupported AI provider: ${provider}. Set AI CLI command for a custom local CLI.`);
  const executable = findExecutable(config.names) || config.names[0];
  return `${quoteShell(executable)} ${config.args}`;
}

function runAiCommand(command, prompt) {
  return runShellCommand(command, prompt, 180000);
}

function runShellCommand(command, stdin = "", timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: shellPath(), stdio: ["pipe", "pipe", "pipe"], env: shellEnv() });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Command failed (${code}): ${stderr || stdout || command}`));
    });
    child.stdin.end(stdin);
  });
}

function runShellCommandUntil(command, successPattern, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: shellPath(), stdio: ["pipe", "pipe", "pipe"], env: shellEnv() });
    let output = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child.killed) child.kill("SIGTERM");
      if (error) reject(error);
      else resolve(output);
    };
    const timer = setTimeout(() => finish(new Error(`Command timed out: ${command}`)), timeoutMs);
    const collect = (chunk) => {
      output += String(chunk);
      if (successPattern.test(output)) finish();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", finish);
    child.on("close", (code) => {
      if (settled) return;
      if (code === 0 || successPattern.test(output)) finish();
      else finish(new Error(`Command failed (${code}): ${output || command}`));
    });
    child.stdin.end("");
  });
}

function renderMarkdown(request, providerResults, now, synthesis) {
  const lines = [
    "---",
    `topic: ${yamlString(request.topic)}`,
    `agent: ${yamlString(request.agent)}`,
    `mock: ${request.mock}`,
    `createdAt: ${yamlString(now.toISOString())}`,
    "providers:",
    ...providerResults.map((provider) => `  - provider: ${provider.name}`),
    "---",
    "",
    `# ${request.topic}`,
    "",
    `Agent: ${request.agent}`,
    "",
  ];

  if (synthesis?.content) {
    lines.push("## AI Synthesis", "", `provider: ${synthesis.provider}`, `command: ${synthesis.command}`, "", synthesis.content, "");
  } else if (synthesis?.error) {
    lines.push("## AI Synthesis", "", `provider: ${synthesis.provider}`, `command: ${synthesis.command}`, `error: ${synthesis.error}`, "");
  }

  for (const provider of providerResults) {
    lines.push(
      `## ${provider.name}`,
      "",
      `provider: ${provider.name}`,
      `mode: ${provider.mode}`,
      `metadata: ${JSON.stringify(provider.metadata)}`,
      "",
      provider.content,
      "",
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function renderHtml(request, markdown) {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    `  <title>${escapeHtml(request.topic)}</title>`,
    "</head>",
    "<body>",
    `  <pre>${escapeHtml(markdown)}</pre>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function renderTavilyContent(payload, results) {
  const lines = [];
  if (payload.answer) lines.push(payload.answer, "");
  for (const result of results) {
    lines.push(`- [${result.title || result.url}](${result.url})`);
    if (result.content) lines.push(`  ${String(result.content).replace(/\s+/g, " ").trim()}`);
  }
  return lines.join("\n").trim() || "No Tavily results returned.";
}

function mockProviderContent(name, topic) {
  const labels = {
    notebooklm: "Notebook-style synthesis",
    tavily: "Search-grounded brief",
  };
  return `${labels[name]} for ${topic}. No source file supplied.`;
}

function truncateTitle(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 120) || "ReallyGood Research";
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function saveTavilyApiKey(apiKey, envFile = defaultEnvFile()) {
  const key = stringValue(apiKey);
  if (!key) throw new Error("Missing Tavily API key");
  await saveEnvValues({ TAVILY_API_KEY: key }, envFile);
  process.env.TAVILY_API_KEY = key;
  return { envFile };
}

async function testTavilyApiKey(apiKey) {
  const key = stringValue(apiKey);
  if (!key) throw new Error("Missing Tavily API key");
  const response = await fetch("https://api.tavily.com/usage", {
    method: "GET",
    headers: { Authorization: `Bearer ${key}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Tavily API key test failed (${response.status}): ${payload.error || payload.message || response.statusText}`);
  }
  return payload;
}

async function saveEnvValues(values, envFile) {
  let existing = "";
  try {
    existing = await readFile(envFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const keys = new Set(Object.keys(values));
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => {
      const key = line.split("=", 1)[0]?.trim();
      return line.trim() && !keys.has(key);
    });
  for (const [key, value] of Object.entries(values)) {
    lines.push(`${key}=${quoteEnv(value)}`);
  }

  await mkdir(dirname(envFile), { recursive: true });
  await writeFile(envFile, `${lines.join("\n")}\n`, "utf8");
  await chmod(envFile, 0o600);
}

async function loadEnvFile(envFile = defaultEnvFile()) {
  let body = "";
  try {
    body = await readFile(envFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { envFile, loaded: false };
    throw error;
  }

  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = unquoteEnv(trimmed.slice(index + 1).trim());
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
  return { envFile, loaded: true };
}

function defaultEnvFile() {
  return join(process.env.HOME || process.cwd(), ".reallygood-research.env");
}

function normalizeProviders(providers) {
  if (Array.isArray(providers)) return providers.map((provider) => String(provider).trim()).filter(Boolean);
  if (typeof providers === "string") return providers.split(",").map((provider) => provider.trim()).filter(Boolean);
  throw new Error("Missing required option: providers");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function shellEnv() {
  return { ...process.env, PATH: mergePath(process.env.PATH) };
}

function mergePath(pathValue) {
  const seen = new Set();
  const paths = [];
  const add = (entry) => {
    const normalized = String(entry || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    paths.push(normalized);
  };
  for (const entry of String(pathValue || "").split(":")) add(entry);
  for (const entry of extraPathEntries()) add(entry);
  return paths.join(":");
}

function extraPathEntries() {
  const home = process.env.HOME || "";
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    ...listNodeVersionBins(),
  ];
}

function listNodeVersionBins() {
  const root = join(process.env.HOME || "", ".nvm", "versions", "node");
  try {
    return readdirSync(root).map((entry) => join(root, entry, "bin"));
  } catch {
    return [];
  }
}

function findExecutable(names) {
  const commandNames = Array.isArray(names) ? names : [names];
  const paths = mergePath(process.env.PATH).split(":").filter(Boolean);
  for (const entry of paths) {
    for (const name of commandNames) {
      const candidate = join(entry, name);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
      }
    }
  }
  return null;
}

function shellPath() {
  if (process.platform === "win32") return true;
  return existsSync("/bin/zsh") ? "/bin/zsh" : true;
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "research";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function quoteEnv(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unquoteEnv(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
  return value;
}
