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
  ensureCursorAppPatched,
  ensureCursorModelMetadataPatched,
  ensureCursorWorkbenchPatched,
  isCursorModelMetadataBundle,
  patchCursorBundleSource,
  patchCursorByokModelRoutingSource,
  patchCursorLocalModeSource,
  patchCursorLocalRuntimeSource,
  patchCursorWorkbenchSource,
  startCursorModelMetadataPatchMonitor,
  startCursorPatchMonitor,
} from "../src/cursor-patch.mjs";
import { cursorGlassWorkbenchFile, cursorWorkbenchFile } from "../src/paths.mjs";

const byokSource = 'function MNg(e){return e.startsWith("claude-")}function PNg(e){return e.startsWith("gemini-")}function aVu(e,t){return MNg(e)?t.useClaudeKey?"anthropic":void 0:PNg(e)?t.useGoogleKey?"google":void 0:t.useOpenAIKey?"openai":void 0}';
const source = `const flags={localMode:!1};let c=a.models;const k=h(c);c=c.map(z=>XTt(z)),bp(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",c)});${byokSource}`;
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

test("restores stored OpenCodex models missing from Cursor's refreshed catalog", () => {
  const executableSource = `function refresh(models){const plain=value=>value,batch=callback=>callback();let catalog=models;catalog=catalog.map(item=>plain(item)),batch(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",catalog)});return catalog}${byokSource}`;
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
  const renamed = `let models=response.models;models=models.map(item=>plain(item)),batch(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",models)});${byokSource}`;
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
