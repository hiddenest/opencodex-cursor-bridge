import assert from "node:assert/strict";
import test from "node:test";
import { enrichModelList, rewriteModelAliasBody } from "../src/gateway.mjs";

const anthropic = {
  alias: "opencodex/claude-sonnet-5",
  sourceId: "anthropic/claude-sonnet-5",
  provider: "anthropic",
  contextWindow: 200_000,
  inputModalities: ["text", "image"],
  reasoningEfforts: ["low", "medium", "high"],
  supportsFast: false,
};

const openai = {
  alias: "opencodex/gpt-5.6-sol",
  sourceId: "gpt-5.6-sol",
  provider: "openai",
  contextWindow: 272_000,
  inputModalities: ["text", "image"],
  reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  supportsFast: true,
};

test("rewrites a Cursor effort variant to the OpenCodex source model", () => {
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/claude-sonnet-5[effort=high]",
    messages: [],
  }));
  const rewritten = JSON.parse(rewriteModelAliasBody(body, [anthropic]));
  assert.equal(rewritten.model, "anthropic/claude-sonnet-5");
  assert.equal(rewritten.reasoning_effort, "high");
});

test("maps a Cursor Fast variant to OpenCodex priority service tier", () => {
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol[reasoning=high,fast=true]",
    messages: [],
  }));
  const rewritten = JSON.parse(rewriteModelAliasBody(body, [openai]));
  assert.equal(rewritten.model, "gpt-5.6-sol");
  assert.equal(rewritten.reasoning_effort, "high");
  assert.equal(rewritten.service_tier, "priority");
});

test("removes priority service tier when Fast is disabled", () => {
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol[reasoning=medium,fast=false]",
    service_tier: "priority",
    messages: [],
  }));
  const rewritten = JSON.parse(rewriteModelAliasBody(body, [openai]));
  assert.equal(rewritten.service_tier, undefined);
});

test("advertises Anthropic aliases through the messages protocol", () => {
  const result = enrichModelList([], [anthropic]);
  assert.deepEqual(result.data[0].api_types, ["anthropic_messages"]);
  assert.deepEqual(result.data[0].capabilities.reasoning_effort, ["low", "medium", "high"]);
  assert.equal(result.data[0].capabilities.supports_vision, true);
});
