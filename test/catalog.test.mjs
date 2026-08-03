import assert from "node:assert/strict";
import test from "node:test";
import { aliasFor, normalizeActiveCatalog } from "../src/catalog.mjs";

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
    { id: "cursor/grok-4.5", owned_by: "cursor" },
    { id: "opencodex/internal", owned_by: "opencodex" },
  ];

  assert.deepEqual(normalizeActiveCatalog(configured, active), [{
    alias: "opencodex/claude-sonnet-5",
    sourceId: "anthropic/claude-sonnet-5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: undefined,
    inputModalities: ["text", "image"],
    reasoningEfforts: ["low", "high"],
  }]);
});
