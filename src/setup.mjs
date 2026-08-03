export function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error("Enter your Cloudflare Tunnel URL or pass --base-url https://your-domain.example/v1");
  }

  const candidate = value.includes("://") ? value : `https://${value}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid Cloudflare Tunnel URL: ${value}`);
  }

  if (url.protocol !== "https:") throw new Error("Cloudflare Tunnel URL must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Cloudflare Tunnel URL cannot contain credentials, a query, or a fragment");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/v1") {
    throw new Error("Cloudflare Tunnel URL must be a hostname or end with /v1");
  }
  url.pathname = "/v1";
  return url.toString().replace(/\/$/, "");
}

async function checkedJson(fetchImpl, url, options, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`${label} failed for ${url}: ${error.message}`);
  }

  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status} for ${url}`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON from ${url}`);
  }
}

export async function testTunnel(baseUrl, secret, options = {}) {
  baseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const origin = new URL(baseUrl).origin;
  const attempts = options.healthAttempts || 10;
  let health;
  let healthError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      health = await checkedJson(fetchImpl, `${origin}/healthz`, {}, "Tunnel health check");
      break;
    } catch (error) {
      healthError = error;
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 500));
      }
    }
  }
  if (!health) throw healthError;
  if (health?.service !== "opencodex-cursor-bridge" || health?.status !== "ok") {
    throw new Error(`Tunnel health check reached an unexpected service at ${origin}/healthz`);
  }

  const models = await checkedJson(fetchImpl, `${baseUrl}/models`, {
    headers: { authorization: `Bearer ${secret}` },
  }, "Tunnel model check");
  if (!Array.isArray(models?.data)) {
    throw new Error(`Tunnel model check returned an invalid catalog from ${baseUrl}/models`);
  }

  return { health, modelCount: models.data.length };
}
