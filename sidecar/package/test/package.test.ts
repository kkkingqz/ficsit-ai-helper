import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  loadForemanPin,
  getDefaultConfig,
  LOOPBACK,
  PORTS,
  EXPECTED_SHA256,
} from "../src/config.js";
import {
  getLauncherCjsCode,
  getLauncherJsCode,
  getStartBat,
  getStartSh,
  getStatusBat,
  getStatusSh,
  getStopBat,
  getStopSh,
} from "../src/launcher-code.js";
import {
  stagePackage,
  verifyWine,
  verifyLinuxNode,
  verifyAdapterDependencies,
  computeSha256,
} from "../src/builder.js";

describe("S5-lite Sidecar Packager", () => {
  it("loads and validates foreman.pin.json", () => {
    const pin = loadForemanPin();
    expect(pin.commit).toBe("08bebe16f3f459170479f5ded3b040087cf43593");
    expect(pin.license).toBe("Apache-2.0");
    expect(pin.defaultPorts["sf-mcp"]).toBe(8723);
    expect(pin.defaultPorts["ff-server"]).toBe(8724);
  });

  it("ensures AC-12, SYSTEM_PROMPT_PATH and FOREMAN_ACCOUNT_PATH in launcher.cjs", () => {
    const launcherCjs = getLauncherCjsCode();
    expect(launcherCjs).toContain(`HOST = '${LOOPBACK}'`);
    expect(launcherCjs).toContain(`SF_MCP_PORT = ${PORTS.sfMcp}`);
    expect(launcherCjs).toContain(`FF_SERVER_PORT = ${PORTS.ffServer}`);
    expect(launcherCjs).toContain(`ADAPTER_PORT = ${PORTS.adapter}`);
    expect(launcherCjs).toContain(`NORMALIZER_PORT = ${PORTS.normalizer}`);

    // System prompt & account path explicitly defined
    expect(launcherCjs).toContain("SYSTEM_PROMPT_PATH");
    expect(launcherCjs).toContain("FOREMAN_ACCOUNT_PATH");
    expect(launcherCjs).not.toContain("NODE_PATH");

    // Prohibit 0.0.0.0 in listen addresses
    expect(launcherCjs).not.toContain("0.0.0.0");

    // Must spawn exactly the 3 processes
    expect(launcherCjs).toContain("sf-mcp");
    expect(launcherCjs).toContain("ff-server");
    expect(launcherCjs).toContain("adapter");
  });

  it("generates start and stop scripts invoking launcher.cjs and supporting set-key", () => {
    const startSh = getStartSh();
    const stopSh = getStopSh();
    const statusSh = getStatusSh();
    const startBat = getStartBat();
    const stopBat = getStopBat();
    const statusBat = getStatusBat();

    expect(startSh).toContain("launcher.cjs");
    expect(stopSh).toContain("launcher.cjs");
    expect(statusSh).toContain("launcher.cjs");

    // start.sh properly passes arguments or defaults to start
    expect(startSh).toContain('"$@"');
    expect(startSh).toContain("start");

    expect(startBat).toContain("runtime\\node.exe");
    expect(startBat).toContain("launcher.cjs");
    expect(stopBat).toContain("runtime\\node.exe");
    expect(statusBat).toContain("runtime\\node.exe");
  });

  it("validates SHA-256 checksums of cached external binaries", () => {
    const config = getDefaultConfig();
    for (const [file, expectedSha] of Object.entries(EXPECTED_SHA256)) {
      const cached = path.join(config.cacheDir, file);
      if (fs.existsSync(cached)) {
        const actualSha = computeSha256(cached);
        expect(actualSha).toBe(expectedSha);
      }
    }
  });

  it("stages linux-x64 layout, validates prompt, excludes dev tools, and verifies node execution", { timeout: 45000 }, () => {
    const config = getDefaultConfig();
    const stageDir = stagePackage("linux-x64", config);

    // 1. Portable Node binary
    expect(fs.existsSync(path.join(stageDir, "runtime/node"))).toBe(true);

    // 2. Packages
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/ff-server"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/sf-mcp"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/adapter/dist"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@ficsitai/save-source"))).toBe(true);

    // 3. Database
    expect(fs.existsSync(path.join(stageDir, "data/foreman.db"))).toBe(true);
    expect(fs.statSync(path.join(stageDir, "data/foreman.db")).size).toBeGreaterThan(100000);

    // 4. System prompt
    expect(fs.existsSync(path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/ff-server/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.statSync(path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md")).size).toBeGreaterThan(1000);

    // 5. CommonJS launcher and root package.json
    expect(fs.existsSync(path.join(stageDir, "launcher.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "package.json"))).toBe(true);
    const rootPkg = JSON.parse(fs.readFileSync(path.join(stageDir, "package.json"), "utf-8"));
    expect(rootPkg.type).toBe("commonjs");

    // 6. Dev tools excluded from production node_modules
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/prisma"))).toBe(false);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@types"))).toBe(false);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/typescript"))).toBe(false);

    // 7. Essential runtime dependencies included
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/better-sqlite3"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@prisma/client"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/.prisma"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/zod-to-json-schema"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/bindings"))).toBe(true);

    // 8. Launchers
    expect(fs.existsSync(path.join(stageDir, "start.sh"))).toBe(true);

    // 9. Linux native addon test
    const linuxRes = verifyLinuxNode(stageDir);
    expect(linuxRes.success).toBe(true);
  });

  it("stages win-x64 layout, validates prompt, and passes Wine verification", { timeout: 45000 }, () => {
    const config = getDefaultConfig();
    const stageDir = stagePackage("win-x64", config);

    expect(fs.existsSync(path.join(stageDir, "runtime/node.exe"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "start.bat"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "launcher.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "data/foreman.db"))).toBe(true);

    const wineRes = verifyWine(stageDir);
    expect(wineRes.success).toBe(true);
    expect(wineRes.details).toContain("Wine 11.0 verified successfully");
  });
});
