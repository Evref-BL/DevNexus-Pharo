import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  preparePharoProjectLoadWorkspace,
  pharoTonelRepositoryUrl,
  PharoProjectLoadWorkspaceError,
} from "./pharoProjectLoadWorkspace.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function fakePharoRepository(root: string, baseline: string): void {
  writeFile(
    path.join(root, "src", `BaselineOf${baseline}`, `BaselineOf${baseline}.class.st`),
    `Class { #name : 'BaselineOf${baseline}', #superclass : 'BaselineOf' }`,
  );
  writeFile(path.join(root, "src", `${baseline}-Core`, "Package.st"), "Package {}");
  writeFile(path.join(root, ".git", "config"), "[core]\n");
  writeFile(path.join(root, "node_modules", "left-pad", "index.js"), "");
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Pharo project load workspace", () => {
  it("stages a project and declared dependencies into a workspace-local load script", () => {
    const root = makeTempDir("dev-nexus-pharo-load-");
    const mcp = path.join(root, "MCP");
    const compatibility = path.join(root, "PharoCompatibility");
    const workspaceRoot = path.join(root, "image-local", "iceberg");
    fakePharoRepository(mcp, "MCP");
    fakePharoRepository(compatibility, "PharoCompatibility");

    const result = preparePharoProjectLoadWorkspace({
      workspaceRoot,
      project: {
        id: "mcp-pharo",
        baseline: "MCP",
        sourceRoot: mcp,
        loads: ["Core"],
      },
      dependencies: [
        {
          id: "pharo-compatibility",
          baseline: "PharoCompatibility",
          sourceRoot: compatibility,
          loads: ["Pharo13Surface"],
        },
      ],
    });

    const stagedMcp = path.join(workspaceRoot, "repositories", "mcp-pharo");
    const stagedCompatibility = path.join(
      workspaceRoot,
      "repositories",
      "pharo-compatibility",
    );
    expect(result.ready).toBe(true);
    expect(result.missing).toEqual([]);
    expect(fs.existsSync(path.join(stagedMcp, "src", "BaselineOfMCP", "BaselineOfMCP.class.st")))
      .toBe(true);
    expect(fs.existsSync(path.join(stagedCompatibility, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(stagedCompatibility, "node_modules"))).toBe(false);
    expect(fs.existsSync(result.scriptPath)).toBe(true);
    expect(fs.existsSync(result.metadataPath)).toBe(true);
    expect(result.scriptSource).toContain("baseline: 'PharoCompatibility';");
    expect(result.scriptSource).toContain("onConflictUseLoaded;");
    expect(result.scriptSource).toContain("load: #( 'Pharo13Surface' ).");
    expect(result.scriptSource).toContain("baseline: 'MCP';");
    expect(result.scriptSource).toContain("load: #( 'Core' ).");
    expect(result.scriptSource).toContain(
      `repository: '${pharoTonelRepositoryUrl(path.join(stagedMcp, "src"))}';`,
    );
    expect(result.scriptSource!.indexOf("baseline: 'PharoCompatibility';"))
      .toBeLessThan(result.scriptSource!.indexOf("baseline: 'MCP';"));
  });

  it("preflights missing baselines before writing partial workspace files", () => {
    const root = makeTempDir("dev-nexus-pharo-load-missing-");
    const mcp = path.join(root, "MCP");
    const missingDependency = path.join(root, "PharoCompatibility");
    const workspaceRoot = path.join(root, "image-local", "iceberg");
    fakePharoRepository(mcp, "MCP");
    fs.mkdirSync(missingDependency, { recursive: true });

    const result = preparePharoProjectLoadWorkspace({
      workspaceRoot,
      project: {
        baseline: "MCP",
        sourceRoot: mcp,
      },
      dependencies: [
        {
          baseline: "PharoCompatibility",
          sourceRoot: missingDependency,
        },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.repositories).toEqual([]);
    expect(result.scriptSource).toBeNull();
    expect(result.missing).toEqual([
      {
        role: "dependency",
        id: "PharoCompatibility",
        baseline: "PharoCompatibility",
        sourceRoot: missingDependency,
        sourceDirectory: "src",
        expectedBaselinePath: path.join(
          missingDependency,
          "src",
          "BaselineOfPharoCompatibility",
          "BaselineOfPharoCompatibility.class.st",
        ),
      },
    ]);
    expect(fs.existsSync(result.scriptPath)).toBe(false);
    expect(fs.existsSync(result.repositoriesRoot)).toBe(false);
  });

  it("rejects duplicate staged repository ids", () => {
    const root = makeTempDir("dev-nexus-pharo-load-duplicate-");
    const mcp = path.join(root, "MCP");
    const compatibility = path.join(root, "PharoCompatibility");
    fakePharoRepository(mcp, "MCP");
    fakePharoRepository(compatibility, "PharoCompatibility");

    expect(() =>
      preparePharoProjectLoadWorkspace({
        workspaceRoot: path.join(root, "workspace"),
        project: {
          id: "same",
          baseline: "MCP",
          sourceRoot: mcp,
        },
        dependencies: [
          {
            id: "same",
            baseline: "PharoCompatibility",
            sourceRoot: compatibility,
          },
        ],
      }),
    ).toThrow(PharoProjectLoadWorkspaceError);
  });
});
