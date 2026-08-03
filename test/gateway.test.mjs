import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { authorized, enrichModelList, rewriteModelAliasBody, startGateway } from "../src/gateway.mjs";

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

test("accepts bridge credentials from bearer and Anthropic API key headers", () => {
  const expected = Buffer.from("bridge-secret");

  assert.equal(authorized({ headers: { authorization: "Bearer bridge-secret" } }, expected), true);
  assert.equal(authorized({ headers: { "x-api-key": "bridge-secret" } }, expected), true);
  assert.equal(authorized({ headers: { authorization: "Bearer wrong", "x-api-key": "bridge-secret" } }, expected), true);
});

test("rejects missing or invalid bridge credentials", () => {
  const expected = Buffer.from("bridge-secret");

  assert.equal(authorized({ headers: {} }, expected), false);
  assert.equal(authorized({ headers: { authorization: "Bearer wrong" } }, expected), false);
  assert.equal(authorized({ headers: { "x-api-key": "wrong" } }, expected), false);
});

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

test("disables strict Chat Completions tools without changing their schemas", () => {
  const parameters = {
    type: "object",
    properties: {
      command: { type: "string" },
      options: {
        type: "object",
        properties: { timeout: { type: "number" } },
      },
    },
    required: ["command"],
  };
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol",
    messages: [],
    tools: [{
      type: "function",
      function: { name: "Shell", strict: true, parameters },
    }],
  }));

  const rewritten = JSON.parse(rewriteModelAliasBody(body, [openai]));
  assert.equal(rewritten.tools[0].function.strict, false);
  assert.deepEqual(rewritten.tools[0].function.parameters, parameters);
});

test("disables strict Responses tools and leaves other tools unchanged", () => {
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol",
    input: [],
    tools: [
      { type: "function", name: "Shell", strict: true, parameters: { type: "object" } },
      { type: "web_search" },
    ],
  }));

  const rewritten = JSON.parse(rewriteModelAliasBody(body, [openai]));
  assert.equal(rewritten.tools[0].strict, false);
  assert.deepEqual(rewritten.tools[1], { type: "web_search" });
});

test("advertises Anthropic aliases through the messages protocol", () => {
  const result = enrichModelList([], [anthropic]);
  assert.deepEqual(result.data[0].api_types, ["anthropic_messages"]);
  assert.deepEqual(result.data[0].capabilities.reasoning_effort, ["low", "medium", "high"]);
  assert.equal(result.data[0].capabilities.supports_vision, true);
});

test("cancels the upstream request when the Cursor client disconnects", async () => {
  let upstreamStarted;
  let upstreamClosed;
  const started = new Promise((resolve) => { upstreamStarted = resolve; });
  const closed = new Promise((resolve) => { upstreamClosed = resolve; });
  const upstream = http.createServer((req) => {
    upstreamStarted();
    req.once("close", upstreamClosed);
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");

  const upstreamAddress = upstream.address();
  const gateway = startGateway({
    secret: "bridge-secret",
    getCatalog: () => [],
    host: "127.0.0.1",
    port: 0,
    upstream: { host: "127.0.0.1", port: upstreamAddress.port },
    serviceToken: "",
  });
  await once(gateway, "listening");
  const gatewayAddress = gateway.address();

  const client = http.request({
    hostname: "127.0.0.1",
    port: gatewayAddress.port,
    method: "POST",
    path: "/v1/chat/completions",
    headers: {
      authorization: "Bearer bridge-secret",
      "content-type": "application/json",
    },
  });
  client.on("error", () => {});
  client.end(JSON.stringify({ model: "opencodex/gpt-test", messages: [] }));

  await started;
  client.destroy();
  await Promise.race([
    closed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("upstream request remained open")), 2_000)),
  ]);
  await Promise.all([
    new Promise((resolve) => gateway.close(resolve)),
    new Promise((resolve) => upstream.close(resolve)),
  ]);
});
