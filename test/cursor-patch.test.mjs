import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cursorByokRoutingPatchMarker,
  cursorLocalModeEnabled,
  cursorLocalRuntimeCapabilitiesPatchMarker,
  legacyCursorLocalRuntimeCapabilitiesPatchMarker,
  cursorLocalRuntimePatchMarker,
  cursorPatchMarker,
  cursorRoutedSubagentTypesPatchMarker,
  cursorSubagentCredentialsPatchMarker,
  legacyCursorSubagentCredentialsPatchMarker,
  cursorSubagentExecutionRoutingPatchMarker,
  cursorSubagentLegacyDetailsPatchMarker,
  legacyCursorSubagentLegacyDetailsPatchMarker,
  cursorSubagentModelDisplayPatchMarker,
  cursorSubagentTaskArgsDisplayPatchMarker,
  legacyCursorSubagentTaskArgsDisplayPatchMarker,
  legacyCursorSubagentModelDisplayPatchMarker,
  cursorSubagentModelsPatchMarker,
  cursorSubagentPromptRoutingPatchMarker,
  cursorSubagentRunRoutingPatchMarker,
  cursorSubagentRuntimeCredentialsPatchMarker,
  clearCursorAppQuarantine,
  ensureCursorAppPatched,
  ensureCursorModelMetadataPatched,
  ensureCursorWorkbenchPatched,
  finalizeCursorAppPatch,
  isCursorModelMetadataBundle,
  patchCursorBundleSource,
  patchCursorByokModelRoutingSource,
  patchCursorExplicitSubagentModelsSource,
  patchCursorLocalModeSource,
  patchCursorLocalRuntimeSource,
  patchCursorRoutedSubagentTypesSource,
  patchCursorSubagentCredentialsSource,
  patchCursorSubagentExecutionRoutingSource,
  patchCursorSubagentLegacyDetailsSource,
  patchCursorSubagentModelDisplaySource,
  patchCursorSubagentTaskArgsDisplaySource,
  patchCursorSubagentPromptRoutingSource,
  patchCursorSubagentRunRoutingSource,
  patchCursorSubagentRuntimeCredentialsSource,
  patchCursorWorkbenchSource,
  startCursorModelMetadataPatchMonitor,
  startCursorPatchMonitor,
} from "../src/cursor-patch.mjs";
import { cursorGlassWorkbenchFile, cursorWorkbenchFile } from "../src/paths.mjs";

