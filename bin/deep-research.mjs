#!/usr/bin/env node
import { runResearchPublish } from "../src/index.mjs";

const args = process.argv.slice(2);

try {
  const command = args.shift();
  if (command !== "run") {
    throw new Error("Usage: deep-research run --topic <topic> --providers <list> --vault-dir <dir> [--agent <name>] [--source-file <path>] [--html] [--mock] [--tavily-keyless]");
  }

  const options = parseArgs(args);
  const result = await runResearchPublish(options);
  console.log(`Markdown: ${result.markdownPath}`);
  if (result.htmlPath) {
    console.log(`HTML: ${result.htmlPath}`);
  }
  console.log(`History: ${result.historyPath}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArgs(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--html" || token === "--mock" || token === "--tavily-keyless") {
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
