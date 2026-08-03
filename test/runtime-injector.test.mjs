import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRuntimeModelPatches,
  catalogPatchExpression,
  findCatalogHookLocation,
} from "../src/runtime-injector.mjs";

const anchor = "c=c.map(z=>XTt(z)),bp(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage(\"availableDefaultModels2\",c)";

test("finds the catalog storage breakpoint after model normalization", () => {
  assert.deepEqual(findCatalogHookLocation(`first line\nabc${anchor}tail`), {
    lineNumber: 1,
    columnNumber: "abc".length + "c=c.map(z=>XTt(z)),".length,
  });
});

test("rejects Cursor bundles without the expected catalog hook", () => {
  assert.throws(() => findCatalogHookLocation("different Cursor version"), /does not contain/);
});

test("builds runtime patches and changes only matching catalog entries", () => {
  const patches = buildRuntimeModelPatches([{
    alias: "opencodex/gpt-test",
    sourceId: "gpt-test",
    provider: "openai",
    inputModalities: ["text"],
    reasoningEfforts: ["low", "high"],
    supportsFast: true,
  }]);
  const models = [
    { name: "native-model", parameterDefinitions: [] },
    { name: "opencodex/gpt-test", parameterDefinitions: [] },
  ];
  const apply = new Function("c", `return ${catalogPatchExpression(patches)};`);
  assert.equal(apply(models), 1);
  assert.deepEqual(patches["opencodex/gpt-test"].parameterDefinitions.map(({ id }) => id), ["reasoning", "fast"]);
  assert.deepEqual(models[0].parameterDefinitions, []);
  assert.deepEqual(models[1].parameterDefinitions.map(({ id }) => id), ["reasoning", "fast"]);
});
