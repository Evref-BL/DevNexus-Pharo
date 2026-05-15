import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Nexus project scaffold", () => {
  it("creates generic project state without Pharo or PLexus files", () => {
    const homePath = makeTempDir("nexus-home-");
    const projectRoot = path.join(makeTempDir("nexus-project-"), "Generic");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    fs.mkdirSync(projectRoot, { recursive: true });

    const result = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: {
        id: "generic",
        name: "Generic",
      },
    });

    expect(result).toEqual({
      projectRoot,
      worktreesRoot,
      extensionResults: {},
    });
    expect(fs.existsSync(worktreesRoot)).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "plexus.project.json"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "suggestedFirstPrompt.md"))).toBe(false);
  });
});