const byokSource = 'function MNg(e){return e.startsWith("claude-")}function PNg(e){return e.startsWith("gemini-")}function aVu(e,t){return MNg(e)?t.useClaudeKey?"anthropic":void 0:PNg(e)?t.useGoogleKey?"google":void 0:t.useOpenAIKey?"openai":void 0}';
const subagentSource = 'class HA{constructor(e){Object.assign(this,e)}}class xL{constructor(e){Object.assign(this,e)}}function providerOverride(e){return e.providerOverride===true}function usesByok(e,t){return t.useOpenAIKey&&t.aiSettings.userAddedModels.includes(e)}function hasByokDetails(e){return!!e.apiKey}function blocked(e,t,n){return t===!0?!0:providerOverride(n)||usesByok(e,n)}function selected(e){const{modelDetails:t,flagEnabled:n,availableModels:i,storage:r,resolveModelParametersForSubmission:s}=e,o=t.maxMode===!0;if(hasByokDetails(t)||!(n||o))return{};const a=r.aiSettings?.modelOverrideEnabled??[],l=i.filter(u=>{if(!u.supportsAgent||blocked(u.name,u.isUserAdded,r))return!1;let h=u.defaultOn??!1;return a.includes(u.name)&&(h=!0),h});return l.length===0?{}:{selectedSubagentModels:l.map(u=>{const h=s(u.name,o);return new HA({modelId:u.name,maxMode:o,parameters:h.map(m=>new xL({id:m.id,value:m.value}))})})}}class AgentCompat{getSelectedSubagentModelSelections(t){return selected({modelDetails:t,flagEnabled:this.experimentService.checkFeatureGate("explicit_subagent_models",{disableExposureLog:!1}),availableModels:this.modelConfigService.getAvailableDefaultModels(),storage:this.reactiveStorageService.applicationUserPersistentStorage,resolveModelParametersForSubmission:(e,n)=>this.modelConfigService.resolveModelParametersForSubmission(e,void 0,n)})}}';
const subagentLoaderSource = 'function context(){const e=this.subagentsService.peekRawSubagents(),t=e??[];return t}';
const subagentModelDisplaySource = 'function displayModel(e){return e.resumeTargetComposerId!==void 0?e.subagentModelName:e.bestOfNModelName!==void 0?e.bestOfNModelName:e.taskParamModelName??e.subagentModelName}';
const subagentTaskCardSource = 'function taskArgs(e){return e.args}function resumeId(e){return e?.resume}function taskCard(m){const g=m.state,_=taskArgs(m),y=resumeId(_),w=m.child,k=y===void 0?m.params?.model:void 0,C=m.additionalData?.modelConfig,X=displayModel({bestOfNModelName:void 0,resumeTargetComposerId:y,subagentModelName:C?.modelName,taskParamModelName:k});return X}';
const directSubagentTaskCardSource = 'function directTaskCard(m){const g=m.bubble,R=m.taskModel,X=displayModel({subagentTypeName:g.params?.name,bestOfNModelName:void 0,resumeTargetComposerId:void 0,subagentModelName:void 0,taskParamModelName:R});return X}';
const agentRequestSource = 'const A={makeMessageType:()=>class{constructor(e){Object.assign(this,e)}}},Zee=A.makeMessageType("agent.v1.ModelDetails",()=>[]),state=e=>e;function request(u,n,e){return{conversationState:state(e),action:n,modelDetails:u.modelDetails,customSystemPrompt:u.customSystemPrompt,harness:u.harness,selectedSubagentModelDetails:u.selectedSubagentModelsLegacy}}class AgentRuntime{buildRequestedModel(e,t){const s=t.data.modelConfig.selectedModels[0].modelId,a=[];return new Zee({modelId:s,maxMode:e.maxMode,parameters:a.map(l=>({id:l.id,value:l.value})),credentials:this.convertModelDetailsToCredentials(e)})}convertModelDetailsToCredentials(e){return{apiKey:e.apiKey,baseUrl:e.openaiApiBaseUrl}}}';
const subagentExecutionSource = 'class SubagentService{constructor(models){this._modelConfigService={getAvailableDefaultModels:()=>models,getModelConfig:()=>({maxMode:true}),fixupModelConfigForCurrentFlag:()=>({selectedModels:[{modelId:"composer-2.5",parameters:[]}]}),setModelConfigForComposer:(e,t)=>{e.data.modelConfig={...e.data.modelConfig,...t,modelName:t.selectedModels?.[0]?.modelId??t.modelName}}};this._composerDataService={appendSubComposer:async e=>({data:e})}}async _prependRequiredGlobalCommandPrompt(e){return e.prompt}async createOrResumeSubagent(e){let t,n=e.resumeAgentId;const i=await this._prependRequiredGlobalCommandPrompt(e),m=this._modelConfigService.getModelConfig("composer"),g=typeof this._modelConfigService.fixupModelConfigForCurrentFlag=="function"?this._modelConfigService.fixupModelConfigForCurrentFlag({modelName:e.modelId,maxMode:m.maxMode===!0}):void 0,l={modelConfig:{modelName:g?.selectedModels?.[0]?.modelId??e.modelId,maxMode:m.maxMode===!0,...g?.selectedModels?.length?{selectedModels:g.selectedModels}: {}}};const h=await this._composerDataService.appendSubComposer(l);return{request:e,prompt:i,modelConfig:h.data.modelConfig}}async runSubagentWithHandle(t,e){return this._runSubagent(t,e)}async _runSubagent(t,e){const g=true,v=e.data.modelConfig,x=t.modelId,I=(typeof this._modelConfigService.fixupModelConfigForCurrentFlag=="function"?this._modelConfigService.fixupModelConfigForCurrentFlag({modelName:x,maxMode:g}):void 0)?.selectedModels??[],R=v?.selectedModels??[],M=I.length>0&&R.length===I.length&&R.every((n,i)=>n.modelId===I[i]?.modelId)?R:I,L=M.length>0?{maxMode:g,selectedModels:M}:{modelName:x,maxMode:g},N=M[0]?.modelId;v?.maxMode===g&&(N!==void 0?v?.selectedModels?.[0]?.modelId===N:v?.modelName===x&&(v?.selectedModels?.length??0)===0)||this._modelConfigService.setModelConfigForComposer(e,L);return{request:t,modelConfig:e.data.modelConfig}}}';
const source = `const flags={localMode:!1};let c=a.models;const k=h(c);c=c.map(z=>XTt(z)),bp(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",c)});${byokSource}${subagentSource}${agentRequestSource}${subagentExecutionSource}${subagentModelDisplaySource}${subagentTaskCardSource}${subagentLoaderSource}`;
const localRuntimeSource = [
  'const runtimeExports={buildBottlerocketPickerModels:()=>M};',
  'function parseCapabilities(e){const r=e.reasoning_effort;return Object.assign(Object.assign(Object.assign({},"boolean"==typeof e.supports_reasoning?{supports_reasoning:e.supports_reasoning}:{}),"boolean"==typeof e.supports_vision?{supports_vision:e.supports_vision}:{}),void 0!==r?{reasoning_effort:r}:{})}',
  'class Manager{constructor(metadata){this.modelMetadataById=metadata;this.extendedCapabilitiesDetectedById=new Map}toPickerInput(e){var t;const n=this.modelMetadataById.get(e.modelId),r=null==n?void 0:n.capabilities;return{id:e.modelId,displayName:e.displayName||e.displayNameShort||e.displayModelId||e.modelId,supportsReasoning:"boolean"==typeof(null==r?void 0:r.supports_reasoning)?r.supports_reasoning:void 0,supportsVision:!0===(null==r?void 0:r.supports_vision),contextLength:void 0,maxOutputTokens:void 0,longContextThresholdTokens:void 0,extendedCapabilitiesDetected:null!==(t=this.extendedCapabilitiesDetectedById.get(e.modelId))&&void 0!==t?t:!0}}}',
  'function providerInput(e,t){var n,r,o,s;const i=e.id.trim();if(!i)return;return{id:i,contextLength:void 0,maxOutputTokens:void 0,longContextThresholdTokens:void 0,supportsReasoning:!0===(null===(o=e.capabilities)||void 0===o?void 0:o.supports_reasoning),supportsVision:!0===(null===(s=e.capabilities)||void 0===s?void 0:s.supports_vision),extendedCapabilitiesDetected:t}}',
  'const rewrite=function(e,t,n,r,o,s=!1){const i=function(e){var t;const n=null===(t=null==e?void 0:e.find(e=>["reasoning","effort","thought_level"].includes(e.id)))||void 0===t?void 0:t.value;return n}(n);return void 0!==i&&(e.reasoning_effort=i),e};',
  'function M(e,t){var n;const r=null!==(n=null==t?void 0:t.defaultEffortTier)&&void 0!==n?n:"curated",o=new Set,s=[];for(const t of e){const e=t.id.trim();e&&!o.has(e)&&(o.add(e),s.push(D(Object.assign(Object.assign({},t),{id:e}),r)))}return s}',
  'function D(e,t){var n,r;const o=function(e){return{values:["low","medium","high","xhigh"],defaultValue:"medium"}}(e),s=function(e){return}(e),i=(null===(n=e.displayName)||void 0===n?void 0:n.trim())||e.id,a=[...void 0!==o?[(c=o,new x.UNk({id:"reasoning",name:"Reasoning",parameterType:{enumParameter:{values:c.values.map(e=>({value:e}))}}}))]:[]];var l,c;return new x.MSu({name:e.id,parameterDefinitions:a,variants:F(o,s,i,t),supportsThinking:void 0!==o,supportsImages:null!==(r=e.supportsVision)&&void 0!==r&&r})}',
  'function F(e,t,n,r){if(void 0===e&&void 0===t)return[];return e.values.map(t=>({parameterValues:[{id:"reasoning",value:t}],displayName:n+" "+t,displayNameOutsidePicker:n+" "+t,isMaxMode:!1,isDefaultNonMaxConfig:t===e.defaultValue,isDefaultMaxConfig:t===e.defaultValue}))}',
  'function aFt(e,t){return new Ce.Gmx({modelId:e,displayModelId:e,displayName:null!=t?t:e,displayNameShort:null!=t?t:e,aliases:[]})}',
].join("");

test("removes only Cursor's quarantine attribute", () => {
  let call;
  clearCursorAppQuarantine({
    appPath: "/test/Cursor.app",
    execFileSync(command, args, options) {
      call = { command, args, options };
    },
  });
  assert.deepEqual(call, {
    command: "/usr/bin/xattr",
    args: ["-dr", "com.apple.quarantine", "/test/Cursor.app"],
    options: { stdio: "ignore" },
  });
});

test("ad-hoc signs an invalid patched Cursor app before clearing quarantine", () => {
  const calls = [];
  let verificationAttempts = 0;
  finalizeCursorAppPatch({
    appPath: "/test/Cursor.app",
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
      if (command === "/usr/bin/codesign" && args[0] === "--verify" && verificationAttempts++ === 0) {
        throw new Error("invalid signature");
      }
    },
  });
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/codesign",
      args: ["--verify", "--deep", "--strict", "/test/Cursor.app"],
      options: { stdio: "ignore" },
    },
    {
      command: "/usr/bin/codesign",
      args: ["--force", "--sign", "-", "/test/Cursor.app"],
      options: { stdio: "ignore" },
    },
    {
      command: "/usr/bin/codesign",
      args: ["--verify", "--deep", "--strict", "/test/Cursor.app"],
      options: { stdio: "ignore" },
    },
    {
      command: "/usr/bin/xattr",
      args: ["-dr", "com.apple.quarantine", "/test/Cursor.app"],
      options: { stdio: "ignore" },
    },
  ]);
});

