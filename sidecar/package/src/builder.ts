import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  BETTER_SQLITE3_WIN_URL,
  getDefaultConfig,
  LOOPBACK,
  NODE_DOWNLOAD_URLS,
} from "./config.js";
import {
  getLauncherJsCode,
  getReadmeTxt,
  getStartBat,
  getStartSh,
  getStatusBat,
  getStatusSh,
  getStopBat,
  getStopSh,
} from "./launcher-code.js";
import type { PackageConfig, PackageResult, TargetPlatform } from "./types.js";

function downloadFile(url: string, destPath: string): void {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    return;
  }
  const tmpPath = `${destPath}.tmp.${Date.now()}`;
  execFileSync("curl", ["-sSL", "-f", "-o", tmpPath, url], { stdio: "inherit" });
  fs.renameSync(tmpPath, destPath);
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function stagePortableNode(
  target: TargetPlatform,
  config: PackageConfig,
  runtimeDir: string
): string {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(config.cacheDir, { recursive: true });

  if (target === "win-x64") {
    const cachedNodeExe = path.join(
      config.cacheDir,
      `node-v${config.nodeVersion}-win-x64.exe`
    );
    const url = NODE_DOWNLOAD_URLS["win-x64"](config.nodeVersion);
    downloadFile(url, cachedNodeExe);

    const destExe = path.join(runtimeDir, "node.exe");
    fs.copyFileSync(cachedNodeExe, destExe);
    return destExe;
  } else {
    const cachedTar = path.join(
      config.cacheDir,
      `node-v${config.nodeVersion}-linux-x64.tar.xz`
    );
    const url = NODE_DOWNLOAD_URLS["linux-x64"](config.nodeVersion);
    downloadFile(url, cachedTar);

    const destNode = path.join(runtimeDir, "node");
    execFileSync(
      "tar",
      [
        "-xJ",
        "-f",
        cachedTar,
        "-C",
        runtimeDir,
        "--strip-components=2",
        `node-v${config.nodeVersion}-linux-x64/bin/node`,
      ],
      { stdio: "inherit" }
    );
    fs.chmodSync(destNode, 0o755);
    return destNode;
  }
}

export function stageForemanPackages(
  foremanSrcDir: string,
  appNodeModulesDir: string
): void {
  const packagesDir = path.join(foremanSrcDir, "packages");
  const foremanOrgDir = path.join(appNodeModulesDir, "@foreman");
  fs.mkdirSync(foremanOrgDir, { recursive: true });

  const pkgNames = [
    "sf-core",
    "sf-present",
    "sf-game-data",
    "sf-game-data-graph",
    "sf-save-data",
    "sf-save-data-graph",
    "sf-flow",
    "sf-mcp",
    "ff-server",
  ];

  for (const name of pkgNames) {
    const srcPkg = path.join(packagesDir, name);
    const destPkg = path.join(foremanOrgDir, name);
    fs.mkdirSync(destPkg, { recursive: true });

    // Copy dist
    const distSrc = path.join(srcPkg, "dist");
    if (fs.existsSync(distSrc)) {
      copyDirRecursive(distSrc, path.join(destPkg, "dist"));
    }

    // Copy package.json
    const pkgJson = path.join(srcPkg, "package.json");
    if (fs.existsSync(pkgJson)) {
      fs.copyFileSync(pkgJson, path.join(destPkg, "package.json"));
    }

    // Copy data for sf-game-data
    const dataSrc = path.join(srcPkg, "data");
    if (fs.existsSync(dataSrc)) {
      copyDirRecursive(dataSrc, path.join(destPkg, "data"));
    }

    // Copy prisma for ff-server
    const prismaSrc = path.join(srcPkg, "prisma");
    if (fs.existsSync(prismaSrc)) {
      copyDirRecursive(prismaSrc, path.join(destPkg, "prisma"));
    }
  }
}

