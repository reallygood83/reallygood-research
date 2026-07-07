const { Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { isAbsolute, join } = require("node:path");

const DEFAULT_SETTINGS = {
  cliScript: "",
  providers: "notebooklm,tavily",
  vaultDir: ".",
  html: true,
  mock: true,
  tavilyKeyless: false,
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
        await navigator.clipboard.writeText(this.buildCommand("Research topic").join(" "));
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

  getCliScriptPath() {
    const configured = this.settings.cliScript.trim();
    return configured || join(this.getPluginDir(), "bin", "deep-research.mjs");
  }

  getOutputDir() {
    const dir = this.settings.vaultDir.trim() || DEFAULT_SETTINGS.vaultDir;
    return isAbsolute(dir) ? dir : join(this.getVaultBasePath(), dir);
  }

  buildCommand(topic) {
    const args = [
      quote(process.execPath),
      quote(this.getCliScriptPath()),
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
    return args;
  }

  runResearch(topic, onData) {
    const cliScript = this.getCliScriptPath();
    if (!existsSync(cliScript)) {
      throw new Error(`CLI script not found: ${cliScript}`);
    }

    const args = this.buildCommand(topic).slice(1).map(unquote);
    const child = spawn(process.execPath, args, {
      cwd: this.getVaultBasePath(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => onData(String(chunk)));
    child.stderr.on("data", (chunk) => onData(String(chunk)));

    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Research command exited with ${code}`));
      });
    });
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

    new Setting(containerEl)
      .setName("CLI script")
      .setDesc("Leave blank to use the bundled bin/deep-research.mjs installed by BRAT.")
      .addText((text) =>
        text
          .setPlaceholder("Bundled CLI")
          .setValue(this.plugin.settings.cliScript)
          .onChange(async (value) => {
            this.plugin.settings.cliScript = value.trim();
            await this.plugin.saveSettings();
          }),
      );

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
  }
}

function quote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function unquote(value) {
  return String(value).replace(/^"|"$/g, "").replaceAll('\\"', '"').replaceAll("\\\\", "\\");
}
