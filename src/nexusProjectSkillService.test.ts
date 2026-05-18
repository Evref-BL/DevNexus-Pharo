import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initNexusHome,
  saveProjectConfig,
  type NexusProjectConfig,
} from "./config.js";
import { devNexusPharoDevNexusPluginConfig } from "./devNexusPharoPlugin.js";
import { refreshProjectSkills } from "./nexusProjectSkillService.js";

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

function sharedProjectConfig(): NexusProjectConfig {
  return {
    version: 1,
    id: "shared-dev-nexus-project",
    name: "Shared DevNexus Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "git@github.com:example/shared-dev-nexus-project.git",
      defaultBranch: "main",
    },
    components: [
      {
        id: "dev-nexus",
        name: "DevNexus",
        kind: "git",
        role: "primary",
        remoteUrl: "git@github.com:example/dev-nexus.git",
        defaultBranch: "main",
        sourceRoot: "sourcesRoot:dev-nexus",
        relationships: [],
      },
      {
        id: "dev-nexus-pharo",
        name: "DevNexus-Pharo",
        kind: "git",
        role: "extension",
        remoteUrl: "git@github.com:example/dev-nexus-pharo.git",
        defaultBranch: "main",
        sourceRoot: "sourcesRoot:dev-nexus-pharo",
        relationships: [],
      },
    ],
    worktreesRoot: "worktrees",
    workTracking: {
      provider: "local",
      storePath: ".dev-nexus/work-items/shared.json",
    },
    skills: {
      defaultCorePack: true,
      sourceControl: "support",
      agentTargets: [
        {
          agent: "codex",
        },
      ],
    },
    plugins: [devNexusPharoDevNexusPluginConfig()],
  };
}

describe("DevNexus-Pharo project skills", () => {
  it("projects plugin-declared Pharo skills for shared projects without Kanban metadata", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-project-");
    initNexusHome({ homePath });
    saveProjectConfig(projectRoot, sharedProjectConfig());

    const result = refreshProjectSkills({
      homePath,
      project: projectRoot,
    });
    const installedSkillIds = result.refresh.after.skills
      .filter((skill) => skill.state === "installed")
      .map((skill) => skill.id);

    expect(installedSkillIds).toEqual(
      expect.arrayContaining([
        "use-devnexus",
        "dev-nexus-pharo-workflow",
        "plexus-diagnostics",
        "pharo-launcher-lifecycle",
        "mcp-pharo-execution",
        "pharo-ci-repro",
        "pharo-image-git-handoff",
        "pharo-project-load",
        "pharo-version-compat",
      ]),
    );
    expect(result.refresh.after.summary.missing).toBe(0);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".agents", "skills", "pharo-ci-repro", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          projectRoot,
          ".dev-nexus",
          "skills",
          "dev-nexus-pharo-workflow",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
  });
});
