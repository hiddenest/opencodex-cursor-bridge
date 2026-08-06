import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { repairCursorMetadataPatch, shouldCopyPackagePath, startService, stopService, updateService } from "../src/install.mjs";

test("copies an npm-installed package but excludes its nested dependencies", () => {
  const packageRoot = join("/cache", "node_modules", "ocx-cursor");
  assert.equal(shouldCopyPackagePath(join(packageRoot, "src", "install.mjs"), packageRoot), true);
  assert.equal(shouldCopyPackagePath(join(packageRoot, "node_modules", "dependency"), packageRoot), false);
  assert.equal(shouldCopyPackagePath(join(packageRoot, ".git", "config"), packageRoot), false);
});

test("updates through the latest npm release from an isolated directory", async () => {
  let call;
  await updateService({
    npmCommand: "/test/npm",
    temporaryDirectory: "/test/update-directory",
    execFileSync(command, args, options) {
      call = { command, args, options };
    },
  });

  assert.deepEqual(call, {
    command: "/test/npm",
    args: [
      "exec",
      "--yes",
      "--package=ocx-cursor@latest",
      "--",
      "ocx-cursor",
      "install",
    ],
    options: { cwd: "/test/update-directory", stdio: "inherit" },
  });
});

test("stops the service without removing its installation", () => {
  const calls = [];
  stopService({
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
    },
  });
  assert.deepEqual(calls, [{
    command: "launchctl",
    args: ["bootout", `gui/${process.getuid()}/com.opencodex.cursor-bridge`],
    options: { stdio: "ignore" },
  }]);
});

test("starts the installed service", async () => {
  const calls = [];
  await startService({
    launchAgentFile: "/test/com.opencodex.cursor-bridge.plist",
    exists: async () => true,
    execFileSync(command, args, options) {
      calls.push({ command, args, options });
    },
  });
  assert.deepEqual(calls, [
    {
      command: "launchctl",
      args: ["bootout", `gui/${process.getuid()}/com.opencodex.cursor-bridge`],
      options: { stdio: "ignore" },
    },
    {
      command: "launchctl",
      args: ["bootstrap", `gui/${process.getuid()}`, "/test/com.opencodex.cursor-bridge.plist"],
      options: { stdio: "ignore" },
    },
  ]);
});

test("fails to start before the service is installed", async () => {
  await assert.rejects(
    startService({ exists: async () => false }),
    /run ocx-cursor install first/,
  );
});

test("repairs every Cursor metadata file before clearing quarantine", async () => {
  const calls = [];
  const patches = await repairCursorMetadataPatch({
    cursorRunning: false,
    cursorAppPath: "/test/Cursor.app",
    exists: async () => true,
    files: ["/test/desktop.js", "/test/glass.js"],
    async ensureCursorModelMetadataPatched({ file }) {
      calls.push(`patch:${file}`);
      return { status: "patched", backupPath: `${file}.bak` };
    },
    clearCursorAppQuarantine({ appPath }) {
      calls.push(`quarantine:${appPath}`);
    },
  });
  assert.deepEqual(calls, [
    "patch:/test/desktop.js",
    "patch:/test/glass.js",
    "quarantine:/test/Cursor.app",
  ]);
  assert.deepEqual(patches.map(({ file, status }) => ({ file, status })), [
    { file: "/test/desktop.js", status: "patched" },
    { file: "/test/glass.js", status: "patched" },
  ]);
});

test("refuses foreground repair while Cursor is running", async () => {
  await assert.rejects(
    repairCursorMetadataPatch({ cursorRunning: true }),
    /Quit Cursor before repairing/,
  );
});
