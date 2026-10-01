import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { browser } from "@wdio/globals";
import { ensureEdgeDriver } from "./support/edgeDriver.ts";
import { APP_BINARY, APP_IDENTIFIER, E2E_DIR, RUN_ROOT, SIDECAR_DIR } from "./support/paths.ts";

const DRIVER_PORT = Number(process.env.VIVEPDF_E2E_DRIVER_PORT ?? 4444);
const NATIVE_PORT = DRIVER_PORT + 1;

let tauriDriver: ChildProcess | null = null;
let driverLog: number | null = null;

function tauriDriverPath(): string {
  const name = process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver";
  const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), ".cargo"), "bin", name);
  return existsSync(cargoBin) ? cargoBin : name;
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error(`tauri-driver did not listen on ${port}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

function resetAppData() {
  for (const base of [process.env.APPDATA, process.env.LOCALAPPDATA]) {
    if (base) rmSync(join(base, APP_IDENTIFIER), { recursive: true, force: true });
  }
}

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [join(E2E_DIR, "specs", "*.e2e.ts")],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: DRIVER_PORT,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": { application: APP_BINARY },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "error",
  bail: 0,
  waitforTimeout: 20000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 1,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 240000 },

  onPrepare: async () => {
    if (!existsSync(APP_BINARY)) throw new Error(`E2E app binary missing: ${APP_BINARY} (run pnpm e2e:build)`);
    const runDir = join(RUN_ROOT, new Date().toISOString().replace(/[:.]/g, "-"));
    const fixtures = join(runDir, "fixtures");
    mkdirSync(fixtures, { recursive: true });
    const python = execFileSync("uv", ["run", "--project", SIDECAR_DIR, "python", "-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).trim();
    process.env.VIVEPDF_E2E_PYTHON = python;
    const manifest = execFileSync(python, [join(E2E_DIR, "support", "make_fixtures.py"), fixtures], { encoding: "utf8" });
    writeFileSync(join(runDir, "fixtures.json"), manifest);
    process.env.VIVEPDF_E2E_RUN_DIR = runDir;
    process.env.VIVEPDF_DATA_DIR = join(runDir, "engine-data");
    process.env.VIVEPDF_E2E_EDGEDRIVER = await ensureEdgeDriver();
    resetAppData();
  },

  beforeSession: async (_config, _capabilities, specs) => {
    const runDir = process.env.VIVEPDF_E2E_RUN_DIR as string;
    const name = (specs[0] ?? "spec").replace(/^.*[\\/]/, "").replace(/\.e2e\.ts$/, "");
    const workDir = join(runDir, name);
    mkdirSync(workDir, { recursive: true });
    const dialogFile = join(workDir, "dialog-answers.json");
    writeFileSync(dialogFile, "[]");
    process.env.VIVEPDF_E2E_WORK_DIR = workDir;
    process.env.VIVEPDF_E2E_DIALOG_FILE = dialogFile;
    const env: NodeJS.ProcessEnv = { ...process.env, VIVEPDF_E2E: "1", VIVEPDF_E2E_DIALOG_FILE: dialogFile };
    delete env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
    const log = openSync(join(workDir, "app.log"), "a");
    driverLog = log;
    tauriDriver = spawn(
      tauriDriverPath(),
      ["--port", String(DRIVER_PORT), "--native-port", String(NATIVE_PORT), "--native-driver", process.env.VIVEPDF_E2E_EDGEDRIVER as string],
      { stdio: ["ignore", log, log], env },
    );
    const cores = Number(process.env.VIVEPDF_E2E_CORES ?? 0);
    if (cores > 0 && tauriDriver.pid !== undefined) {
      execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Process -Id ${tauriDriver.pid}).ProcessorAffinity = ${2 ** cores - 1}`]);
    }
    await waitForPort(DRIVER_PORT, 30000);
  },

  afterTest: async (test, _context, result) => {
    if (result.passed) return;
    const name = `${test.parent} ${test.title}`.replace(/[^\w-]+/g, "_").slice(0, 120);
    await browser.saveScreenshot(join(process.env.VIVEPDF_E2E_WORK_DIR as string, `${name}.png`)).catch(() => undefined);
    const images = await browser
      .execute(() =>
        Array.from(document.querySelectorAll("img")).map((image) => ({
          src: image.src.slice(0, 80),
          complete: image.complete,
          width: image.naturalWidth,
          annotation: image.closest("[data-annotation-layer]") !== null,
          page: image.closest<HTMLElement>("[data-page-index]")?.dataset.pageIndex ?? null,
        })),
      )
      .catch(() => []);
    writeFileSync(join(process.env.VIVEPDF_E2E_WORK_DIR as string, `${name}.images.json`), JSON.stringify(images, null, 2));
    const failure = result.error instanceof Error ? (result.error.stack ?? result.error.message) : String(result.error);
    writeFileSync(join(process.env.VIVEPDF_E2E_WORK_DIR as string, `${name}.error.txt`), failure);
    const appLog = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, APP_IDENTIFIER, "logs", "vivepdf.log") : null;
    if (appLog && existsSync(appLog)) copyFileSync(appLog, join(process.env.VIVEPDF_E2E_WORK_DIR as string, `${name}.vivepdf.log`));
  },

  afterSession: async () => {
    const driver = tauriDriver;
    tauriDriver = null;
    if (driver && driver.exitCode === null) {
      const exited = new Promise((resolve) => driver.once("exit", resolve));
      driver.kill();
      await exited;
    }
    if (driverLog !== null) closeSync(driverLog);
    driverLog = null;
  },
};
