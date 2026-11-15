import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ForemanPin, PackageConfig } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");

export function loadForemanPin(pinPath?: string): ForemanPin {
  const resolved = pinPath ?? path.resolve(REPO_ROOT, "sidecar/launcher/foreman.pin.json");
  if (!fs.existsSync(resolved)) {
    throw new Error(`foreman.pin.json not found at ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as ForemanPin;
}

export function getDefaultConfig(): PackageConfig {
  const pin = loadForemanPin();
  const envForemanSrc = process.env["FOREMAN_SRC"];
  const envHome = process.env["HOME"];
  const foremanSrcDir = envForemanSrc
    ? path.resolve(envForemanSrc)
    : envHome
      ? path.resolve(envHome, "Projects/foreman-src")
      : undefined;

  if (!foremanSrcDir || !fs.existsSync(foremanSrcDir)) {
    throw new Error(
      `Foreman source directory not found. Please set FOREMAN_SRC environment variable (searched: ${foremanSrcDir ?? "neither FOREMAN_SRC nor HOME is set"}).`
    );
  }

  return {
    foremanPinPath: path.resolve(REPO_ROOT, "sidecar/launcher/foreman.pin.json"),
    foremanSrcDir,
    adapterDir: path.resolve(REPO_ROOT, "sidecar/adapter"),
    saveSourceDir: path.resolve(REPO_ROOT, "sidecar/save-source"),
    outputDir: path.resolve(REPO_ROOT, "sidecar/package/out"),
    cacheDir: path.resolve(REPO_ROOT, "sidecar/package/cache"),
    nodeVersion: pin.runtime.nodeVerified || "22.23.4",
  };
}

export const NODE_DOWNLOAD_URLS = {
  "win-x64": (version: string) => `https://nodejs.org/dist/v${version}/win-x64/node.exe`,
  "linux-x64": (version: string) => `https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz`,
};

export const BETTER_SQLITE3_WIN_URL =
  "https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz";

/**
 * Official SHA-256 checksums for external binary dependencies.
 * Node hashes from official https://nodejs.org/dist/v<version>/SHASUMS256.txt.
 */
export const EXPECTED_SHA256: Record<string, string> = {
  "node-v22.23.4-linux-x64.tar.xz":
    "1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce",
  "node-v22.23.4-win-x64.exe":
    "dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f",
  "better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz":
    "927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b",
};

export const PORTS = {
  sfMcp: 8723,
  ffServer: 8724,
  adapter: 8730,
  normalizer: 8731,
} as const;

export const LOOPBACK = "127.0.0.1";
