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
  const home = process.env["HOME"] || "/home/king";
  return {
    foremanPinPath: path.resolve(REPO_ROOT, "sidecar/launcher/foreman.pin.json"),
    foremanSrcDir: process.env["FOREMAN_SRC"] || path.resolve(home, "Projects/foreman-src"),
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

export const PORTS = {
  sfMcp: 8723,
  ffServer: 8724,
  adapter: 8730,
  normalizer: 8731,
} as const;

export const LOOPBACK = "127.0.0.1";
