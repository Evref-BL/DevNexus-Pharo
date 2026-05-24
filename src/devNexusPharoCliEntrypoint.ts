import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface NexusToolCommand {
  command: string;
  args: string[];
}

export function devNexusPharoCliEntrypointPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot =
    path.basename(moduleDirectory).toLowerCase() === "src" ||
    path.basename(moduleDirectory).toLowerCase() === "dist"
      ? path.dirname(moduleDirectory)
      : moduleDirectory;

  return path.join(packageRoot, "dist", "cli.js");
}

export function defaultNexusToolCommand(): NexusToolCommand {
  return {
    command: process.execPath,
    args: [devNexusPharoCliEntrypointPath(), "mcp"],
  };
}
