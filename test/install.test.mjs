import assert from "node:assert/strict";
import test from "node:test";
import { updateService } from "../src/install.mjs";

test("updates through the latest npm release and reinstalls the service", () => {
  let call;
  updateService({
    npmCommand: "/test/npm",
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
    options: { stdio: "inherit" },
  });
});
