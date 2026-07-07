const { Modal, Notice, Plugin, PluginSettingTab, Setting } = require("obsidian");
const { chmod, mkdir, readFile, writeFile } = require("node:fs/promises");
const { dirname, isAbsolute, join } = require("node:path");
const { spawn } = require("node:child_process");

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

const SUPPORTED_PROVIDERS = new Set(["notebooklm", "tavily", "odysseus"]);

async function runResearchPublish(input) {
  const request = validateResearchRequest(input);
  await loadEnvFile(request.envFile);
  const providerResults = await Promise.all(
    request.providers.map((provider) => runProvider(provider, request)),
  );
  const synthesis = await runAiSynthesis(request, providerResults);

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
      synthesis: synthesis ? { provider: synthesis.provider, command: synthesis.command } : null,
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
  };
}

async function runProvider(name, request) {
  if (!request.mock) {
    if (name === "tavily") return runTavilyProvider(request);
    throw new Error(`Provider ${name} requires an integration; rerun with Mock mode for local mock mode`);
  }

  return {
    name,
    mode: "mock",
    metadata: { topic: request.topic, agent: request.agent },
    content: mockProviderContent(name, request.topic),
  };
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
    mode: process.env.TAVILY_API_KEY ? "live" : "keyless",
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
  if (process.env.TAVILY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TAVILY_API_KEY}`;
  } else if (input.tavilyKeyless) {
    headers["X-Tavily-Access-Mode"] = "keyless";
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

function resolveAiCommand(provider, aiCommand) {
  if (aiCommand) return aiCommand;
  const commands = {
    codex: "codex exec -",
    claude: "claude -p",
    gemini: "gemini -p",
    grok: 'grok -p "$(cat)"',
  };
  const command = commands[provider];
  if (!command) throw new Error(`Unsupported AI provider: ${provider}. Set AI CLI command for a custom local CLI.`);
  return command;
}

function runAiCommand(command, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["pipe", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`AI CLI timed out: ${command}`));
    }, 180000);
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
      else reject(new Error(`AI CLI failed (${code}): ${stderr || stdout || command}`));
    });
    child.stdin.end(prompt);
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
    odysseus: "Long-form reasoning brief",
  };
  return `${labels[name]} for ${topic}. No source file supplied.`;
}

async function saveTavilyApiKey(apiKey, envFile = defaultEnvFile()) {
  const key = stringValue(apiKey);
  if (!key) throw new Error("Missing Tavily API key");
  await saveEnvValues({ TAVILY_API_KEY: key }, envFile);
  process.env.TAVILY_API_KEY = key;
  return { envFile };
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
