import assert from "node:assert/strict";
import test from "node:test";
import { updateService } from "../src/install.mjs";

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