test("keeps a valid Cursor signature when finalizing an already-patched app", () => {
  const calls = [];
  finalizeCursorAppPatch({
    appPath: "/test/Cursor.app",
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
    },
  });
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/codesign",
      args: ["--verify", "--deep", "--strict", "/test/Cursor.app"],
      options: { stdio: "ignore" },
    },
  ]);
});

test("adds display names, Fast, and advertised reasoning efforts to the local runtime", () => {
  const first = patchCursorLocalRuntimeSource(localRuntimeSource);
  assert.equal(first.status, "patched");
  assert.match(first.source, new RegExp(cursorLocalRuntimePatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(first.source, new RegExp(cursorLocalRuntimeCapabilitiesPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const Model = class { constructor(value) { Object.assign(this, value); } };
  const runtime = new Function("Ce", "x", `${first.source}; return {factory:aFt,parseCapabilities,providerInput,Manager,build:M,rewrite};`)({ Gmx: Model }, { UNk: Model, MSu: Model });
  const factory = runtime.factory;
  assert.equal(factory("opencodex/gpt-5.6-sol").displayName, "GPT 5.6 Sol");
  assert.equal(factory("opencodex/claude-opus-5").displayName, "Claude Opus 5");
  assert.equal(factory("opencodex/cursor/kimi-k3").displayName, "Cursor Kimi K3");
  assert.equal(factory("native-model").displayName, "native-model");
  assert.equal(factory("opencodex/gpt-5.6-sol", "Custom").displayName, "Custom");

  const capabilities = runtime.parseCapabilities({
    supports_vision: true,
    supports_fast: true,
    supports_reasoning: true,
    reasoning_effort: ["low", "medium", "high", "xhigh", "max"],
  });
  assert.equal(capabilities.supports_fast, true);
  assert.deepEqual(runtime.providerInput({ id: "opencodex/gpt-5.6-sol", capabilities }, true), {
    id: "opencodex/gpt-5.6-sol",
    contextLength: undefined,
    maxOutputTokens: undefined,
    longContextThresholdTokens: undefined,
    supportsReasoning: true,
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsFast: true,
    supportsVision: true,
    extendedCapabilitiesDetected: true,
  });
  const input = new runtime.Manager(new Map([["opencodex/gpt-5.6-sol", { capabilities }]])).toPickerInput({
    modelId: "opencodex/gpt-5.6-sol",
    displayName: "GPT 5.6 Sol",
  });
  const [pickerModel] = runtime.build([input], { defaultEffortTier: "curated" });
  assert.deepEqual(pickerModel.parameterDefinitions.map(({ id }) => id), ["reasoning", "fast"]);
  assert.deepEqual(
    pickerModel.parameterDefinitions[0].parameterType.enumParameter.values.map(({ value }) => value),
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.equal(pickerModel.variants.length, 10);
  assert.equal(pickerModel.variants.filter(({ parameterValues }) => parameterValues.some(({ id, value }) => id === "fast" && value === "true")).length, 5);

  assert.equal(runtime.rewrite({}, "model", [{ id: "fast", value: "true" }], "chat", "route").service_tier, "priority");
  assert.equal(runtime.rewrite({ service_tier: "priority" }, "model", [{ id: "fast", value: "false" }], "chat", "route").service_tier, undefined);
  assert.equal(patchCursorLocalRuntimeSource(first.source).status, "already-patched");
});

test("upgrades the v2 local runtime capabilities patch", () => {
  const v3 = patchCursorLocalRuntimeSource(localRuntimeSource).source;
  const providerMetadata = ',reasoningEfforts:Array.isArray(e.capabilities?.reasoning_effort)?e.capabilities.reasoning_effort:void 0,supportsFast:!0===e.capabilities?.supports_fast';
  const v2 = v3
    .replace(cursorLocalRuntimeCapabilitiesPatchMarker, legacyCursorLocalRuntimeCapabilitiesPatchMarker)
    .replace(providerMetadata, "");
  const upgraded = patchCursorLocalRuntimeSource(v2);
  assert.equal(upgraded.status, "patched");
  assert.match(upgraded.source, /reasoningEfforts:Array\.isArray\(e\.capabilities\?\.reasoning_effort\)/);
  assert.match(upgraded.source, /supportsFast:!0===e\.capabilities\?\.supports_fast/);
  assert.doesNotMatch(upgraded.source, /capabilities-v2/);
  assert.equal(patchCursorLocalRuntimeSource(upgraded.source).status, "already-patched");
});

test("preserves model metadata in desktop and Glass workbench bundles", () => {
  assert.equal(isCursorModelMetadataBundle(cursorWorkbenchFile), true);
  assert.equal(isCursorModelMetadataBundle(cursorGlassWorkbenchFile), true);
  assert.equal(isCursorModelMetadataBundle("/Applications/Cursor.app/Contents/Resources/app/out/main.js"), false);
});

test("injects metadata preservation before Cursor stores its catalog", () => {
  const result = patchCursorWorkbenchSource(source);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata/);
  assert.match(result.source, /name\.startsWith\("opencodex\/"\)/);
  assert.match(result.source, /parameterDefinitions:ocxCursorDefinitions/);
  assert.match(result.source, /ocxCursorModel\.parameterDefinitions\.length>0/);
  assert.match(result.source, /clientDisplayName:ocxCursorDisplayName/);
  assert.ok(result.source.indexOf(cursorPatchMarker) < result.source.indexOf('setApplicationUserPersistentStorage("availableDefaultModels2"'));
});

test("routes custom API keys only for OpenCodex and user-added models", () => {
  const result = patchCursorByokModelRoutingSource(byokSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorByokRoutingPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const route = new Function(`${result.source};return aVu`)();
  const settings = {
    useOpenAIKey: true,
    aiSettings: { userAddedModels: ["custom/model"] },
  };

  assert.equal(route("composer-2.5", settings), undefined);
  assert.equal(route("gpt-5.4", settings), undefined);
  assert.equal(route("opencodex/cursor/composer-2.5-fast", settings), "openai");
  assert.equal(route("custom/model", settings), "openai");
  assert.equal(route("claude-sonnet-4-6", { ...settings, useClaudeKey: true }), "anthropic");
  assert.equal(patchCursorByokModelRoutingSource(result.source).status, "already-patched");
});

test("allows managed OpenCodex models through Cursor's explicit subagent filter", () => {
  const result = patchCursorExplicitSubagentModelsSource(subagentSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentModelsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const blocked = new Function(`${result.source};return blocked`)();
  const settings = {
    providerOverride: false,
    useOpenAIKey: true,
    aiSettings: { userAddedModels: ["opencodex/claude-fable-5", "custom/model"] },
  };

  assert.equal(blocked("opencodex/claude-fable-5", true, settings), false);
  assert.equal(blocked("custom/model", true, settings), true);
  assert.equal(blocked("native/model", false, { ...settings, useOpenAIKey: false }), false);
  assert.equal(patchCursorExplicitSubagentModelsSource(result.source).status, "already-patched");
});

test("attaches OpenCodex credentials to explicit subagent model requests", () => {
  const result = patchCursorSubagentCredentialsSource(patchCursorExplicitSubagentModelsSource(subagentSource).source);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentCredentialsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const AgentCompat = new Function(`${result.source};return AgentCompat`)();
  const storage = {
    openAIBaseUrl: "http://127.0.0.1:8787/v1",
    aiSettings: { modelOverrideEnabled: ["opencodex/claude-fable-5", "native/model"] },
  };
  const agent = new AgentCompat();
  agent.experimentService = { checkFeatureGate: () => true };
  agent.modelConfigService = {
    getAvailableDefaultModels: () => [
      { name: "opencodex/claude-fable-5", supportsAgent: true, isUserAdded: true },
      { name: "native/model", supportsAgent: true, isUserAdded: false },
    ],
    resolveModelParametersForSubmission: () => [],
  };
  agent.reactiveStorageService = { applicationUserPersistentStorage: storage };
  agent.cursorAuthenticationService = { openAIKey: () => "secret" };
  agent.convertModelDetailsToCredentials = ({ apiKey, openaiApiBaseUrl }) => ({
    case: "apiKeyCredentials",
    value: { apiKey, baseUrl: openaiApiBaseUrl },
  });

  const { selectedSubagentModels } = agent.getSelectedSubagentModelSelections({
    apiKey: "secret",
    modelName: "opencodex/gpt-5.6-sol",
    maxMode: false,
  });
  assert.deepEqual(selectedSubagentModels.map(({ modelId, credentials }) => ({ modelId, credentials })), [
    {
      modelId: "opencodex/claude-fable-5",
      credentials: {
        case: "apiKeyCredentials",
        value: { apiKey: "secret", baseUrl: "http://127.0.0.1:8787/v1" },
      },
    },
    { modelId: "native/model", credentials: undefined },
  ]);
  assert.deepEqual(agent.getSelectedSubagentModelSelections({
    apiKey: "secret",
    modelName: "custom/model",
    maxMode: false,
  }), {});
  assert.equal(patchCursorSubagentCredentialsSource(result.source).status, "already-patched");
});

test("upgrades the legacy credentials patch to allow OpenCodex BYOK parents", () => {
  const current = patchCursorSubagentCredentialsSource(
    patchCursorExplicitSubagentModelsSource(subagentSource).source,
  ).source;
  const v1 = current
    .replace(cursorSubagentCredentialsPatchMarker, legacyCursorSubagentCredentialsPatchMarker)
    .replace(
      'if(hasByokDetails(t)&&!t.modelName?.startsWith("opencodex/")||!(n||o))return{};',
      'if(hasByokDetails(t)||!(n||o))return{};',
    );
  const upgraded = patchCursorSubagentCredentialsSource(v1);

  assert.equal(upgraded.status, "patched");
  assert.match(upgraded.source, new RegExp(cursorSubagentCredentialsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(upgraded.source, new RegExp(legacyCursorSubagentCredentialsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(upgraded.source, /hasByokDetails\(t\)&&!t\.modelName\?\.startsWith\("opencodex\/"\)/);
});

test("merges OpenCodex selections into Cursor's nonempty legacy subagent model details", () => {
  const result = patchCursorSubagentLegacyDetailsSource(agentRequestSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentLegacyDetailsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const request = new Function(`${result.source};return request`)();
  const credentials = { case: "apiKeyCredentials", value: { apiKey: "secret", baseUrl: "http://127.0.0.1:10101/v1" } };
  const legacyModels = [
    { modelId: "inherit", displayName: "inherit" },
    { modelId: "composer-2.5-fast", displayName: "Composer 2.5 Fast" },
  ];
  const selectedSubagentModelDetails = request({
    selectedSubagentModelsLegacy: legacyModels,
    selectedSubagentModels: [
      { modelId: "native/model", maxMode: false },
      { modelId: "opencodex/claude-fable-5", maxMode: true, credentials },
    ],
  }).selectedSubagentModelDetails;

  assert.deepEqual(JSON.parse(JSON.stringify(selectedSubagentModelDetails)), [
    ...legacyModels,
    {
      modelId: "opencodex/claude-fable-5",
      displayModelId: "opencodex/claude-fable-5",
      displayName: "opencodex/claude-fable-5",
      displayNameShort: "opencodex/claude-fable-5",
      aliases: [],
      maxMode: true,
      credentials,
    },
  ]);
  assert.equal(patchCursorSubagentLegacyDetailsSource(result.source).status, "already-patched");
});

test("upgrades the legacy subagent details patch to merge Cursor and OpenCodex models", () => {
  const v1Injection = `selectedSubagentModelDetails:${legacyCursorSubagentLegacyDetailsPatchMarker}u.selectedSubagentModelsLegacy?.length?u.selectedSubagentModelsLegacy:u.selectedSubagentModels?.filter(ocxCursorModel=>ocxCursorModel.modelId.startsWith("opencodex/")).map(ocxCursorModel=>new Zee({modelId:ocxCursorModel.modelId,displayModelId:ocxCursorModel.modelId,displayName:ocxCursorModel.modelId,displayNameShort:ocxCursorModel.modelId,aliases:[],maxMode:ocxCursorModel.maxMode,credentials:ocxCursorModel.credentials}))`;
  const v1Source = agentRequestSource.replace(
    "selectedSubagentModelDetails:u.selectedSubagentModelsLegacy",
    v1Injection,
  );
  const upgraded = patchCursorSubagentLegacyDetailsSource(v1Source);

  assert.equal(upgraded.status, "patched");
  assert.match(upgraded.source, new RegExp(cursorSubagentLegacyDetailsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(upgraded.source, new RegExp(legacyCursorSubagentLegacyDetailsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const request = new Function(`${upgraded.source};return request`)();
  assert.deepEqual(request({
    selectedSubagentModelsLegacy: [{ modelId: "inherit" }],
    selectedSubagentModels: [{ modelId: "opencodex/gpt-5.6-sol" }],
  }).selectedSubagentModelDetails.map(({ modelId }) => modelId), [
    "inherit",
    "opencodex/gpt-5.6-sol",
  ]);
});

test("rewrites exact OpenCodex model names only in the server request action", () => {
  const result = patchCursorSubagentPromptRoutingSource(agentRequestSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentPromptRoutingPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const request = new Function(`${result.source};return request`)();
  const userMessage = {
    text: "Fable subagent(model: opencodex/claude-fable-5) 사용",
    richText: "Fable subagent(model: opencodex/claude-fable-5) 사용",
  };
  const action = { action: { case: "userMessageAction", value: { userMessage } } };
  const routed = request({
    conversationId: "parent-1",
    customSystemPrompt: "Existing instructions",
    selectedSubagentModels: [
      { modelId: "composer-2.5" },
      { modelId: "opencodex/claude-fable-5" },
      { modelId: "opencodex/gpt-5.6-sol" },
    ],
  }, action, {});

  assert.equal(routed.customSystemPrompt, "Existing instructions");
  assert.equal(routed.action, action);
  assert.equal(userMessage.text, "Fable subagent(model: composer-2.5) 사용\n\nLocal routing requirement: when calling the Subagent tool, its prompt must begin exactly with <ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>. Preserve this marker exactly.");
  assert.equal(userMessage.richText, "Fable subagent(model: composer-2.5) 사용");
  assert.equal(patchCursorSubagentPromptRoutingSource(result.source).status, "already-patched");
});

test("restores the exact OpenCodex model before Cursor creates a child composer", async () => {
  const result = patchCursorSubagentExecutionRoutingSource(subagentExecutionSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentExecutionRoutingPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const SubagentService = new Function(`${result.source};return SubagentService`)();
  const service = new SubagentService([{ name: "opencodex/claude-fable-5" }]);

  const routed = await service.createOrResumeSubagent({
    modelId: "composer-2.5",
    parentConversationId: "parent-1",
    prompt: "<ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>Check Seoul weather",
  });
  assert.equal(routed.request.modelId, "opencodex/claude-fable-5");
  assert.equal(routed.request.prompt, "Check Seoul weather");
  assert.equal(routed.prompt, "Check Seoul weather");
  assert.equal(routed.modelConfig.modelName, "opencodex/claude-fable-5");
  assert.deepEqual(routed.modelConfig.selectedModels, [{ modelId: "opencodex/claude-fable-5", parameters: [] }]);

  const native = await service.createOrResumeSubagent({ modelId: "composer-2.5", parentConversationId: "parent-2", prompt: "Native task" });
  assert.equal(native.request.modelId, "composer-2.5");
  assert.equal(native.request.prompt, "Native task");
  assert.equal(native.modelConfig.modelName, "composer-2.5");

  await assert.rejects(
    service.createOrResumeSubagent({
      modelId: "composer-2.5",
      prompt: "<ocx-subagent-model>opencodex/missing</ocx-subagent-model>Task",
    }),
    /OpenCodex subagent model is unavailable: opencodex\/missing/,
  );
  assert.equal(patchCursorSubagentExecutionRoutingSource(result.source).status, "already-patched");
});

test("upgrades the v4 subagent execution patch before applying final model persistence", () => {
  const v4 = patchCursorSubagentExecutionRoutingSource(subagentExecutionSource).source
    .replaceAll("/*ocx-cursor-subagent-execution-routing-v5*/", "/*ocx-cursor-subagent-execution-routing-v4*/")
    .replace(/ocxCursorRequestedModel&&\([A-Za-z_$][\w$]*\.modelConfig=\{modelName:ocxCursorRequestedModel,maxMode:[A-Za-z_$][\w$]*\.modelConfig\?\.maxMode===!0,selectedModels:\[\{modelId:ocxCursorRequestedModel,parameters:\[\]\}\]\}\);/, "");
  const result = patchCursorSubagentExecutionRoutingSource(v4);

  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-subagent-execution-routing-v5/);
  assert.doesNotMatch(result.source, /ocx-cursor-subagent-execution-routing-v4/);
  assert.match(result.source, /ocxCursorRequestedModel&&\([A-Za-z_$][\w$]*\.modelConfig=/);
});

test("keeps the stored OpenCodex model when the child run starts", async () => {
  const result = patchCursorSubagentRunRoutingSource(subagentExecutionSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentRunRoutingPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const SubagentService = new Function(`${result.source};return SubagentService`)();
  const service = new SubagentService([]);
  const handle = {
    data: {
      modelConfig: {
        modelName: "opencodex/claude-fable-5",
        maxMode: true,
        selectedModels: [{ modelId: "opencodex/claude-fable-5", parameters: [] }],
      },
    },
  };

  const routed = await service.runSubagentWithHandle({ modelId: "composer-2.5" }, handle);
  assert.equal(routed.request.modelId, "opencodex/claude-fable-5");
  assert.equal(routed.modelConfig.modelName, "opencodex/claude-fable-5");
  assert.deepEqual(routed.modelConfig.selectedModels, [{ modelId: "opencodex/claude-fable-5", parameters: [] }]);

  const nativeHandle = {
    data: {
      modelConfig: {
        modelName: "composer-2.5",
        maxMode: true,
        selectedModels: [{ modelId: "composer-2.5", parameters: [] }],
      },
    },
  };
  const native = await service.runSubagentWithHandle({ modelId: "composer-2.5" }, nativeHandle);
  assert.equal(native.request.modelId, "composer-2.5");
  assert.equal(native.modelConfig.modelName, "composer-2.5");
  assert.equal(patchCursorSubagentRunRoutingSource(result.source).status, "already-patched");
});

test("uses bridge credentials for an OpenCodex child request", () => {
  const result = patchCursorSubagentRuntimeCredentialsSource(agentRequestSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentRuntimeCredentialsPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const AgentRuntime = new Function(`${result.source};return AgentRuntime`)();
  const runtime = new AgentRuntime();
  runtime.cursorAuthenticationService = { openAIKey: () => "bridge-secret" };
  runtime.reactiveStorageService = { applicationUserPersistentStorage: { openAIBaseUrl: "http://127.0.0.1:10101/v1" } };

  const custom = runtime.buildRequestedModel(
    { maxMode: true },
    { data: { modelConfig: { selectedModels: [{ modelId: "opencodex/claude-fable-5" }] } } },
  );
  assert.deepEqual(custom.credentials, { apiKey: "bridge-secret", baseUrl: "http://127.0.0.1:10101/v1" });

  const native = runtime.buildRequestedModel(
    { maxMode: true, apiKey: "native-secret", openaiApiBaseUrl: "https://native.invalid/v1" },
    { data: { modelConfig: { selectedModels: [{ modelId: "composer-2.5" }] } } },
  );
  assert.deepEqual(native.credentials, { apiKey: "native-secret", baseUrl: "https://native.invalid/v1" });
  assert.equal(patchCursorSubagentRuntimeCredentialsSource(result.source).status, "already-patched");
});

test("shows the routed OpenCodex model instead of the placeholder task model", () => {
  const result = patchCursorSubagentModelDisplaySource(subagentModelDisplaySource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentModelDisplayPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const displayModel = new Function(`${result.source};return displayModel`)();

  assert.equal(displayModel({
    taskParamModelName: "composer-2.5",
    subagentModelName: "opencodex/claude-fable-5",
  }), "opencodex/claude-fable-5");
  assert.equal(displayModel({
    taskParamModelName: "composer-2.5",
    subagentModelName: "composer-2.5",
  }), "composer-2.5");
  assert.equal(displayModel({
    resumeTargetComposerId: "child-1",
    taskParamModelName: "composer-2.5",
    subagentModelName: "opencodex/gpt-5.6-sol",
  }), "opencodex/gpt-5.6-sol");
  assert.equal(displayModel({
    taskParamModelName: "opencodex/claude-fable-5",
    subagentModelName: "opencodex/gpt-5.6-sol",
  }), "opencodex/claude-fable-5");
  assert.equal(patchCursorSubagentModelDisplaySource(result.source).status, "already-patched");
});

test("upgrades the legacy display patch without replacing a persisted child model", () => {
  const v2 = patchCursorSubagentModelDisplaySource(subagentModelDisplaySource).source;
  const v1 = v2
    .replace(cursorSubagentModelDisplayPatchMarker, legacyCursorSubagentModelDisplayPatchMarker)
    .replace(
      'return e.resumeTargetComposerId!==void 0?e.subagentModelName:e.bestOfNModelName!==void 0?e.bestOfNModelName:e.taskParamModelName?.startsWith("opencodex/")?e.taskParamModelName:e.taskParamModelName?.startsWith("composer-")&&e.subagentModelName?.startsWith("opencodex/")?e.subagentModelName:e.taskParamModelName??e.subagentModelName',
      'return e.subagentModelName?.startsWith("opencodex/")?e.subagentModelName:e.resumeTargetComposerId!==void 0?e.subagentModelName:e.bestOfNModelName!==void 0?e.bestOfNModelName:e.taskParamModelName??e.subagentModelName',
    );
  const upgraded = patchCursorSubagentModelDisplaySource(v1);
  const displayModel = new Function(`${upgraded.source};return displayModel`)();

  assert.equal(upgraded.status, "patched");
  assert.doesNotMatch(upgraded.source, new RegExp(legacyCursorSubagentModelDisplayPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(displayModel({
    taskParamModelName: "opencodex/claude-fable-5",
    subagentModelName: "opencodex/gpt-5.6-sol",
  }), "opencodex/claude-fable-5");
});

test("prefers the routed subagent marker over the persisted parent model", () => {
  const display = patchCursorSubagentModelDisplaySource(subagentModelDisplaySource).source;
  const result = patchCursorSubagentTaskArgsDisplaySource(`${display}${subagentTaskCardSource}`);
  const taskCard = new Function(`${result.source};return taskCard`)();

  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorSubagentTaskArgsDisplayPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(taskCard({
    args: {
      model: "opencodex/gpt-5.6-sol",
      prompt: "<ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>\nReply.",
    },
    params: {
      model: "opencodex/gpt-5.6-sol",
      prompt: "<ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>\nReply.",
    },
    additionalData: { modelConfig: { modelName: "opencodex/gpt-5.6-sol" } },
  }), "opencodex/claude-fable-5");
  assert.equal(patchCursorSubagentTaskArgsDisplaySource(result.source).status, "already-patched");
});

test("patches the direct task-card context used by current Cursor builds", () => {
  const display = patchCursorSubagentModelDisplaySource(subagentModelDisplaySource).source;
  const result = patchCursorSubagentTaskArgsDisplaySource(`${display}${directSubagentTaskCardSource}`);
  const directTaskCard = new Function(`${result.source};return directTaskCard`)();

  assert.equal(result.status, "patched");
  assert.equal(directTaskCard({
    bubble: {
      params: {
        name: "generalPurpose",
        prompt: "<ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>\nReply.",
      },
    },
    taskModel: "opencodex/gpt-5.6-sol",
  }), "opencodex/claude-fable-5");
});

test("upgrades the task args display patch to recover models from routing markers", () => {
  const display = patchCursorSubagentModelDisplaySource(subagentModelDisplaySource).source;
  const v1 = `${display}${subagentTaskCardSource}`.replace(
    "taskParamModelName:k",
    `taskParamModelName:${legacyCursorSubagentTaskArgsDisplayPatchMarker}k??_?.model`,
  );
  const upgraded = patchCursorSubagentTaskArgsDisplaySource(v1);
  const taskCard = new Function(`${upgraded.source};return taskCard`)();

  assert.equal(upgraded.status, "patched");
  assert.doesNotMatch(upgraded.source, new RegExp(legacyCursorSubagentTaskArgsDisplayPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(taskCard({
    args: {
      model: "opencodex/gpt-5.6-sol",
      prompt: "<ocx-subagent-model>opencodex/claude-fable-5</ocx-subagent-model>",
    },
    params: { model: "opencodex/gpt-5.6-sol" },
    additionalData: { modelConfig: { modelName: "opencodex/gpt-5.6-sol" } },
  }), "opencodex/claude-fable-5");
});

test("hides generated routed agent types without changing other custom subagents", () => {
  const result = patchCursorRoutedSubagentTypesSource(subagentLoaderSource);
  assert.equal(result.status, "patched");
  assert.match(result.source, new RegExp(cursorRoutedSubagentTypesPatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const context = new Function(`${result.source};return context`)();
  const subagents = [
    { name: "ocx-claude-fable-5", prompt: "<!-- generated-by: opencodex -->" },
    { name: "ocx-cursor-model-anthropic-claude-fable-5", prompt: "<!-- generated-by: ocx-cursor -->" },
    { name: "manual", prompt: "Keep me" },
  ];

  assert.deepEqual(context.call({ subagentsService: { peekRawSubagents: () => subagents } }), [subagents[2]]);
  assert.deepEqual(context.call({ subagentsService: { peekRawSubagents: () => undefined } }), []);
  assert.equal(patchCursorRoutedSubagentTypesSource(result.source).status, "already-patched");
});

test("restores stored OpenCodex models missing from Cursor's refreshed catalog", () => {
  const executableSource = `function refresh(models){const plain=value=>value,batch=callback=>callback();let catalog=models;catalog=catalog.map(item=>plain(item)),batch(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",catalog)});return catalog}${byokSource}${subagentSource}${agentRequestSource}${subagentExecutionSource}${subagentModelDisplaySource}${subagentTaskCardSource}${subagentLoaderSource}`;
  const patched = patchCursorWorkbenchSource(executableSource);
  const refresh = new Function(`${patched.source};return refresh`)();
  const missingStoredModel = {
    name: "opencodex/cursor/kimi-k3",
    clientDisplayName: "Cursor Kimi K3",
    parameterDefinitions: [{ id: "reasoning" }],
  };
  const existingStoredModel = {
    name: "opencodex/claude-opus-5",
    clientDisplayName: "Claude Opus 5",
  };
  let persisted;
  const context = {
    _reactiveStorageService: {
      applicationUserPersistentStorage: {
        availableDefaultModels2: [missingStoredModel, existingStoredModel, { name: "custom/unmanaged" }],
      },
      setApplicationUserPersistentStorage(key, value) {
        assert.equal(key, "availableDefaultModels2");
        persisted = value;
      },
    },
  };

  const result = refresh.call(context, [
    { name: "cursor/native" },
    { name: existingStoredModel.name, clientDisplayName: "Server name" },
  ]);

  assert.deepEqual(result.map(({ name }) => name), [
    "cursor/native",
    existingStoredModel.name,
    missingStoredModel.name,
  ]);
  assert.equal(result[1].clientDisplayName, "Claude Opus 5");
  assert.equal(result[2].clientDisplayName, "Cursor Kimi K3");
  assert.deepEqual(persisted, result);
  assert.equal(result.some(({ name }) => name === "custom/unmanaged"), false);
});

test("upgrades the legacy metadata hook", () => {
  const legacy = source.replace(
    'c=c.map(z=>XTt(z)),',
    'c=c.map(z=>XTt(z)),/*ocx-cursor-model-metadata*/c=c.map(ocxCursorModel=>{const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name&&ocxCursorCandidate.name.startsWith("opencodex/"));return ocxCursorStored?{...ocxCursorModel,parameterDefinitions:ocxCursorStored.parameterDefinitions??[],variants:ocxCursorStored.variants??[],legacySlugs:ocxCursorStored.legacySlugs??[],supportsThinking:ocxCursorStored.supportsThinking??ocxCursorModel.supportsThinking}:ocxCursorModel}),',
  );
  const result = patchCursorWorkbenchSource(legacy);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata-v6/);
  assert.doesNotMatch(result.source, /ocx-cursor-model-metadata\*\//);
  assert.match(result.source, /clientDisplayName:ocxCursorDisplayName/);
});

test("upgrades the v2 metadata hook", () => {
  const v2 = source.replace(
    'c=c.map(z=>XTt(z)),',
    'c=c.map(z=>XTt(z)),/*ocx-cursor-model-metadata-v2*/c=c.map(ocxCursorModel=>{const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name&&ocxCursorCandidate.name.startsWith("opencodex/"));return ocxCursorStored?{...ocxCursorModel,clientDisplayName:ocxCursorStored.clientDisplayName??ocxCursorModel.clientDisplayName,inputboxShortModelName:ocxCursorStored.inputboxShortModelName??ocxCursorModel.inputboxShortModelName,parameterDefinitions:ocxCursorStored.parameterDefinitions??[],variants:ocxCursorStored.variants??[],legacySlugs:ocxCursorStored.legacySlugs??[],supportsThinking:ocxCursorStored.supportsThinking??ocxCursorModel.supportsThinking}:ocxCursorModel}),',
  );
  const result = patchCursorWorkbenchSource(v2);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata-v6/);
  assert.doesNotMatch(result.source, /ocx-cursor-model-metadata-v2/);
  assert.match(result.source, /ocxCursorDisplayWords/);
});

test("upgrades the v3 metadata hook and prefers fresh picker metadata", () => {
  const v3 = source.replace(
    'c=c.map(z=>XTt(z)),',
    'c=c.map(z=>XTt(z)),/*ocx-cursor-model-metadata-v3*/c=c.map(ocxCursorModel=>{const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name);const ocxCursorVariants=(ocxCursorStored?.variants??ocxCursorModel.variants??[]);return{...ocxCursorModel,parameterDefinitions:ocxCursorStored?.parameterDefinitions??ocxCursorModel.parameterDefinitions??[],variants:ocxCursorVariants}}),',
  );
  const result = patchCursorWorkbenchSource(v3);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata-v6/);
  assert.doesNotMatch(result.source, /ocx-cursor-model-metadata-v3/);
  assert.match(result.source, /ocxCursorModel\.parameterDefinitions\.length>0/);
  assert.match(result.source, /ocxCursorModel\.variants\.length>0/);
});

test("upgrades the v5 metadata hook to restore missing models", () => {
  const v5 = patchCursorWorkbenchSource(source).source.replace(cursorPatchMarker, "/*ocx-cursor-model-metadata-v5*/");
  const result = patchCursorWorkbenchSource(v5);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata-v6/);
  assert.doesNotMatch(result.source, /ocx-cursor-model-metadata-v5/);
  assert.match(result.source, /ocxCursorStoredModel/);
  assert.equal(patchCursorWorkbenchSource(result.source).status, "already-patched");
});

test("matches minified variable renames and is idempotent", () => {
  const renamed = `let models=response.models;models=models.map(item=>plain(item)),batch(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",models)});${byokSource}${subagentSource}${agentRequestSource}${subagentExecutionSource}${subagentModelDisplaySource}${subagentTaskCardSource}${subagentLoaderSource}`;
  const first = patchCursorWorkbenchSource(renamed);
  assert.equal(first.status, "patched");
  const second = patchCursorWorkbenchSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

test("fails closed when Cursor changes the catalog storage structure", () => {
  assert.throws(() => patchCursorWorkbenchSource("different Cursor bundle"), /found 0/);
});

test("enables Cursor local mode and is idempotent", () => {
  const first = patchCursorLocalModeSource("const flags={localMode:!1}");
  assert.equal(first.status, "patched");
  assert.match(first.source, new RegExp(cursorLocalModeEnabled));
  const second = patchCursorLocalModeSource(first.source);
  assert.equal(second.status, "already-patched");
  assert.equal(second.source, first.source);
});

test("patches local mode and catalog metadata together", () => {
  const result = patchCursorBundleSource(source, { preserveCatalogMetadata: true });
  assert.equal(result.status, "patched");
  assert.match(result.source, /localMode:!0/);
  assert.match(result.source, /ocx-cursor-model-metadata/);
});

test("fails closed when a bundle has no local mode flag", () => {
  assert.throws(() => patchCursorLocalModeSource("const flags={}"), /was not found/);
});

test("backs up and atomically patches a workbench file", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-patch-"));
  const file = join(directory, "workbench.js");
  const backups = join(directory, "backups");
  await writeFile(file, source);
  const result = await ensureCursorWorkbenchPatched({ file, backupDirectory: backups });
  assert.equal(result.status, "patched");
  assert.equal(await readFile(result.backupPath, "utf8"), source);
  const patched = await readFile(file, "utf8");
  assert.match(patched, /ocx-cursor-model-metadata/);
  assert.match(patched, /localMode:!0/);
});

test("serializes patches in a read-only app directory and restores its mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-readonly-patch-"));
  const appDirectory = join(directory, "app");
  const files = [join(appDirectory, "desktop.js"), join(appDirectory, "glass.js")];
  await mkdir(appDirectory);
  await Promise.all(files.map((file) => writeFile(file, source)));
  await chmod(appDirectory, 0o555);

  const results = await Promise.all(files.map((file) => ensureCursorModelMetadataPatched({
    file,
    backupDirectory: join(directory, "backups"),
  })));

  assert.deepEqual(results.map(({ status }) => status), ["patched", "patched"]);
  for (const file of files) assert.match(await readFile(file, "utf8"), /ocx-cursor-model-metadata-v6/);
  assert.equal((await stat(appDirectory)).mode & 0o777, 0o555);
});

test("patches model metadata without enabling local mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-metadata-patch-"));
  const file = join(directory, "workbench.js");
  await writeFile(file, source);
  const result = await ensureCursorModelMetadataPatched({
    file,
    backupDirectory: join(directory, "backups"),
  });
  const patched = await readFile(file, "utf8");
  assert.equal(result.status, "patched");
  assert.match(patched, /ocx-cursor-model-metadata/);
  assert.match(patched, /localMode:!1/);
  assert.doesNotMatch(patched, /localMode:!0/);
});

test("applies the complete Cursor patch set", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-app-patch-"));
  const bundle = join(directory, "workbench.js");
  const runtime = join(directory, "runtime.js");
  await writeFile(bundle, source);
  await writeFile(runtime, localRuntimeSource);

  const results = await ensureCursorAppPatched({
    bundleFiles: [bundle],
    localRuntimeFiles: [runtime],
    backupDirectory: join(directory, "backups"),
  });

  assert.equal(results.length, 2);
  assert.match(await readFile(bundle, "utf8"), /localMode:!0/);
  assert.match(await readFile(runtime, "utf8"), /ocx-cursor-local-model-display/);
});

test("monitors bundles and local runtimes after Cursor updates", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-app-monitor-"));
  const bundle = join(directory, "bundle.js");
  const runtime = join(directory, "runtime.js");
  await writeFile(bundle, "const flags={localMode:!1}");
  await writeFile(runtime, localRuntimeSource);
  const monitor = startCursorPatchMonitor({
    bundleFiles: [bundle],
    localRuntimeFiles: [runtime],
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
  });
  try {
    await monitor.check();
    assert.match(await readFile(bundle, "utf8"), /localMode:!0/);
    assert.match(await readFile(runtime, "utf8"), /ocx-cursor-local-model-display/);
  } finally {
    monitor.stop();
  }
});

test("monitors model metadata without enabling local mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-metadata-monitor-"));
  const file = join(directory, "workbench.js");
  await writeFile(file, source);
  const monitor = startCursorModelMetadataPatchMonitor({
    bundleFiles: [file],
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
  });
  try {
    await monitor.check();
    const patched = await readFile(file, "utf8");
    assert.match(patched, /ocx-cursor-model-metadata/);
    assert.match(patched, /localMode:!1/);
    assert.doesNotMatch(patched, /localMode:!0/);
  } finally {
    monitor.stop();
  }
});

test("finalizes each successful patch batch once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-finalize-monitor-"));
  const files = [join(directory, "desktop.js"), join(directory, "glass.js")];
  await Promise.all(files.map((file) => writeFile(file, source)));
  const batches = [];
  const ready = [];
  const monitor = startCursorModelMetadataPatchMonitor({
    bundleFiles: files,
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
    onPatched: (results) => batches.push(results),
    onReady: (results) => ready.push(results),
  });
  try {
    await monitor.check();
    await monitor.check();
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].map(({ file }) => file).sort(), files.sort());
    assert.equal(ready.length, 1);
    assert.deepEqual(ready[0].map(({ file }) => file).sort(), files.sort());
  } finally {
    monitor.stop();
  }
});

test("retries a patch batch when app finalization fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-finalize-retry-"));
  const file = join(directory, "workbench.js");
  const errors = [];
  let attempts = 0;
  await writeFile(file, source);
  const monitor = startCursorModelMetadataPatchMonitor({
    bundleFiles: [file],
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
    onReady: () => {
      attempts += 1;
      if (attempts === 1) throw new Error("codesign failed");
    },
    onError: (error) => errors.push(error.message),
  });
  try {
    await monitor.check();
    await monitor.check();
    assert.equal(attempts, 2);
    assert.deepEqual(errors, ["codesign failed"]);
  } finally {
    monitor.stop();
  }
});

test("finalizes a partial patch batch without marking it ready", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-partial-patch-"));
  const good = join(directory, "desktop.js");
  const incompatible = join(directory, "glass.js");
  const finalized = [];
  const ready = [];
  const errors = [];
  await writeFile(good, source);
  await writeFile(incompatible, "const incompatibleCursorBuild=true");
  const monitor = startCursorModelMetadataPatchMonitor({
    bundleFiles: [good, incompatible],
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
    onPatched: (results) => finalized.push(results),
    onReady: (results) => ready.push(results),
    onError: (error, file) => errors.push({ message: error.message, file }),
  });
  try {
    await monitor.check();
    assert.equal(finalized.length, 1);
    assert.deepEqual(finalized[0].map(({ file }) => file), [good]);
    assert.equal(ready.length, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].file, incompatible);
  } finally {
    monitor.stop();
  }
});

test("defers bundle patching until the application is not running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-monitor-"));
  const file = join(directory, "workbench.js");
  let shouldPatch = false;
  await writeFile(file, source);
  const monitor = startCursorPatchMonitor({
    file,
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
    shouldPatch: () => shouldPatch,
  });
  try {
    await monitor.check();
    assert.equal(await readFile(file, "utf8"), source);
    shouldPatch = true;
    await monitor.check();
    assert.match(await readFile(file, "utf8"), /ocx-cursor-model-metadata/);
  } finally {
    monitor.stop();
  }
});

