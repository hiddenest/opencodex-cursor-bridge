import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aliasFor, normalizeActiveCatalog, priorityModelIds } from "../src/catalog.mjs";

test("aliases Anthropic models without exposing the provider segment", () => {
  assert.equal(aliasFor("anthropic/claude-sonnet-5"), "opencodex/claude-sonnet-5");
  assert.equal(aliasFor("openai/gpt-5.6-sol"), "opencodex/openai/gpt-5.6-sol");
});

test("normalizes only models returned by the active OpenCodex endpoint", () => {
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
      alias: "opencodex/cursor/grok-4.5",
      sourceId: "cursor/grok-4.5",
      provider: "cursor",
      contextWindow: undefined,
      maxOutputTokens: undefined,
      inputModalities: ["text", "image"],
      reasoningEfforts: [],
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
