import assert from "node:assert/strict";
import test from "node:test";
import { applyCatalogToState, cursorModel } from "../src/cursor-state.mjs";

const model = {
  alias: "opencodex/claude-sonnet-5",
  sourceId: "anthropic/claude-sonnet-5",
  provider: "anthropic",
  inputModalities: ["text", "image"],
  reasoningEfforts: ["low", "medium", "high"],
};

test("builds Cursor variants that its effort selector can cycle", () => {
  const value = cursorModel(model);
  assert.equal(value.supportsThinking, true);
  assert.equal(value.parameterDefinitions[0].id, "effort");
  assert.equal(value.parameterDefinitions[0].isCycleableByHotkey, true);
  assert.deepEqual(value.variants.map(({ variantStringRepresentation }) => variantStringRepresentation), [
    "opencodex/claude-sonnet-5[effort=low]",
    "opencodex/claude-sonnet-5[effort=medium]",
    "opencodex/claude-sonnet-5[effort=high]",
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
    },
  };

  applyCatalogToState(state, [model]);
  assert.deepEqual(state.availableDefaultModels2.map(({ name }) => name), [
    "cursor/builtin",
    "custom/keep",
    "opencodex/claude-sonnet-5",
  ]);
  assert.deepEqual(state.aiSettings.userAddedModels, ["custom/keep", "opencodex/claude-sonnet-5"]);
});