export function stageProductionModules(
  foremanSrcDir: string,
  appNodeModulesDir: string,
  target: TargetPlatform,
  cacheDir: string
): void {
  const srcNm = path.join(foremanSrcDir, "node_modules");
  fs.mkdirSync(appNodeModulesDir, { recursive: true });

  const EXCLUDED_DIRS = new Set([
    "typescript",
    "@typescript",
    "vitest",
    "@vitest",
    "eslint",
    "@eslint",
    "prettier",
    "tsx",
    "esbuild",
    "@esbuild",
    "@rolldown",
    "@foreman",
    ".bin",
    ".cache",
  ]);

  for (const entry of fs.readdirSync(srcNm)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const srcPath = path.join(srcNm, entry);
    const destPath = path.join(appNodeModulesDir, entry);
    fs.cpSync(srcPath, destPath, { recursive: true });
  }

  // Note: better-sqlite3 native addon replacement for Windows
  if (target === "win-x64") {
    const cachedWinSqliteTar = path.join(
      cacheDir,
      "better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz"
    );
    downloadFile(BETTER_SQLITE3_WIN_URL, cachedWinSqliteTar);

    const tmpExtract = path.join(cacheDir, "win32-better-sqlite3-extract");
    fs.mkdirSync(tmpExtract, { recursive: true });
    execFileSync("tar", ["-xz", "-f", cachedWinSqliteTar, "-C", tmpExtract], {
      stdio: "inherit",
    });

    const targetReleaseDir = path.join(
      appNodeModulesDir,
      "better-sqlite3",
      "build",
      "Release"
    );
    fs.mkdirSync(targetReleaseDir, { recursive: true });
    fs.copyFileSync(
      path.join(tmpExtract, "build", "Release", "better_sqlite3.node"),
      path.join(targetReleaseDir, "better_sqlite3.node")
    );
    fs.rmSync(tmpExtract, { recursive: true, force: true });
  }
}

export function stageAdapterAndSaveSource(
  adapterDir: string,
  saveSourceDir: string,
  appDir: string,
  appNodeModulesDir: string
): void {
  // 1. Stage @ficsitai/save-source
  const saveSourceOrgDir = path.join(appNodeModulesDir, "@ficsitai", "save-source");
  fs.mkdirSync(saveSourceOrgDir, { recursive: true });
  copyDirRecursive(path.join(saveSourceDir, "dist"), path.join(saveSourceOrgDir, "dist"));
  fs.copyFileSync(
    path.join(saveSourceDir, "package.json"),
    path.join(saveSourceOrgDir, "package.json")
  );

  // 2. Stage adapter
  const destAdapterDir = path.join(appDir, "adapter");
  fs.mkdirSync(destAdapterDir, { recursive: true });
  copyDirRecursive(path.join(adapterDir, "dist"), path.join(destAdapterDir, "dist"));
  fs.copyFileSync(
    path.join(adapterDir, "package.json"),
    path.join(destAdapterDir, "package.json")
  );
}

export function deployCleanDatabase(
  foremanSrcDir: string,
  destDbPath: string
): void {
  fs.mkdirSync(path.dirname(destDbPath), { recursive: true });
  if (fs.existsSync(destDbPath)) {
    fs.unlinkSync(destDbPath);
  }

  const ffServerDir = path.join(foremanSrcDir, "packages", "ff-server");
  execFileSync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema=prisma/schema.prisma"],
    {
      cwd: ffServerDir,
      env: {
        ...process.env,
        DATABASE_URL: `file:${destDbPath}`,
      },
      stdio: "inherit",
    }
  );
}

