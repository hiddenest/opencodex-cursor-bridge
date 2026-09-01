import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  cursorAppPath,
  cursorBundleFiles,
  cursorGlassWorkbenchFile,
  cursorLocalRuntimeFiles,
  cursorModelMetadataFiles,
  cursorPatchBackupDirectory,
  cursorWorkbenchFile,
} from "./paths.mjs";

export const cursorPatchMarker = "/*ocx-cursor-model-metadata-v6*/";
export const legacyCursorPatchMarker = "/*ocx-cursor-model-metadata*/";
export const cursorByokRoutingPatchMarker = "/*ocx-cursor-byok-model-routing-v1*/";
export const cursorSubagentModelsPatchMarker = "/*ocx-cursor-subagent-models-v1*/";
export const cursorSubagentCredentialsPatchMarker = "/*ocx-cursor-subagent-credentials-v1*/";
export const cursorSubagentLegacyDetailsPatchMarker = "/*ocx-cursor-subagent-legacy-details-v1*/";
export const cursorSubagentPromptRoutingPatchMarker = "/*ocx-cursor-subagent-prompt-routing-v3*/";
export const cursorSubagentExecutionRoutingPatchMarker = "/*ocx-cursor-subagent-execution-routing-v5*/";
export const cursorSubagentRunRoutingPatchMarker = "/*ocx-cursor-subagent-run-routing-v1*/";
export const cursorSubagentRuntimeCredentialsPatchMarker = "/*ocx-cursor-subagent-runtime-credentials-v1*/";
export const cursorRoutedSubagentTypesPatchMarker = "/*ocx-cursor-hide-routed-subagent-types-v1*/";
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
const previousCatalogInjection = /\/\*ocx-cursor-model-metadata(?:-v[2-5])?\*\/(?<catalog>[A-Za-z_$][\w$]*)=[\s\S]*?,(?=(?<batch>[A-Za-z_$][\w$]*)\(\(\)=>\{this\._reactiveStorageService\.setApplicationUserPersistentStorage\("availableDefaultModels2",\k<catalog>\))/g;
const byokModelRouting = /function (?<functionName>[A-Za-z_$][\w$]*)\((?<model>[A-Za-z_$][\w$]*),(?<settings>[A-Za-z_$][\w$]*)\)\{return (?<isClaude>[A-Za-z_$][\w$]*)\(\k<model>\)\?\k<settings>\.useClaudeKey\?"anthropic":void 0:(?<isGemini>[A-Za-z_$][\w$]*)\(\k<model>\)\?\k<settings>\.useGoogleKey\?"google":void 0:\k<settings>\.useOpenAIKey\?"openai":void 0\}/g;
const explicitSubagentModelFilter = /function (?<functionName>[A-Za-z_$][\w$]*)\((?<model>[A-Za-z_$][\w$]*),(?<isUserAdded>[A-Za-z_$][\w$]*),(?<storage>[A-Za-z_$][\w$]*)\)\{return \k<isUserAdded>===!0\?!0:(?<hasProviderOverride>[A-Za-z_$][\w$]*)\(\k<storage>\)\|\|(?<usesByok>[A-Za-z_$][\w$]*)\(\k<model>,\k<storage>\)\}(?=function [A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\)\{const\{modelDetails:)/g;
const explicitSubagentModelSelection = /function (?<functionName>[A-Za-z_$][\w$]*)\((?<input>[A-Za-z_$][\w$]*)\)\{const\{modelDetails:(?<modelDetails>[A-Za-z_$][\w$]*),flagEnabled:(?<flagEnabled>[A-Za-z_$][\w$]*),availableModels:(?<availableModels>[A-Za-z_$][\w$]*),storage:(?<storage>[A-Za-z_$][\w$]*),resolveModelParametersForSubmission:(?<resolveParameters>[A-Za-z_$][\w$]*)\}=\k<input>,(?<maxMode>[A-Za-z_$][\w$]*)=\k<modelDetails>\.maxMode===!0;/g;
const explicitSubagentRequestedModel = /new (?<requestedModelType>[A-Za-z_$][\w$]*)\(\{modelId:(?<model>[A-Za-z_$][\w$]*)\.name,maxMode:(?<maxMode>[A-Za-z_$][\w$]*),parameters:(?<parameters>[A-Za-z_$][\w$]*)\.map\((?<parameter>[A-Za-z_$][\w$]*)=>new (?<parameterType>[A-Za-z_$][\w$]*)\(\{id:\k<parameter>\.id,value:\k<parameter>\.value\}\)\)\}\)(?=\}\)\}\})/g;
const explicitSubagentSelectionCall = /getSelectedSubagentModelSelections\((?<modelDetails>[A-Za-z_$][\w$]*)\)\{return (?<selector>[A-Za-z_$][\w$]*)\(\{modelDetails:\k<modelDetails>,flagEnabled:(?<featureGate>[\s\S]*?),availableModels:this\.modelConfigService\.getAvailableDefaultModels\(\),storage:this\.reactiveStorageService\.applicationUserPersistentStorage,resolveModelParametersForSubmission:\((?<model>[A-Za-z_$][\w$]*),(?<maxMode>[A-Za-z_$][\w$]*)\)=>this\.modelConfigService\.resolveModelParametersForSubmission\(\k<model>,void 0,\k<maxMode>\)\}\)\}/g;
const agentModelDetailsType = /(?<type>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.makeMessageType\("agent\.v1\.ModelDetails"/g;
const selectedSubagentLegacyDetails = /selectedSubagentModelDetails:(?<options>[A-Za-z_$][\w$]*)\.selectedSubagentModelsLegacy/g;
const agentCustomSystemPrompt = /customSystemPrompt:(?<options>[A-Za-z_$][\w$]*)\.customSystemPrompt(?=,harness:)/g;
const agentRequestAction = /(?<prefix>conversationState:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),action:)(?<action>[A-Za-z_$][\w$]*)(?=,modelDetails:)/g;
const legacySubagentPromptRouting = /customSystemPrompt:\(\(\)=>\{\/\*ocx-cursor-subagent-prompt-routing-v1\*\/const ocxCursorModelIds=\((?<options>[A-Za-z_$][\w$]*)\.selectedSubagentModels[\s\S]*?\}\)\(\)(?=,harness:)/g;
const legacySubagentRequestRouting = /(?<prefix>conversationState:[A-Za-z_$][\w$]*\([A-Za-z_$][\w$]*\),action:)\(\(\)=>\{\/\*ocx-cursor-subagent-prompt-routing-v2\*\/[\s\S]*?return (?<action>[A-Za-z_$][\w$]*)\}\)\(\)(?=,modelDetails:)/g;
const createOrResumeSubagentStart = /async createOrResumeSubagent\((?<input>[A-Za-z_$][\w$]*)\)\{/g;
const legacySubagentExecutionRouting = /(?<start>async createOrResumeSubagent\((?<input>[A-Za-z_$][\w$]*)\)\{)\/\*ocx-cursor-subagent-execution-routing-v[1-4]\*\/[\s\S]*?(?=let [A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*=\k<input>\.resumeAgentId;)/g;
const legacySubagentModelConfigFixup = /(?<fixup>[A-Za-z_$][\w$]*)=ocxCursorRequestedModel\?void 0:typeof this\._modelConfigService\.fixupModelConfigForCurrentFlag=="function"\?this\._modelConfigService\.fixupModelConfigForCurrentFlag\(\{modelName:(?<input>[A-Za-z_$][\w$]*)\.modelId,maxMode:(?<composerConfig>[A-Za-z_$][\w$]*)\.maxMode===!0\}\):void 0/g;
const subagentModelConfigFixup = /(?<fixup>[A-Za-z_$][\w$]*)=typeof this\._modelConfigService\.fixupModelConfigForCurrentFlag=="function"\?this\._modelConfigService\.fixupModelConfigForCurrentFlag\(\{modelName:(?<input>[A-Za-z_$][\w$]*)\.modelId,maxMode:(?<composerConfig>[A-Za-z_$][\w$]*)\.maxMode===!0\}\):void 0/g;
const appendSubagentComposer = /(?<declaration>const (?<result>[A-Za-z_$][\w$]*)=await this\._composerDataService\.appendSubComposer\((?<composer>[A-Za-z_$][\w$]*)\))/g;
const runSubagentWithHandle = /async runSubagentWithHandle\((?<input>[A-Za-z_$][\w$]*),(?<handle>[A-Za-z_$][\w$]*)\)\{return this\._runSubagent\(\k<input>,\k<handle>\)\}/g;
const runSubagentModelConfigFixup = /(?<fixed>[A-Za-z_$][\w$]*)=\(typeof this\._modelConfigService\.fixupModelConfigForCurrentFlag=="function"\?this\._modelConfigService\.fixupModelConfigForCurrentFlag\(\{modelName:(?<resolved>[A-Za-z_$][\w$]*),maxMode:(?<maxMode>[A-Za-z_$][\w$]*)\}\):void 0\)\?\.selectedModels\?\?\[\],(?<stored>[A-Za-z_$][\w$]*)=(?<config>[A-Za-z_$][\w$]*)\?\.selectedModels\?\?\[\]/g;
const requestedModelCredentials = /(?<prefix>new [A-Za-z_$][\w$]*\(\{modelId:(?<model>[A-Za-z_$][\w$]*),maxMode:(?<details>[A-Za-z_$][\w$]*)\.maxMode,parameters:[\s\S]*?,credentials:)this\.convertModelDetailsToCredentials\(\k<details>\)(?<suffix>\}\))(?=\}convertModelDetailsToCredentials)/g;
const rawSubagentLoad = /(?<raw>[A-Za-z_$][\w$]*)=this\.subagentsService\.peekRawSubagents\(\)/g;
const localModelConstructor = /function (?<functionName>[A-Za-z_$][\w$]*)\(e,t\)\{return new (?<modelType>[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\(\{modelId:e,displayModelId:e,displayName:null!=t\?t:e,displayNameShort:null!=t\?t:e,aliases:\[\]\}\)\}/g;
const localRuntimeVisionCapability = /"boolean"==typeof (?<object>[A-Za-z_$][\w$]*)\.supports_vision\?\{supports_vision:\k<object>\.supports_vision\}:\{\}\)/g;
const localRuntimePickerInput = /toPickerInput\((?<model>[A-Za-z_$][\w$]*)\)\{var [A-Za-z_$][\w$]*;const [A-Za-z_$][\w$]*=this\.modelMetadataById\.get\(\k<model>\.modelId\),(?<capabilities>[A-Za-z_$][\w$]*)=.*?;return\{.*?supportsReasoning:[^,]+,supportsVision:/g;
const localRuntimeProviderPickerInput = /supportsReasoning:(?<reasoning>!0===\(null===\((?<capability>[A-Za-z_$][\w$]*)=(?<model>[A-Za-z_$][\w$]*)\.capabilities\)\|\|void 0===\k<capability>\?void 0:\k<capability>\.supports_reasoning\)),supportsVision:/g;
const localRuntimeRequestParameters = /function\((?<payload>[A-Za-z_$][\w$]*),(?<model>[A-Za-z_$][\w$]*),(?<parameters>[A-Za-z_$][\w$]*),(?<apiType>[A-Za-z_$][\w$]*),(?<route>[A-Za-z_$][\w$]*),(?<extended>[A-Za-z_$][\w$]*)=!1\)\{(?=const [A-Za-z_$][\w$]*=function\([A-Za-z_$][\w$]*\)\{var [A-Za-z_$][\w$]*;const [A-Za-z_$][\w$]*=.*?\["reasoning","effort","thought_level"\]\.includes)/g;
const localRuntimeBuilderExport = /buildBottlerocketPickerModels:\(\)=>(?<builder>[A-Za-z_$][\w$]*)/g;
const transientPatchErrorCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
const directoryPatchQueues = new Map();

export function clearCursorAppQuarantine(options = {}) {
  const execute = options.execFileSync || execFileSync;
  execute("/usr/bin/xattr", ["-dr", "com.apple.quarantine", options.appPath || cursorAppPath], {
    stdio: "ignore",
  });
}

export function finalizeCursorAppPatch(options = {}) {
  const execute = options.execFileSync || execFileSync;
  const appPath = options.appPath || cursorAppPath;
  execute("/usr/bin/codesign", ["--force", "--sign", "-", appPath], { stdio: "ignore" });
  execute("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "ignore" });
  clearCursorAppQuarantine({ ...options, appPath, execFileSync: execute });
}

function replaceSingleMatch(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Expected one Cursor ${label}, found ${matches.length}`);
  const match = matches[0];
  const value = typeof replacement === "function" ? replacement(match) : replacement;
  return `${source.slice(0, match.index)}${value}${source.slice(match.index + match[0].length)}`;
}

async function withWritableDirectory(file, callback) {
  const directory = dirname(file);
  const previous = directoryPatchQueues.get(directory) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const directoryMode = (await stat(directory)).mode & 0o777;
    const restoreDirectoryMode = (directoryMode & 0o200) === 0;
    if (restoreDirectoryMode) await chmod(directory, directoryMode | 0o200);
    try {
      return await callback();
    } finally {
      if (restoreDirectoryMode) await chmod(directory, directoryMode);
    }
  });
  directoryPatchQueues.set(directory, current);
  try {
    return await current;
  } finally {
    if (directoryPatchQueues.get(directory) === current) directoryPatchQueues.delete(directory);
  }
}

function metadataInjection(catalog) {
  return `${cursorPatchMarker}${catalog}=[...${catalog},...(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).filter(ocxCursorStoredModel=>typeof ocxCursorStoredModel?.name==="string"&&ocxCursorStoredModel.name.startsWith("opencodex/")&&!${catalog}.some(ocxCursorFreshModel=>ocxCursorFreshModel?.name===ocxCursorStoredModel.name))].map(ocxCursorModel=>{if(!ocxCursorModel.name.startsWith("opencodex/"))return ocxCursorModel;const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name);const ocxCursorDisplayWords={claude:"Claude",codex:"Codex",composer:"Composer",deepseek:"DeepSeek",fable:"Fable",fast:"Fast",flash:"Flash",gpt:"GPT",grok:"Grok",hy3:"HY3",kimi:"Kimi",luna:"Luna",max:"Max",mimo:"MiMo",mini:"Mini",opus:"Opus",pro:"Pro",qwen:"Qwen",sol:"Sol",sonnet:"Sonnet",spark:"Spark",terra:"Terra"};const ocxCursorDisplayName=ocxCursorStored?.clientDisplayName??((ocxCursorModel.name.startsWith("opencodex/cursor/")?"Cursor ":"")+ocxCursorModel.name.split("/").at(-1).split("-").map(ocxCursorWord=>{if(ocxCursorDisplayWords[ocxCursorWord])return ocxCursorDisplayWords[ocxCursorWord];const ocxCursorAttached=/^(qwen|kimi|gpt|claude|grok)(\\d+(?:\\.\\d+)*)$/.exec(ocxCursorWord);if(ocxCursorAttached)return ocxCursorDisplayWords[ocxCursorAttached[1]]+" "+ocxCursorAttached[2];if(/^v\\d/i.test(ocxCursorWord))return"V"+ocxCursorWord.slice(1);if(/^k\\d/i.test(ocxCursorWord))return"K"+ocxCursorWord.slice(1);if(/^\\d/.test(ocxCursorWord))return ocxCursorWord;return ocxCursorWord.slice(0,1).toUpperCase()+ocxCursorWord.slice(1)}).join(" "));const ocxCursorPrettyLabel=ocxCursorValue=>typeof ocxCursorValue==="string"?ocxCursorValue.split(ocxCursorModel.name).join(ocxCursorDisplayName):ocxCursorValue;const ocxCursorDefinitions=Array.isArray(ocxCursorModel.parameterDefinitions)&&ocxCursorModel.parameterDefinitions.length>0?ocxCursorModel.parameterDefinitions:ocxCursorStored?.parameterDefinitions??[];const ocxCursorVariantSource=Array.isArray(ocxCursorModel.variants)&&ocxCursorModel.variants.length>0?ocxCursorModel.variants:ocxCursorStored?.variants??[];const ocxCursorVariants=ocxCursorVariantSource.map(ocxCursorVariant=>({...ocxCursorVariant,displayName:ocxCursorPrettyLabel(ocxCursorVariant.displayName),displayNameOutsidePicker:ocxCursorPrettyLabel(ocxCursorVariant.displayNameOutsidePicker)}));const ocxCursorLegacySlugs=Array.isArray(ocxCursorModel.legacySlugs)&&ocxCursorModel.legacySlugs.length>0?ocxCursorModel.legacySlugs:ocxCursorStored?.legacySlugs??[];return{...ocxCursorModel,clientDisplayName:ocxCursorDisplayName,inputboxShortModelName:ocxCursorDisplayName,parameterDefinitions:ocxCursorDefinitions,variants:ocxCursorVariants,legacySlugs:ocxCursorLegacySlugs,supportsThinking:void 0!==ocxCursorModel.supportsThinking?ocxCursorModel.supportsThinking:ocxCursorStored?.supportsThinking}}),`;
}

function patchCursorModelMetadataSource(source) {
  if (source.includes(cursorPatchMarker)) return { status: "already-patched", source };
  if (source.includes(legacyCursorPatchMarker) || source.includes("/*ocx-cursor-model-metadata-v2*/") || source.includes("/*ocx-cursor-model-metadata-v3*/") || source.includes("/*ocx-cursor-model-metadata-v4*/") || source.includes("/*ocx-cursor-model-metadata-v5*/")) {
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

export function patchCursorByokModelRoutingSource(source) {
  if (source.includes(cursorByokRoutingPatchMarker)) return { status: "already-patched", source };
  const patched = replaceSingleMatch(source, byokModelRouting, (match) => {
    const { functionName, model, settings, isClaude, isGemini } = match.groups;
    return `function ${functionName}(${model},${settings}){${cursorByokRoutingPatchMarker}return ${isClaude}(${model})?${settings}.useClaudeKey?"anthropic":void 0:${isGemini}(${model})?${settings}.useGoogleKey?"google":void 0:${settings}.useOpenAIKey&&(${model}.startsWith("opencodex/")||${settings}.aiSettings?.userAddedModels?.includes(${model}))?"openai":void 0}`;
  }, "BYOK model routing hook");
  return { status: "patched", source: patched };
}

export function patchCursorExplicitSubagentModelsSource(source) {
  if (source.includes(cursorSubagentModelsPatchMarker)) return { status: "already-patched", source };
  const patched = replaceSingleMatch(source, explicitSubagentModelFilter, (match) => {
    const { functionName, model, isUserAdded, storage, hasProviderOverride, usesByok } = match.groups;
    return `function ${functionName}(${model},${isUserAdded},${storage}){${cursorSubagentModelsPatchMarker}return ${model}.startsWith("opencodex/")?!1:${isUserAdded}===!0?!0:${hasProviderOverride}(${storage})||${usesByok}(${model},${storage})}`;
  }, "explicit subagent model filter");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentCredentialsSource(source) {
  if (source.includes(cursorSubagentCredentialsPatchMarker)) return { status: "already-patched", source };
  let patched = replaceSingleMatch(source, explicitSubagentModelSelection, (match) => {
    const { functionName, input, modelDetails, flagEnabled, availableModels, storage, resolveParameters, maxMode } = match.groups;
    return `function ${functionName}(${input}){${cursorSubagentCredentialsPatchMarker}const{modelDetails:${modelDetails},flagEnabled:${flagEnabled},availableModels:${availableModels},storage:${storage},resolveModelParametersForSubmission:${resolveParameters},resolveCredentialsForSubmission:ocxCursorResolveCredentials}=${input},${maxMode}=${modelDetails}.maxMode===!0;`;
  }, "explicit subagent selection hook");
  patched = replaceSingleMatch(patched, explicitSubagentRequestedModel, (match) => {
    const { requestedModelType, model, maxMode, parameters, parameter, parameterType } = match.groups;
    return `new ${requestedModelType}({modelId:${model}.name,maxMode:${maxMode},credentials:ocxCursorResolveCredentials?.(${model}.name),parameters:${parameters}.map(${parameter}=>new ${parameterType}({id:${parameter}.id,value:${parameter}.value}))})`;
  }, "explicit subagent requested model");
  patched = replaceSingleMatch(patched, explicitSubagentSelectionCall, (match) => {
    const { modelDetails, selector, featureGate, model, maxMode } = match.groups;
    return `getSelectedSubagentModelSelections(${modelDetails}){return ${selector}({modelDetails:${modelDetails},flagEnabled:${featureGate},availableModels:this.modelConfigService.getAvailableDefaultModels(),storage:this.reactiveStorageService.applicationUserPersistentStorage,resolveModelParametersForSubmission:(${model},${maxMode})=>this.modelConfigService.resolveModelParametersForSubmission(${model},void 0,${maxMode}),resolveCredentialsForSubmission:ocxCursorModel=>ocxCursorModel.startsWith("opencodex/")?this.convertModelDetailsToCredentials({apiKey:this.cursorAuthenticationService.openAIKey()??void 0,openaiApiBaseUrl:this.reactiveStorageService.applicationUserPersistentStorage.openAIBaseUrl}):void 0})}`;
  }, "explicit subagent selection caller");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentLegacyDetailsSource(source) {
  if (source.includes(cursorSubagentLegacyDetailsPatchMarker)) return { status: "already-patched", source };
  const modelDetailsMatches = [...source.matchAll(agentModelDetailsType)];
  if (modelDetailsMatches.length !== 1) {
    throw new Error(`Expected one Cursor agent model details type, found ${modelDetailsMatches.length}`);
  }
  const modelDetailsType = modelDetailsMatches[0].groups.type;
  const patched = replaceSingleMatch(source, selectedSubagentLegacyDetails, (match) => {
    const { options } = match.groups;
    return `selectedSubagentModelDetails:${cursorSubagentLegacyDetailsPatchMarker}${options}.selectedSubagentModelsLegacy?.length?${options}.selectedSubagentModelsLegacy:${options}.selectedSubagentModels?.filter(ocxCursorModel=>ocxCursorModel.modelId.startsWith("opencodex/")).map(ocxCursorModel=>new ${modelDetailsType}({modelId:ocxCursorModel.modelId,displayModelId:ocxCursorModel.modelId,displayName:ocxCursorModel.modelId,displayNameShort:ocxCursorModel.modelId,aliases:[],maxMode:ocxCursorModel.maxMode,credentials:ocxCursorModel.credentials}))`;
  }, "legacy explicit subagent model details");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentPromptRoutingSource(source) {
  if (source.includes(cursorSubagentPromptRoutingPatchMarker)) return { status: "already-patched", source };
  let restored = source;
  if (restored.includes("/*ocx-cursor-subagent-prompt-routing-v1*/")) {
    restored = replaceSingleMatch(restored, legacySubagentPromptRouting, (match) => {
      return `customSystemPrompt:${match.groups.options}.customSystemPrompt`;
    }, "legacy subagent prompt routing");
  }
  if (restored.includes("/*ocx-cursor-subagent-prompt-routing-v2*/")) {
    restored = replaceSingleMatch(restored, legacySubagentRequestRouting, (match) => {
      return `${match.groups.prefix}${match.groups.action}`;
    }, "legacy subagent request routing");
  }
  const promptMatches = [...restored.matchAll(agentCustomSystemPrompt)];
  if (promptMatches.length !== 1) {
    throw new Error(`Expected one Cursor custom system prompt field, found ${promptMatches.length}`);
  }
  const options = promptMatches[0].groups.options;
  const patched = replaceSingleMatch(restored, agentRequestAction, (match) => {
    const { prefix, action } = match.groups;
    return `${prefix}(()=>{${cursorSubagentPromptRoutingPatchMarker}const ocxCursorUserMessage=${action}.action.case==="userMessageAction"?${action}.action.value.userMessage:void 0;if(ocxCursorUserMessage){const ocxCursorModelIds=(${options}.selectedSubagentModels??[]).map(ocxCursorModel=>ocxCursorModel.modelId).filter(ocxCursorModelId=>ocxCursorModelId.startsWith("opencodex/")),ocxCursorRequestedModel=ocxCursorModelIds.find(ocxCursorModelId=>ocxCursorUserMessage.text?.includes(ocxCursorModelId)||ocxCursorUserMessage.richText?.includes(ocxCursorModelId));if(ocxCursorRequestedModel){for(const ocxCursorField of["text","richText"])typeof ocxCursorUserMessage[ocxCursorField]==="string"&&(ocxCursorUserMessage[ocxCursorField]=ocxCursorUserMessage[ocxCursorField].split(ocxCursorRequestedModel).join("composer-2.5"));ocxCursorUserMessage.text+=("\\n\\nLocal routing requirement: when calling the Subagent tool, its prompt must begin exactly with <ocx-subagent-model>"+ocxCursorRequestedModel+"</ocx-subagent-model>. Preserve this marker exactly.")}}return ${action}})()`;
  }, "agent request action");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentExecutionRoutingSource(source) {
  if (source.includes(cursorSubagentExecutionRoutingPatchMarker)) return { status: "already-patched", source };
  let restored = source;
  if (restored.includes("/*ocx-cursor-subagent-execution-routing-v4*/")) {
    restored = replaceSingleMatch(restored, legacySubagentModelConfigFixup, (match) => {
      const { fixup, input, composerConfig } = match.groups;
      return `${fixup}=typeof this._modelConfigService.fixupModelConfigForCurrentFlag=="function"?this._modelConfigService.fixupModelConfigForCurrentFlag({modelName:${input}.modelId,maxMode:${composerConfig}.maxMode===!0}):void 0`;
    }, "legacy subagent model config fixup");
  }
  if (restored.includes("/*ocx-cursor-subagent-execution-routing-v1*/") || restored.includes("/*ocx-cursor-subagent-execution-routing-v2*/") || restored.includes("/*ocx-cursor-subagent-execution-routing-v3*/") || restored.includes("/*ocx-cursor-subagent-execution-routing-v4*/")) {
    restored = replaceSingleMatch(restored, legacySubagentExecutionRouting, (match) => match.groups.start, "legacy subagent execution routing");
  }
  let patched = replaceSingleMatch(restored, createOrResumeSubagentStart, (match) => {
    const { input } = match.groups;
    return `${match[0]}${cursorSubagentExecutionRoutingPatchMarker}const ocxCursorModelMarker=typeof ${input}.prompt==="string"?/^\\s*<ocx-subagent-model>(opencodex\\/[A-Za-z0-9._\\/-]+)<\\/ocx-subagent-model>\\s*/.exec(${input}.prompt):null,ocxCursorRequestedModel=ocxCursorModelMarker?.[1];if(ocxCursorRequestedModel&&!${input}.resumeAgentId){const ocxCursorModelAvailable=this._modelConfigService.getAvailableDefaultModels().some(ocxCursorModel=>ocxCursorModel?.name===ocxCursorRequestedModel);if(!ocxCursorModelAvailable)throw new Error("OpenCodex subagent model is unavailable: "+ocxCursorRequestedModel);${input}={...${input},modelId:ocxCursorRequestedModel}}if(ocxCursorModelMarker)${input}={...${input},prompt:${input}.prompt.slice(ocxCursorModelMarker[0].length)};`;
  }, "subagent execution entrypoint");
  patched = replaceSingleMatch(patched, subagentModelConfigFixup, (match) => {
    const { fixup, input, composerConfig } = match.groups;
    return `${fixup}=ocxCursorRequestedModel?void 0:typeof this._modelConfigService.fixupModelConfigForCurrentFlag=="function"?this._modelConfigService.fixupModelConfigForCurrentFlag({modelName:${input}.modelId,maxMode:${composerConfig}.maxMode===!0}):void 0`;
  }, "subagent model config fixup");
  patched = replaceSingleMatch(patched, appendSubagentComposer, (match) => {
    const { declaration, composer } = match.groups;
    return `ocxCursorRequestedModel&&(${composer}.modelConfig={modelName:ocxCursorRequestedModel,maxMode:${composer}.modelConfig?.maxMode===!0,selectedModels:[{modelId:ocxCursorRequestedModel,parameters:[]}]});${declaration}`;
  }, "final subagent model config");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentRunRoutingSource(source) {
  if (source.includes(cursorSubagentRunRoutingPatchMarker)) return { status: "already-patched", source };
  let patched = replaceSingleMatch(source, runSubagentWithHandle, (match) => {
    const { input, handle } = match.groups;
    return `async runSubagentWithHandle(${input},${handle}){${cursorSubagentRunRoutingPatchMarker}const ocxCursorStoredModel=${handle}.data.modelConfig?.modelName;return this._runSubagent(ocxCursorStoredModel?.startsWith("opencodex/")?{...${input},modelId:ocxCursorStoredModel}:${input},${handle})}`;
  }, "subagent run input");
  patched = replaceSingleMatch(patched, runSubagentModelConfigFixup, (match) => {
    const { fixed, resolved, maxMode, stored, config } = match.groups;
    return `${fixed}=${resolved}.startsWith("opencodex/")?${config}?.selectedModels??[]:(typeof this._modelConfigService.fixupModelConfigForCurrentFlag=="function"?this._modelConfigService.fixupModelConfigForCurrentFlag({modelName:${resolved},maxMode:${maxMode}}):void 0)?.selectedModels??[],${stored}=${config}?.selectedModels??[]`;
  }, "subagent run model config");
  return { status: "patched", source: patched };
}

export function patchCursorSubagentRuntimeCredentialsSource(source) {
  if (source.includes(cursorSubagentRuntimeCredentialsPatchMarker)) return { status: "already-patched", source };
  const patched = replaceSingleMatch(source, requestedModelCredentials, (match) => {
    const { prefix, model, details, suffix } = match.groups;
    return `${prefix}${cursorSubagentRuntimeCredentialsPatchMarker}${model}.startsWith("opencodex/")?this.convertModelDetailsToCredentials({apiKey:this.cursorAuthenticationService.openAIKey()??void 0,openaiApiBaseUrl:this.reactiveStorageService.applicationUserPersistentStorage.openAIBaseUrl}):this.convertModelDetailsToCredentials(${details})${suffix}`;
  }, "subagent runtime credentials");
  return { status: "patched", source: patched };
}

export function patchCursorRoutedSubagentTypesSource(source) {
  if (source.includes(cursorRoutedSubagentTypesPatchMarker)) return { status: "already-patched", source };
  const patched = replaceSingleMatch(source, rawSubagentLoad, (match) => {
    const { raw } = match.groups;
    return `${raw}=this.subagentsService.peekRawSubagents()?.filter(ocxCursorSubagent=>{${cursorRoutedSubagentTypesPatchMarker}const ocxCursorPrompt=ocxCursorSubagent?.prompt;return!ocxCursorPrompt?.includes("generated-by: opencodex")&&!ocxCursorPrompt?.includes("generated-by: ocx-cursor")})`;
  }, "custom subagent loader");
  return { status: "patched", source: patched };
}

export function patchCursorWorkbenchSource(source) {
  const metadata = patchCursorModelMetadataSource(source);
  const routing = patchCursorByokModelRoutingSource(metadata.source);
  const subagents = patchCursorExplicitSubagentModelsSource(routing.source);
  const credentials = patchCursorSubagentCredentialsSource(subagents.source);
  const legacyDetails = patchCursorSubagentLegacyDetailsSource(credentials.source);
  const promptRouting = patchCursorSubagentPromptRoutingSource(legacyDetails.source);
  const executionRouting = patchCursorSubagentExecutionRoutingSource(promptRouting.source);
  const runRouting = patchCursorSubagentRunRoutingSource(executionRouting.source);
  const runtimeCredentials = patchCursorSubagentRuntimeCredentialsSource(runRouting.source);
  const subagentTypes = patchCursorRoutedSubagentTypesSource(runtimeCredentials.source);
  return {
    status: metadata.status === "patched" || routing.status === "patched" || subagents.status === "patched" || credentials.status === "patched" || legacyDetails.status === "patched" || promptRouting.status === "patched" || executionRouting.status === "patched" || runRouting.status === "patched" || runtimeCredentials.status === "patched" || subagentTypes.status === "patched"
      ? "patched"
      : "already-patched",
    source: subagentTypes.source,
  };
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
  await withWritableDirectory(file, async () => {
    await writeFile(temporary, patched.source, { mode });
    await chmod(temporary, mode);
    await rename(temporary, file);
  });
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

export async function ensureCursorModelMetadataPatched(options = {}) {
  const file = options.file || cursorWorkbenchFile;
  const backupDirectory = options.backupDirectory || cursorPatchBackupDirectory;
  const source = await readFile(file, "utf8");
  return await writePatchedFile(file, source, patchCursorWorkbenchSource(source), backupDirectory);
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
  if (options.metadataOnly) {
    return {
      file,
      ...await ensureCursorModelMetadataPatched({ ...options, file }),
    };
  }
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

export function startCursorModelMetadataPatchMonitor(options = {}) {
  return startCursorPatchMonitor({
    ...options,
    bundleFiles: options.bundleFiles || cursorModelMetadataFiles,
    localRuntimeFiles: [],
    metadataOnly: true,
  });
}

export function startCursorPatchMonitor(options = {}) {
  const intervalMs = options.intervalMs || 250;
  const stableMs = options.stableMs || 0;
  const bundleFiles = options.file ? [options.file] : (options.bundleFiles || options.files || cursorBundleFiles);
  const runtimeFiles = options.file ? [] : (options.localRuntimeFiles || cursorLocalRuntimeFiles);
  const files = [...bundleFiles, ...runtimeFiles];
  const localRuntimeFiles = new Set(runtimeFiles);
  const lastSignatures = new Map();
  let stableFingerprint = null;
  let stableSince = 0;
  let patchPromise = null;
  let stopped = false;

  const resetStability = () => {
    stableFingerprint = null;
    stableSince = 0;
  };

  const filesAreStable = async () => {
    if (stableMs === 0) return true;
    const signatures = await Promise.all(files.map(async (file) => {
      try {
        return await cursorWorkbenchSignature(file);
      } catch {
        return null;
      }
    }));
    if (signatures.some((signature) => signature === null)) {
      resetStability();
      return false;
    }
    const fingerprint = signatures.join("|");
    const now = (options.now || Date.now)();
    if (fingerprint !== stableFingerprint) {
      stableFingerprint = fingerprint;
      stableSince = now;
      return false;
    }
    return now - stableSince >= stableMs;
  };

  const check = async () => {
    if (stopped || patchPromise) return patchPromise;
    if (options.shouldPatch?.() === false) {
      resetStability();
      lastSignatures.clear();
      return null;
    }
    patchPromise = (async () => {
      if (!await filesAreStable()) return [];
      let retryAfterStabilityDelay = false;
      const results = await Promise.all(files.map(async (file) => {
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
          return result;
        } catch (error) {
          if (transientPatchErrorCodes.has(error.code)) retryAfterStabilityDelay = true;
          else lastSignatures.set(file, signature);
          options.onError?.(error, file);
        }
      }));
      if (retryAfterStabilityDelay) resetStability();
      const patched = results.filter((result) => result?.status === "patched");
      try {
        if (patched.length > 0) await options.onPatched?.(patched);
        if (results.length === files.length && results.every(Boolean)) await options.onReady?.(results);
      } catch (error) {
        resetStability();
        lastSignatures.clear();
        options.onError?.(error, options.appPath || cursorAppPath);
      }
      return results;
    })().finally(() => {
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
