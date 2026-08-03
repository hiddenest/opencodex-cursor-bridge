import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { effortLabels } from "./catalog.mjs";
import { cursorDatabaseFile, installRoot, managedPrefix, pendingFile } from "./paths.mjs";

const storageKey = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";
const displayWords = new Map([
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["composer", "Composer"],
  ["deepseek", "DeepSeek"],
  ["fable", "Fable"],
  ["fast", "Fast"],
  ["flash", "Flash"],
  ["gpt", "GPT"],
  ["grok", "Grok"],
  ["hy3", "HY3"],
  ["kimi", "Kimi"],
  ["luna", "Luna"],
  ["max", "Max"],
  ["mimo", "MiMo"],
  ["mini", "Mini"],
  ["opus", "Opus"],
  ["pro", "Pro"],
  ["qwen", "Qwen"],
  ["sol", "Sol"],
  ["sonnet", "Sonnet"],
  ["spark", "Spark"],
  ["terra", "Terra"],
]);

function displayWord(value) {
  const known = displayWords.get(value);
  if (known) return known;
  const attachedVersion = /^(qwen|kimi|gpt|claude|grok)(\d+(?:\.\d+)*)$/.exec(value);
  if (attachedVersion) return `${displayWords.get(attachedVersion[1])} ${attachedVersion[2]}`;
  if (/^v\d/i.test(value)) return `V${value.slice(1)}`;
  if (/^k\d/i.test(value)) return `K${value.slice(1)}`;
  if (/^\d/.test(value)) return value;
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function displayNameFor(model) {
  return model.sourceId.split("/").at(-1).split("-").map(displayWord).join(" ");
}

export function cursorIsRunning() {
  try {
    // Match the main binary only: orphaned crashpad helpers under Contents/ outlive the app.
    execFileSync("pgrep", ["-f", "/Applications/Cursor.app/Contents/MacOS/Cursor"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function defaultEffort(model) {
  const modelId = model.sourceId.split("/").at(-1);
  if (/^(?:gpt|gemini)-/.test(modelId) && model.reasoningEfforts.includes("medium")) return "medium";
  if (model.reasoningEfforts.includes("high")) return "high";
  if (model.reasoningEfforts.includes("medium")) return "medium";
  return model.reasoningEfforts[0];
}

function parameterIdFor(model) {
  return model.provider === "anthropic" ? "effort" : "reasoning";
}

function effortDefinition(model) {
  const parameterId = parameterIdFor(model);
  return {
    id: parameterId,
    name: "Effort",
    markdownTooltip: "Effort the model uses to generate its response.",
    parameterType: {
      enumParameter: {
        values: model.reasoningEfforts.map((value) => ({ value, displayName: effortLabels[value], modelPickerBadges: [] })),
      },
    },
    isCycleableByHotkey: true,
  };
}

function fastDefinition() {
  return {
    id: "fast",
    name: "Fast",
    markdownTooltip: "1.5x speed with increased usage.",
    parameterType: {
      booleanParameter: {
        values: [
          { value: "false" },
          { value: "true", displayName: "Fast", increasesModelCost: true },
        ],
      },
    },
    isCycleableByHotkey: false,
  };
}

function modelVariants(model) {
  const parameterId = parameterIdFor(model);
  const selectedDefault = defaultEffort(model);
  const modelDisplayName = displayNameFor(model);
  const efforts = model.reasoningEfforts.length > 0 ? model.reasoningEfforts : [null];
  const fastValues = model.supportsFast ? ["false", "true"] : [null];
  return efforts.flatMap((effort) => fastValues.map((fast) => {
    const labels = [effort ? effortLabels[effort] : null, fast === "true" ? "Fast" : null].filter(Boolean);
    const displayName = labels.length > 0
      ? `${modelDisplayName} <span style="color: var(--cursor-text-tertiary);">${labels.join(" ")}</span>`
      : modelDisplayName;
    const isDefault = (effort === null || effort === selectedDefault) && fast !== "true";
    const parameters = [
      ...(effort ? [{ id: parameterId, value: effort }] : []),
      ...(fast ? [{ id: "fast", value: fast }] : []),
    ];
    const suffix = [effort, fast === "true" ? "fast" : null].filter(Boolean).join("-");
    return {
      parameterValues: parameters,
      displayName,
      displayNameOutsidePicker: displayName,
      isMaxMode: false,
      ...(isDefault ? { isDefaultMaxConfig: true, isDefaultNonMaxConfig: true } : {}),
      variantStringRepresentation: `${model.alias}[${parameters.map(({ id, value }) => `${id}=${value}`).join(",")}]`,
      legacySlug: suffix ? `${model.alias}-${suffix}` : model.alias,
    };
  }));
}

export function cursorModel(model) {
  const hasEffort = model.reasoningEfforts.length > 0;
  const hasVariants = hasEffort || model.supportsFast;
  const variants = hasVariants ? modelVariants(model) : [];
  const displayName = displayNameFor(model);
  return {
    name: model.alias,
    clientDisplayName: displayName,
    defaultOn: false,
    supportsAgent: true,
    degradationStatus: 0,
    supportsThinking: hasEffort,
    supportsImages: model.inputModalities.includes("image"),
    supportsMaxMode: true,
    supportsNonMaxMode: true,
    serverModelName: model.alias,
    isRecommendedForBackgroundComposer: false,
    supportsPlanMode: true,
    supportsSandboxing: true,
    isUserAdded: true,
    inputboxShortModelName: displayName,
    idAliases: [],
    namedModelSectionIndex: 1,
    cloudAgentEffortModes: [],
    parameterDefinitions: [
      ...(hasEffort ? [effortDefinition(model)] : []),
      ...(model.supportsFast ? [fastDefinition()] : []),
    ],
    variants,
    legacySlugs: variants.map(({ legacySlug }) => legacySlug),
    modelPickerBadges: [],
  };
}

function syncSelectedModel(state, catalog) {
  const composer = state.aiSettings?.modelConfig?.composer;
  if (!composer || !Array.isArray(composer.selectedModels)) return;
  const byAlias = new Map(catalog.map((model) => [model.alias, model]));
  for (const selected of composer.selectedModels) {
    const model = byAlias.get(selected.modelId);
    if (!model || (model.reasoningEfforts.length === 0 && !model.supportsFast)) continue;
    const parameterId = parameterIdFor(model);
    const current = Array.isArray(selected.parameters) ? selected.parameters : [];
    const effort = current.find(({ id }) => id === parameterId)?.value;
    const fast = current.find(({ id }) => id === "fast")?.value;
    selected.parameters = [
      ...(model.reasoningEfforts.length > 0 ? [{
        id: parameterId,
        value: model.reasoningEfforts.includes(effort) ? effort : defaultEffort(model),
      }] : []),
      ...(model.supportsFast ? [{ id: "fast", value: fast === "true" ? "true" : "false" }] : []),
    ];
  }
}

export function applyCatalogToState(state, catalog) {
  const aliases = catalog.map(({ alias }) => alias);
  const keepUnmanaged = (value) => typeof value !== "string" || !value.startsWith(managedPrefix);
  const existingModels = Array.isArray(state.availableDefaultModels2) ? state.availableDefaultModels2 : [];
  state.availableDefaultModels2 = [
    ...existingModels.filter((model) => !(model?.isUserAdded && typeof model.name === "string" && model.name.startsWith(managedPrefix))),
    ...catalog.map(cursorModel),
  ];
  state.aiSettings ||= {};
  state.aiSettings.userAddedModels = [
    ...(Array.isArray(state.aiSettings.userAddedModels) ? state.aiSettings.userAddedModels.filter(keepUnmanaged) : []),
    ...aliases,
  ];
  state.aiSettings.modelOverrideEnabled = [
    ...(Array.isArray(state.aiSettings.modelOverrideEnabled) ? state.aiSettings.modelOverrideEnabled.filter(keepUnmanaged) : []),
    ...aliases,
  ];
  syncSelectedModel(state, catalog);
  return state;
}

export async function syncCursorDatabase(catalog, options = {}) {
  if (cursorIsRunning()) throw new Error("Quit Cursor before syncing OpenCodex models");
  const databasePath = options.databasePath || cursorDatabaseFile;
  const backupDirectory = options.backupDirectory || installRoot;
  await mkdir(backupDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  const row = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(storageKey);
  if (!row?.value) {
    database.close();
    throw new Error("Cursor application user storage was not found");
  }
  const state = applyCatalogToState(JSON.parse(row.value), catalog);
  let backupPath = null;
  if (options.createBackup !== false) {
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    backupPath = `${backupDirectory}/cursor-state-before-model-sync-${timestamp}.vscdb`;
    await backup(database, backupPath);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE ItemTable SET value = ? WHERE key = ?").run(JSON.stringify(state), storageKey);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  return {
    modelCount: catalog.length,
    effortCount: catalog.filter(({ reasoningEfforts }) => reasoningEfforts.length > 0).length,
    backupPath,
  };
}

export async function writePendingCatalog(catalog, file = pendingFile) {
  await mkdir(installRoot, { recursive: true });
  await writeFile(file, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
}

export async function readPendingCatalog(file = pendingFile) {
  try {
    const catalog = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(catalog) ? catalog : null;
  } catch {
    return null;
  }
}

export async function clearPendingCatalog(file = pendingFile) {
  await rm(file, { force: true });
}