export function stagePackage(
  target: TargetPlatform,
  customConfig?: Partial<PackageConfig>
): string {
  const config = { ...getDefaultConfig(), ...customConfig };
  const stageDir = path.join(config.outputDir, "staging", target);

  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stageDir, { recursive: true });

  const runtimeDir = path.join(stageDir, "runtime");
  const appDir = path.join(stageDir, "app");
  const appNodeModulesDir = path.join(appDir, "node_modules");
  const dataDir = path.join(stageDir, "data");
  const savesDir = path.join(dataDir, "saves");
  const logsDir = path.join(stageDir, "logs");
  const runDir = path.join(stageDir, "run");

  for (const d of [runtimeDir, appDir, appNodeModulesDir, dataDir, savesDir, logsDir, runDir]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // 1. Portable Node
  stagePortableNode(target, config, runtimeDir);

  // 2. Foreman packages
  stageForemanPackages(config.foremanSrcDir, appNodeModulesDir);

  // 3. Production node_modules
  stageProductionModules(
    config.foremanSrcDir,
    appNodeModulesDir,
    target,
    config.cacheDir
  );

  // 4. Adapter and save-source
  stageAdapterAndSaveSource(
    config.adapterDir,
    config.saveSourceDir,
    appDir,
    appNodeModulesDir
  );

  // 5. Pre-migrated clean SQLite database
  const destDb = path.join(dataDir, "foreman.db");
  deployCleanDatabase(config.foremanSrcDir, destDb);

  // 6. Scripts and launchers
  fs.writeFileSync(path.join(stageDir, "launcher.js"), getLauncherJsCode());
  fs.writeFileSync(path.join(stageDir, "start.sh"), getStartSh());
  fs.writeFileSync(path.join(stageDir, "stop.sh"), getStopSh());
  fs.writeFileSync(path.join(stageDir, "status.sh"), getStatusSh());
  fs.writeFileSync(path.join(stageDir, "start.bat"), getStartBat());
  fs.writeFileSync(path.join(stageDir, "stop.bat"), getStopBat());
  fs.writeFileSync(path.join(stageDir, "status.bat"), getStatusBat());
  fs.writeFileSync(path.join(stageDir, "README.txt"), getReadmeTxt());

  fs.chmodSync(path.join(stageDir, "start.sh"), 0o755);
  fs.chmodSync(path.join(stageDir, "stop.sh"), 0o755);
  fs.chmodSync(path.join(stageDir, "status.sh"), 0o755);

  return stageDir;
}

export function createZipArchive(stageDir: string, zipPath: string): number {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  execFileSync("zip", ["-r", "-q", zipPath, "."], {
    cwd: stageDir,
    stdio: "inherit",
  });
  return fs.statSync(zipPath).size;
}

export function buildTarget(
  target: TargetPlatform,
  customConfig?: Partial<PackageConfig>
): PackageResult {
  const config = { ...getDefaultConfig(), ...customConfig };
  fs.mkdirSync(config.outputDir, { recursive: true });

  const stageDir = stagePackage(target, config);
  const zipName = `ficsitai-sidecar-${target}.zip`;
  const archivePath = path.join(config.outputDir, zipName);
  const archiveSizeBytes = createZipArchive(stageDir, archivePath);

  return {
    target,
    archivePath,
    archiveSizeBytes,
    stageDir,
    processCount: 3,
    bindAddress: LOOPBACK,
  };
}

export function verifyWine(stageDir: string): { success: boolean; details: string } {
  const nodeExe = path.join(stageDir, "runtime", "node.exe");
  if (!fs.existsSync(nodeExe)) {
    return { success: false, details: `runtime/node.exe not found in ${stageDir}` };
  }

  const logFile = path.join(stageDir, "run", "wine-verify.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  try {
    // 1. Verify portable node runs under wine
    const verOutput = execFileSync("wine", [nodeExe, "-v"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();

    // 2. Verify better-sqlite3 loads under wine by redirecting to log file
    const appDir = path.join(stageDir, "app");
    const testScript = "const db = require('better-sqlite3')(':memory:'); const row = db.prepare('SELECT 1 + 1 as res').get(); if (row.res !== 2) throw new Error('mismatch'); console.log('WINE_SQLITE_OK_RES_' + row.res);";

    execFileSync(
      "bash",
      [
        "-c",
        `cd "${appDir}" && wine "${nodeExe}" -e "${testScript}" > "${logFile}" 2>&1`,
      ],
      { encoding: "utf-8" }
    );

    const output = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";

    if (output.includes("WINE_SQLITE_OK_RES_2")) {
      return {
        success: true,
        details: `Wine 11.0 verified successfully: Node ${verOutput}, SQLite in-memory query OK`,
      };
    } else {
      return { success: false, details: `Wine output mismatch: ${output}` };
    }
  } catch (err: any) {
    const output = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";
    return {
      success: false,
      details: `Wine verification failed: ${err.message || String(err)}\nOutput: ${output}`,
    };
  }
}
