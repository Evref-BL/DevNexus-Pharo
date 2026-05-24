import path from "node:path";

export const codexConfigDirectoryName = ".codex";
export const codexConfigFileName = "config.toml";

export function codexConfigPath(workspacePath: string): string {
  return path.join(
    path.resolve(workspacePath),
    codexConfigDirectoryName,
    codexConfigFileName,
  );
}
