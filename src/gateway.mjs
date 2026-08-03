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

export function rewriteModelAliasBody(body, catalog) {
  if (!body?.length) return body;
  let payload;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return body;
  }
  if (!isRecord(payload) || typeof payload.model !== "string" || !payload.model.startsWith(managedPrefix)) return body;

  const variant = /^(opencodex\/.+?)\[([^\]]+)\]$/.exec(payload.model);
  let alias = variant?.[1] || payload.model;
  let effort = suppliedEffort(payload, variant?.[2]);
  if (!allowedEfforts.includes(effort)) {
    const legacy = catalog.find((model) => model.reasoningEfforts?.some((value) => payload.model === `${model.alias}-${value}`));
    if (legacy) {
      effort = legacy.reasoningEfforts.find((value) => payload.model === `${legacy.alias}-${value}`);
      alias = legacy.alias;
    }
  }

  const catalogModel = catalog.find((model) => model.alias === alias);
  const fallbackSourceId = alias.slice(managedPrefix.length);
  payload.model = catalogModel?.sourceId
    || (fallbackSourceId.startsWith("claude-") ? `anthropic/${fallbackSourceId}` : fallbackSourceId);
  if (allowedEfforts.includes(effort)) payload.reasoning_effort = effort;
  delete payload.reasoningEffort;
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

function authorized(req, expected) {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
  const port = options.port || gatewayPort;
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
    res.once("close", () => { activeRequests = Math.max(0, activeRequests - 1); });
    try {
      if (route === "GET /v1/models") {
        return json(res, 200, enrichModelList(await activeModels(), catalog));
      }

      const upstream = opencodexEndpoint();
      const body = rewriteModelAliasBody(await readBody(req), catalog);
      const token = await serviceToken();
      const upstreamReq = http.request({
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
