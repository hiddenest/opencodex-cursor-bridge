import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { managedPrefix, opencodexConfigFile, opencodexServiceTokenFile } from "./paths.mjs";

export const allowedEfforts = ["low", "medium", "high", "xhigh", "max"];
export const effortLabels = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

export function opencodexEndpoint() {
  let config = {};
  try {
    config = JSON.parse(execFileSync("/bin/cat", [opencodexConfigFile], { encoding: "utf8" }));
  } catch {}
  const port = Number(config.port || 10100);
  const configuredHost = String(config.hostname || "127.0.0.1");
  const host = configuredHost === "0.0.0.0" || configuredHost === "::" ? "127.0.0.1" : configuredHost;
  return { host, port };
}

export function aliasFor(sourceId) {
  return sourceId.startsWith("anthropic/claude-")
    ? `${managedPrefix}${sourceId.slice("anthropic/".length)}`
    : `${managedPrefix}${sourceId}`;
}

export function inferredEfforts(sourceId) {
  const modelId = sourceId.split("/").at(-1);
  if (/^claude-(?:fable-5|sonnet-5|opus-(?:5|4-[78]))$/.test(modelId)) return [...allowedEfforts];
  if (/^claude-(?:opus-4-6|sonnet-4-6)$/.test(modelId)) return ["low", "medium", "high", "max"];
  if (/^gpt-5\.6-(?:luna|sol|terra)$/.test(modelId)) return [...allowedEfforts];
  if (/^gpt-5\.[45](?:$|-)/.test(modelId)) return ["low", "medium", "high", "xhigh"];
  return [];
}

export function sanitizeEfforts(sourceId, configured) {
  const values = Array.isArray(configured) ? configured : inferredEfforts(sourceId);
  return allowedEfforts.filter((effort) => values.includes(effort));
}

export function normalizeActiveCatalog(configured, active) {
  const configuredById = new Map(configured
    .filter((model) => typeof model.provider === "string" && typeof model.model === "string")
    .map((model) => [`${model.provider}/${model.model}`, model]));
  const models = new Map();

  for (const model of active) {
    if (typeof model?.id !== "string" || model.owned_by === "opencodex" || model.id.startsWith("cursor/")) continue;
    const configuredModel = configuredById.get(model.id);
    const provider = model.id.includes("/") ? model.id.split("/", 1)[0] : String(model.owned_by || "openai").toLowerCase();
    const inputModalities = Array.isArray(configuredModel?.inputModalities)
      ? configuredModel.inputModalities
      : Array.isArray(model.capabilities?.input_modalities)
        ? model.capabilities.input_modalities
        : ["text", "image"];
    models.set(model.id, {
      alias: aliasFor(model.id),
      sourceId: model.id,
      provider,
      contextWindow: Number.isFinite(configuredModel?.contextWindow)
        ? configuredModel.contextWindow
        : model.capabilities?.context_length,
      maxOutputTokens: model.capabilities?.max_output_tokens,
      inputModalities,
      reasoningEfforts: sanitizeEfforts(model.id, configuredModel?.reasoningEfforts ?? model.capabilities?.reasoning_effort),
    });
  }

  return [...models.values()].sort((left, right) => left.alias.localeCompare(right.alias));
}

async function optionalServiceToken() {
  try {
    return (await readFile(opencodexServiceTokenFile, "utf8")).trim();
  } catch {
    return "";
  }
}

export function configuredModels(ocxBin = process.env.OCX_BIN || join(homedir(), ".local", "bin", "ocx")) {
  let executable = ocxBin;
  try {
    execFileSync(executable, ["--version"], { stdio: "ignore" });
  } catch {
    executable = "/opt/homebrew/bin/ocx";
  }
  const output = execFileSync(executable, ["models", "--json"], { encoding: "utf8" });
  const payload = JSON.parse(output);
  if (!Array.isArray(payload.models)) throw new Error("ocx models --json returned an invalid catalog");
  return payload.models;
}

export async function activeModels(fetchImpl = fetch) {
  const { host, port } = opencodexEndpoint();
  const token = await optionalServiceToken();
  const response = await fetchImpl(`http://${host}:${port}/v1/models`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`OpenCodex /v1/models returned HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.data)) throw new Error("OpenCodex /v1/models returned an invalid catalog");
  return payload.data;
}

export async function buildActiveCatalog(options = {}) {
  return normalizeActiveCatalog(
    configuredModels(options.ocxBin),
    await activeModels(options.fetchImpl),
  );
}
