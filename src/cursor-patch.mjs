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

export const cursorPatchMarker = "/*ocx-cursor-model-metadata-v3*/";
export const legacyCursorPatchMarker = "/*ocx-cursor-model-metadata*/";
export const cursorLocalModeDisabled = "localMode:!1";
export const cursorLocalModeEnabled = "localMode:!0";
export const cursorLocalRuntimePatchMarker = "/*ocx-cursor-local-model-display*/";

export function isCursorModelMetadataBundle(file) {
  return file === cursorWorkbenchFile || file === cursorGlassWorkbenchFile;
}

const catalogNormalization = /(?<normalization>\b(?<catalog>[A-Za-z_$][\w$]*)=\k<catalog>\.map\((?<item>[A-Za-z_$][\w$]*)=>(?<plain>[A-Za-z_$][\w$]*)\(\k<item>\)\)),(?=(?<batch>[A-Za-z_$][\w$]*)\(\(\)=>\{this\._reactiveStorageService\.setApplicationUserPersistentStorage\("availableDefaultModels2",\k<catalog>\))/g;
const previousCatalogInjection = /\/\*ocx-cursor-model-metadata(?:-v2)?\*\/(?<catalog>[A-Za-z_$][\w$]*)=\k<catalog>\.map\(ocxCursorModel=>\{.*?\}\),(?=(?<batch>[A-Za-z_$][\w$]*)\(\(\)=>\{this\._reactiveStorageService\.setApplicationUserPersistentStorage\("availableDefaultModels2",\k<catalog>\))/g;
const localModelConstructor = /function (?<functionName>[A-Za-z_$][\w$]*)\(e,t\)\{return new (?<modelType>[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\(\{modelId:e,displayModelId:e,displayName:null!=t\?t:e,displayNameShort:null!=t\?t:e,aliases:\[\]\}\)\}/g;
const transientPatchErrorCodes = new Set(["EACCES", "EBUSY", "EPERM"]);

function metadataInjection(catalog) {
  return `${cursorPatchMarker}${catalog}=${catalog}.map(ocxCursorModel=>{if(!ocxCursorModel.name.startsWith("opencodex/"))return ocxCursorModel;const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name);const ocxCursorDisplayWords={claude:"Claude",codex:"Codex",composer:"Composer",deepseek:"DeepSeek",fable:"Fable",fast:"Fast",flash:"Flash",gpt:"GPT",grok:"Grok",hy3:"HY3",kimi:"Kimi",luna:"Luna",max:"Max",mimo:"MiMo",mini:"Mini",opus:"Opus",pro:"Pro",qwen:"Qwen",sol:"Sol",sonnet:"Sonnet",spark:"Spark",terra:"Terra"};const ocxCursorDisplayName=ocxCursorModel.name.split("/").at(-1).split("-").map(ocxCursorWord=>{if(ocxCursorDisplayWords[ocxCursorWord])return ocxCursorDisplayWords[ocxCursorWord];const ocxCursorAttached=/^(qwen|kimi|gpt|claude|grok)(\\d+(?:\\.\\d+)*)$/.exec(ocxCursorWord);if(ocxCursorAttached)return ocxCursorDisplayWords[ocxCursorAttached[1]]+" "+ocxCursorAttached[2];if(/^v\\d/i.test(ocxCursorWord))return"V"+ocxCursorWord.slice(1);if(/^k\\d/i.test(ocxCursorWord))return"K"+ocxCursorWord.slice(1);if(/^\\d/.test(ocxCursorWord))return ocxCursorWord;return ocxCursorWord.slice(0,1).toUpperCase()+ocxCursorWord.slice(1)}).join(" ");const ocxCursorPrettyLabel=ocxCursorValue=>typeof ocxCursorValue==="string"?ocxCursorValue.split(ocxCursorModel.name).join(ocxCursorDisplayName):ocxCursorValue;const ocxCursorVariants=(ocxCursorStored?.variants??ocxCursorModel.variants??[]).map(ocxCursorVariant=>({...ocxCursorVariant,displayName:ocxCursorPrettyLabel(ocxCursorVariant.displayName),displayNameOutsidePicker:ocxCursorPrettyLabel(ocxCursorVariant.displayNameOutsidePicker)}));return{...ocxCursorModel,clientDisplayName:ocxCursorDisplayName,inputboxShortModelName:ocxCursorDisplayName,parameterDefinitions:ocxCursorStored?.parameterDefinitions??ocxCursorModel.parameterDefinitions??[],variants:ocxCursorVariants,legacySlugs:ocxCursorStored?.legacySlugs??ocxCursorModel.legacySlugs??[],supportsThinking:ocxCursorStored?.supportsThinking??ocxCursorModel.supportsThinking}}),`;
}

export function patchCursorWorkbenchSource(source) {
  if (source.includes(cursorPatchMarker)) return { status: "already-patched", source };
  if (source.includes(legacyCursorPatchMarker) || source.includes("/*ocx-cursor-model-metadata-v2*/")) {
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

export function patchCursorLocalRuntimeSource(source) {
  if (source.includes(cursorLocalRuntimePatchMarker)) return { status: "already-patched", source };
  const matches = [...source.matchAll(localModelConstructor)];
  if (matches.length !== 1) {
    throw new Error(`Expected one Cursor local model constructor, found ${matches.length}`);
  }
  const match = matches[0];
  const { functionName, modelType } = match.groups;
  const replacement = `function ${functionName}(e,t){${cursorLocalRuntimePatchMarker}const ocxCursorDisplayWords={claude:"Claude",codex:"Codex",composer:"Composer",deepseek:"DeepSeek",fable:"Fable",fast:"Fast",flash:"Flash",gpt:"GPT",grok:"Grok",hy3:"HY3",kimi:"Kimi",luna:"Luna",max:"Max",mimo:"MiMo",mini:"Mini",opus:"Opus",pro:"Pro",qwen:"Qwen",sol:"Sol",sonnet:"Sonnet",spark:"Spark",terra:"Terra"};const ocxCursorDisplayName=null!=t?t:e.startsWith("opencodex/")?e.split("/").at(-1).split("-").map(ocxCursorWord=>{if(ocxCursorDisplayWords[ocxCursorWord])return ocxCursorDisplayWords[ocxCursorWord];const ocxCursorAttached=/^(qwen|kimi|gpt|claude|grok)(\\d+(?:\\.\\d+)*)$/.exec(ocxCursorWord);if(ocxCursorAttached)return ocxCursorDisplayWords[ocxCursorAttached[1]]+" "+ocxCursorAttached[2];if(/^v\\d/i.test(ocxCursorWord))return"V"+ocxCursorWord.slice(1);if(/^k\\d/i.test(ocxCursorWord))return"K"+ocxCursorWord.slice(1);if(/^\\d/.test(ocxCursorWord))return ocxCursorWord;return ocxCursorWord.slice(0,1).toUpperCase()+ocxCursorWord.slice(1)}).join(" "):e;return new ${modelType}({modelId:e,displayModelId:e,displayName:ocxCursorDisplayName,displayNameShort:ocxCursorDisplayName,aliases:[]})}`;
  return {
    status: "patched",
    source: `${source.slice(0, match.index)}${replacement}${source.slice(match.index + match[0].length)}`,
  };
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
