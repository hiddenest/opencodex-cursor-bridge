import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aliasFor, codexNativeModels, normalizeActiveCatalog, priorityModelIds } from "../src/catalog.mjs";

test("aliases Anthropic models without exposing the provider segment", () => {
  assert.equal(aliasFor("anthropic/claude-sonnet-5"), "opencodex/claude-sonnet-5");
  assert.equal(aliasFor("openai/gpt-5.6-sol"), "opencodex/openai/gpt-5.6-sol");
});

test("normalizes active models except Cursor provider models", () => {
  const configured = [
    {
      provider: "anthropic",
      model: "claude-sonnet-5",
      contextWindow: 200_000,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["low", "high", "bogus"],
    },
    { provider: "openai", model: "not-active" },
    { provider: "cursor", model: "grok-4.5" },
  ];
  const active = [
    { id: "anthropic/claude-sonnet-5", owned_by: "anthropic" },
    { id: "gpt-5.6-sol", owned_by: "openai" },
    { id: "cursor/grok-4.5", owned_by: "cursor" },
    { id: "opencodex/internal", owned_by: "opencodex" },
  ];

  assert.deepEqual(normalizeActiveCatalog(configured, active, new Set(["gpt-5.6-sol"])), [
    {
      alias: "opencodex/claude-sonnet-5",
      sourceId: "anthropic/claude-sonnet-5",
      provider: "anthropic",
      contextWindow: 200_000,
      maxOutputTokens: undefined,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["low", "high"],
      supportsFast: false,
    },
    {
      alias: "opencodex/gpt-5.6-sol",
      sourceId: "gpt-5.6-sol",
      provider: "openai",
      contextWindow: undefined,
      maxOutputTokens: undefined,
      inputModalities: ["text", "image"],
      reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      supportsFast: true,
    },
  ]);
});

test("reads Fast support from the OpenCodex priority service tier", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-catalog-"));
  const file = join(directory, "models.json");
  await writeFile(file, JSON.stringify({ models: [
    { slug: "gpt-fast", service_tiers: [{ id: "priority" }] },
    { slug: "gpt-standard", service_tiers: [] },
  ] }));
  assert.deepEqual([...priorityModelIds(file)], ["gpt-fast"]);
});

test("reads visible native models from the Codex catalog", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-native-catalog-"));
  const file = join(directory, "models.json");
  await writeFile(file, JSON.stringify({ models: [
    {
      slug: "gpt-daybreak-blue-latest",
      visibility: "list",
      supported_in_api: true,
      context_window: 272_000,
      input_modalities: ["text", "image"],
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "ultra" }],
    },
    { slug: "gpt-hidden", visibility: "hide", supported_in_api: true },
    {
      slug: "anthropic/claude-sonnet-5",
      visibility: "list",
      supported_in_api: true,
    },
  ] }));

  assert.deepEqual(codexNativeModels(file), [{
    id: "gpt-daybreak-blue-latest",
    owned_by: "openai",
    capabilities: {
      input_modalities: ["text", "image"],
      context_length: 272_000,
      max_output_tokens: undefined,
      reasoning_effort: ["low", "high", "ultra"],
    },
  }]);
});
