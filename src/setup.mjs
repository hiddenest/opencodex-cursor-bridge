export function normalizeBaseUrl(value) {
  if (!value) {
    throw new Error("Enter an HTTPS endpoint or pass --base-url https://cursor-api.example.com/v1");
  }

  const trimmed = value.trim();
  const loopbackWithoutScheme = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::|\/|$)/i.test(trimmed);
  const candidate = trimmed.includes("://")
    ? trimmed
    : `${loopbackWithoutScheme ? "http" : "https"}://${trimmed}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid endpoint URL: ${value}`);
  }

  const isLoopback = url.hostname === "localhost"
    || url.hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("Endpoint URL must use HTTPS unless it points to localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("Endpoint URL cannot contain credentials, a query, or a fragment");
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/v1") {
    throw new Error("Endpoint URL must be an origin or end with /v1");
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

export async function testEndpoint(baseUrl, secret, options = {}) {
  baseUrl = normalizeBaseUrl(baseUrl);
  const fetchImpl = options.fetchImpl || fetch;
  const origin = new URL(baseUrl).origin;
  const attempts = options.healthAttempts || 10;
  let health;
  let healthError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      health = await checkedJson(fetchImpl, `${origin}/healthz`, {}, "Endpoint health check");
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
    throw new Error(`Endpoint health check reached an unexpected service at ${origin}/healthz`);
  }

  const models = await checkedJson(fetchImpl, `${baseUrl}/models`, {
    headers: { authorization: `Bearer ${secret}` },
  }, "Endpoint model check");
  if (!Array.isArray(models?.data)) {
    throw new Error(`Endpoint model check returned an invalid catalog from ${baseUrl}/models`);
  }

  return { health, modelCount: models.data.length };
}
