import http from "node:http";
import { readFile } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { activeModels, allowedEfforts, opencodexEndpoint } from "./catalog.mjs";
import { gatewayHost, gatewayPort, managedPrefix, opencodexServiceTokenFile } from "./paths.mjs";

const maxBodyBytes = 24 * 1024 * 1024;
const allowedRoutes = new Set([
  "GET /v1/models",
  "POST /v1/responses",
  "POST /v1/responses/compact",
  "POST /v1/chat/completions",
  "POST /v1/messages",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function suppliedEffort(payload, variantText) {
  const variantEffort = variantText
    ?.split(",")
    .map((value) => value.split("=", 2))
    .find(([key]) => key === "effort" || key === "reasoning")?.[1];
  return variantEffort
    || payload.reasoning_effort
    || payload.reasoning?.effort
    || payload.output_config?.effort
    || payload.reasoningEffort;
}

function suppliedFast(variantText) {
  return variantText
    ?.split(",")
    .map((value) => value.split("=", 2))
    .find(([key]) => key === "fast")?.[1];
}

function disableStrictFunctionTools(tools) {
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!isRecord(tool) || tool.type !== "function") continue;
    const definition = isRecord(tool.function) ? tool.function : tool;
    if (definition.strict === true) definition.strict = false;
  }
}

function normalizeCursorTool(tool) {
  if (!isRecord(tool) || tool.type !== undefined || typeof tool.name !== "string" || !isRecord(tool.input_schema)) {
    return tool;
  }
  const definition = {
    name: tool.name,
    ...(typeof tool.description === "string" ? { description: tool.description } : {}),
    parameters: tool.input_schema,
    ...(typeof tool.strict === "boolean" ? { strict: tool.strict } : {}),
  };
  return { type: "function", function: definition };
}

function normalizeToolChoice(choice) {
  if (!isRecord(choice) || typeof choice.type !== "string") return choice;
  if (choice.type === "auto") return "auto";
  if (choice.type === "none") return "none";
  if (choice.type === "any") return "required";
  if (choice.type === "tool" && typeof choice.name === "string") {
    return { type: "function", function: { name: choice.name } };
  }
  return choice;
}

function normalizeCursorTooling(payload) {
  if (Array.isArray(payload.tools)) payload.tools = payload.tools.map(normalizeCursorTool);
  if (payload.tool_choice !== undefined) payload.tool_choice = normalizeToolChoice(payload.tool_choice);
}

function toolResultText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(toolResultText).filter(Boolean).join("\n");
  if (isRecord(value)) {
    if (typeof value.text === "string") return value.text;
    if (value.content !== undefined) return toolResultText(value.content);
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return value === undefined || value === null ? "" : String(value);
}

function openAiToolCallFromCursorBlock(block) {
  let args = "{}";
  try {
    args = JSON.stringify(block.input ?? {}) ?? "{}";
  } catch {
    // Keep the request valid if Cursor supplied a non-serializable input value.
  }
  return {
    id: block.id,
    type: "function",
    function: {
      name: block.name,
      arguments: args,
    },
  };
}

export function normalizeCursorChatMessages(messages) {
  if (!Array.isArray(messages)) return messages;
  const normalized = [];
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      normalized.push(message);
      continue;
    }
    if (message.role === "assistant") {
      const allToolUses = message.content.filter((block) => isRecord(block) && block.type === "tool_use");
      const toolUses = allToolUses.filter((block) => typeof block.id === "string" && block.id.length > 0 && typeof block.name === "string");
      if (allToolUses.length > toolUses.length) {
        normalized.push(message);
        continue;
      }
      if (toolUses.length === 0) {
        normalized.push(message);
        continue;
      }
      const existingToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      const existingIds = new Set(existingToolCalls.map((call) => call?.id).filter((id) => typeof id === "string"));
      const newToolUses = toolUses.filter((block) => !existingIds.has(block.id));
      const content = message.content.filter((block) => !(isRecord(block) && block.type === "tool_use"));
      normalized.push({
        ...message,
        content: content.length > 0 ? content : null,
        tool_calls: [
          ...existingToolCalls,
          ...newToolUses.map((block) => openAiToolCallFromCursorBlock(block)),
        ],
      });
      continue;
    }
    const toolResults = message.content.filter((block) => isRecord(block) && block.type === "tool_result");
    if (message.role !== "user" || toolResults.length === 0) {
      normalized.push(message);
      continue;
    }
    if (toolResults.some((block) => typeof block.tool_use_id !== "string" || block.tool_use_id.length === 0)) {
      normalized.push(message);
      continue;
    }
    for (const block of toolResults) {
      normalized.push({
        role: "tool",
        tool_call_id: block.tool_use_id,
        content: toolResultText(block.content),
      });
    }
    const remainingContent = message.content.filter((block) => !(isRecord(block) && block.type === "tool_result"));
    if (remainingContent.length > 0) normalized.push({ ...message, content: remainingContent });
  }
  return normalized;
}

