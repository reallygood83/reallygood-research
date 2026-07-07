import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const SUPPORTED_PROVIDERS = new Set(["notebooklm", "tavily", "odysseus"]);

export const requestSchema = {
  required: ["topic", "providers", "vaultDir"],
  optional: ["agent", "sourceFile", "html", "mock", "tavilyKeyless"],
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
  };
}

export async function runResearchPublish(input) {
  const request = validateResearchRequest(input);
  const source = await readSource(request.sourceFile);
  const providerResults = await Promise.all(
    request.providers.map((provider) => runProvider(provider, request, source)),
  );

  const now = new Date();
  const slug = slugify(request.topic);
  const stamp = now.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  await mkdir(request.vaultDir, { recursive: true });

  const markdownPath = join(request.vaultDir, `${stamp}-${slug}.md`);
  const markdown = renderMarkdown(request, providerResults, source, now);
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

async function runTavilyProvider(request) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.TAVILY_API_KEY) {
    headers.Authorization = `Bearer ${process.env.TAVILY_API_KEY}`;
  } else if (request.tavilyKeyless) {
    headers["X-Tavily-Access-Mode"] = "keyless";
  } else {
    throw new Error("Tavily provider requires TAVILY_API_KEY or --tavily-keyless; rerun with --mock for local mock mode");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers,
    body: JSON.stringify({
      query: request.topic,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Tavily search failed (${response.status}): ${payload.error || payload.message || response.statusText}`);
  }

  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    name: "tavily",
    mode: process.env.TAVILY_API_KEY ? "live" : "keyless",
    metadata: {
      topic: request.topic,
      resultCount: results.length,
      requestId: payload.request_id || null,
      credits: payload.usage?.credits ?? null,
    },
    content: renderTavilyContent(payload, results),
  };
}

function renderTavilyContent(payload, results) {
  const lines = [];
  if (payload.answer) {
    lines.push(payload.answer, "");
  }

  for (const result of results) {
    lines.push(`- [${result.title || result.url}](${result.url})`);
    if (result.content) {
      lines.push(`  ${String(result.content).replace(/\s+/g, " ").trim()}`);
    }
  }

  return lines.join("\n").trim() || "No Tavily results returned.";
}

function mockProviderContent(name, topic, source) {
  const sourceLine = source ? `Source supplied (${Buffer.byteLength(source, "utf8")} bytes).` : "No source file supplied.";
  const labels = {
    notebooklm: "Notebook-style synthesis",
    tavily: "Search-grounded brief",
    odysseus: "Long-form reasoning brief",
  };
  return `${labels[name]} for ${topic}. ${sourceLine}`;
}

function renderMarkdown(request, providerResults, source, now) {
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

  if (source) {
    lines.push("## Source", "", source.trim(), "");
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
