import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  cursorBundleFiles,
  cursorGlassWorkbenchFile,
  cursorLocalRuntimeFiles,
  cursorPatchBackupDirectory,
  cursorWorkbenchFile,
} from "./paths.mjs";

export const cursorPatchMarker = "/*ocx-cursor-model-metadata-v5*/";
export const legacyCursorPatchMarker = "/*ocx-cursor-model-metadata*/";
export const cursorLocalModeDisabled = "localMode:!1";
export const cursorLocalModeEnabled = "localMode:!0";
export const cursorLocalRuntimePatchMarker = "/*ocx-cursor-local-model-display-v2*/";
export const legacyCursorLocalRuntimePatchMarker = "/*ocx-cursor-local-model-display*/";
export const cursorLocalRuntimeCapabilitiesPatchMarker = "/*ocx-cursor-local-model-capabilities-v3*/";
export const legacyCursorLocalRuntimeCapabilitiesPatchMarker = "/*ocx-cursor-local-model-capabilities-v2*/";

export function isCursorModelMetadataBundle(file) {
  return file === cursorWorkbenchFile || file === cursorGlassWorkbenchFile;
}

const catalogNormalization = /(?<normalization>\b(?<catalog>[A-Za-z_$][\w$]*)=\k<catalog>\.map\((?<item>[A-Za-z_$][\w$]*)=>(?<plain>[A-Za-z_$][\w$]*)\(\k<item>\)\)),(?=(?<batch>[A-Za-z_$][\w$]*)\(\(\)=>\{this\._reactiveStorageService\.setApplicationUserPersistentStorage\("availableDefaultModels2",\k<catalog>\))/g;
const previousCatalogInjection = /\/\*ocx-cursor-model-metadata(?:-v[234])?\*\/(?<catalog>[A-Za-z_$][\w$]*)=\k<catalog>\.map\(ocxCursorModel=>\{.*?\}\),(?=(?<batch>[A-Za-z_$][\w$]*)\(\(\)=>\{this\._reactiveStorageService\.setApplicationUserPersistentStorage\("availableDefaultModels2",\k<catalog>\))/g;
const localModelConstructor = /function (?<functionName>[A-Za-z_$][\w$]*)\(e,t\)\{return new (?<modelType>[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\(\{modelId:e,displayModelId:e,displayName:null!=t\?t:e,displayNameShort:null!=t\?t:e,aliases:\[\]\}\)\}/g;
const localRuntimeVisionCapability = /"boolean"==typeof (?<object>[A-Za-z_$][\w$]*)\.supports_vision\?\{supports_vision:\k<object>\.supports_vision\}:\{\}\)/g;
const localRuntimePickerInput = /toPickerInput\((?<model>[A-Za-z_$][\w$]*)\)\{var [A-Za-z_$][\w$]*;const [A-Za-z_$][\w$]*=this\.modelMetadataById\.get\(\k<model>\.modelId\),(?<capabilities>[A-Za-z_$][\w$]*)=.*?;return\{.*?supportsReasoning:[^,]+,supportsVision:/g;
const localRuntimeProviderPickerInput = /supportsReasoning:(?<reasoning>!0===\(null===\((?<capability>[A-Za-z_$][\w$]*)=(?<model>[A-Za-z_$][\w$]*)\.capabilities\)\|\|void 0===\k<capability>\?void 0:\k<capability>\.supports_reasoning\)),supportsVision:/g;
const localRuntimeRequestParameters = /function\((?<payload>[A-Za-z_$][\w$]*),(?<model>[A-Za-z_$][\w$]*),(?<parameters>[A-Za-z_$][\w$]*),(?<apiType>[A-Za-z_$][\w$]*),(?<route>[A-Za-z_$][\w$]*),(?<extended>[A-Za-z_$][\w$]*)=!1\)\{(?=const [A-Za-z_$][\w$]*=function\([A-Za-z_$][\w$]*\)\{var [A-Za-z_$][\w$]*;const [A-Za-z_$][\w$]*=.*?\["reasoning","effort","thought_level"\]\.includes)/g;
const localRuntimeBuilderExport = /buildBottlerocketPickerModels:\(\)=>(?<builder>[A-Za-z_$][\w$]*)/g;
const transientPatchErrorCodes = new Set(["EACCES", "EBUSY", "EPERM"]);

function replaceSingleMatch(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected one Cursor ${label}, found ${matches.length}`);
  const match = matches[0];
  const value = typeof replacement === "function" ? replacement(match) : replacement;
  return `${source.slice(0, match.index)}${value}${source.slice(match.index + match[0].length)}`;
}

function metadataInjection(catalog) {
  return `${cursorPatchMarker}${catalog}=${catalog}.map(ocxCursorModel=>{if(!ocxCursorModel.name.startsWith("opencodex/"))return ocxCursorModel;const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name);const ocxCursorDisplayWords={claude:"Claude",codex:"Codex",composer:"Composer",deepseek:"DeepSeek",fable:"Fable",fast:"Fast",flash:"Flash",gpt:"GPT",grok:"Grok",hy3:"HY3",kimi:"Kimi",luna:"Luna",max:"Max",mimo:"MiMo",mini:"Mini",opus:"Opus",pro:"Pro",qwen:"Qwen",sol:"Sol",sonnet:"Sonnet",spark:"Spark",terra:"Terra"};const ocxCursorDisplayName=ocxCursorStored?.clientDisplayName??((ocxCursorModel.name.startsWith("opencodex/cursor/")?"Cursor ":"")+ocxCursorModel.name.split("/").at(-1).split("-").map(ocxCursorWord=>{if(ocxCursorDisplayWords[ocxCursorWord])return ocxCursorDisplayWords[ocxCursorWord];const ocxCursorAttached=/^(qwen|kimi|gpt|claude|grok)(\\d+(?:\\.\\d+)*)$/.exec(ocxCursorWord);if(ocxCursorAttached)return ocxCursorDisplayWords[ocxCursorAttached[1]]+" "+ocxCursorAttached[2];if(/^v\\d/i.test(ocxCursorWord))return"V"+ocxCursorWord.slice(1);if(/^k\\d/i.test(ocxCursorWord))return"K"+ocxCursorWord.slice(1);if(/^\\d/.test(ocxCursorWord))return ocxCursorWord;return ocxCursorWord.slice(0,1).toUpperCase()+ocxCursorWord.slice(1)}).join(" "));const ocxCursorPrettyLabel=ocxCursorValue=>typeof ocxCursorValue==="string"?ocxCursorValue.split(ocxCursorModel.name).join(ocxCursorDisplayName):ocxCursorValue;const ocxCursorDefinitions=Array.isArray(ocxCursorModel.parameterDefinitions)&&ocxCursorModel.parameterDefinitions.length>0?ocxCursorModel.parameterDefinitions:ocxCursorStored?.parameterDefinitions??[];const ocxCursorVariantSource=Array.isArray(ocxCursorModel.variants)&&ocxCursorModel.variants.length>0?ocxCursorModel.variants:ocxCursorStored?.variants??[];const ocxCursorVariants=ocxCursorVariantSource.map(ocxCursorVariant=>({...ocxCursorVariant,displayName:ocxCursorPrettyLabel(ocxCursorVariant.displayName),displayNameOutsidePicker:ocxCursorPrettyLabel(ocxCursorVariant.displayNameOutsidePicker)}));const ocxCursorLegacySlugs=Array.isArray(ocxCursorModel.legacySlugs)&&ocxCursorModel.legacySlugs.length>0?ocxCursorModel.legacySlugs:ocxCursorStored?.legacySlugs??[];return{...ocxCursorModel,clientDisplayName:ocxCursorDisplayName,inputboxShortModelName:ocxCursorDisplayName,parameterDefinitions:ocxCursorDefinitions,variants:ocxCursorVariants,legacySlugs:ocxCursorLegacySlugs,supportsThinking:void 0!==ocxCursorModel.supportsThinking?ocxCursorModel.supportsThinking:ocxCursorStored?.supportsThinking}}),`;
}

export function patchCursorWorkbenchSource(source) {
  if (source.includes(cursorPatchMarker)) return { status: "already-patched", source };
  if (source.includes(legacyCursorPatchMarker) || source.includes("/*ocx-cursor-model-metadata-v2*/") || source.includes("/*ocx-cursor-model-metadata-v3*/") || source.includes("/*ocx-cursor-model-metadata-v4*/")) {
    const matches = [...source.matchAll(previousCatalogInjection)];
    if (matches.length !== 1) {
      throw new Error(`Expected one legacy Cursor model metadata hook, found ${matches.length}`);
    }
    const match = matches[0];
    const replacement = metadataInjection(match.groups.catalog);
    return {
      status: "patched",
      source: `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`,
    };
  }
  const matches = [...source.matchAll(catalogNormalization)];
  if (matches.length !== 1) {
    throw new Error(`Expected one Cursor model catalog storage hook, found ${matches.length}`);
  }
  const match = matches[0];
  const { normalization, catalog } = match.groups;
  const injection = `${normalization},${metadataInjection(catalog)}`;
  const patched = `${source.slice(0, match.index)}${injection}${source.slice(match.index + match[0].length)}`;
  return { status: "patched", source: patched };
}

export function patchCursorLocalModeSource(source) {
  const disabledCount = source.split(cursorLocalModeDisabled).length - 1;
  if (disabledCount > 1) {
    throw new Error(`Expected at most one disabled Cursor localMode flag, found ${disabledCount}`);
  }
  if (disabledCount === 1) {
    return {
      status: "patched",
      source: source.replace(cursorLocalModeDisabled, cursorLocalModeEnabled),
    };
  }
  if (source.includes(cursorLocalModeEnabled)) return { status: "already-patched", source };
  throw new Error("Cursor localMode build flag was not found");
}

export function patchCursorBundleSource(source, options = {}) {
  const localMode = patchCursorLocalModeSource(source);
  const metadata = options.preserveCatalogMetadata
    ? patchCursorWorkbenchSource(localMode.source)
    : { status: "already-patched", source: localMode.source };
  return {
    status: localMode.status === "patched" || metadata.status === "patched"
      ? "patched"
      : "already-patched",
    source: metadata.source,
  };
}

function patchCursorLocalRuntimeDisplayName(source) {
  if (source.includes(cursorLocalRuntimePatchMarker)) return source;
  if (source.includes(legacyCursorLocalRuntimePatchMarker)) {
    return source
      .replace(legacyCursorLocalRuntimePatchMarker, cursorLocalRuntimePatchMarker)
      .replace('e.startsWith("opencodex/")?e.split("/")', 'e.startsWith("opencodex/")?(e.startsWith("opencodex/cursor/")?"Cursor ":"")+e.split("/")');
  }
  const matches = [...source.matchAll(localModelConstructor)];
  if (matches.length !== 1) {
    throw new Error(`Expected one Cursor local model constructor, found ${matches.length}`);
  }
  const match = matches[0];
  const { functionName, modelType } = match.groups;
  const replacement = `function ${functionName}(e,t){${cursorLocalRuntimePatchMarker}const ocxCursorDisplayWords={claude:"Claude",codex:"Codex",composer:"Composer",deepseek:"DeepSeek",fable:"Fable",fast:"Fast",flash:"Flash",gpt:"GPT",grok:"Grok",hy3:"HY3",kimi:"Kimi",luna:"Luna",max:"Max",mimo:"MiMo",mini:"Mini",opus:"Opus",pro:"Pro",qwen:"Qwen",sol:"Sol",sonnet:"Sonnet",spark:"Spark",terra:"Terra"};const ocxCursorDisplayName=null!=t?t:e.startsWith("opencodex/")?(e.startsWith("opencodex/cursor/")?"Cursor ":"")+e.split("/").at(-1).split("-").map(ocxCursorWord=>{if(ocxCursorDisplayWords[ocxCursorWord])return ocxCursorDisplayWords[ocxCursorWord];const ocxCursorAttached=/^(qwen|kimi|gpt|claude|grok)(\\d+(?:\\.\\d+)*)$/.exec(ocxCursorWord);if(ocxCursorAttached)return ocxCursorDisplayWords[ocxCursorAttached[1]]+" "+ocxCursorAttached[2];if(/^v\\d/i.test(ocxCursorWord))return"V"+ocxCursorWord.slice(1);if(/^k\\d/i.test(ocxCursorWord))return"K"+ocxCursorWord.slice(1);if(/^\\d/.test(ocxCursorWord))return ocxCursorWord;return ocxCursorWord.slice(0,1).toUpperCase()+ocxCursorWord.slice(1)}).join(" "):e;return new ${modelType}({modelId:e,displayModelId:e,displayName:ocxCursorDisplayName,displayNameShort:ocxCursorDisplayName,aliases:[]})}`;
  return `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`;
}

function patchCursorLocalRuntimeCapabilities(source) {
  source = replaceSingleMatch(source, localRuntimeVisionCapability, (match) => {
    const object = match.groups.object;
    return `${match[0].slice(0, -1)},"boolean"==typeof ${object}.supports_fast?{supports_fast:${object}.supports_fast}:{})`;
  }, "local model capability parser");

  source = replaceSingleMatch(source, localRuntimePickerInput, (match) => {
    const capabilities = match.groups.capabilities;
    return match[0].replace(
      ",supportsVision:",
      `,reasoningEfforts:Array.isArray(${capabilities}?.reasoning_effort)?${capabilities}.reasoning_effort:void 0,supportsFast:!0===${capabilities}?.supports_fast,supportsVision:`,
    );
  }, "local picker input mapper");

  source = patchCursorLocalRuntimeProviderCapabilities(source);

  source = replaceSingleMatch(source, localRuntimeRequestParameters, (match) => {
    const { payload, parameters } = match.groups;
    return `${match[0]}const ocxCursorFast=${parameters}?.find(ocxCursorParameter=>ocxCursorParameter.id==="fast")?.value;if(ocxCursorFast==="true")${payload}.service_tier="priority";else if(ocxCursorFast==="false")delete ${payload}.service_tier;`;
  }, "local request parameter mapper");

  const exportMatches = [...source.matchAll(localRuntimeBuilderExport)];
  if (exportMatches.length !== 1) {
    throw new Error(`Expected one Cursor local picker builder export, found ${exportMatches.length}`);
  }
  const builderName = exportMatches[0].groups.builder;
  const builderStart = source.indexOf(`function ${builderName}(`, exportMatches[0].index);
  if (builderStart === -1) throw new Error("Cursor local picker builder was not found");
  const builderHead = source.slice(builderStart, builderStart + 1_000);
  const modelBuilderName = /\.push\((?<name>[A-Za-z_$][\w$]*)\(/.exec(builderHead)?.groups.name;
  if (!modelBuilderName) throw new Error("Cursor local picker model builder was not found");

  const modelBuilderStart = source.indexOf(`function ${modelBuilderName}(`, builderStart);
  const modelBuilderSource = source.slice(modelBuilderStart, modelBuilderStart + 6_000);
  const signature = new RegExp(`function ${modelBuilderName}\\((?<model>[A-Za-z_$][\\w$]*),(?<tier>[A-Za-z_$][\\w$]*)\\)\\{var [^;]+;const (?<effort>[A-Za-z_$][\\w$]*)=function\\((?<inner>[A-Za-z_$][\\w$]*)\\)\\{`).exec(modelBuilderSource);
  if (!signature) throw new Error("Cursor local picker model effort builder was not found");
  const { model, effort } = signature.groups;
  const effortPrefix = `const ${effort}=function(`;
  const effortIndex = modelBuilderSource.indexOf(effortPrefix);
  const effortReplacement = `const ${effort}=Array.isArray(${model}.reasoningEfforts)&&${model}.reasoningEfforts.length>0?{param:"reasoning_effort",values:${model}.reasoningEfforts,defaultValue:${model}.reasoningEfforts.includes("medium")?"medium":${model}.reasoningEfforts.includes("high")?"high":${model}.reasoningEfforts[0]}:function(`;
  let patchedBuilder = `${modelBuilderSource.slice(0, effortIndex)}${effortReplacement}${modelBuilderSource.slice(effortIndex + effortPrefix.length)}`;

  const definitions = new RegExp(`(?<name>[A-Za-z_$][\\w$]*)=\\[\\.\\.\\.void 0!==${effort}\\?`).exec(patchedBuilder)?.groups.name;
  const parameterClass = /new (?<name>[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\(\{id:"reasoning"/.exec(patchedBuilder)?.groups.name;
  if (!definitions || !parameterClass) throw new Error("Cursor local picker parameter definition builder was not found");
  const definitionsEnd = patchedBuilder.indexOf("];var ", patchedBuilder.indexOf(`${definitions}=[`));
  if (definitionsEnd === -1) throw new Error("Cursor local picker parameter definitions were not terminated");
  const fastDefinition = `];${model}.supportsFast&&${definitions}.push(new ${parameterClass}({id:"fast",name:"Fast",markdownTooltip:"Use priority processing with increased usage.",parameterType:{booleanParameter:{values:[{value:"false"},{value:"true",displayName:"Fast",increasesModelCost:!0}]}},isCycleableByHotkey:!1}))`;
  patchedBuilder = `${patchedBuilder.slice(0, definitionsEnd)}${fastDefinition}${patchedBuilder.slice(definitionsEnd + 1)}`;

  const variantMatch = new RegExp(`variants:(?<call>[A-Za-z_$][\\w$]*\\(${effort},(?<context>[A-Za-z_$][\\w$]*),(?<display>[A-Za-z_$][\\w$]*),(?<tier>[A-Za-z_$][\\w$]*)\\))`).exec(patchedBuilder);
  if (!variantMatch) throw new Error("Cursor local picker variant builder was not found");
  const variantReplacement = `variants:ocxCursorFastVariants(${variantMatch.groups.call},${model}.supportsFast,${variantMatch.groups.display})`;
  patchedBuilder = `${patchedBuilder.slice(0, variantMatch.index)}${variantReplacement}${patchedBuilder.slice(variantMatch.index + variantMatch[0].length)}`;

  source = `${source.slice(0, modelBuilderStart)}${patchedBuilder}${source.slice(modelBuilderStart + modelBuilderSource.length)}`;
  const helper = `${cursorLocalRuntimeCapabilitiesPatchMarker}function ocxCursorFastVariants(e,t,n){if(!t)return e;const r=e.length>0?e:[{parameterValues:[],displayName:n,displayNameOutsidePicker:n,isMaxMode:!1,isDefaultNonMaxConfig:!0,isDefaultMaxConfig:!0}];return r.flatMap(e=>[{...e,parameterValues:[...(e.parameterValues??[]),{id:"fast",value:"false"}]},{...e,parameterValues:[...(e.parameterValues??[]),{id:"fast",value:"true"}],displayName:e.displayName+" Fast",displayNameOutsidePicker:(e.displayNameOutsidePicker??e.displayName)+" Fast",isDefaultNonMaxConfig:!1,isDefaultMaxConfig:!1}])}`;
  return `${source.slice(0, builderStart)}${helper}${source.slice(builderStart)}`;
}

function patchCursorLocalRuntimeProviderCapabilities(source) {
  return replaceSingleMatch(source, localRuntimeProviderPickerInput, (match) => {
    const { model, reasoning } = match.groups;
    return `supportsReasoning:${reasoning},reasoningEfforts:Array.isArray(${model}.capabilities?.reasoning_effort)?${model}.capabilities.reasoning_effort:void 0,supportsFast:!0===${model}.capabilities?.supports_fast,supportsVision:`;
  }, "standalone local provider picker mapper");
}

export function patchCursorLocalRuntimeSource(source) {
  const displayPatched = patchCursorLocalRuntimeDisplayName(source);
  if (displayPatched.includes(cursorLocalRuntimeCapabilitiesPatchMarker)) {
    return { status: displayPatched === source ? "already-patched" : "patched", source: displayPatched };
  }
  if (displayPatched.includes(legacyCursorLocalRuntimeCapabilitiesPatchMarker)) {
    const upgraded = patchCursorLocalRuntimeProviderCapabilities(displayPatched).replace(
      legacyCursorLocalRuntimeCapabilitiesPatchMarker,
      cursorLocalRuntimeCapabilitiesPatchMarker,
    );
    return { status: "patched", source: upgraded };
  }
  return { status: "patched", source: patchCursorLocalRuntimeCapabilities(displayPatched) };
}

export async function cursorWorkbenchSignature(file = cursorWorkbenchFile) {
  const value = await stat(file);
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}`;
}

async function writePatchedFile(file, source, patched, backupDirectory) {
  if (patched.status === "already-patched") {
    return { status: patched.status, signature: await cursorWorkbenchSignature(file), backupPath: null };
  }

  await mkdir(backupDirectory, { recursive: true });
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const backupPath = join(backupDirectory, `${basename(file)}.${digest}.bak`);
  await copyFile(file, backupPath);

  const mode = (await stat(file)).mode & 0o777;
  const temporary = `${file}.ocx-cursor-${process.pid}`;
  await writeFile(temporary, patched.source, { mode });
  await chmod(temporary, mode);
  await rename(temporary, file);
  return { status: patched.status, signature: await cursorWorkbenchSignature(file), backupPath };
}

export async function ensureCursorWorkbenchPatched(options = {}) {
  const file = options.file || cursorWorkbenchFile;
  const backupDirectory = options.backupDirectory || cursorPatchBackupDirectory;
  const source = await readFile(file, "utf8");
  const patched = patchCursorBundleSource(source, {
    preserveCatalogMetadata: options.preserveCatalogMetadata ?? true,
  });
  return await writePatchedFile(file, source, patched, backupDirectory);
}

export async function ensureCursorLocalRuntimesPatched(options = {}) {
  const files = options.files || cursorLocalRuntimeFiles;
  const backupDirectory = options.backupDirectory || cursorPatchBackupDirectory;
  return await Promise.all(files.map(async (file) => {
    const source = await readFile(file, "utf8");
    return {
      file,
      ...await writePatchedFile(file, source, patchCursorLocalRuntimeSource(source), backupDirectory),
    };
  }));
}

export async function ensureCursorBundlesPatched(options = {}) {
  const files = options.files || cursorBundleFiles;
  return await Promise.all(files.map(async (file) => ({
    file,
    ...await ensureCursorWorkbenchPatched({
      ...options,
      file,
      preserveCatalogMetadata: isCursorModelMetadataBundle(file),
    }),
  })));
}

export async function ensureCursorAppPatched(options = {}) {
  const [bundles, runtimes] = await Promise.all([
    ensureCursorBundlesPatched({
      ...options,
      files: options.bundleFiles,
    }),
    ensureCursorLocalRuntimesPatched({
      ...options,
      files: options.localRuntimeFiles,
    }),
  ]);
  return [...bundles, ...runtimes];
}

async function ensureCursorPatchFile(file, localRuntimeFiles, options) {
  if (localRuntimeFiles.has(file)) {
    const [result] = await ensureCursorLocalRuntimesPatched({
      ...options,
      files: [file],
    });
    return result;
  }
  return {
    file,
    ...await ensureCursorWorkbenchPatched({
      ...options,
      file,
      preserveCatalogMetadata: options.file ? true : isCursorModelMetadataBundle(file),
    }),
  };
}

export function startCursorPatchMonitor(options = {}) {
  const intervalMs = options.intervalMs || 250;
  const bundleFiles = options.file ? [options.file] : (options.bundleFiles || options.files || cursorBundleFiles);
  const runtimeFiles = options.file ? [] : (options.localRuntimeFiles || cursorLocalRuntimeFiles);
  const files = [...bundleFiles, ...runtimeFiles];
  const localRuntimeFiles = new Set(runtimeFiles);
  const lastSignatures = new Map();
  let patchPromise = null;
  let stopped = false;

  const check = async () => {
    if (stopped || patchPromise || options.shouldPatch?.() === false) return patchPromise;
    patchPromise = Promise.all(files.map(async (file) => {
      let signature;
      try {
        signature = await cursorWorkbenchSignature(file);
      } catch {
        return;
      }
      if (signature === lastSignatures.get(file)) return;
      try {
        const result = await ensureCursorPatchFile(file, localRuntimeFiles, options);
        lastSignatures.set(file, result.signature);
        options.onResult?.(result);
      } catch (error) {
        if (!transientPatchErrorCodes.has(error.code)) lastSignatures.set(file, signature);
        options.onError?.(error, file);
      }
    })).finally(() => {
      patchPromise = null;
    });
    return patchPromise;
  };

  const timer = setInterval(check, intervalMs);
  void check();
  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