function enrichSubagentModelTools(tools, catalog) {
  if (!Array.isArray(tools)) return;
  const aliases = catalog.map(({ alias }) => alias).filter((alias) => alias.startsWith(managedPrefix));
  if (aliases.length === 0) return;
  const modelList = aliases.map((alias) => `- ${alias}`).join("\n");
  const modelListPattern = /(If the user explicitly asks for the model of a subagent\/task,[\s\S]*?)(?=\n\nIf the user isn't asking)/;
  for (const tool of tools) {
    if (!isRecord(tool) || tool.type !== "function") continue;
    const definition = isRecord(tool.function) ? tool.function : tool;
    if (typeof definition.name !== "string" || !/^(subagent|task)$/i.test(definition.name)) continue;
    if (typeof definition.description === "string" && modelListPattern.test(definition.description)) {
      definition.description = definition.description.replace(modelListPattern, `$1\n${modelList}`);
    }
    const model = definition.parameters?.properties?.model;
    if (!isRecord(model)) continue;
    if (Array.isArray(model.enum)) {
      model.enum = [...new Set([...model.enum, ...aliases])];
    }
    if (typeof model.description === "string") {
      model.description += ` Available OpenCodex model slugs: ${aliases.join(", ")}.`;
    }
  }
}

function restoreRoutedSubagentModels(messages, catalog) {
  if (!Array.isArray(messages)) return;
  const aliases = new Set(catalog.map(({ alias }) => alias));
  const restore = (text) => {
    if (typeof text !== "string") return text;
    const requested = [...text.matchAll(/<ocx-subagent-model>(opencodex\/[^<]+)<\/ocx-subagent-model>/g)]
      .map((match) => match[1])
      .find((alias) => aliases.has(alias));
    return requested ? text.split("composer-2.5").join(requested) : text;
  };
  for (const message of messages) {
    if (!isRecord(message)) continue;
    if (typeof message.content === "string") {
      message.content = restore(message.content);
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isRecord(part) && typeof part.text === "string") part.text = restore(part.text);
      }
    }
  }
}

export function rewriteModelAliasBody(body, catalog, route = "POST /v1/chat/completions") {
  if (!body?.length) return body;
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isRecord(payload) || typeof payload.model !== "string" || !payload.model.startsWith(managedPrefix)) return body;
  restoreRoutedSubagentModels(payload.messages, catalog);
  if (route === "POST /v1/chat/completions") {
    payload.messages = normalizeCursorChatMessages(payload.messages);
    normalizeCursorTooling(payload);
    enrichSubagentModelTools(payload.tools, catalog);
  }

  const variant = /^(opencodex\/.+?)\[([^\]]+)\]$/.exec(payload.model);
  let alias = variant?.[1] || payload.model;
  let effort = suppliedEffort(payload, variant?.[2]);
  let fast = suppliedFast(variant?.[2]);
  if (!allowedEfforts.includes(effort)) {
    const legacy = catalog.find((model) => model.reasoningEfforts?.some((value) => (
      payload.model === `${model.alias}-${value}` || payload.model === `${model.alias}-${value}-fast`
    )));
    if (legacy) {
      effort = legacy.reasoningEfforts.find((value) => (
        payload.model === `${legacy.alias}-${value}` || payload.model === `${legacy.alias}-${value}-fast`
      ));
      fast = payload.model.endsWith("-fast") ? "true" : "false";
      alias = legacy.alias;
    }
  }

  const catalogModel = catalog.find((model) => model.alias === alias);
  const fallbackSourceId = alias.slice(managedPrefix.length);
  payload.model = catalogModel?.sourceId
    || (fallbackSourceId.startsWith("claude-") ? `anthropic/${fallbackSourceId}` : fallbackSourceId);
  if (allowedEfforts.includes(effort)) payload.reasoning_effort = effort;
  if (catalogModel?.supportsFast && fast === "true") payload.service_tier = "priority";
  if (catalogModel?.supportsFast && fast === "false") delete payload.service_tier;
  delete payload.reasoningEffort;
  disableStrictFunctionTools(payload.tools);
  return Buffer.from(JSON.stringify(payload));
}

