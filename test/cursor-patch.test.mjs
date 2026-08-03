import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cursorLocalModeEnabled,
  cursorLocalRuntimePatchMarker,
  cursorPatchMarker,
  ensureCursorAppPatched,
  ensureCursorWorkbenchPatched,
  isCursorModelMetadataBundle,
  patchCursorBundleSource,
  patchCursorLocalModeSource,
  patchCursorLocalRuntimeSource,
  patchCursorWorkbenchSource,
  startCursorPatchMonitor,
} from "../src/cursor-patch.mjs";
import { cursorGlassWorkbenchFile, cursorWorkbenchFile } from "../src/paths.mjs";

const source = 'const flags={localMode:!1};let c=a.models;const k=h(c);c=c.map(z=>XTt(z)),bp(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",c)})';
const localRuntimeSource = 'function aFt(e,t){return new Ce.Gmx({modelId:e,displayModelId:e,displayName:null!=t?t:e,displayNameShort:null!=t?t:e,aliases:[]})}';

test("formats OpenCodex display names in the local model runtime", () => {
  const first = patchCursorLocalRuntimeSource(localRuntimeSource);
  assert.equal(first.status, "patched");
  assert.match(first.source, new RegExp(cursorLocalRuntimePatchMarker.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const Model = class { constructor(value) { Object.assign(this, value); } };
  const factory = new Function("Ce", `${first.source}; return aFt;`)({ Gmx: Model });
  assert.equal(factory("opencodex/gpt-5.6-sol").displayName, "GPT 5.6 Sol");
  assert.equal(factory("opencodex/claude-opus-5").displayName, "Claude Opus 5");
  assert.equal(factory("native-model").displayName, "native-model");
  assert.equal(factory("opencodex/gpt-5.6-sol", "Custom").displayName, "Custom");
  assert.equal(patchCursorLocalRuntimeSource(first.source).status, "already-patched");
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
  assert.match(result.source, /parameterDefinitions:ocxCursorStored\?\.parameterDefinitions/);
  assert.match(result.source, /clientDisplayName:ocxCursorDisplayName/);
  assert.ok(result.source.indexOf(cursorPatchMarker) < result.source.indexOf('setApplicationUserPersistentStorage("availableDefaultModels2"'));
});

test("upgrades the legacy metadata hook", () => {
  const legacy = source.replace(
    'c=c.map(z=>XTt(z)),',
    'c=c.map(z=>XTt(z)),/*ocx-cursor-model-metadata*/c=c.map(ocxCursorModel=>{const ocxCursorStored=(this._reactiveStorageService.applicationUserPersistentStorage.availableDefaultModels2??[]).find(ocxCursorCandidate=>ocxCursorCandidate?.name===ocxCursorModel.name&&ocxCursorCandidate.name.startsWith("opencodex/"));return ocxCursorStored?{...ocxCursorModel,parameterDefinitions:ocxCursorStored.parameterDefinitions??[],variants:ocxCursorStored.variants??[],legacySlugs:ocxCursorStored.legacySlugs??[],supportsThinking:ocxCursorStored.supportsThinking??ocxCursorModel.supportsThinking}:ocxCursorModel}),',
  );
  const result = patchCursorWorkbenchSource(legacy);
  assert.equal(result.status, "patched");
  assert.match(result.source, /ocx-cursor-model-metadata-v3/);
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
  assert.match(result.source, /ocx-cursor-model-metadata-v3/);
  assert.doesNotMatch(result.source, /ocx-cursor-model-metadata-v2/);
  assert.match(result.source, /ocxCursorDisplayWords/);
});

test("matches minified variable renames and is idempotent", () => {
  const renamed = 'let models=response.models;models=models.map(item=>plain(item)),batch(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage("availableDefaultModels2",models)})';
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

test("retries a bundle after a transient filesystem error", async () => {
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
    assert.equal(errors.length, 1);
    assert.equal(await readFile(file, "utf8"), source);
    await chmod(directory, 0o755);
    await monitor.check();
    assert.match(await readFile(file, "utf8"), /ocx-cursor-model-metadata/);
  } finally {
    monitor.stop();
    await chmod(directory, 0o755);
  }
});
