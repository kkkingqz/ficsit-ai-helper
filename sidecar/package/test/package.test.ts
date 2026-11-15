import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it, expect } from "vitest";
import {
  loadForemanPin,
  getDefaultConfig,
  LOOPBACK,
  PORTS,
} from "../src/config.js";
import {
  getLauncherJsCode,
  getStartBat,
  getStartSh,
  getStatusBat,
  getStatusSh,
  getStopBat,
  getStopSh,
} from "../src/launcher-code.js";
import { stagePackage, verifyWine } from "../src/builder.js";

describe("S5-lite Sidecar Packager", () => {
  it("loads and validates foreman.pin.json", () => {
    const pin = loadForemanPin();
    expect(pin.commit).toBe("08bebe16f3f459170479f5ded3b040087cf43593");
    expect(pin.license).toBe("Apache-2.0");
    expect(pin.defaultPorts["sf-mcp"]).toBe(8723);
    expect(pin.defaultPorts["ff-server"]).toBe(8724);
  });

  it("ensures AC-12: all launcher templates bind strictly to 127.0.0.1", () => {
    const launcherJs = getLauncherJsCode();
    expect(launcherJs).toContain(`HOST = '${LOOPBACK}'`);
    expect(launcherJs).toContain(`SF_MCP_PORT = ${PORTS.sfMcp}`);
    expect(launcherJs).toContain(`FF_SERVER_PORT = ${PORTS.ffServer}`);
    expect(launcherJs).toContain(`ADAPTER_PORT = ${PORTS.adapter}`);
    expect(launcherJs).toContain(`NORMALIZER_PORT = ${PORTS.normalizer}`);

    // Prohibit 0.0.0.0 in listen addresses
    expect(launcherJs).not.toContain("0.0.0.0");

    // Must spawn exactly the 3 processes
    expect(launcherJs).toContain("sf-mcp");
    expect(launcherJs).toContain("ff-server");
    expect(launcherJs).toContain("adapter");
  });

  it("generates start and stop scripts for Linux and Windows", () => {
    const startSh = getStartSh();
    const stopSh = getStopSh();
    const statusSh = getStatusSh();
    const startBat = getStartBat();
    const stopBat = getStopBat();
    const statusBat = getStatusBat();

    expect(startSh).toContain("launcher.js");
    expect(stopSh).toContain("launcher.js");
    expect(statusSh).toContain("launcher.js");

    expect(startBat).toContain("runtime\\node.exe");
    expect(stopBat).toContain("runtime\\node.exe");
    expect(statusBat).toContain("runtime\\node.exe");
  });

  it("stages linux-x64 layout with portable node and pre-migrated DB", { timeout: 30000 }, () => {
    const config = getDefaultConfig();
    const stageDir = stagePackage("linux-x64", config);

    expect(fs.existsSync(path.join(stageDir, "runtime/node"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/ff-server"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@foreman/sf-mcp"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/adapter/dist"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "app/node_modules/@ficsitai/save-source"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "data/foreman.db"))).toBe(true);
    expect(fs.statSync(path.join(stageDir, "data/foreman.db")).size).toBeGreaterThan(100000);
    expect(fs.existsSync(path.join(stageDir, "start.sh"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "launcher.js"))).toBe(true);
  });

  it("stages win-x64 layout and passes Wine verification", { timeout: 45000 }, () => {
    const config = getDefaultConfig();
    const stageDir = stagePackage("win-x64", config);

    expect(fs.existsSync(path.join(stageDir, "runtime/node.exe"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "start.bat"))).toBe(true);
    expect(fs.existsSync(path.join(stageDir, "data/foreman.db"))).toBe(true);

    const wineRes = verifyWine(stageDir);
    expect(wineRes.success).toBe(true);
    expect(wineRes.details).toContain("Wine 11.0 verified successfully");
  });
});
