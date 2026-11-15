import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  BETTER_SQLITE3_WIN_URL,
  EXPECTED_SHA256,
  getDefaultConfig,
  LOOPBACK,
  NODE_DOWNLOAD_URLS,
  REPO_ROOT,
} from "./config.js";
import {
  getLauncherCjsCode,
  getReadmeTxt,
  getStartBat,
  getStartSh,
  getStatusBat,
  getStatusSh,
  getStopBat,
  getStopSh,
} from "./launcher-code.js";
import type { PackageConfig, PackageResult, TargetPlatform } from "./types.js";

export function computeSha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest("hex");
}

/**
 * Dynamically resolves official SHA-256 from Node.js SHASUMS256.txt for the given version.
 * Caches SHASUMS256.txt locally.
 */
export function getNodeSha256(
  version: string,
  targetRelPath: string,
  cacheDir: string
): string {
  const shasumsUrl = `https://nodejs.org/dist/v${version}/SHASUMS256.txt`;
  const cachedShasums = path.join(cacheDir, `SHASUMS256-v${version}.txt`);
  if (!fs.existsSync(cachedShasums) || fs.statSync(cachedShasums).size === 0) {
    fs.mkdirSync(cacheDir, { recursive: true });
    execFileSync("curl", ["-sSL", "-f", "-o", cachedShasums, shasumsUrl], {
      stdio: "inherit",
    });
  }
  const content = fs.readFileSync(cachedShasums, "utf-8");
  for (const line of content.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[1] === targetRelPath) {
      return parts[0]!;
    }
  }
  throw new Error(
    `SHA-256 for ${targetRelPath} not found in Node v${version} SHASUMS256.txt`
  );
}

export function downloadFile(
  url: string,
  destPath: string,
  expectedSha256?: string
): void {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const baseName = path.basename(destPath);
  const expectedHash = expectedSha256 ?? EXPECTED_SHA256[baseName];

  if (!expectedHash) {
    throw new Error(
      `No SHA-256 checksum configured for ${baseName}. Downloading unverified external files is prohibited.`
    );
  }

  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
    const actual = computeSha256(destPath);
    if (actual === expectedHash) {
      return;
    }
    console.warn(
      `[WARN] Cached file ${baseName} SHA-256 mismatch (got ${actual}, expected ${expectedHash}), re-downloading...`
    );
    fs.unlinkSync(destPath);
  }

  const tmpPath = `${destPath}.tmp.${Date.now()}`;
  execFileSync("curl", ["-sSL", "-f", "-o", tmpPath, url], { stdio: "inherit" });

  const actual = computeSha256(tmpPath);
  if (actual !== expectedHash) {
    fs.unlinkSync(tmpPath);
    throw new Error(
      `SHA-256 verification failed for ${baseName}. Expected ${expectedHash}, got ${actual}`
    );
  }

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
    const expectedSha = getNodeSha256(
      config.nodeVersion,
      "win-x64/node.exe",
      config.cacheDir
    );
    downloadFile(url, cachedNodeExe, expectedSha);

    const destExe = path.join(runtimeDir, "node.exe");
    fs.copyFileSync(cachedNodeExe, destExe);
    return destExe;
  } else {
    const tarName = `node-v${config.nodeVersion}-linux-x64.tar.xz`;
    const cachedTar = path.join(config.cacheDir, tarName);
    const url = NODE_DOWNLOAD_URLS["linux-x64"](config.nodeVersion);
    const expectedSha = getNodeSha256(
      config.nodeVersion,
      tarName,
      config.cacheDir
    );
    downloadFile(url, cachedTar, expectedSha);

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

/**
 * Collects production runtime dependencies transitively starting from
 * ff-server, sf-mcp, and adapter. Excludes dev-only tools (prisma CLI, @types,
 * typescript, test frameworks, etc.) to keep archive minimal and secure.
 */
export function collectProductionDependencies(
  foremanSrcDir: string,
  adapterDir: string
): string[] {
  const nmDir = path.join(foremanSrcDir, "node_modules");
  const visited = new Set<string>();
  const queue: string[] = [];

  function addDependenciesFromPkg(pkgJsonPath: string): void {
    if (!fs.existsSync(pkgJsonPath)) return;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
      if (pkg.dependencies && typeof pkg.dependencies === "object") {
        for (const dep of Object.keys(pkg.dependencies)) {
          // Skip dev-only packages and TypeScript type definitions
          if (dep.startsWith("@types/")) continue;
          if (
            dep === "prisma" ||
            dep.startsWith("@prisma/studio") ||
            dep.startsWith("@prisma/dev") ||
            dep.startsWith("@prisma/engines")
          ) {
            continue;
          }

          if (dep.startsWith("@foreman/")) {
            const internalDir = path.join(
              foremanSrcDir,
              "packages",
              dep.replace("@foreman/", ""),
              "package.json"
            );
            addDependenciesFromPkg(internalDir);
          } else if (!visited.has(dep)) {
            visited.add(dep);
            queue.push(dep);
          }
        }
      }
    } catch {
      // Ignore unparseable package.json
    }
  }

  // Seed strictly from the backend packages and adapter
  addDependenciesFromPkg(path.join(foremanSrcDir, "packages/ff-server/package.json"));
  addDependenciesFromPkg(path.join(foremanSrcDir, "packages/sf-mcp/package.json"));
  addDependenciesFromPkg(path.join(adapterDir, "package.json"));

  // Also check sf-core, sf-flow, sf-game-data, sf-save-data
  const internalNames = [
    "sf-core",
    "sf-present",
    "sf-game-data",
    "sf-game-data-graph",
    "sf-save-data",
    "sf-save-data-graph",
    "sf-flow",
  ];
  for (const name of internalNames) {
    addDependenciesFromPkg(
      path.join(foremanSrcDir, "packages", name, "package.json")
    );
  }

  // Transitively resolve all child dependencies
  while (queue.length > 0) {
    const dep = queue.shift()!;
    const depPkgJson = path.join(nmDir, dep, "package.json");
    if (fs.existsSync(depPkgJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(depPkgJson, "utf-8"));
        if (pkg.dependencies && typeof pkg.dependencies === "object") {
          for (const nextDep of Object.keys(pkg.dependencies)) {
            if (nextDep.startsWith("@types/")) continue;
            if (
              nextDep === "prisma" ||
              nextDep.startsWith("@prisma/studio") ||
              nextDep.startsWith("@prisma/dev") ||
              nextDep.startsWith("@prisma/engines")
            ) {
              continue;
            }
            if (!visited.has(nextDep) && !nextDep.startsWith("@foreman/")) {
              visited.add(nextDep);
              queue.push(nextDep);
            }
          }
        }
      } catch {
        // Ignore unparseable package.json
      }
    }
  }

  return Array.from(visited).sort();
}

