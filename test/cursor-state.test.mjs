import assert from "node:assert/strict";
import test from "node:test";
import { applyCatalogToState, cursorModel } from "../src/cursor-state.mjs";

const model = {
  alias: "opencodex/claude-sonnet-5",
  sourceId: "anthropic/claude-sonnet-5",
  provider: "anthropic",
  inputModalities: ["text", "image"],
  reasoningEfforts: ["low", "medium", "high"],
  supportsFast: true,
};

test("builds Cursor variants for effort and Fast selectors", () => {
  const value = cursorModel(model);
  assert.equal(value.supportsThinking, true);
  assert.equal(value.parameterDefinitions[0].id, "effort");
  assert.equal(value.parameterDefinitions[0].isCycleableByHotkey, true);
  assert.equal(value.parameterDefinitions[1].id, "fast");
  assert.equal(value.parameterDefinitions[1].parameterType.booleanParameter.values[1].increasesModelCost, true);
  assert.deepEqual(value.variants.map(({ variantStringRepresentation }) => variantStringRepresentation), [
    "opencodex/claude-sonnet-5[effort=low,fast=false]",
    "opencodex/claude-sonnet-5[effort=low,fast=true]",
    "opencodex/claude-sonnet-5[effort=medium,fast=false]",
    "opencodex/claude-sonnet-5[effort=medium,fast=true]",
    "opencodex/claude-sonnet-5[effort=high,fast=false]",
    "opencodex/claude-sonnet-5[effort=high,fast=true]",
  ]);
});

test("replaces only bridge-managed user models", () => {
  const state = {
    availableDefaultModels2: [
      { name: "cursor/builtin" },
      { name: "custom/keep", isUserAdded: true },
      { name: "opencodex/stale", isUserAdded: true },
    ],
    aiSettings: {
      userAddedModels: ["custom/keep", "opencodex/stale"],
      modelOverrideEnabled: ["custom/keep", "opencodex/stale"],
      modelConfig: { composer: { selectedModels: [{ modelId: model.alias, parameters: [{ id: "fast", value: "true" }] }] } },
    },
  };

  applyCatalogToState(state, [model]);
  assert.deepEqual(state.availableDefaultModels2.map(({ name }) => name), [
    "cursor/builtin",
    "custom/keep",
    "opencodex/claude-sonnet-5",
  ]);
  assert.deepEqual(state.aiSettings.userAddedModels, ["custom/keep", "opencodex/claude-sonnet-5"]);
  assert.deepEqual(state.aiSettings.modelConfig.composer.selectedModels[0].parameters, [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ]);
});
