import { homedir } from "node:os";
import { join } from "node:path";

export const serviceLabel = "com.opencodex.cursor-bridge";
export const legacyServiceLabel = "com.local.opencodex.cursor-gateway";
export const installRoot = process.env.OCX_CURSOR_HOME || join(homedir(), ".opencodex", "cursor-bridge");
export const installedPackageRoot = join(installRoot, "package");
export const cliLinkFile = join(homedir(), ".local", "bin", "ocx-cursor");
export const secretFile = join(installRoot, "secret");
export const catalogFile = join(installRoot, "catalog.json");
export const pendingFile = join(installRoot, "pending-sync.json");
export const stdoutFile = join(installRoot, "service.log");
export const stderrFile = join(installRoot, "service.error.log");
export const launchAgentFile = join(homedir(), "Library", "LaunchAgents", `${serviceLabel}.plist`);
export const legacyLaunchAgentFile = join(homedir(), "Library", "LaunchAgents", `${legacyServiceLabel}.plist`);
export const cursorDatabaseFile = join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
export const cursorAppOutDirectory = "/Applications/Cursor.app/Contents/Resources/app/out";
export const cursorWorkbenchFile = join(cursorAppOutDirectory, "vs", "workbench", "workbench.desktop.main.js");
export const cursorGlassWorkbenchFile = join(cursorAppOutDirectory, "vs", "workbench", "workbench.glass.main.js");
export const cursorLocalRuntimeFiles = [
  "/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-local-agent-runtime/dist/main.js",
  "/Applications/Cursor.app/Contents/Resources/app/extensions/cursor-agent-exec/dist/main.js",
];
export const cursorBundleFiles = [
  join(cursorAppOutDirectory, "main.js"),
  join(cursorAppOutDirectory, "vs", "code", "electron-utility", "alwaysLocalSingleton", "alwaysLocalSingletonMain.js"),
  join(cursorAppOutDirectory, "vs", "code", "electron-utility", "mcpProcess", "mcpProcessMain.js"),
  join(cursorAppOutDirectory, "vs", "code", "electron-utility", "sharedProcess", "sharedProcessMain.js"),
  join(cursorAppOutDirectory, "vs", "workbench", "api", "node", "extensionHostProcess.js"),
  join(cursorAppOutDirectory, "vs", "workbench", "api", "worker", "extensionHostWorkerMain.js"),
  cursorWorkbenchFile,
  cursorGlassWorkbenchFile,
];
export const cursorPatchBackupDirectory = join(installRoot, "cursor-app-backups");
export const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
export const codexConfigFile = join(codexHome, "config.toml");
export const defaultCodexCatalogFile = join(codexHome, "opencodex-catalog.json");
export const opencodexConfigFile = join(homedir(), ".opencodex", "config.json");
export const opencodexServiceTokenFile = join(homedir(), ".opencodex", "service-api-token");
export const gatewayPort = Number(process.env.OCX_CURSOR_PORT || "10101");
export const gatewayHost = process.env.OCX_CURSOR_HOST || "127.0.0.1";
export const cursorLocalBaseUrl = `http://127.0.0.1:${gatewayPort}/v1`;
export const cursorOpenAIBaseUrl = process.env.OCX_CURSOR_BASE_URL || "";
export const managedPrefix = "opencodex/";
