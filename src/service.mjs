import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { buildActiveCatalog } from "./catalog.mjs";
import { startCursorModelMetadataPatchMonitor } from "./cursor-patch.mjs";
import {
  cursorIsRunning,
  readPendingCatalog,
} from "./cursor-state.mjs";
import { startGateway } from "./gateway.mjs";
import { installRoot, secretFile } from "./paths.mjs";
import { applyOrQueueCatalog, loadCatalogSnapshot, saveCatalogSnapshot } from "./sync.mjs";

export async function loadOrCreateSecret() {
  await mkdir(installRoot, { recursive: true });
  try {
    return (await readFile(secretFile, "utf8")).trim();
  } catch {
    const secret = `ocx_cursor_${randomBytes(32).toString("hex")}`;
    await writeFile(secretFile, `${secret}\n`, { mode: 0o600, flag: "wx" });
    await chmod(secretFile, 0o600);
    return secret;
  }
}

export async function runService(options = {}) {
  let catalog = await loadCatalogSnapshot();
  let refreshPromise = null;
  let cursorSyncPromise = null;
  let wasCursorRunning = cursorIsRunning();
  let stopped = false;

  const refresh = async () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const next = await buildActiveCatalog(options);
        if (JSON.stringify(next) === JSON.stringify(catalog)) return;
        catalog = next;
        await saveCatalogSnapshot(catalog);
        const result = await applyOrQueueCatalog(catalog, { createBackup: false });
        process.stdout.write(`${result.status === "queued" ? "Queued" : "Synced"} ${result.modelCount} Cursor models\n`);
      } catch (error) {
        process.stderr.write(`Catalog refresh failed: ${error.message}\n`);
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  };

  const secret = await loadOrCreateSecret();
  if (catalog.length === 0) {
    try {
      catalog = await buildActiveCatalog(options);
      await saveCatalogSnapshot(catalog);
    } catch (error) {
      process.stderr.write(`Initial catalog load failed: ${error.message}\n`);
    }
  }

  const server = startGateway({ secret, getCatalog: () => catalog, host: options.host, port: options.port });
  const patchMonitor = startCursorModelMetadataPatchMonitor({
    intervalMs: options.cursorPatchIntervalMs,
    shouldPatch: () => !cursorIsRunning(),
    onResult: (result) => {
      if (result.status === "patched") process.stdout.write(`Patched Cursor app file ${result.file} (backup: ${result.backupPath})\n`);
    },
    onError: (error, file) => process.stderr.write(`Cursor patch failed for ${file}: ${error.message}\n`),
  });
  const refreshTimer = setInterval(refresh, options.refreshIntervalMs || 15_000);
  const pendingTimer = setInterval(() => {
    if (cursorSyncPromise) return;
    if (cursorIsRunning()) {
      wasCursorRunning = true;
      return;
    }
    cursorSyncPromise = (async () => {
      const pending = await readPendingCatalog();
      const next = pending || (wasCursorRunning ? catalog : null);
      if (!next) return;
      const result = await applyOrQueueCatalog(next, { createBackup: false });
      wasCursorRunning = false;
      process.stdout.write(`Synced ${result.modelCount} Cursor models after shutdown\n`);
    })().catch((error) => {
      process.stderr.write(`Cursor shutdown sync failed: ${error.message}\n`);
    }).finally(() => {
      cursorSyncPromise = null;
    });
  }, options.cursorPollIntervalMs || 2_000);

  await refresh();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(refreshTimer);
    clearInterval(pendingTimer);
    patchMonitor.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return { server, stop, getCatalog: () => catalog, refresh };
}
