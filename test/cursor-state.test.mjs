import assert from "node:assert/strict";
import test from "node:test";
import { applyCatalogToState, cursorModel, displayNameFor } from "../src/cursor-state.mjs";

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
  assert.equal(value.clientDisplayName, "Claude Sonnet 5");
  assert.equal(value.inputboxShortModelName, "Claude Sonnet 5");
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
  assert.match(value.variants[4].displayName, /^Claude Sonnet 5 /);
});

test("formats provider model ids as human-readable names", () => {
  assert.equal(displayNameFor({ sourceId: "openai/gpt-5.6-sol" }), "GPT 5.6 Sol");
  assert.equal(displayNameFor({ sourceId: "anthropic/claude-opus-5" }), "Claude Opus 5");
  assert.equal(displayNameFor({ sourceId: "cursor/kimi-k3", provider: "cursor" }), "Cursor Kimi K3");
  assert.equal(displayNameFor({ sourceId: "opencode-go/deepseek-v4-flash" }), "DeepSeek V4 Flash");
  assert.equal(displayNameFor({ sourceId: "opencode-go/qwen3.8-max" }), "Qwen 3.8 Max");
});

test("replaces only bridge-managed user models", () => {
  const state = {
    availableDefaultModels2: [
      { name: "cursor/builtin" },
      { name: "custom/keep", isUserAdded: true },
      { name: "opencodex/stale" },
    ],
    aiSettings: {
      userAddedModels: ["custom/keep", "opencodex/stale"],
      modelOverrideEnabled: ["custom/keep", "opencodex/stale"],
      modelParameterPreferences: {
        "custom/keep": { modelId: "custom/keep" },
        "opencodex/stale": { modelId: "opencodex/stale" },
        [model.alias]: { modelId: model.alias },
      },
      modelConfig: { composer: { selectedModels: [
        { modelId: "custom/keep", parameters: [] },
        { modelId: "opencodex/stale", parameters: [] },
        { modelId: model.alias, parameters: [{ id: "fast", value: "true" }] },
      ] } },
    },
  };

  applyCatalogToState(state, [model]);
  assert.deepEqual(state.availableDefaultModels2.map(({ name }) => name), [
    "cursor/builtin",
    "custom/keep",
    "opencodex/claude-sonnet-5",
  ]);
  assert.deepEqual(state.aiSettings.userAddedModels, ["custom/keep", "opencodex/claude-sonnet-5"]);
  assert.deepEqual(Object.keys(state.aiSettings.modelParameterPreferences), ["custom/keep", model.alias]);
  assert.deepEqual(state.aiSettings.modelConfig.composer.selectedModels.map(({ modelId }) => modelId), ["custom/keep", model.alias]);
  assert.deepEqual(state.aiSettings.modelConfig.composer.selectedModels[1].parameters, [
    { id: "effort", value: "high" },
    { id: "fast", value: "true" },
  ]);
});
