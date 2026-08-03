import { execFileSync } from "node:child_process";
import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { cursorIsRunning } from "./cursor-state.mjs";
import { cursorDatabaseFile, installRoot } from "./paths.mjs";

const applicationStorageKey = "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";
const openAISecretKey = "secret://cursorAuth/openAIKey";

function cursorSafeStoragePassword() {
  try {
    return execFileSync("security", [
      "find-generic-password",
      "-w",
      "-a", "Cursor Key",
      "-s", "Cursor Safe Storage",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    throw new Error("Cursor Safe Storage key was not found. Launch and sign in to Cursor once, then rerun init.");
  }
}

export function encryptedCursorSecret(secret, password) {
  const key = pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const encrypted = Buffer.concat([Buffer.from("v10"), cipher.update(secret, "utf8"), cipher.final()]);
  return JSON.stringify({ type: "Buffer", data: [...encrypted] });
}

export function applyOpenAISettings(state, baseUrl) {
  state.useOpenAIKey = true;
  state.openAIBaseUrl = baseUrl;
  return state;
}

export function storedCursorOpenAIBaseUrl(databasePath = cursorDatabaseFile) {
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(applicationStorageKey);
    database.close();
    const value = JSON.parse(row?.value || "{}").openAIBaseUrl;
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export async function configureCursorOpenAI(options) {
  const databasePath = options.databasePath || cursorDatabaseFile;
  const backupDirectory = options.backupDirectory || installRoot;
  const password = options.safeStoragePassword || cursorSafeStoragePassword();
  const encryptedSecret = encryptedCursorSecret(options.secret, password);
  const database = new DatabaseSync(databasePath);
  const stateRow = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(applicationStorageKey);
  const secretRow = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(openAISecretKey);
  if (!stateRow?.value) {
    database.close();
    throw new Error("Cursor application user storage was not found");
  }

  const state = JSON.parse(stateRow.value);
  const alreadyConfigured = state.useOpenAIKey === true
    && state.openAIBaseUrl === options.baseUrl
    && secretRow?.value === encryptedSecret;
  if (alreadyConfigured) {
    database.close();
    return { changed: false, backupPath: null };
  }
  if (options.cursorRunning ?? cursorIsRunning()) {
    database.close();
    throw new Error("Quit Cursor before running ocx-cursor init so its API settings can be updated safely");
  }

  applyOpenAISettings(state, options.baseUrl);
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const backupPath = `${backupDirectory}/cursor-state-before-api-init-${timestamp}.vscdb`;
  await backup(database, backupPath);

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("UPDATE ItemTable SET value = ? WHERE key = ?").run(JSON.stringify(state), applicationStorageKey);
    database.prepare(`
      INSERT INTO ItemTable (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(openAISecretKey, encryptedSecret);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
  return { changed: true, backupPath };
}