export function enrichModelList(active, catalog) {
  const existing = new Set(active.map((model) => model?.id));
  const aliases = catalog
    .filter(({ alias }) => !existing.has(alias))
    .map((model) => ({
      id: model.alias,
      object: "model",
      created: 0,
      owned_by: "opencodex",
      api_types: [model.provider === "anthropic" ? "anthropic_messages" : "chat_completions"],
      capabilities: {
        ...(model.contextWindow ? { context_length: model.contextWindow } : {}),
        ...(model.maxOutputTokens ? { max_output_tokens: model.maxOutputTokens } : {}),
        output_modalities: ["text"],
        input_modalities: model.inputModalities,
        supports_tool_use: true,
        supports_streaming: true,
        supports_reasoning: model.reasoningEfforts.length > 0,
        supports_fast: model.supportsFast,
        supports_vision: model.inputModalities.includes("image"),
        reasoning_effort: model.reasoningEfforts,
      },
    }));
  return { object: "list", data: [...active, ...aliases] };
}

async function serviceToken() {
  try {
    return (await readFile(opencodexServiceTokenFile, "utf8")).trim();
  } catch {
    return "";
  }
}

export function authorized(req, expected) {
  const supplied = [
    String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim(),
    String(req.headers["x-api-key"] || "").trim(),
  ];
  return supplied.some((value) => {
    const actual = Buffer.from(value);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function upstreamHeaders(req, body, token, upstream) {
  const headers = { ...req.headers };
  delete headers.authorization;
  delete headers["x-api-key"];
  delete headers["x-opencodex-api-key"];
  delete headers.cookie;
  delete headers.origin;
  delete headers["cf-access-jwt-assertion"];
  if (token) headers.authorization = `Bearer ${token}`;
  headers.host = `${upstream.host}:${upstream.port}`;
  if (body) headers["content-length"] = String(body.length);
  else delete headers["content-length"];
  headers["cache-control"] = "no-store";
  return headers;
}

export function startGateway(options) {
  const host = options.host || gatewayHost;
  const port = options.port ?? gatewayPort;
  const expected = Buffer.from(options.secret);
  let activeRequests = 0;

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const route = `${req.method} ${url.pathname}`;
    const catalog = options.getCatalog();

    if (route === "GET /healthz") {
      return json(res, 200, { service: "opencodex-cursor-bridge", status: "ok", models: catalog.length, pid: process.pid });
    }
    if (!authorized(req, expected)) return json(res, 401, { error: { message: "invalid bridge API key", type: "authentication_error" } });
    if (!allowedRoutes.has(route)) return json(res, 404, { error: { message: "route not exposed", type: "not_found" } });
    if (activeRequests >= 8) return json(res, 429, { error: { message: "bridge concurrency limit reached", type: "rate_limit_error" } });

    activeRequests += 1;
    let upstreamReq;
    let downstreamClosed = false;
    const cancelUpstream = () => {
      downstreamClosed = true;
      if (upstreamReq && !upstreamReq.destroyed) upstreamReq.destroy();
    };
    req.once("aborted", cancelUpstream);
    res.once("close", () => {
      activeRequests = Math.max(0, activeRequests - 1);
      if (!res.writableEnded) cancelUpstream();
    });
    try {
      if (route === "GET /v1/models") {
        return json(res, 200, enrichModelList(await activeModels(), catalog));
      }

      const upstream = options.upstream || opencodexEndpoint();
      const receivedBody = await readBody(req);
      if (downstreamClosed) return;
      const body = rewriteModelAliasBody(receivedBody, catalog, route);
      const token = options.serviceToken !== undefined ? options.serviceToken : await serviceToken();
      if (downstreamClosed) return;
      upstreamReq = http.request({
        hostname: upstream.host,
        port: upstream.port,
        method: req.method,
        path: `${url.pathname}${url.search}`,
        headers: upstreamHeaders(req, body, token, upstream),
      }, (upstreamRes) => {
        const headers = { ...upstreamRes.headers, "cache-control": "no-store" };
        delete headers["set-cookie"];
        res.writeHead(upstreamRes.statusCode || 502, headers);
        upstreamRes.pipe(res);
        upstreamRes.on("end", () => {
          process.stdout.write(`${route} ${upstreamRes.statusCode || 502} ${Date.now() - started}ms\n`);
        });
      });
      upstreamReq.on("error", (error) => {
        if (downstreamClosed) return;
        if (!res.headersSent) json(res, 502, { error: { message: "OpenCodex upstream unavailable", type: "upstream_error" } });
        else res.destroy(error);
      });
      upstreamReq.end(body);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: { message: error.message || "bridge error", type: "bridge_error" } });
      else res.destroy(error);
    }
  });

  server.listen(port, host, () => {
    process.stdout.write(`OpenCodex Cursor Bridge listening on http://${host}:${port}\n`);
  });
  return server;
}
