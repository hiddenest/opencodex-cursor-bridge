import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { authorized, enrichModelList, normalizeCursorChatMessages, rewriteModelAliasBody, startGateway } from "../src/gateway.mjs";

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

test("normalizes Cursor Anthropic-shaped Task tools and enriches model aliases", () => {
  const request = {
    model: "opencodex/gpt-5.6-sol",
    tools: [{
      name: "Task",
      description: "Launch a task.",
      input_schema: {
        type: "object",
        properties: { model: { type: "string", enum: ["inherit"] } },
      },
      strict: true,
    }],
    tool_choice: { type: "auto" },
  };
  const original = JSON.stringify(request);
  const rewritten = JSON.parse(rewriteModelAliasBody(Buffer.from(original), [anthropic]));
  assert.deepEqual(rewritten.tools[0], {
    type: "function",
    function: {
      name: "Task",
      description: "Launch a task.",
      parameters: {
        type: "object",
        properties: {
          model: {
            type: "string",
            enum: ["inherit", "opencodex/claude-sonnet-5"],
          },
        },
      },
      strict: false,
    },
  });
  assert.equal(rewritten.tool_choice, "auto");
  assert.equal(JSON.stringify(request), original);
});

test("normalizes Cursor tool-use history into OpenAI chat messages", () => {
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "text", text: "Before" },
        { type: "tool_use", id: "call-a", name: "Task", input: { model: "opencodex/claude-sonnet-5" } },
        { type: "tool_use", id: "call-b", name: "Task", input: { model: "opencodex/gpt-5.6-sol" } },
        { type: "text", text: "After" },
      ],
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Result heading" },
        { type: "tool_result", tool_use_id: "call-a", content: [{ type: "text", text: "CHILD_A" }] },
        { type: "tool_result", tool_use_id: "call-b", content: "CHILD_B" },
        { type: "text", text: "Result footer" },
      ],
    },
  ];
  const normalized = normalizeCursorChatMessages(messages);
  assert.deepEqual(normalized, [
    {
      role: "assistant",
      content: [{ type: "text", text: "Before" }, { type: "text", text: "After" }],
      tool_calls: [
        { id: "call-a", type: "function", function: { name: "Task", arguments: '{"model":"opencodex/claude-sonnet-5"}' } },
        { id: "call-b", type: "function", function: { name: "Task", arguments: '{"model":"opencodex/gpt-5.6-sol"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call-a", content: "CHILD_A" },
    { role: "tool", tool_call_id: "call-b", content: "CHILD_B" },
    { role: "user", content: [{ type: "text", text: "Result heading" }, { type: "text", text: "Result footer" }] },
  ]);
  assert.deepEqual(messages[0].content[1], { type: "tool_use", id: "call-a", name: "Task", input: { model: "opencodex/claude-sonnet-5" } });
});

test("preserves malformed tool blocks and deduplicates existing OpenAI calls", () => {
  const malformed = [{
    role: "assistant",
    content: [{ type: "tool_use", name: "Task", input: {} }],
  }, {
    role: "user",
    content: [{ type: "tool_result", content: "missing id" }],
  }];
  assert.deepEqual(normalizeCursorChatMessages(malformed), malformed);

  const existingCall = { id: "call-1", type: "function", function: { name: "Task", arguments: "{}" } };
  const deduped = normalizeCursorChatMessages([{
    role: "assistant",
    content: [{ type: "tool_use", id: "call-1", name: "Task", input: { changed: true } }],
    tool_calls: [existingCall],
  }]);
  assert.deepEqual(deduped, [{ role: "assistant", content: null, tool_calls: [existingCall] }]);

  const standard = [
    { role: "assistant", content: null, tool_calls: [existingCall] },
    { role: "tool", tool_call_id: "call-1", content: "done" },
  ];
  assert.deepEqual(normalizeCursorChatMessages(standard), standard);
});

test("normalizes Anthropic tool-choice variants and leaves standard tools unchanged", () => {
  const standard = { type: "function", function: { name: "Task", parameters: { type: "object" } } };
  for (const [choice, expected] of [
    [{ type: "none" }, "none"],
    [{ type: "any" }, "required"],
    [{ type: "tool", name: "Task" }, { type: "function", function: { name: "Task" } }],
  ]) {
    const body = Buffer.from(JSON.stringify({ model: "opencodex/gpt-5.6-sol", tools: [standard], tool_choice: choice }));
    const rewritten = JSON.parse(rewriteModelAliasBody(body, [openai]));
    assert.deepEqual(rewritten.tool_choice, expected);
    assert.deepEqual(rewritten.tools, [standard]);
  }
});

test("preserves native Anthropic tool shapes on the Messages route", () => {
  const request = {
    model: "opencodex/claude-sonnet-5",
    tools: [{
      name: "Task",
      description: "Launch a task.",
      input_schema: { type: "object", properties: { model: { type: "string" } } },
    }],
    tool_choice: { type: "auto" },
    messages: [],
  };
  const rewritten = JSON.parse(rewriteModelAliasBody(
    Buffer.from(JSON.stringify(request)),
    [anthropic],
    "POST /v1/messages",
  ));
  assert.equal(rewritten.model, "anthropic/claude-sonnet-5");
  assert.deepEqual(rewritten.tools, request.tools);
  assert.deepEqual(rewritten.tool_choice, request.tool_choice);
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

test("adds OpenCodex aliases to Cursor's Subagent model instructions", () => {
  const description = [
    "Launch a specialized subagent.",
    "",
    "If the user explicitly asks for the model of a subagent/task, you may ONLY use model slugs from this list:",
    "- inherit (default; required unless the user explicitly requested another model)",
    "- composer-2.5-fast",
    "",
    "If the user isn't asking for a specific version, prefer the latest version of the model family.",
  ].join("\n");
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol",
    messages: [],
    tools: [{
      type: "function",
      function: {
        name: "Subagent",
        description,
        parameters: {
          type: "object",
          properties: {
            model: {
              type: "string",
              enum: ["inherit", "composer-2.5-fast"],
              description: "Optional model slug for this agent.",
            },
          },
        },
      },
    }],
  }));

  const rewritten = JSON.parse(rewriteModelAliasBody(body, [anthropic, openai]));
  const tool = rewritten.tools[0].function;
  assert.match(tool.description, /- opencodex\/claude-sonnet-5/);
  assert.match(tool.description, /- opencodex\/gpt-5\.6-sol/);
  assert.match(tool.description, /If the user isn't asking for a specific version/);
  assert.deepEqual(tool.parameters.properties.model.enum, [
    "inherit",
    "composer-2.5-fast",
    "opencodex/claude-sonnet-5",
    "opencodex/gpt-5.6-sol",
  ]);
  assert.match(tool.parameters.properties.model.description, /Available OpenCodex model slugs: opencodex\/claude-sonnet-5, opencodex\/gpt-5\.6-sol/);
});

test("restores the routed OpenCodex model in marked parent messages", () => {
  const marker = "<ocx-subagent-model>opencodex/claude-sonnet-5</ocx-subagent-model>";
  const body = Buffer.from(JSON.stringify({
    model: "opencodex/gpt-5.6-sol",
    messages: [
      { role: "user", content: `composer-2.5 모델을 실행해.\n\n${marker}` },
      { role: "user", content: [{ type: "text", text: `composer-2.5 only\n${marker}` }] },
      { role: "user", content: "composer-2.5 without a routing marker" },
    ],
  }));

  const rewritten = JSON.parse(rewriteModelAliasBody(body, [anthropic, openai]));
  assert.match(rewritten.messages[0].content, /^opencodex\/claude-sonnet-5 모델을 실행해/);
  assert.match(rewritten.messages[1].content[0].text, /^opencodex\/claude-sonnet-5 only/);
  assert.equal(rewritten.messages[2].content, "composer-2.5 without a routing marker");
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

test("passes the Messages route through without Chat Completions tool normalization", async () => {
  let received;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  const gateway = startGateway({
    secret: "bridge-secret",
    getCatalog: () => [anthropic],
    host: "127.0.0.1",
    port: 0,
    upstream: { host: "127.0.0.1", port: upstreamAddress.port },
    serviceToken: "",
  });
  await once(gateway, "listening");
  const gatewayAddress = gateway.address();
  const request = {
    model: "opencodex/claude-sonnet-5",
    tools: [{ name: "Task", input_schema: { type: "object" } }],
    tool_choice: { type: "auto" },
    messages: [],
  };
  await new Promise((resolve, reject) => {
    const client = http.request({
      hostname: "127.0.0.1",
      port: gatewayAddress.port,
      method: "POST",
      path: "/v1/messages",
      headers: { authorization: "Bearer bridge-secret", "content-type": "application/json" },
    }, (res) => {
      res.resume();
      res.once("end", resolve);
    });
    client.once("error", reject);
    client.end(JSON.stringify(request));
  });
  assert.equal(received.model, "anthropic/claude-sonnet-5");
  assert.deepEqual(received.tools, request.tools);
  assert.deepEqual(received.tool_choice, request.tool_choice);
  await Promise.all([
    new Promise((resolve) => gateway.close(resolve)),
    new Promise((resolve) => upstream.close(resolve)),
  ]);
});

test("forwards normalized Cursor tool history on Chat Completions", async () => {
  let received;
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  const gateway = startGateway({
    secret: "bridge-secret", getCatalog: () => [openai], host: "127.0.0.1", port: 0,
    upstream: { host: "127.0.0.1", port: upstreamAddress.port }, serviceToken: "",
  });
  await once(gateway, "listening");
  const request = {
    model: "opencodex/gpt-5.6-sol",
    messages: [
      { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "Task", input: { description: "reply" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: [{ type: "text", text: "CHILD_OK" }] }] },
    ],
  };
  const address = gateway.address();
  await new Promise((resolve, reject) => {
    const client = http.request({ hostname: "127.0.0.1", port: address.port, method: "POST", path: "/v1/chat/completions", headers: { authorization: "Bearer bridge-secret", "content-type": "application/json" } }, (res) => { res.resume(); res.once("end", resolve); });
    client.once("error", reject); client.end(JSON.stringify(request));
  });
  assert.deepEqual(received.messages[0].tool_calls, [{ id: "call-1", type: "function", function: { name: "Task", arguments: '{"description":"reply"}' } }]);
  assert.deepEqual(received.messages[1], { role: "tool", tool_call_id: "call-1", content: "CHILD_OK" });
  await Promise.all([new Promise((resolve) => gateway.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
});
