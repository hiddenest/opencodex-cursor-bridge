import assert from "node:assert/strict";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { configureCursorOpenAI, encryptedCursorSecret, storedCursorOpenAIBaseUrl } from "../src/cursor-config.mjs";

function decryptSecret(value, password) {
  const encrypted = Buffer.from(JSON.parse(value).data);
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const decipher = createDecipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]).toString("utf8");
}

test("encrypts secrets in Cursor Safe Storage v10 format", () => {
  const value = encryptedCursorSecret("bridge-key", "safe-storage-password");
  assert.equal(Buffer.from(JSON.parse(value).data).subarray(0, 3).toString(), "v10");
  assert.equal(decryptSecret(value, "safe-storage-password"), "bridge-key");
});

test("configures the endpoint and secret, then becomes idempotent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ocx-cursor-config-"));
  const databasePath = join(directory, "state.vscdb");
  const database = new DatabaseSync(databasePath);
  database.exec("CREATE TABLE ItemTable (key TEXT UNIQUE, value BLOB)");
  database.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser",
    JSON.stringify({ unrelated: true }),
  );
  database.close();

  try {
    const options = {
      secret: "bridge-key",
      baseUrl: "https://cursor-api.example.test/v1",
      databasePath,
      backupDirectory: directory,
      safeStoragePassword: "safe-storage-password",
      cursorRunning: false,
    };
    const first = await configureCursorOpenAI(options);
    assert.equal(first.changed, true);
    assert.ok((await readFile(first.backupPath)).length > 0);

    const updated = new DatabaseSync(databasePath, { readOnly: true });
    const state = JSON.parse(updated.prepare("SELECT value FROM ItemTable WHERE key LIKE '%applicationUser'").get().value);
    const secret = updated.prepare("SELECT value FROM ItemTable WHERE key = 'secret://cursorAuth/openAIKey'").get().value;
    updated.close();
    assert.deepEqual(state, {
      unrelated: true,
      useOpenAIKey: true,
      openAIBaseUrl: "https://cursor-api.example.test/v1",
    });
    assert.equal(decryptSecret(secret, "safe-storage-password"), "bridge-key");
    assert.equal(storedCursorOpenAIBaseUrl(databasePath), "https://cursor-api.example.test/v1");

    const second = await configureCursorOpenAI({ ...options, cursorRunning: true });
    assert.deepEqual(second, { changed: false, backupPath: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
