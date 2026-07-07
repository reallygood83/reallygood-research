import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { spawn } from "node:child_process";

const SUPPORTED_PROVIDERS = new Set(["notebooklm", "tavily"]);
const AI_CLI_PROVIDERS = {
  codex: { names: ["codex"], args: "exec -" },
  claude: { names: ["claude"], args: "-p" },
  gemini: { names: ["gemini"], args: "-p" },
  grok: { names: ["grok"], args: '-p "$(cat)"' },
  antigravity: { names: ["antigravity"], args: "-p" },
};

export const requestSchema = {
  required: ["topic", "providers", "vaultDir"],
  optional: ["agent", "sourceFile", "html", "mock", "tavilyKeyless", "envFile", "searchDepth", "maxResults", "chunksPerSource", "includeAnswer", "aiProvider", "aiCommand", "notebooklmMcpCommand", "notebooklmMode", "notebooklmMaxWait"],
  providers: [...SUPPORTED_PROVIDERS],
};

export function validateResearchRequest(input) {
  if (!input || typeof input !== "object") {
    throw new Error("Request must be an object");
  }

  const topic = stringValue(input.topic);
  if (!topic) {
    throw new Error("Missing required option: topic");
  }

  const vaultDir = stringValue(input.vaultDir);
  if (!vaultDir) {
    throw new Error("Missing required option: vaultDir");
  }

  const providers = normalizeProviders(input.providers);
  for (const provider of providers) {
    if (!SUPPORTED_PROVIDERS.has(provider)) {
      throw new Error(`Unsupported provider: ${provider}`);
    }
  }

  return {
    topic,
    providers,
    agent: stringValue(input.agent) || "codex",
    sourceFile: stringValue(input.sourceFile),
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

export async function runResearchPublish(input) {
  const request = validateResearchRequest(input);
  await loadEnvFile(request.envFile);
  const source = await readSource(request.sourceFile);
  const providerResults = await Promise.all(
    request.providers.map((provider) => runProvider(provider, request, source)),
  );
  const synthesis = await runAiSynthesisSafely(request, providerResults, source);

  const now = new Date();
  const slug = slugify(request.topic);
  const stamp = now.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  await mkdir(request.vaultDir, { recursive: true });

  const markdownPath = join(request.vaultDir, `${stamp}-${slug}.md`);
  const markdown = renderMarkdown(request, providerResults, source, now, synthesis);
  await writeFile(markdownPath, markdown, "utf8");

  let htmlPath = null;
  if (request.html) {
    htmlPath = join(request.vaultDir, `${stamp}-${slug}.html`);
    await writeFile(htmlPath, renderHtml(request, markdown), "utf8");
  }

  const historyDir = join(request.vaultDir, ".deep-research-publisher");
  await mkdir(historyDir, { recursive: true });
  const historyPath = join(historyDir, `${stamp}-${slug}.json`);
  const history = {
    topic: request.topic,
    agent: request.agent,
    mock: request.mock,
    sourceFile: request.sourceFile || null,
    sourceName: request.sourceFile ? basename(request.sourceFile) : null,
    createdAt: now.toISOString(),
    providers: providerResults.map(({ name, mode, metadata }) => ({ name, mode, metadata })),
    synthesis: synthesis
      ? { provider: synthesis.provider, command: synthesis.command, error: synthesis.error || null }
      : null,
    outputs: { markdownPath, htmlPath },
  };
  await writeFile(historyPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");

  return {
    topic: request.topic,
    markdownPath,
    htmlPath,
    historyPath,
    providers: history.providers,
  };
}

export function defaultEnvFile() {
  return join(process.env.HOME || process.cwd(), ".reallygood-research.env");
}

export async function loadEnvFile(envFile = defaultEnvFile()) {
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
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return { envFile, loaded: true };
}

export async function saveTavilyApiKey(apiKey, envFile = defaultEnvFile()) {
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

function normalizeProviders(providers) {
  if (Array.isArray(providers)) {
    return providers.map((provider) => String(provider).trim()).filter(Boolean);
  }
  if (typeof providers === "string") {
    return providers.split(",").map((provider) => provider.trim()).filter(Boolean);
  }
  throw new Error("Missing required option: providers");
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function readSource(sourceFile) {
  if (!sourceFile) {
    return "";
  }
  return readFile(sourceFile, "utf8");
}

async function runProvider(name, request, source) {
  if (!request.mock) {
    if (name === "tavily") {
      return runTavilyProvider(request);
    }
    if (name === "notebooklm") {
      return runNotebookLmProvider(request);
    }
    throw new Error(`Provider ${name} requires an integration; rerun with --mock for local mock mode`);
  }

  return {
    name,
    mode: "mock",
    metadata: {
      topic: request.topic,
      agent: request.agent,
      sourceBytes: Buffer.byteLength(source, "utf8"),
    },
    content: mockProviderContent(name, request.topic, source),
  };
}

async function runNotebookLmProvider(request) {
  const session = createMcpSession(request.notebooklmMcpCommand, request.notebooklmMaxWait * 1000 + 30000);
  try {
    await session.start();
    const title = truncateTitle(`ReallyGood Research - ${request.topic}`);
    const start = normalizeMcpToolPayload(
      await session.callTool("research_start", {
        query: request.topic,
        source: "web",
        mode: request.notebooklmMode,
        title,
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
      child = spawn(command, { shell: shellPath(), stdio: ["pipe", "pipe", "pipe"], env: shellEnv() });
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
  if (result?.structuredContent && Object.keys(result.structuredContent).length) {
    return result.structuredContent;
  }
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

export async function tavilySearch(input) {
  const query = stringValue(input?.query);
  if (!query) throw new Error("Missing required option: query");
  await loadEnvFile(stringValue(input.envFile) || defaultEnvFile());
  const headers = { "Content-Type": "application/json" };
  if (input.tavilyKeyless) {
    headers["X-Tavily-Access-Mode"] = "keyless";
  } else if (process.env.TAVILY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TAVILY_API_KEY}`;
  } else {
    throw new Error("Tavily provider requires TAVILY_API_KEY or --tavily-keyless; rerun with --mock for local mock mode");
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

export async function tavilyExtract(input) {
  const urls = Array.isArray(input?.urls) ? input.urls.filter(Boolean) : [stringValue(input?.url)].filter(Boolean);
  if (!urls.length) throw new Error("Missing required option: url or urls");
  await loadEnvFile(stringValue(input.envFile) || defaultEnvFile());
  const headers = { "Content-Type": "application/json" };
  if (input.tavilyKeyless) {
    headers["X-Tavily-Access-Mode"] = "keyless";
  } else if (process.env.TAVILY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TAVILY_API_KEY}`;
  } else {
    throw new Error("Tavily extract requires TAVILY_API_KEY or tavilyKeyless=true");
  }

  const response = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers,
    body: JSON.stringify({
      urls,
      extract_depth: stringValue(input.extractDepth) || "basic",
      format: stringValue(input.format) || "markdown",
      include_images: Boolean(input.includeImages),
      include_favicon: Boolean(input.includeFavicon),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Tavily extract failed (${response.status}): ${payload.error || payload.message || response.statusText}`);
  }
  return payload;
}

async function runAiSynthesis(request, providerResults, source) {
  if (request.mock || request.aiProvider === "none") return null;
  const provider = request.aiProvider;
  if (provider === "none") return null;
  const context = providerResults
    .map((result) => `## ${result.name}\nmode: ${result.mode}\nmetadata: ${JSON.stringify(result.metadata)}\n\n${result.content}`)
    .join("\n\n");
  const prompt = [
    "You are writing a concise Korean research report from supplied research context.",
    "Do not invent facts beyond the supplied context. Preserve source URLs and caveats.",
    "",
    `Topic: ${request.topic}`,
    source ? `User source:\n${source}` : "",
    "Research provider context:",
    context,
    "",
    "Write sections: 핵심 결론, 근거, 리스크/불확실성, 다음 액션.",
  ]
    .filter(Boolean)
    .join("\n\n");
  const command = await resolveAiCommand(provider, request.aiCommand);
  const content = await runAiCommand(command, prompt);

  return {
    provider,
    command,
    content: content.trim(),
  };
}

async function runAiSynthesisSafely(request, providerResults, source) {
  try {
    return await runAiSynthesis(request, providerResults, source);
  } catch (error) {
    return {
      provider: request.aiProvider,
      command: await resolveAiCommand(request.aiProvider, request.aiCommand),
      error: error instanceof Error ? error.message : String(error),
      content: "",
    };
  }
}

async function resolveAiCommand(provider, aiCommand) {
  if (aiCommand) return aiCommand;
  const config = AI_CLI_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unsupported AI provider: ${provider}. Set aiCommand for a custom local CLI.`);
  }
  const executable = await findExecutable(config.names) || config.names[0];
  return `${quoteShell(executable)} ${config.args}`;
}

async function findExecutable(names) {
  const commandNames = Array.isArray(names) ? names : [names];
  const paths = (await mergePath(process.env.PATH)).split(":").filter(Boolean);
  for (const entry of paths) {
    for (const name of commandNames) {
      const candidate = join(entry, name);
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {
      }
    }
  }
  return null;
}

function shellEnv() {
  return { ...process.env, PATH: mergePathSync(process.env.PATH) };
}

function mergePathSync(pathValue) {
  const home = process.env.HOME || "";
  return uniquePathEntries([
    ...String(pathValue || "").split(":"),
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
  ]).join(":");
}

async function mergePath(pathValue) {
  return uniquePathEntries([
    ...mergePathSync(pathValue).split(":"),
    ...(await listNodeVersionBins()),
  ]).join(":");
}

async function listNodeVersionBins() {
  const root = join(process.env.HOME || "", ".nvm", "versions", "node");
  try {
    return (await readdir(root)).map((entry) => join(root, entry, "bin"));
  } catch {
    return [];
  }
}

function uniquePathEntries(entries) {
  const seen = new Set();
  const paths = [];
  for (const entry of entries) {
    const normalized = String(entry || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    paths.push(normalized);
  }
  return paths;
}

function shellPath() {
  if (process.platform === "win32") return true;
  return "/bin/zsh";
}

function quoteShell(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runAiCommand(command, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: shellPath(),
      stdio: ["pipe", "pipe", "pipe"],
      env: shellEnv(),
    });
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

function renderTavilyContent(payload, results) {
  const lines = [];
  if (payload.answer) {
    lines.push("### Tavily Answer", "", truncateText(payload.answer, 800), "");
  }

  if (results.length) lines.push("### Web Sources", "");
  for (const result of results) {
    lines.push(`- [${truncateText(result.title || result.url, 120)}](${result.url})`);
    const snippet = truncateText(result.content || result.raw_content || "", 360);
    if (snippet) lines.push(`  - ${snippet}`);
  }

  return lines.join("\n").trim() || "No Tavily results returned.";
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3).trim()}...` : text;
}

function mockProviderContent(name, topic, source) {
  const sourceLine = source ? `Source supplied (${Buffer.byteLength(source, "utf8")} bytes).` : "No source file supplied.";
  const labels = {
    notebooklm: "Notebook-style synthesis",
    tavily: "Search-grounded brief",
  };
  return `${labels[name]} for ${topic}. ${sourceLine}`;
}

function truncateTitle(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 120) || "ReallyGood Research";
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function renderMarkdown(request, providerResults, source, now, synthesis) {
  const lines = [
    "---",
    `title: ${yamlString(request.topic)}`,
    "aliases:",
    `  - ${yamlString(request.topic)}`,
    "tags:",
    "  - research",
    "  - reallygood-research",
    `type: ${yamlString("research-note")}`,
    `status: ${yamlString(researchStatus(synthesis))}`,
    `created: ${yamlString(now.toISOString())}`,
    `agent: ${yamlString(request.agent)}`,
    `research_mode: ${yamlString(describeResearchMode(providerResults, synthesis))}`,
    `html_export: ${request.html}`,
    `mock: ${request.mock}`,
    "providers:",
    ...providerResults.map((provider) => `  - ${yamlString(provider.name)}`),
    "---",
    "",
    `# ${request.topic}`,
    "",
    "> [!summary] Research status",
    `> Mode: ${describeResearchMode(providerResults, synthesis)}`,
    `> Providers: ${providerResults.map((provider) => `${provider.name} (${provider.mode})`).join(", ") || "none"}`,
    `> AI synthesis: ${synthesis?.content ? `completed by ${synthesis.provider}` : synthesis?.error ? `failed by ${synthesis.provider}` : "not used"}`,
    "",
  ];

  if (source) {
    lines.push("## Source", "", source.trim(), "");
  }

  if (synthesis?.content) {
    lines.push("## AI Synthesis", "", `> [!success] ${synthesis.provider}`, `> Command: \`${synthesis.command}\``, "", synthesis.content, "");
  } else if (synthesis?.error) {
    lines.push("## AI Synthesis", "", `> [!failure] ${synthesis.provider}`, `> Command: \`${synthesis.command}\``, `> Error: ${firstLine(synthesis.error)}`, "");
  }

  for (const provider of providerResults) {
    lines.push(
      `## ${provider.name} Results`,
      "",
      `> [!info] Provider metadata`,
      `> Mode: ${provider.mode}`,
      `> Results: ${provider.metadata?.resultCount ?? provider.metadata?.sourcesFound ?? "n/a"}`,
      `> Request: ${provider.metadata?.requestId || provider.metadata?.taskId || provider.metadata?.notebookId || "n/a"}`,
      "",
      provider.content,
      "",
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function researchStatus(synthesis) {
  if (synthesis?.content) return "synthesized";
  if (synthesis?.error) return "synthesis-failed";
  return "collected";
}

function describeResearchMode(providerResults, synthesis) {
  const providers = providerResults.map((provider) => provider.name);
  if (providers.includes("notebooklm")) return "NotebookLM deep research";
  if (providers.includes("tavily")) return synthesis?.content ? "Tavily search + AI synthesis" : "Tavily search";
  return "research";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/, 1)[0];
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
