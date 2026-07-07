#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { defaultEnvFile, runResearchPublish, saveTavilyApiKey, tavilyExtract, tavilySearch } from "../src/index.mjs";

const args = process.argv.slice(2);

try {
  const command = args.shift();
  if (command === "run") {
    await runCommand(args);
  } else if (command === "setup") {
    await setupCommand(args);
  } else if (command === "mcp") {
    await mcpCommand();
  } else {
    throw new Error(
        "Usage: reallygood-research <run|setup|mcp>\n" +
        "  run --topic <topic> --providers <list> --vault-dir <dir> [--html] [--mock] [--ai-provider <name>] [--ai-command <command>] [--notebooklm-mcp-command <command>]\n" +
        "  setup tavily [--env-path <path>]\n" +
        "  mcp",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function runCommand(tokens) {
  const result = await runResearchPublish(parseArgs(tokens));
  printResult(result);
}

async function setupCommand(tokens) {
  const target = tokens.shift();
  if (target !== "tavily") {
    throw new Error("Usage: reallygood-research setup tavily [--env-path <path>]");
  }

  const options = parseArgs(tokens);
  const envFile = options.envPath || defaultEnvFile();
  const rl = createInterface({ input, output });
  const apiKey = await rl.question("Tavily API key: ");
  rl.close();

  const result = await saveTavilyApiKey(apiKey, envFile);
  console.log(`Saved Tavily API key to ${result.envFile}`);
}

async function mcpCommand() {
  process.stdin.setEncoding("utf8");
  let buffer = "";

  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) await handleJsonRpc(line);
      newline = buffer.indexOf("\n");
    }
  }
}

async function handleJsonRpc(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (!("id" in message)) return;

  try {
    if (message.method === "initialize") {
      send(message.id, {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "reallygood-research", version: "0.1.19" },
      });
    } else if (message.method === "tools/list") {
      send(message.id, { tools: tools() });
    } else if (message.method === "tools/call") {
      send(message.id, await callTool(message.params));
    } else if (message.method === "ping") {
      send(message.id, {});
    } else {
      sendError(message.id, -32601, `Unknown method: ${message.method}`);
    }
  } catch (error) {
    sendError(message.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function callTool(params = {}) {
  const name = params.name;
  const args = params.arguments || {};
  if (name === "run_research") {
    const result = await runResearchPublish(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (name === "setup_tavily") {
    const result = await saveTavilyApiKey(args.apiKey, args.envFile || defaultEnvFile());
    return { content: [{ type: "text", text: `Saved Tavily API key to ${result.envFile}` }] };
  }
  if (name === "tavily_search") {
    const result = await tavilySearch(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  if (name === "tavily_extract") {
    const result = await tavilyExtract(args);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw new Error(`Unknown tool: ${name}`);
}

function tools() {
  return [
    {
      name: "run_research",
      description: "Run NotebookLM MCP and/or Tavily deep research and save Markdown plus optional HTML.",
      inputSchema: {
        type: "object",
        required: ["topic", "providers", "vaultDir"],
        properties: {
          topic: { type: "string" },
          providers: { type: "string", description: "Comma-separated providers: notebooklm,tavily" },
          vaultDir: { type: "string" },
          sourceFile: { type: "string" },
          agent: { type: "string" },
          html: { type: "boolean" },
          mock: { type: "boolean" },
          envFile: { type: "string" },
          searchDepth: { type: "string", enum: ["ultra-fast", "fast", "basic", "advanced"] },
          maxResults: { type: "number" },
          chunksPerSource: { type: "number" },
          includeAnswer: { type: "boolean" },
          aiProvider: { type: "string", enum: ["none", "codex", "claude", "gemini", "grok", "antigravity", "custom"] },
          aiCommand: { type: "string" },
          notebooklmMcpCommand: { type: "string", description: "Command that starts the NotebookLM MCP stdio server." },
          notebooklmMode: { type: "string", enum: ["fast", "deep"] },
          notebooklmMaxWait: { type: "number" },
        },
      },
    },
    {
      name: "setup_tavily",
      description: "Save a Tavily API key into the local ReallyGood Research env file.",
      inputSchema: {
        type: "object",
        required: ["apiKey"],
        properties: {
          apiKey: { type: "string" },
          envFile: { type: "string" },
        },
      },
    },
    {
      name: "tavily_search",
      description: "Search the web with Tavily Search using the configured Tavily API key.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          searchDepth: { type: "string", enum: ["ultra-fast", "fast", "basic", "advanced"] },
          maxResults: { type: "number" },
          chunksPerSource: { type: "number" },
          includeAnswer: { type: "boolean" },
          envFile: { type: "string" },
        },
      },
    },
    {
      name: "tavily_extract",
      description: "Extract clean content from one or more URLs with Tavily Extract using the configured Tavily API key.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          urls: { type: "array", items: { type: "string" } },
          extractDepth: { type: "string", enum: ["basic", "advanced"] },
          format: { type: "string", enum: ["markdown", "text"] },
          includeImages: { type: "boolean" },
          includeFavicon: { type: "boolean" },
          envFile: { type: "string" },
        },
      },
    },
  ];
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function printResult(result) {
  console.log(`Markdown: ${result.markdownPath}`);
  if (result.htmlPath) {
    console.log(`HTML: ${result.htmlPath}`);
  }
  console.log(`History: ${result.historyPath}`);
}

function parseArgs(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--tavily-keyless") {
      throw new Error("--tavily-keyless is no longer supported for research output. Save a Tavily API key with `reallygood-research setup tavily`.");
    }
    if (token === "--html" || token === "--mock") {
      options[toCamel(token.slice(2))] = true;
      continue;
    }
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = toCamel(token.slice(2));
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