test("waits for stable files and resets the delay while updates are running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-update-pause-"));
  const file = join(directory, "workbench.js");
  let now = 0;
  let updateRunning = true;
  await writeFile(file, source);
  const monitor = startCursorPatchMonitor({
    file,
    backupDirectory: join(directory, "backups"),
    intervalMs: 60_000,
    stableMs: 5_000,
    now: () => now,
    shouldPatch: () => !updateRunning,
  });
  try {
    await monitor.check();
    updateRunning = false;
    await monitor.check();
    now = 4_999;
    await monitor.check();
    assert.equal(await readFile(file, "utf8"), source);

    updateRunning = true;
    await monitor.check();
    updateRunning = false;
    now = 5_000;
    await monitor.check();
    now = 9_000;
    await writeFile(file, `${source}\n`);
    await monitor.check();
    now = 13_999;
    await monitor.check();
    assert.equal(await readFile(file, "utf8"), `${source}\n`);
    now = 14_000;
    await monitor.check();
    assert.match(await readFile(file, "utf8"), /ocx-cursor-model-metadata/);
  } finally {
    monitor.stop();
  }
});

test("monitor patches a bundle in a read-only app directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-retry-"));
  const backupDirectory = await mkdtemp(join(tmpdir(), "ocx-cursor-retry-backups-"));
  const file = join(directory, "workbench.js");
  const errors = [];
  await writeFile(file, source);
  await chmod(directory, 0o555);
  const monitor = startCursorPatchMonitor({
    file,
    backupDirectory,
    intervalMs: 60_000,
    onError: (error) => errors.push(error),
  });
  try {
    await monitor.check();
    assert.equal(errors.length, 0);
    assert.match(await readFile(file, "utf8"), /ocx-cursor-model-metadata/);
    assert.equal((await stat(directory)).mode & 0o777, 0o555);
  } finally {
    monitor.stop();
    await chmod(directory, 0o755);
  }
});
