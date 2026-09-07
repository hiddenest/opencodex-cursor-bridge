import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aliasFor, buildActiveCatalog, normalizeActiveCatalog, priorityModelIds } from "../src/catalog.mjs";

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

test("infers allowed thinking efforts for active Claude Fable 5.1 rows without metadata", () => {
  const normalized = normalizeActiveCatalog(
    [{ provider: "anthropic", model: "claude-fable-5-1" }],
    [{ id: "anthropic/claude-fable-5-1", owned_by: "anthropic", capabilities: { supports_reasoning: false } }],
  );
  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0].reasoningEfforts, ["low", "medium", "high", "xhigh", "max"]);
});

test("folds synthetic Fast rows into a base model toggle regardless of listing order", () => {
  const base = { id: "gpt-6-astra", owned_by: "openai", capabilities: { reasoning_effort: ["low", "high"] } };
  const fast = { ...base, id: "gpt-6-astra--fast" };
  for (const active of [[fast, base], [base, fast]]) {
    const catalog = normalizeActiveCatalog([], active);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].sourceId, base.id);
    assert.equal(catalog[0].supportsFast, true);
    assert.deepEqual(catalog[0].reasoningEfforts, ["low", "high"]);
  }
});

test("preserves real Fast products, configured IDs, aliases, and rows without a base", () => {
  const ids = ["openai/product", "openai/product--fast", "aliased", "aliased--fast", "gpt-native", "gpt-native--fast", "grok-4", "grok-4-fast", "orphan--fast"];
  const catalog = normalizeActiveCatalog([
    { provider: "openai", model: "product--fast" },
    { provider: "custom", model: "real-model", alias: "aliased--fast" },
    { provider: "openai", model: "gpt-native--fast" },
  ], ids.map((id) => ({ id, owned_by: "openai" })));
  assert.deepEqual(catalog.map(({ sourceId }) => sourceId).sort(), [...ids].sort());
  assert.equal(catalog.some(({ supportsFast }) => supportsFast), false);
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

test("registers only active models and uses the Codex catalog only for Fast metadata", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-active-catalog-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "models.json");
  const ocxBin = join(directory, "ocx");
  await writeFile(ocxBin, `#!${process.execPath}
process.stdout.write(JSON.stringify({ models: [] }));
`, { mode: 0o755 });
  await writeFile(file, JSON.stringify({ models: [
    { slug: "gpt-5.2", visibility: "list", supported_in_api: true },
    {
      slug: "gpt-6-astra",
      visibility: "list",
      supported_in_api: true,
      context_window: 272_000,
      service_tiers: [{ id: "priority" }],
    },
  ] }));
  const options = {
    ocxBin,
    codexCatalogFile: file,
    fetchImpl: async () => Response.json({ data: [{
      id: "gpt-6-astra",
      owned_by: "openai",
      capabilities: { context_length: 872_000, reasoning_effort: ["low", "high"] },
    }] }),
  };
  const catalog = await buildActiveCatalog(options);
  assert.deepEqual(catalog.map(({ sourceId }) => sourceId), ["gpt-6-astra"]);
  assert.equal(catalog[0].contextWindow, 872_000);
  assert.equal(catalog[0].supportsFast, true);
  assert.deepEqual(catalog[0].reasoningEfforts, ["low", "high"]);
  assert.deepEqual(await buildActiveCatalog({
    ...options,
    fetchImpl: async () => Response.json({ data: [] }),
  }), []);
});
