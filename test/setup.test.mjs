import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBaseUrl, testTunnel } from "../src/setup.mjs";

test("normalizes a Cloudflare hostname to the Cursor OpenAI base URL", () => {
  assert.equal(normalizeBaseUrl("https://cursor-api.example.com"), "https://cursor-api.example.com/v1");
  assert.equal(normalizeBaseUrl("cursor-api.example.com"), "https://cursor-api.example.com/v1");
  assert.equal(normalizeBaseUrl("https://cursor-api.example.com/v1/"), "https://cursor-api.example.com/v1");
});

test("rejects tunnel URLs that cannot route the gateway", () => {
  assert.throws(() => normalizeBaseUrl("http://cursor-api.example.com"), /must use HTTPS/);
  assert.throws(() => normalizeBaseUrl("https://cursor-api.example.com/proxy"), /hostname or end with \/v1/);
});

test("checks public health and authenticated model discovery", async () => {
  const calls = [];
  const result = await testTunnel("https://cursor-api.example.com/v1", "bridge-secret", {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/healthz")) {
        return Response.json({ service: "opencodex-cursor-bridge", status: "ok" });
      }
      return Response.json({ object: "list", data: [{ id: "opencodex/model" }] });
    },
  });

  assert.equal(result.modelCount, 1);
  assert.equal(calls[0].url, "https://cursor-api.example.com/healthz");
  assert.equal(calls[1].url, "https://cursor-api.example.com/v1/models");
  assert.equal(calls[1].options.headers.authorization, "Bearer bridge-secret");
});

test("rejects a tunnel pointing at another service", async () => {
  await assert.rejects(
    testTunnel("https://cursor-api.example.com/v1", "bridge-secret", {
      fetchImpl: async () => Response.json({ status: "ok" }),
    }),
    /unexpected service/,
  );
});

test("retries while the bridge service starts", async () => {
  let healthAttempts = 0;
  const result = await testTunnel("https://cursor-api.example.com/v1", "bridge-secret", {
    healthAttempts: 2,
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      if (url.endsWith("/healthz")) {
        healthAttempts += 1;
        if (healthAttempts === 1) return new Response("Bad Gateway", { status: 502 });
        return Response.json({ service: "opencodex-cursor-bridge", status: "ok" });
      }
      return Response.json({ object: "list", data: [] });
    },
  });

  assert.equal(healthAttempts, 2);
  assert.equal(result.modelCount, 0);
});
