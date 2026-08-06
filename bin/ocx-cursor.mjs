#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { configureCursorOpenAI, storedCursorOpenAIBaseUrl } from "../src/cursor-config.mjs";
import { cursorIsRunning } from "../src/cursor-state.mjs";
import { installService, prepareInstallSecret, repairCursorMetadataPatch, serviceStatus, startService, stopService, uninstallService, updateService } from "../src/install.mjs";
import { cursorOpenAIBaseUrl, pendingFile } from "../src/paths.mjs";
import { runService } from "../src/service.mjs";
import { normalizeBaseUrl, testEndpoint } from "../src/setup.mjs";
import { loadCatalogSnapshot, syncNow } from "../src/sync.mjs";
import { findAvailableDebugPort, launchCursorForInjection, runRuntimeInjector } from "../src/runtime-injector.mjs";

const usage = `OpenCodex Cursor Bridge

Usage:
  ocx-cursor init [--base-url <url>]
                        Install the service, test the endpoint, configure Cursor,
                        and sync models
  ocx-cursor install    Install and start the macOS companion service
  ocx-cursor stop       Stop the companion service without removing its state
  ocx-cursor start      Start the installed companion service
  ocx-cursor update     Install the latest companion release and restart it
  ocx-cursor sync       Sync active OpenCodex models into Cursor
  ocx-cursor launch [--port <port>]
                        Launch Cursor with the experimental runtime model hook
  ocx-cursor inject --port <port> [--reload]
                        Attach the experimental hook to a debug-enabled Cursor
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
    ? `HTTPS endpoint [${fallback}]: `
    : "HTTPS endpoint (for example, https://cursor-api.example.com): ";
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

function printCursorPatches(result) {
  if (!result.cursorInstalled) {
    process.stdout.write("Cursor is not installed; app patches will be applied after it is installed.\n");
    return;
  }
  if (result.cursorPatches === null) {
    process.stdout.write("Cursor app patches will be applied after Cursor quits.\n");
    return;
  }
  const changed = result.cursorPatches.filter(({ status }) => status === "patched").length;
  process.stdout.write(`Verified ${result.cursorPatches.length} Cursor metadata patches (${changed} changed).\n`);
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
    printCursorPatches(installed);
    printSync(await syncNow());
    process.stdout.write("Local gateway: http://127.0.0.1:10101/v1\n");
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
    printCursorPatches(installed);
    process.stdout.write(`Testing endpoint: ${new URL(baseUrl).origin}\n`);
    let endpoint;
    try {
      endpoint = await testEndpoint(baseUrl, prepared.secret);
    } catch (error) {
      throw new Error(`${error.message}\nThe bridge service is running locally. Fix the HTTPS endpoint and rerun ocx-cursor init.`);
    }
    process.stdout.write(`Endpoint is ready (${endpoint.modelCount} models reachable).\n`);
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
  if (command === "stop") {
    stopService();
    process.stdout.write("Stopped OpenCodex Cursor Bridge.\n");
    return;
  }
  if (command === "start") {
    await startService();
    process.stdout.write("Started OpenCodex Cursor Bridge.\n");
    return;
  }
  if (command === "sync") {
    if (!cursorIsRunning()) {
      stopService();
      try {
        const cursorPatches = await repairCursorMetadataPatch();
        const changed = cursorPatches.filter(({ status }) => status === "patched").length;
        process.stdout.write(`Verified ${cursorPatches.length} Cursor metadata patches (${changed} changed).\n`);
        printSync(await syncNow());
      } finally {
        await startService();
      }
      return;
    }
    printSync(await syncNow());
    return;
  }
  if (command === "launch") {
    if (cursorIsRunning()) throw new Error("Quit Cursor before running ocx-cursor launch");
    const requestedPort = argumentValue("--port");
    const port = requestedPort ? Number(requestedPort) : await findAvailableDebugPort();
    const pid = launchCursorForInjection(port);
    process.stdout.write(`Launched Cursor ${pid} with runtime injection on 127.0.0.1:${port}. Keep this command running.\n`);
    await runRuntimeInjector({
      port,
      onInjection: (count) => process.stdout.write(`Injected ${count} OpenCodex model definitions.\n`),
      onError: (error) => process.stderr.write(`Runtime injection failed: ${error.message}\n`),
    });
    return;
  }
  if (command === "inject") {
    const port = Number(argumentValue("--port"));
    process.stdout.write(`Attaching runtime injection to Cursor on 127.0.0.1:${port}. Keep this command running.\n`);
    await runRuntimeInjector({
      port,
      reloadExisting: process.argv.includes("--reload"),
      onInjection: (count) => process.stdout.write(`Injected ${count} OpenCodex model definitions.\n`),
      onError: (error) => process.stderr.write(`Runtime injection failed: ${error.message}\n`),
    });
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
