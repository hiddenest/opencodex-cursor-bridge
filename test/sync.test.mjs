import assert from "node:assert/strict";
import test from "node:test";
import { applyOrQueueCatalog } from "../src/sync.mjs";

const catalog = [
  { alias: "opencodex/gpt-test", reasoningEfforts: ["medium"] },
];

test("queues catalog metadata until the Cursor app patch is ready", async () => {
  let queued = null;
  let synced = false;
  const result = await applyOrQueueCatalog(catalog, {
    cursorRunning: false,
    defer: true,
    writePendingCatalog: async (value) => {
      queued = value;
    },
    syncCursorDatabase: async () => {
      synced = true;
    },
  });
  assert.equal(result.status, "queued");
  assert.equal(result.modelCount, 1);
  assert.deepEqual(queued, catalog);
  assert.equal(synced, false);
});

test("syncs catalog metadata after the Cursor app patch is ready", async () => {
  const calls = [];
  const result = await applyOrQueueCatalog(catalog, {
    cursorRunning: false,
    syncCursorDatabase: async () => {
      calls.push("sync");
      return { modelCount: 1, effortCount: 1, backupPath: "/test/backup" };
    },
    clearPendingCatalog: async () => {
      calls.push("clear-pending");
    },
  });
  assert.equal(result.status, "synced");
  assert.deepEqual(calls, ["sync", "clear-pending"]);
});
