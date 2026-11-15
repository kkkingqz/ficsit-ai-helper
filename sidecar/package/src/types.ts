export type TargetPlatform = "linux-x64" | "win-x64";

export interface PackageConfig {
  foremanPinPath: string;
  foremanSrcDir: string;
  adapterDir: string;
  saveSourceDir: string;
  outputDir: string;
  cacheDir: string;
  nodeVersion: string;
}

export interface PackageResult {
  target: TargetPlatform;
  archivePath: string;
  archiveSizeBytes: number;
  stageDir: string;
  processCount: number;
  bindAddress: string;
}

export interface ForemanPin {
  repository: string;
  commit: string;
  commitDate: string;
  runtime: {
    node: string;
    nodeVerified: string;
    npm: string;
    npmVerified: string;
  };
  packages: Record<string, string>;
  defaultPorts: {
    "sf-mcp": number;
    "ff-server": number;
    "ff-client": number;
  };
}
