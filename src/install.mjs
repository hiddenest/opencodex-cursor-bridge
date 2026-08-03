import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cliLinkFile,
  installRoot,
  installedPackageRoot,
  launchAgentFile,
  legacyLaunchAgentFile,
  legacyServiceLabel,
  secretFile,
  serviceLabel,
  stderrFile,
  stdoutFile,
} from "./paths.mjs";

const sourcePackageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const launchDomain = `gui/${process.getuid()}`;

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function bootout(label) {
  try {
    execFileSync("launchctl", ["bootout", `${launchDomain}/${label}`], { stdio: "ignore" });
  } catch {}
}

async function bootstrap(plist) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      execFileSync("launchctl", ["bootstrap", launchDomain, plist], { stdio: "ignore" });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runningLegacyPlist() {
  if (await exists(legacyLaunchAgentFile)) return legacyLaunchAgentFile;
  const output = commandOutput("launchctl", ["print", `${launchDomain}/${legacyServiceLabel}`]);
  return output.match(/^\s*path = (.+)$/m)?.[1]?.trim() || legacyLaunchAgentFile;
}

async function migrateSecret(legacyPlist) {
  if (await exists(secretFile)) return "preserved";
  if (legacyPlist && await exists(legacyPlist)) {
    const stdoutPath = commandOutput("plutil", ["-extract", "StandardOutPath", "raw", "-o", "-", legacyPlist]);
    if (stdoutPath) {
      const candidate = join(dirname(stdoutPath), "ocx-cursor-gateway.secret");
      if (await exists(candidate)) {
        await copyFile(candidate, secretFile);
        await chmod(secretFile, 0o600);
        return "migrated";
      }
    }
  }
  const secret = `ocx_cursor_${randomBytes(32).toString("hex")}`;
  await writeFile(secretFile, `${secret}\n`, { mode: 0o600, flag: "wx" });
  return "created";
}

export async function prepareInstallSecret() {
  await mkdir(installRoot, { recursive: true });
  const legacyPlist = await runningLegacyPlist();
  const secretStatus = await migrateSecret(legacyPlist);
  return {
    legacyPlist,
    secretStatus,
    secret: (await readFile(secretFile, "utf8")).trim(),
  };
}

async function copyPackage() {
  if (resolve(sourcePackageRoot) === resolve(installedPackageRoot)) return;
  const temporary = `${installedPackageRoot}.tmp-${process.pid}`;
  await rm(temporary, { recursive: true, force: true });
  await cp(sourcePackageRoot, temporary, {
    recursive: true,
    filter: (source) => !source.includes("/node_modules/") && !source.includes("/.git/"),
  });
  await rm(installedPackageRoot, { recursive: true, force: true });
  await rename(temporary, installedPackageRoot);
}

async function installCliLink() {
  const target = join(installedPackageRoot, "bin", "ocx-cursor.mjs");
  await mkdir(dirname(cliLinkFile), { recursive: true });
  try {
    const stat = await lstat(cliLinkFile);
    if (!stat.isSymbolicLink() || resolve(dirname(cliLinkFile), await readlink(cliLinkFile)) !== resolve(target)) {
      throw new Error(`${cliLinkFile} already exists and is not managed by this package`);
    }
    await rm(cliLinkFile);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await symlink(target, cliLinkFile);
}

function launchAgent(nodePath) {
  const program = join(installedPackageRoot, "bin", "ocx-cursor.mjs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(serviceLabel)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(program)}</string>
    <string>service</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xml(stdoutFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrFile)}</string>
</dict>
</plist>
`;
}

export async function installService() {
  await mkdir(dirname(launchAgentFile), { recursive: true });
  const { legacyPlist, secretStatus } = await prepareInstallSecret();
  await copyPackage();
  await installCliLink();

  const nodePath = (await exists("/opt/homebrew/bin/node")) ? "/opt/homebrew/bin/node" : process.execPath;
  await writeFile(launchAgentFile, launchAgent(nodePath), { mode: 0o644 });
  bootout(serviceLabel);
  bootout(legacyServiceLabel);
  await bootstrap(launchAgentFile);

  if (legacyPlist.startsWith(dirname(legacyLaunchAgentFile)) && await exists(legacyPlist)) {
    const disabled = `${legacyPlist}.disabled-by-${serviceLabel}`;
    await rm(disabled, { force: true });
    await rename(legacyPlist, disabled);
  }
  return { installRoot, launchAgentFile, cliLinkFile, secretStatus };
}

export async function updateService(options = {}) {
  const execute = options.execFileSync || execFileSync;
  const ownsTemporaryDirectory = !options.temporaryDirectory;
  const temporaryDirectory = options.temporaryDirectory || await mkdtemp(join(tmpdir(), "ocx-cursor-update-"));
  try {
    execute(options.npmCommand || "npm", [
      "exec",
      "--yes",
      "--package=ocx-cursor@latest",
      "--",
      "ocx-cursor",
      "install",
    ], { cwd: temporaryDirectory, stdio: "inherit" });
  } finally {
    if (ownsTemporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function uninstallService() {
  bootout(serviceLabel);
  await rm(launchAgentFile, { force: true });
  try {
    if (resolve(dirname(cliLinkFile), await readlink(cliLinkFile)).startsWith(resolve(installRoot))) {
      await rm(cliLinkFile, { force: true });
    }
  } catch {}
  await rm(installRoot, { recursive: true, force: true });
}

export async function serviceStatus(fetchImpl = fetch) {
  const launchctl = commandOutput("launchctl", ["print", `${launchDomain}/${serviceLabel}`]);
  let health = null;
  try {
    const response = await fetchImpl("http://127.0.0.1:10101/healthz", { signal: AbortSignal.timeout(1000) });
    if (response.ok) health = await response.json();
  } catch {}
  return {
    installed: await exists(launchAgentFile),
    loaded: launchctl.includes("state = running") || launchctl.includes("state = active"),
    health,
    installRoot,
  };
}