export function stageProductionModules(
  foremanSrcDir: string,
  appNodeModulesDir: string,
  target: TargetPlatform,
  cacheDir: string,
  adapterDir?: string
): void {
  const srcNm = path.join(foremanSrcDir, "node_modules");
  fs.mkdirSync(appNodeModulesDir, { recursive: true });

  const effectiveAdapterDir =
    adapterDir || path.resolve(REPO_ROOT, "sidecar/adapter");
  const productionPackages = collectProductionDependencies(
    foremanSrcDir,
    effectiveAdapterDir
  );

  for (const dep of productionPackages) {
    const srcPath = path.join(srcNm, dep);
    if (!fs.existsSync(srcPath)) continue;

    const destPath = path.join(appNodeModulesDir, dep);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.cpSync(srcPath, destPath, { recursive: true });
  }

  // Copy generated .prisma runtime client (required by @prisma/client)
  const srcPrismaClient = path.join(foremanSrcDir, "node_modules", ".prisma");
  if (fs.existsSync(srcPrismaClient)) {
    const destPrismaClient = path.join(appNodeModulesDir, ".prisma");
    fs.mkdirSync(destPrismaClient, { recursive: true });
    fs.cpSync(srcPrismaClient, destPrismaClient, { recursive: true });
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

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemver(v: string): SemVer | null {
  const m = v.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m || !m[1] || !m[2]) return null;
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3] || "0", 10),
  };
}

export function isSemverCompatible(
  reqRange: string,
  installedVersion: string
): boolean {
  if (
    reqRange === "*" ||
    reqRange === "latest" ||
    reqRange.startsWith("workspace:")
  ) {
    return true;
  }
  const req = parseSemver(reqRange);
  const inst = parseSemver(installedVersion);
  if (!req || !inst) return true;

  if (reqRange.startsWith("^")) {
    if (req.major === 0) {
      // For 0.x releases, minor bump is breaking
      return (
        inst.major === 0 &&
        inst.minor === req.minor &&
        inst.patch >= req.patch
      );
    }
    return (
      inst.major === req.major &&
      (inst.minor > req.minor ||
        (inst.minor === req.minor && inst.patch >= req.patch))
    );
  }

  if (reqRange.startsWith("~")) {
    return (
      inst.major === req.major &&
      inst.minor === req.minor &&
      inst.patch >= req.patch
    );
  }

  if (reqRange.startsWith(">=")) {
    if (inst.major !== req.major) return inst.major > req.major;
    if (inst.minor !== req.minor) return inst.minor > req.minor;
    return inst.patch >= req.patch;
  }

  return (
    inst.major === req.major &&
    inst.minor === req.minor &&
    inst.patch === req.patch
  );
}

