#!/usr/bin/env node
import { buildTarget, verifyWine, stagePackage } from "./builder.js";
import { getDefaultConfig } from "./config.js";
import type { TargetPlatform } from "./types.js";

function printHelp(): void {
  console.log(`
FICSIT AI Sidecar Packager (S5-lite, #13)

Usage:
  tsx src/cli.ts [options]

Options:
  --target=linux-x64     Build portable Linux x64 zip archive
  --target=win-x64       Build portable Windows x64 zip archive
  --target=all           Build both Linux and Windows archives (default)
  --verify-wine          Run Wine verification on win-x64 staging
  --stage-only           Only create staging directory, skip zip creation
  --help                 Show this help message
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let targetArg: string = "all";
  let verifyWineOnly = false;
  let stageOnly = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return;
    }
    if (arg.startsWith("--target=")) {
      targetArg = arg.split("=")[1] || "all";
    }
    if (arg === "--verify-wine") {
      verifyWineOnly = true;
    }
    if (arg === "--stage-only") {
      stageOnly = true;
    }
  }

  const config = getDefaultConfig();

  if (verifyWineOnly) {
    console.log("Verifying Windows package under Wine...");
    const winStage = stagePackage("win-x64", config);
    const res = verifyWine(winStage);
    if (res.success) {
      console.log(`[OK] ${res.details}`);
      process.exit(0);
    } else {
      console.error(`[FAIL] ${res.details}`);
      process.exit(1);
    }
  }

  const targets: TargetPlatform[] =
    targetArg === "all"
      ? ["linux-x64", "win-x64"]
      : [targetArg as TargetPlatform];

  console.log(`Building FICSIT AI Sidecar package for targets: ${targets.join(", ")}...`);

  for (const t of targets) {
    console.log(`\n=== Building ${t} ===`);
    if (stageOnly) {
      const stageDir = stagePackage(t, config);
      console.log(`Staged at: ${stageDir}`);
    } else {
      const res = buildTarget(t, config);
      const sizeMb = (res.archiveSizeBytes / (1024 * 1024)).toFixed(2);
      console.log(`Created archive: ${res.archivePath} (${sizeMb} MB)`);
      console.log(`Process count: ${res.processCount} (ff-server, sf-mcp, adapter)`);
      console.log(`Loopback bind address: ${res.bindAddress}`);
    }
  }

  console.log("\n[SUCCESS] Sidecar packaging complete.");
}

main().catch((err) => {
  console.error("Packaging failed:", err);
  process.exit(1);
});
