import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  controlProjectConfigPath,
  controlProjectRootPath,
  controlProjectWorktreesRootPath,
  createControlProjectConfig,
  createDefaultHomeConfig,
  defaultNexusToolCommand,
  ensureControlProject,
  initNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  devNexusPharoControlProjectId,
  devNexusPharoControlProjectName,
  nexusGeneratedDirectoryName,
  devNexusHomeConfigPath,
  devNexusHomeConfigFileName,
  nexusLogsDirectoryName,
  devNexusProjectConfigFileName,
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  resolveNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  validateHomeConfig,
  validateProjectConfig,
} from "../../src/config.js";
import {
  devNexusPharoProjectExtensionConfigKey,
  projectPlexusConfigPath,
} from "../../src/devNexusPharoExtension.js";

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

describe("DevNexus-Pharo home config", () => {
  it("resolves home and config paths to absolute filesystem paths", () => {
    const parentPath = makeTempDir("dev-nexus-pharo-parent-");
    const homePath = path.join(parentPath, "home");
    const relativeHomePath = path.relative(process.cwd(), homePath);

    expect(resolveNexusHome(relativeHomePath)).toBe(path.resolve(homePath));
    expect(devNexusHomeConfigPath(relativeHomePath)).toBe(
      path.join(path.resolve(homePath), devNexusHomeConfigFileName),
    );
    expect(() => resolveNexusHome("   ")).toThrow(NexusConfigError);
  });

  it("creates a default home config under the selected home", () => {
    const homePath = path.join("C:", "dev", "dev-nexus-pharo");
    const resolvedHomePath = path.resolve(homePath);

    expect(createDefaultHomeConfig(homePath)).toEqual({
      version: 1,
      paths: {
        projectsRoot: path.join(resolvedHomePath, "projects"),
        workspacesRoot: path.join(resolvedHomePath, "workspaces"),
        plexusStateRoot: path.join(resolvedHomePath, "state", "plexus"),
      },
      ports: {
        devNexusPharoMcp: 7330,
        plexusMcp: 7331,
      },
      mcp: {
        host: "127.0.0.1",
      },
      tools: {
        nexus: defaultNexusToolCommand(),
        plexus: {
          command: "plexus-gateway",
          args: [],
        },
      },
      controlProject: {
        id: devNexusPharoControlProjectId,
        name: devNexusPharoControlProjectName,
        root: path.resolve(homePath, "DevNexus-Pharo"),
      },
      projects: [],
    });
  });

  it("defines a reserved control project under the selected home", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");

    expect(controlProjectRootPath(homePath)).toBe(path.join(homePath, "DevNexus-Pharo"));
    expect(controlProjectConfigPath(homePath)).toBe(
      path.join(homePath, "DevNexus-Pharo", devNexusProjectConfigFileName),
    );
    expect(controlProjectWorktreesRootPath(homePath)).toBe(
      path.join(homePath, "DevNexus-Pharo", nexusProjectWorktreesDirectoryName),
    );
    expect(createControlProjectConfig()).toEqual({
      version: 1,
      id: devNexusPharoControlProjectId,
      name: devNexusPharoControlProjectName,
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      components: [
        {
          id: "primary",
          name: devNexusPharoControlProjectName,
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: null,
          sourceRoot: ".",
          relationships: [],
        },
      ],
      worktreesRoot: nexusProjectWorktreesDirectoryName,
    });
  });

  it("loads home configs with default Nexus MCP HTTP settings", () => {
    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    const partialConfig = config as unknown as Record<string, unknown>;
    delete (partialConfig.ports as Record<string, unknown>).devNexusPharoMcp;
    delete partialConfig.mcp;
    delete (partialConfig.tools as Record<string, unknown>).nexus;

    expect(validateHomeConfig(partialConfig)).toMatchObject({
      ports: {
        devNexusPharoMcp: 7330,
      },
      mcp: {
        host: "127.0.0.1",
      },
      tools: {
        nexus: defaultNexusToolCommand(),
      },
    });
  });

  it("rejects obsolete bare DevNexus-Pharo MCP commands during validation", () => {
    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    config.tools.nexus = {
      command: "dev-nexus-pharo",
      args: [],
    };

    expect(() => validateHomeConfig(config)).toThrow(
      /obsolete bare command.*Regenerate/,
    );
  });

  it("accepts optional home-level agent defaults", () => {
    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    config.agent = {
      executor: "CODEX",
      model: "gpt-5.3-codex",
      reasoning: "high",
    };

    expect(validateHomeConfig(config).agent).toEqual(config.agent);
  });

  it("validates and persists DevNexus-Pharo project config files", () => {
    const projectPath = path.join(makeTempDir("dev-nexus-pharo-project-parent-"), "project");
    const config = {
      version: 1 as const,
      id: "my-project",
      name: "My Project",
      home: "C:\\dev\\code\\.dev-nexus-pharo",
      repo: {
        kind: "git" as const,
        remoteUrl: "https://github.com/example/my-project.git",
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      agent: {
        executor: "CODEX",
        model: "gpt-5.3-codex",
        reasoning: "high",
      },
    };
    const expectedConfig = {
      ...config,
      components: [
        {
          id: "primary",
          name: "My Project",
          kind: "git" as const,
          role: "primary" as const,
          remoteUrl: "https://github.com/example/my-project.git",
          defaultBranch: "main",
          sourceRoot: ".",
          relationships: [],
        },
      ],
    };

    expect(validateProjectConfig(config)).toEqual(expectedConfig);
    expect(saveProjectConfig(projectPath, config)).toBe(
      path.join(projectPath, devNexusProjectConfigFileName),
    );
    expect(loadProjectConfig(projectPath)).toEqual(expectedConfig);
  });

  it("validates optional agent defaults and rejects empty agent config", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "agent-project",
        name: "Agent Project",
        home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      agent: {
        model: "gpt-5.3-codex",
      },
      }),
    ).toMatchObject({
      agent: {
        model: "gpt-5.3-codex",
      },
    });

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "agent-project",
        name: "Agent Project",
        repo: {
          kind: "local",
          remoteUrl: null,
          defaultBranch: null,
        },
        agent: {},
      }),
    ).toThrow(NexusConfigError);
  });

  it("resolves agent configuration using issue, project, home, then fallback precedence", () => {
    expect(
      resolveNexusAgentConfig({
        fallback: {
          executor: "CODEX",
          model: "profile-default",
          reasoning: "medium",
        },
        home: {
          agent: {
            model: "gpt-5.3-codex",
          },
        },
        project: {
          agent: {
            reasoning: "high",
          },
        },
        issue: {
          model: "gpt-5.4",
        },
      }),
    ).toEqual({
      executor: "CODEX",
      model: "gpt-5.4",
      reasoning: "high",
    });
  });

  it("accepts provider-neutral local work tracking config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus-pharo/work-items.json",
      },
    });

    expect(config.workTracking).toEqual({
      provider: "local",
      storePath: ".dev-nexus-pharo/work-items.json",
    });
  });

  it("accepts provider-neutral GitHub work tracking config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "github-tracked-project",
      name: "GitHub Tracked Project",
      workTracking: {
        provider: "github",
        host: "https://github.com",
        repository: {
          owner: "example",
          name: "project",
        },
        board: {
          kind: "github-project-v2",
          ownerKind: "organization",
          owner: "example",
          number: 1,
          projectId: "PVT_project",
          statusFieldId: "PVTSSF_status",
          statusOptions: {
            todo: "Todo",
            done: "Done",
          },
        },
      },
    });

    expect(config.workTracking).toEqual({
      provider: "github",
      host: "https://github.com",
      repository: {
        owner: "example",
        name: "project",
      },
      board: {
        kind: "github-project-v2",
        ownerKind: "organization",
        owner: "example",
        number: 1,
        projectId: "PVT_project",
        statusFieldId: "PVTSSF_status",
        statusOptions: {
          todo: "Todo",
          done: "Done",
        },
      },
    });
  });

  it("accepts provider-neutral Jira work tracking config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "jira-tracked-project",
      name: "Jira Tracked Project",
      workTracking: {
        provider: "jira",
        host: "example.atlassian.net",
        projectKey: "FCD",
        issueType: "Bug",
        board: {
          kind: "jira-workflow",
          statusOptions: {
            blocked: "31",
            done: "41",
          },
        },
      },
    });

    expect(config.workTracking).toEqual({
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "FCD",
      issueType: "Bug",
      board: {
        kind: "jira-workflow",
        statusOptions: {
          blocked: "31",
          done: "41",
        },
      },
    });
  });

  it("rejects invalid provider-neutral work tracking config", () => {
    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-tracked-project",
        name: "Invalid Tracked Project",
        workTracking: {
          provider: "trello",
        },
      }),
    ).toThrow(/workTracking\.provider/);

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid-github-project",
        name: "Invalid GitHub Project",
        workTracking: {
          provider: "github",
          repository: {
            owner: "example",
          },
        },
      }),
    ).toThrow(/workTracking\.repository\.name/);
  });

  it("resolves project-local paths from the project directory", () => {
    const projectPath = path.join(makeTempDir("dev-nexus-pharo-project-parent-"), "project");
    const config = validateProjectConfig({
      version: 1,
      id: "my-project",
      name: "My Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      worktreesRoot: path.join(".nexus", "worktrees"),
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {
          plexusProjectConfig: path.join("config", "plexus.project.json"),
        },
      },
    });

    expect(projectPlexusConfigPath(projectPath, config)).toBe(
      path.join(projectPath, "config", "plexus.project.json"),
    );
    expect(projectWorktreesRootPath(projectPath, config)).toBe(
      path.join(projectPath, ".nexus", "worktrees"),
    );
  });

  it("ensures the control project without overwriting an existing config", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectPath = controlProjectRootPath(homePath);
    const existingConfig = createControlProjectConfig();
    saveProjectConfig(projectPath, existingConfig);

    expect(ensureControlProject(homePath)).toEqual({
      projectPath,
      configPath: controlProjectConfigPath(homePath),
      config: existingConfig,
    });
    expect(fs.existsSync(controlProjectWorktreesRootPath(homePath))).toBe(true);
    expect(loadProjectConfig(projectPath)).toEqual(existingConfig);
  });

  it("normalizes a configured control project root from the home directory", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);
    config.controlProject = {
      id: "custom-control",
      name: "Custom Control",
      root: path.join("nested", "control"),
    };

    expect(validateHomeConfig(config, homePath).controlProject).toEqual({
      id: "custom-control",
      name: "Custom Control",
      root: path.join(homePath, "nested", "control"),
    });
  });

  it("rejects an obsolete default control project root without moving files", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);
    const obsoleteRoot = path.join(homePath, "control");
    config.controlProject.root = obsoleteRoot;

    expect(() => validateHomeConfig(config, homePath)).toThrow(
      /obsolete controlProject\.root.*Regenerate/,
    );
    expect(fs.existsSync(obsoleteRoot)).toBe(false);
  });

  it("defaults the control project when optional sections are absent", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);
    const partialConfig = { ...config } as Partial<typeof config>;
    delete partialConfig.controlProject;

    expect(validateHomeConfig(partialConfig, homePath)).toMatchObject({
      controlProject: {
        id: devNexusPharoControlProjectId,
        name: devNexusPharoControlProjectName,
        root: controlProjectRootPath(homePath),
      },
    });
  });

  it("resolves relative configured paths from the selected home", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");

    expect(
      createDefaultHomeConfig(homePath, {
        projectsRoot: "custom-projects",
        workspacesRoot: path.join("nested", "workspaces"),
        plexusStateRoot: path.join(".state", "plexus"),
      }).paths,
    ).toEqual({
      projectsRoot: path.join(path.resolve(homePath), "custom-projects"),
      workspacesRoot: path.join(path.resolve(homePath), "nested", "workspaces"),
      plexusStateRoot: path.join(path.resolve(homePath), ".state", "plexus"),
    });
  });

  it("preserves absolute configured paths", () => {
    const parentPath = makeTempDir("dev-nexus-pharo-parent-");
    const projectsRoot = path.join(parentPath, "external-projects");
    const workspacesRoot = path.join(parentPath, "external-workspaces");
    const plexusStateRoot = path.join(parentPath, "external-state", "plexus");

    expect(
      createDefaultHomeConfig(path.join(parentPath, "home"), {
        projectsRoot,
        workspacesRoot,
        plexusStateRoot,
      }).paths,
    ).toEqual({
      projectsRoot,
      workspacesRoot,
      plexusStateRoot,
    });
  });

  it("validates port boundaries and requires them to be distinct", () => {
    const validBoundaryConfig = createDefaultHomeConfig(
      makeTempDir("dev-nexus-pharo-home-"),
      {
        devNexusPharoMcpPort: 7330,
        plexusMcpPort: 65_535,
      },
    );

    expect(validateHomeConfig(validBoundaryConfig).ports).toEqual({
      devNexusPharoMcp: 7330,
      plexusMcp: 65_535,
    });

    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    config.ports.plexusMcp = 7330;

    expect(() => validateHomeConfig(config)).toThrow(NexusConfigError);

    for (const invalidPort of [0, -1, 65_536, 3.14, "3000"]) {
      const invalidConfig = createDefaultHomeConfig(
        makeTempDir("dev-nexus-pharo-home-"),
      ) as unknown as Record<string, unknown>;
      const ports = invalidConfig.ports as Record<string, unknown>;
      ports.plexusMcp = invalidPort;

      expect(() => validateHomeConfig(invalidConfig)).toThrow(
        NexusConfigError,
      );
    }
  });

  it("rejects duplicate project ids", () => {
    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    config.projects = [
      {
        id: "project-1",
        name: "Project One",
        projectRoot: "C:\\dev\\code\\git\\ProjectOne",
      },
      {
        id: "project-1",
        name: "Project One Duplicate",
        projectRoot: "C:\\dev\\code\\git\\ProjectOneDuplicate",
      },
    ];

    expect(() => validateHomeConfig(config)).toThrow(NexusConfigError);
  });

  it("rejects normal projects that collide with the reserved control project", () => {
    const config = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    config.projects = [
      {
        id: devNexusPharoControlProjectId,
        name: "Colliding Project",
        projectRoot: path.join(config.paths.projectsRoot, "CollidingProject"),
      },
    ];

    expect(() => validateHomeConfig(config)).toThrow(
      /reserved for the control project/,
    );

    const rootCollision = createDefaultHomeConfig(makeTempDir("dev-nexus-pharo-home-"));
    rootCollision.projects = [
      {
        id: "normal-project",
        name: "Normal Project",
        projectRoot: rootCollision.controlProject.root,
      },
    ];

    expect(() => validateHomeConfig(rootCollision)).toThrow(
      /reserved for the control project/,
    );
  });

  it("initializes a home directory, writes config, and creates runtime directories", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");

    const result = initNexusHome({
      homePath,
      plexusMcpPort: 7332,
    });

    expect(result.configPath).toBe(
      path.join(homePath, devNexusHomeConfigFileName),
    );
    expect(loadHomeConfig(homePath)).toEqual(result.config);
    expect(fs.existsSync(result.config.paths.projectsRoot)).toBe(true);
    expect(fs.existsSync(result.config.paths.workspacesRoot)).toBe(true);
    expect(fs.existsSync(result.config.paths.plexusStateRoot)).toBe(true);
    expect(
      fs.existsSync(path.join(homePath, nexusLogsDirectoryName)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(homePath, nexusGeneratedDirectoryName)),
    ).toBe(true);
    expect(result.controlProjectPath).toBe(controlProjectRootPath(homePath));
    expect(result.controlProjectConfigPath).toBe(
      controlProjectConfigPath(homePath),
    );
    expect(fs.existsSync(controlProjectRootPath(homePath))).toBe(true);
    expect(fs.existsSync(controlProjectWorktreesRootPath(homePath))).toBe(true);
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      createControlProjectConfig(),
    );
  });

  it("preserves an existing control project during init unless forced", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const existingControlConfig = createControlProjectConfig();
    saveProjectConfig(controlProjectRootPath(homePath), existingControlConfig);

    initNexusHome({ homePath });
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      existingControlConfig,
    );

    initNexusHome({ homePath, force: true });
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      createControlProjectConfig(),
    );
  });

  it("generates normalized home config JSON and creates parent directories", () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "nested", "home");
    const config = createDefaultHomeConfig(homePath, {
      projectsRoot: "projects-custom",
      workspacesRoot: "workspaces-custom",
      plexusStateRoot: path.join("state-custom", "plexus"),
      plexusMcpPort: 7332,
    });

    const configPath = saveHomeConfig(homePath, config);
    const rawConfig = fs.readFileSync(configPath, "utf8");

    expect(configPath).toBe(path.join(homePath, devNexusHomeConfigFileName));
    expect(rawConfig.startsWith("\uFEFF")).toBe(false);
    expect(rawConfig.endsWith("\n")).toBe(true);
    expect(JSON.parse(rawConfig)).toEqual(config);
    expect(loadHomeConfig(homePath)).toEqual(config);
  });

  it("refuses to overwrite an existing home config unless forced", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });

    expect(() => initNexusHome({ homePath })).toThrow(
      NexusConfigError,
    );

    expect(() =>
      initNexusHome({
        homePath,
        force: true,
        plexusMcpPort: 7332,
      }),
    ).not.toThrow();
    expect(loadHomeConfig(homePath).ports.plexusMcp).toBe(7332);
  });

  it("loads home config files that include a UTF-8 BOM", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);
    fs.mkdirSync(homePath, { recursive: true });
    fs.writeFileSync(
      path.join(homePath, devNexusHomeConfigFileName),
      `\uFEFF${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );

    expect(loadHomeConfig(homePath)).toEqual(config);
  });

  it("reports an actionable error when loading an uninitialized home", () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "missing");

    expect(() => loadHomeConfig(homePath)).toThrow(
      /Run "dev-nexus-pharo init" first/,
    );
  });
});