export function verifyAdapterDependencies(
  adapterDir: string,
  appNodeModulesDir: string
): void {
  const adapterPkgPath = path.join(adapterDir, "package.json");
  if (!fs.existsSync(adapterPkgPath)) {
    throw new Error(`adapter/package.json not found at ${adapterPkgPath}`);
  }
  const adapterPkg = JSON.parse(fs.readFileSync(adapterPkgPath, "utf-8"));
  const requiredDeps: Record<string, string> = adapterPkg.dependencies || {};

  for (const [dep, reqRange] of Object.entries(requiredDeps)) {
    const installedPkgPath = path.join(appNodeModulesDir, dep, "package.json");
    if (!fs.existsSync(installedPkgPath)) {
      throw new Error(
        `Adapter dependency '${dep}' is missing from staged node_modules (${installedPkgPath})`
      );
    }
    const installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, "utf-8"));
    const installedVersion: string = installedPkg.version || "";

    if (!isSemverCompatible(reqRange, installedVersion)) {
      throw new Error(
        `Adapter dependency '${dep}' version mismatch: requested range ${reqRange}, installed ${installedVersion}`
      );
    }
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

export function verifyLinuxNode(
  stageDir: string
): { success: boolean; details: string } {
  const nodeBin = path.join(stageDir, "runtime", "node");
  if (!fs.existsSync(nodeBin)) {
    return { success: false, details: `runtime/node not found in ${stageDir}` };
  }

  try {
    const verOutput = execFileSync(nodeBin, ["-v"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      killSignal: "SIGKILL",
    }).trim();

    const appDir = path.join(stageDir, "app");
    const testScript =
      "const db = require('better-sqlite3')(':memory:'); const row = db.prepare('SELECT 1 + 1 as res').get(); if (row.res !== 2) throw new Error('mismatch'); console.log('LINUX_SQLITE_OK_RES_' + row.res);";

    const testOutput = execFileSync(nodeBin, ["-e", testScript], {
      cwd: appDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
      killSignal: "SIGKILL",
    });

    if (testOutput.includes("LINUX_SQLITE_OK_RES_2")) {
      return {
        success: true,
        details: `Linux portable Node verified successfully: Node ${verOutput}, SQLite in-memory query OK`,
      };
    } else {
      return {
        success: false,
        details: `Linux verification output mismatch: ${testOutput}`,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      details: `Linux portable Node verification failed: ${err.message || String(err)}`,
    };
  }
}

/**
 * Smoke-tests starting ff-server from the staged directory using portable Node.
 * Verifies system prompt loading, SQLite connection, and HTTP listener startup.
 */
export function verifyForemanStartup(
  stageDir: string
): { success: boolean; details: string } {
  const nodeBin = path.join(stageDir, "runtime/node");
  const ffScript = path.join(
    stageDir,
    "app/node_modules/@foreman/ff-server/dist/index.js"
  );
  const promptPath = path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md");
  const dbPath = path.join(stageDir, "data/foreman.db");
  const appDir = path.join(stageDir, "app");

  if (!fs.existsSync(nodeBin) || !fs.existsSync(ffScript)) {
    return {
      success: false,
      details: `Required binaries missing for smoke test in ${stageDir}`,
    };
  }

  const runnerCode = `
const { spawn } = require("child_process");
const proc = spawn(process.execPath, [${JSON.stringify(ffScript)}], {
  cwd: ${JSON.stringify(appDir)},
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: "28724",
    SYSTEM_PROMPT_PATH: ${JSON.stringify(promptPath)},
    DATABASE_URL: "file:" + ${JSON.stringify(dbPath)},
    LLM_API_KEY: "smoke-test-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
proc.stdout.on("data", (d) => {
  out += d.toString();
  if (out.includes("Listening on")) {
    proc.kill("SIGTERM");
    process.exit(0);
  }
});
proc.stderr.on("data", (d) => {
  out += d.toString();
});

proc.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error("Exited with code", code, out);
    process.exit(1);
  }
});

setTimeout(() => {
  proc.kill("SIGTERM");
  console.error("Smoke test timeout. Output:", out);
  process.exit(1);
}, 6000);
`;

  try {
    execFileSync(nodeBin, ["-e", runnerCode], {
      cwd: appDir,
      encoding: "utf-8",
      timeout: 10000,
    });
    return {
      success: true,
      details: "Foreman ff-server startup verified successfully",
    };
  } catch (err: any) {
    return {
      success: false,
      details: `Foreman ff-server startup failed: ${err.message || String(err)}`,
    };
  }
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

  // 3. Production node_modules (whitelist-based, no dev tools)
  stageProductionModules(
    config.foremanSrcDir,
    appNodeModulesDir,
    target,
    config.cacheDir,
    config.adapterDir
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

  // 6. Copy system prompt template to exactly the two active locations
  const systemPromptSrc = path.resolve(
    REPO_ROOT,
    "third_party/foreman/SYSTEM_PROMPT.md"
  );
  if (!fs.existsSync(systemPromptSrc)) {
    throw new Error(`SYSTEM_PROMPT.md not found at ${systemPromptSrc}`);
  }
  // 6a. Main copy for SYSTEM_PROMPT_PATH
  const promptDestForeman = path.join(stageDir, "app/foreman/SYSTEM_PROMPT.md");
  fs.mkdirSync(path.dirname(promptDestForeman), { recursive: true });
  fs.copyFileSync(systemPromptSrc, promptDestForeman);

  // 6b. Fallback copy at ff-server package root
  const promptDestServerPkg = path.join(
    appNodeModulesDir,
    "@foreman/ff-server/SYSTEM_PROMPT.md"
  );
  fs.mkdirSync(path.dirname(promptDestServerPkg), { recursive: true });
  fs.copyFileSync(systemPromptSrc, promptDestServerPkg);

  // 7. Validate adapter dependencies against staged node_modules
  verifyAdapterDependencies(config.adapterDir, appNodeModulesDir);

  // 8. Root package.json declaring CommonJS module scope
  const rootPkg = {
    name: "ficsitai-sidecar",
    version: "0.1.0",
    private: true,
    type: "commonjs",
    description: "FICSIT AI Sidecar self-contained runtime",
  };
  fs.writeFileSync(
    path.join(stageDir, "package.json"),
    JSON.stringify(rootPkg, null, 2) + "\n"
  );

  // 9. Scripts and launchers
  fs.writeFileSync(path.join(stageDir, "launcher.cjs"), getLauncherCjsCode());
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

  // 10. Self-verify native addon loading and smoke tests
  if (target === "linux-x64") {
    const linuxVerify = verifyLinuxNode(stageDir);
    if (!linuxVerify.success) {
      throw new Error(`Linux verification failed: ${linuxVerify.details}`);
    }
    const smokeVerify = verifyForemanStartup(stageDir);
    if (!smokeVerify.success) {
      throw new Error(`Foreman startup verification failed: ${smokeVerify.details}`);
    }
  } else if (target === "win-x64") {
    const wineVerify = verifyWine(stageDir, config.cacheDir);
    if (!wineVerify.success) {
      throw new Error(`Wine verification failed: ${wineVerify.details}`);
    }
  }

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

export function verifyWine(
  stageDir: string,
  cacheDir?: string
): { success: boolean; details: string } {
  const nodeExe = path.join(stageDir, "runtime", "node.exe");
  if (!fs.existsSync(nodeExe)) {
    return { success: false, details: `runtime/node.exe not found in ${stageDir}` };
  }

  const logFile = path.join(stageDir, "run", "wine-verify.log");
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const winePrefix = cacheDir
    ? path.join(cacheDir, "wine-prefix")
    : path.resolve(stageDir, "../../cache/wine-prefix");
  fs.mkdirSync(winePrefix, { recursive: true });

  const wineEnv = {
    ...process.env,
    WINEPREFIX: winePrefix,
    WINEDEBUG: "-all",
  };

  try {
    // 1. Verify portable node runs under wine with timeout and isolated WINEPREFIX
    const verOutput = execFileSync("wine", [nodeExe, "-v"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      killSignal: "SIGKILL",
      env: wineEnv,
    }).trim();

    // 2. Verify better-sqlite3 loads under wine by redirecting to log file
    const appDir = path.join(stageDir, "app");
    const testScript =
      "const db = require('better-sqlite3')(':memory:'); const row = db.prepare('SELECT 1 + 1 as res').get(); if (row.res !== 2) throw new Error('mismatch'); console.log('WINE_SQLITE_OK_RES_' + row.res);";

    execFileSync(
      "bash",
      [
        "-c",
        `cd "${appDir}" && wine "${nodeExe}" -e "${testScript}" > "${logFile}" 2>&1`,
      ],
      {
        encoding: "utf-8",
        timeout: 120000,
        killSignal: "SIGKILL",
        env: wineEnv,
      }
    );

    const output = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8") : "";

    if (output.includes("WINE_SQLITE_OK_RES_2")) {
      return {
        success: true,
        details: `Wine 11.0 verified successfully: Node ${verOutput}, SQLite in-memory query OK (prefix: ${winePrefix})`,
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
