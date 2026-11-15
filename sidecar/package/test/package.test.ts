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
  verifyForemanStartup,
  verifyAdapterDependencies,
  computeSha256,
  getNodeSha256,
  isSemverCompatible,
} from "../src/builder.js";

describe("S5-lite Sidecar Packager", () => {
  it("loads and validates foreman.pin.json", () => {
    const pin = loadForemanPin();
    expect(pin.commit).toBe("08bebe16f3f459170479f5ded3b040087cf43593");
    expect(pin.license).toBe("Apache-2.0");
    expect(pin.defaultPorts["sf-mcp"]).toBe(8723);
    expect(pin.defaultPorts["ff-server"]).toBe(8724);
  });

  it("ensures AC-12, SYSTEM_PROMPT_PATH, FOREMAN_ACCOUNT_PATH and 8731 in launcher.cjs", () => {
    const launcherCjs = getLauncherCjsCode();
    expect(launcherCjs).toContain(`HOST = '${LOOPBACK}'`);
    expect(launcherCjs).toContain(`SF_MCP_PORT = ${PORTS.sfMcp}`);
    expect(launcherCjs).toContain(`FF_SERVER_PORT = ${PORTS.ffServer}`);
    expect(launcherCjs).toContain(`ADAPTER_PORT = ${PORTS.adapter}`);
    expect(launcherCjs).toContain(`NORMALIZER_PORT = ${PORTS.normalizer}`);

    // Pre-flight port checks must include NORMALIZER_PORT (8731)
    expect(launcherCjs).toContain("checkPort(NORMALIZER_PORT)");

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

  it("validates dynamic Node SHA-256 resolution from SHASUMS256.txt", () => {
    const config = getDefaultConfig();
    const winSha = getNodeSha256(config.nodeVersion, "win-x64/node.exe", config.cacheDir);
    expect(winSha).toBe("dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f");

    const linuxSha = getNodeSha256(
      config.nodeVersion,
      `node-v${config.nodeVersion}-linux-x64.tar.xz`,
      config.cacheDir
    );
    expect(linuxSha).toBe("1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce");
  });

  it("validates semver compatibility logic for 0.x and 1.x+", () => {
    // 0.x minor bump is breaking
    expect(isSemverCompatible("^0.21.0", "0.21.0")).toBe(true);
    expect(isSemverCompatible("^0.21.0", "0.21.4")).toBe(true);
    expect(isSemverCompatible("^0.21.0", "0.22.0")).toBe(false);
    expect(isSemverCompatible("^0.21.0", "1.0.0")).toBe(false);

    // 1.x+ major bump is breaking
    expect(isSemverCompatible("^5.3.0", "5.3.0")).toBe(true);
    expect(isSemverCompatible("^5.3.0", "5.4.1")).toBe(true);
    expect(isSemverCompatible("^5.3.0", "6.0.0")).toBe(false);

    // Wildcards
    expect(isSemverCompatible("*", "1.2.3")).toBe(true);
    expect(isSemverCompatible("latest", "2.0.0")).toBe(true);
  });

  it("stages linux-x64 layout, validates prompt, smoke-tests ff-server, and verifies node execution", { timeout: 45000 }, () => {
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

    // 4. System prompt: exactly 2 active copies, dead third copy removed
    expect(fs.existsSync(path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/ff-server/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/SYSTEM_PROMPT.md"))).toBe(false);

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

    // 10. Smoke test ff-server startup
    const smokeRes = verifyForemanStartup(stageDir);
    expect(smokeRes.success).toBe(true);
  });

  it("stages win-x64 layout, validates prompt, and passes Wine verification directly in stagePackage", { timeout: 90000 }, () => {
    const config = getDefaultConfig();
    const stageDir = stagePackage("win-x64", config);

    expect(fs.existsSync(path.join(stageDir, "runtime/node.exe"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "start.bat"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "launcher.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/SYSTEM_PROMPT.md"))).toBe(false);
    expect(fs.existsSync(path.join(stageDir, "data/foreman.db"))).toBe(true);

    const wineRes = verifyWine(stageDir);
    expect(wineRes.success).toBe(true);
    expect(wineRes.details).toContain("Wine 11.0 verified successfully");
  });
});
