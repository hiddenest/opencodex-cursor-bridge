import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { buildActiveCatalog } from "./catalog.mjs";
import {
  clearPendingCatalog,
  cursorIsRunning,
  syncCursorDatabase,
  writePendingCatalog,
} from "./cursor-state.mjs";
import { catalogFile, installRoot } from "./paths.mjs";

export async function loadCatalogSnapshot() {
  try {
    const value = JSON.parse(await readFile(catalogFile, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export async function saveCatalogSnapshot(catalog) {
  await mkdir(installRoot, { recursive: true });
  const temporary = `${catalogFile}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, catalogFile);
}

export async function applyOrQueueCatalog(catalog, options = {}) {
  if (cursorIsRunning()) {
    await writePendingCatalog(catalog);
    return {
      status: "queued",
      modelCount: catalog.length,
      effortCount: catalog.filter(({ reasoningEfforts }) => reasoningEfforts.length > 0).length,
    };
  }
  const result = await syncCursorDatabase(catalog, options);
  await clearPendingCatalog();
  return { status: "synced", ...result };
}

export async function syncNow(options = {}) {
  const catalog = await buildActiveCatalog(options);
  await saveCatalogSnapshot(catalog);
  return { catalog, ...(await applyOrQueueCatalog(catalog)) };
}
