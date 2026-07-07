const { Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { isAbsolute, join } = require("node:path");
const { pathToFileURL } = require("node:url");

const DEFAULT_SETTINGS = {
  providers: "notebooklm,tavily",
  vaultDir: ".",
  html: true,
  mock: true,
  tavilyKeyless: false,
  aiProvider: "none",
  aiCommand: "",
};

module.exports = class ReallyGoodResearchPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

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

  getCoreModuleUrl() {
    return pathToFileURL(join(this.getPluginDir(), "src", "index.mjs")).href;
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
    };
  }

  async saveTavilyApiKey(apiKey) {
    const { saveTavilyApiKey } = await import(this.getCoreModuleUrl());
    return saveTavilyApiKey(apiKey);
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
    return args.join(" ");
  }

  async runResearch(topic, onData) {
    const { runResearchPublish } = await import(this.getCoreModuleUrl());
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
    contentEl.createEl("h2", { text: "ReallyGood Research" });

    new Setting(contentEl)
      .setName("Topic")
      .setDesc("Research question or brief.")
      .addTextArea((text) =>
        text
          .setPlaceholder("Agentic AI가 vertical AI 산업에 미칠 영향")
          .onChange((value) => {
            this.topic = value.trim();
          }),
      );

    new Setting(contentEl)
      .setName("Providers")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.providers)
          .onChange(async (value) => {
            this.plugin.settings.providers = value.trim() || DEFAULT_SETTINGS.providers;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(contentEl)
      .setName("Export HTML")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.html).onChange(async (value) => {
          this.plugin.settings.html = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(contentEl)
      .setName("Mock mode")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.mock).onChange(async (value) => {
          this.plugin.settings.mock = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(contentEl)
      .setName("Tavily keyless")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.tavilyKeyless).onChange(async (value) => {
          this.plugin.settings.tavilyKeyless = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(contentEl)
      .setName("AI provider")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("none", "None")
          .addOption("codex", "Codex CLI")
          .addOption("claude", "Claude Code CLI")
          .addOption("gemini", "Gemini CLI")
          .addOption("grok", "Grok CLI")
          .addOption("custom", "Custom CLI")
          .setValue(this.plugin.settings.aiProvider || DEFAULT_SETTINGS.aiProvider)
          .onChange(async (value) => {
            this.plugin.settings.aiProvider = value;
            await this.plugin.saveSettings();
          }),
      );

    const logEl = contentEl.createEl("pre", { cls: "reallygood-research-log" });

    new Setting(contentEl).addButton((button) =>
      button
        .setButtonText("Start")
        .setCta()
        .onClick(async () => {
          if (!this.topic) {
            new Notice("Enter a research topic first.");
            return;
          }

          button.setDisabled(true);
          logEl.setText("Running...\n");

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
      .setDesc("Comma-separated: notebooklm,tavily,odysseus.")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.providers)
          .onChange(async (value) => {
            this.plugin.settings.providers = value.trim() || DEFAULT_SETTINGS.providers;
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
            tavilyApiKey = "";
            new Notice(`Saved Tavily API key to ${result.envFile}`);
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
