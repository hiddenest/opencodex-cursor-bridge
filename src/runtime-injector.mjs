import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { cursorModel } from "./cursor-state.mjs";
import { loadCatalogSnapshot } from "./sync.mjs";

export const cursorBinary = "/Applications/Cursor.app/Contents/MacOS/Cursor";
export const cursorWorkbenchBundle = "/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js";
export const cursorWorkbenchUrl = "vscode-file://vscode-app/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js";

const catalogStorageAnchor = "c=c.map(z=>XTt(z)),bp(()=>{this._reactiveStorageService.setApplicationUserPersistentStorage(\"availableDefaultModels2\",c)";
const breakpointOffset = "c=c.map(z=>XTt(z)),".length;

export function findCatalogHookLocation(source) {
  const index = source.indexOf(catalogStorageAnchor);
  if (index === -1) throw new Error("This Cursor version does not contain the supported model catalog hook");
  if (source.indexOf(catalogStorageAnchor, index + 1) !== -1) {
    throw new Error("Cursor model catalog hook is ambiguous");
  }
  const lines = source.slice(0, index + breakpointOffset).split("\n");
  return {
    lineNumber: lines.length - 1,
    columnNumber: lines.at(-1).length,
  };
}

export function buildRuntimeModelPatches(catalog) {
  return Object.fromEntries(catalog.map((model) => {
    const value = cursorModel(model);
    return [value.name, value];
  }));
}

export function catalogPatchExpression(patches) {
  return `(() => {
    const patches = ${JSON.stringify(patches)};
    let count = 0;
    for (const model of c) {
      const patch = patches[model.name];
      if (!patch) continue;
      count += 1;
      Object.assign(model, patch);
    }
    return count;
  })()`;
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async open() {
    this.socket = new WebSocket(this.url);
    this.socket.onmessage = ({ data }) => this.handleMessage(JSON.parse(data));
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onclose = () => {
      for (const { reject } of this.pending.values()) reject(new Error("Cursor debugger disconnected"));
      this.pending.clear();
    };
    return this;
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
  }

  handleMessage(message) {
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  close() {
    this.socket?.close();
  }
}

async function cursorTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1000),
  });
  if (!response.ok) throw new Error(`Cursor debugger returned HTTP ${response.status}`);
  return await response.json();
}

async function attachCatalogHook(target, options) {
  const connection = await new CdpConnection(target.webSocketDebuggerUrl).open();
  let breakpointId;
  connection.onEvent((message) => {
    if (message.method !== "Debugger.paused" || !message.params.hitBreakpoints.includes(breakpointId)) return;
    const frame = message.params.callFrames[0];
    void (async () => {
      try {
        const patches = buildRuntimeModelPatches(await loadCatalogSnapshot());
        const result = await connection.call("Debugger.evaluateOnCallFrame", {
          callFrameId: frame.callFrameId,
          expression: catalogPatchExpression(patches),
          returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Catalog injection failed");
        options.onInjection?.(Number(result.result.value || 0), target);
      } catch (error) {
        options.onError?.(error, target);
      } finally {
        await connection.call("Debugger.resume").catch(() => {});
      }
    })();
  });

  await connection.call("Debugger.enable");
  const breakpoint = await connection.call("Debugger.setBreakpointByUrl", {
    url: cursorWorkbenchUrl,
    lineNumber: options.location.lineNumber,
    columnNumber: options.location.columnNumber,
  });
  breakpointId = breakpoint.breakpointId;
  if (options.reload) await connection.call("Page.reload");
  return connection;
}

export async function runRuntimeInjector(options = {}) {
  const port = Number(options.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("A valid Cursor debugging port is required");
  const source = await readFile(options.bundleFile || cursorWorkbenchBundle, "utf8");
  const location = findCatalogHookLocation(source);
  const connections = new Map();
  let foundTarget = false;
  let missingPolls = 0;

  try {
    while (missingPolls < (options.maxMissingPolls || 10)) {
      let targets = [];
      try {
        targets = await cursorTargets(port);
        missingPolls = 0;
      } catch {
        missingPolls += 1;
      }

      for (const target of targets.filter(({ type }) => type === "page")) {
        if (connections.has(target.id)) continue;
        const connection = await attachCatalogHook(target, {
          location,
          reload: options.reloadExisting === true && !foundTarget,
          onInjection: options.onInjection,
          onError: options.onError,
        });
        connections.set(target.id, connection);
        foundTarget = true;
      }

      for (const [id, connection] of connections) {
        if (targets.some((target) => target.id === id)) continue;
        connection.close();
        connections.delete(id);
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs || 500));
    }
  } finally {
    for (const connection of connections.values()) connection.close();
  }

  if (!foundTarget) throw new Error(`No Cursor renderer appeared on debugging port ${port}`);
}

export function launchCursorForInjection(port, options = {}) {
  const child = spawn(options.cursorBinary || cursorBinary, [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

export async function findAvailableDebugPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("Could not allocate a Cursor debugging port");
  return address.port;
}
