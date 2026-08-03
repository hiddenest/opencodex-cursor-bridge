import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { shouldCopyPackagePath, updateService } from "../src/install.mjs";

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
