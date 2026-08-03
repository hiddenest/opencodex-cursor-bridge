#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { configureCursorOpenAI, storedCursorOpenAIBaseUrl } from "../src/cursor-config.mjs";
import { cursorIsRunning } from "../src/cursor-state.mjs";
import { installService, prepareInstallSecret, serviceStatus, uninstallService, updateService } from "../src/install.mjs";
import { cursorOpenAIBaseUrl, pendingFile } from "../src/paths.mjs";
import { runService } from "../src/service.mjs";
import { normalizeBaseUrl, testTunnel } from "../src/setup.mjs";
import { loadCatalogSnapshot, syncNow } from "../src/sync.mjs";

const usage = `OpenCodex Cursor Bridge

Usage:
  ocx-cursor init [--base-url <https-url>]
                        Install the service, test the tunnel, configure Cursor,
                        and sync models
  ocx-cursor install    Install and start the macOS companion service
  ocx-cursor update     Install the latest companion release and restart it
  ocx-cursor sync       Sync active OpenCodex models into Cursor
  ocx-cursor status     Show service and model-sync status
  ocx-cursor uninstall  Stop and remove the companion service
  ocx-cursor service    Run the service in the foreground (internal)
`;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? "" : String(process.argv[index + 1] || "");
}

async function requestedBaseUrl() {
  const supplied = argumentValue("--base-url");
  const fallback = cursorOpenAIBaseUrl || storedCursorOpenAIBaseUrl();
  if (supplied) return normalizeBaseUrl(supplied);
  if (!process.stdin.isTTY || !process.stdout.isTTY) return normalizeBaseUrl(fallback);

  const prompt = fallback
    ? `Cloudflare Tunnel URL [${fallback}]: `
    : "Cloudflare Tunnel URL (for example, https://cursor-api.example.com): ";
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return normalizeBaseUrl((await readline.question(prompt)).trim() || fallback);
  } finally {
    readline.close();
  }
}

async function pendingCount() {
  try {
    const value = JSON.parse(await readFile(pendingFile, "utf8"));
    return Array.isArray(value) ? value.length : 0;
  } catch {
    return 0;
  }
}

function printSync(result) {
  const effort = `${result.effortCount} with effort selector`;
  if (result.status === "queued") {
    process.stdout.write(`Queued ${result.modelCount} active models (${effort}); they will be applied after Cursor quits.\n`);
  } else {
    process.stdout.write(`Synced ${result.modelCount} active models (${effort}).\nBackup: ${result.backupPath}\n`);
  }
}

async function main() {
  const command = process.argv[2] || "help";
  if (["help", "--help", "-h"].includes(command)) {
    process.stdout.write(usage);
    return;
  }
  if (["--version", "-v"].includes(command)) {
    const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (command === "install") {
    const installed = await installService();
    process.stdout.write(`Installed ${installed.launchAgentFile} (API key ${installed.secretStatus}).\nCLI: ${installed.cliLinkFile}\n`);
    printSync(await syncNow());
    process.stdout.write("Endpoint: http://127.0.0.1:10101/v1\n");
    return;
  }
  if (command === "init") {
    if (cursorIsRunning()) {
      throw new Error("Quit Cursor before running ocx-cursor init so model variants and effort selectors can be applied");
    }
    const baseUrl = await requestedBaseUrl();
    const prepared = await prepareInstallSecret();
    const installed = await installService();
    process.stdout.write(`Installed ${installed.launchAgentFile} (API key ${prepared.secretStatus}).\nCLI: ${installed.cliLinkFile}\n`);
    process.stdout.write(`Testing Cloudflare Tunnel: ${new URL(baseUrl).origin}\n`);
    let tunnel;
    try {
      tunnel = await testTunnel(baseUrl, prepared.secret);
    } catch (error) {
      throw new Error(`${error.message}\nThe bridge service is running locally. Fix the tunnel and rerun ocx-cursor init.`);
    }
    process.stdout.write(`Tunnel is ready (${tunnel.modelCount} models reachable).\n`);
    const configured = await configureCursorOpenAI({
      secret: prepared.secret,
      baseUrl,
    });
    process.stdout.write(configured.changed
      ? `Configured Cursor OpenAI endpoint: ${baseUrl}\nBackup: ${configured.backupPath}\n`
      : `Cursor OpenAI endpoint is already configured: ${baseUrl}\n`);
    printSync(await syncNow());
    return;
  }
  if (command === "update") {
    process.stdout.write("Updating OpenCodex Cursor Bridge from npm...\n");
    await updateService();
    return;
  }
  if (command === "sync") {
    printSync(await syncNow());
    return;
  }
  if (command === "status") {
    const [status, catalog, pending] = await Promise.all([
      serviceStatus(),
      loadCatalogSnapshot(),
      pendingCount(),
    ]);
    process.stdout.write([
      `Installed: ${status.installed ? "yes" : "no"}`,
      `Service: ${status.loaded ? "running" : "stopped"}`,
      `Gateway: ${status.health?.status === "ok" ? `healthy (${status.health.models} models)` : "unavailable"}`,
      `Catalog: ${catalog.length} active models`,
      `Pending Cursor sync: ${pending ? `${pending} models` : "none"}`,
      `Home: ${status.installRoot}`,
    ].join("\n") + "\n");
    return;
  }
  if (command === "uninstall") {
    await uninstallService();
    process.stdout.write("Uninstalled OpenCodex Cursor Bridge.\n");
    return;
  }
  if (command === "service") {
    await runService();
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage}`);
}

main().catch((error) => {
  process.stderr.write(`${error.message || error}\n`);
  process.exitCode = 1;
});
