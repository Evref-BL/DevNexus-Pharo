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
  defaultVibeKanbanToolCommand,
  ensureControlProject,
  initPharoNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  pharoNexusControlProjectId,
  pharoNexusControlProjectName,
  pharoNexusGeneratedDirectoryName,
  devNexusHomeConfigPath,
  devNexusHomeConfigFileName,
  pharoNexusLogsDirectoryName,
  devNexusProjectConfigFileName,
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  resolvePharoNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  validateHomeConfig,
  validateProjectConfig,
} from "./config.js";
import {
  pharoNexusProjectExtensionConfigKey,
  projectPlexusConfigPath,
} from "./pharoNexusExtension.js";

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

describe("PharoNexus home config", () => {
  it("resolves home and config paths to absolute filesystem paths", () => {
    const parentPath = makeTempDir("pharo-nexus-parent-");
    const homePath = path.join(parentPath, "home");
    const relativeHomePath = path.relative(process.cwd(), homePath);

    expect(resolvePharoNexusHome(relativeHomePath)).toBe(path.resolve(homePath));
    expect(devNexusHomeConfigPath(relativeHomePath)).toBe(
      path.join(path.resolve(homePath), devNexusHomeConfigFileName),
    );
    expect(() => resolvePharoNexusHome("   ")).toThrow(NexusConfigError);
  });

  it("creates a default home config under the selected home", () => {
    const homePath = path.join("C:", "dev", "pharo-nexus");
    const resolvedHomePath = path.resolve(homePath);
    const remoteRoot = path.join(
      resolvedHomePath,
      "vibe-kanban",
      "crates",
      "remote",
    );

    expect(createDefaultHomeConfig(homePath)).toEqual({
      version: 1,
      paths: {
        projectsRoot: path.join(resolvedHomePath, "projects"),
        workspacesRoot: path.join(resolvedHomePath, "workspaces"),
        plexusStateRoot: path.join(resolvedHomePath, "state", "plexus"),
      },
      ports: {
        vibeKanban: 3000,
        pharoNexusMcp: 7330,
        plexusMcp: 7331,
      },
      mcp: {
        host: "127.0.0.1",
      },
      tools: {
        pharoNexus: defaultNexusToolCommand(),
        vibeKanban: defaultVibeKanbanToolCommand(),
        plexus: {
          command: "plexus-gateway",
          args: [],
        },
      },
      integrations: {
        vibeKanban: {
          executor: "CODEX",
          pharoNexusMcpServerName: "pharo_nexus",
          plexusMcpServerName: "plexus",
          installMcpOnStart: true,
          openBrowserOnStart: true,
          backend: {
            mode: "docker",
            sharedApiBase: "http://127.0.0.1:3100",
            healthPath: "/v1/health",
            sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
            autoBootstrap: true,
            composeCommand: "auto",
            composeArgs: [],
            composeFile: path.join(remoteRoot, "docker-compose.yml"),
            envFile: path.join(remoteRoot, ".env.remote"),
            projectName: "pharo-nexus-vibe",
            workingDirectory: remoteRoot,
            startOnPharoNexusStart: true,
            stopOnPharoNexusStop: true,
          },
        },
      },
      controlProject: {
        id: pharoNexusControlProjectId,
        name: pharoNexusControlProjectName,
        root: path.resolve(homePath, "PharoNexus"),
        vibeKanbanProjectId: null,
        vibeKanbanRepoId: null,
      },
      projects: [],
    });
  });

  it("defines a reserved control project under the selected home", () => {
    const homePath = makeTempDir("pharo-nexus-home-");

    expect(controlProjectRootPath(homePath)).toBe(path.join(homePath, "PharoNexus"));
    expect(controlProjectConfigPath(homePath)).toBe(
      path.join(homePath, "PharoNexus", devNexusProjectConfigFileName),
    );
    expect(controlProjectWorktreesRootPath(homePath)).toBe(
      path.join(homePath, "PharoNexus", nexusProjectWorktreesDirectoryName),
    );
    expect(createControlProjectConfig()).toEqual({
      version: 1,
      id: pharoNexusControlProjectId,
      name: pharoNexusControlProjectName,
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      worktreesRoot: nexusProjectWorktreesDirectoryName,
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
  });

  it("loads older home configs with default PharoNexus MCP HTTP settings", () => {
    const config = createDefaultHomeConfig(makeTempDir("pharo-nexus-home-"));
    const legacyConfig = config as unknown as Record<string, unknown>;
    delete (legacyConfig.ports as Record<string, unknown>).pharoNexusMcp;
    delete legacyConfig.mcp;
    delete (legacyConfig.tools as Record<string, unknown>).pharoNexus;

    expect(validateHomeConfig(legacyConfig)).toMatchObject({
      ports: {
        pharoNexusMcp: 7330,
      },
      mcp: {
        host: "127.0.0.1",
      },
      tools: {
        pharoNexus: defaultNexusToolCommand(),
      },
    });
  });

  it("accepts optional home-level agent defaults", () => {
    const config = createDefaultHomeConfig(makeTempDir("pharo-nexus-home-"));
    config.agent = {
      executor: "CODEX",
      model: "gpt-5.3-codex",
      reasoning: "high",
    };

    expect(validateHomeConfig(config).agent).toEqual(config.agent);
  });

  it("validates and persists PharoNexus project config files", () => {
    const projectPath = path.join(makeTempDir("pharo-nexus-project-parent-"), "project");
    const config = {
      version: 1 as const,
      id: "my-project",
      name: "My Project",
      home: "C:\\dev\\code\\.pharo-nexus",
      repo: {
        kind: "git" as const,
        remoteUrl: "https://github.com/example/my-project.git",
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "vk-project-1",
      },
      agent: {
        executor: "CODEX",
        model: "gpt-5.3-codex",
        reasoning: "high",
      },
    };

    expect(validateProjectConfig(config)).toEqual(config);
    expect(saveProjectConfig(projectPath, config)).toBe(
      path.join(projectPath, devNexusProjectConfigFileName),
    );
    expect(loadProjectConfig(projectPath)).toEqual(config);
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
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
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
        kanban: {
          provider: "vibe-kanban",
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

  it("defaults legacy project configs to the current explicit JSON shape", () => {
    const legacyConfig = {
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
      },
    };

    expect(validateProjectConfig(legacyConfig)).toEqual({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
  });

  it("accepts provider-neutral local work tracking config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      workTracking: {
        provider: "local",
        storePath: ".pharo-nexus/work-items.json",
      },
    });

    expect(config.workTracking).toEqual({
      provider: "local",
      storePath: ".pharo-nexus/work-items.json",
    });
  });

  it("accepts provider-neutral GitHub work tracking config", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "github-tracked-project",
      name: "GitHub Tracked Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
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
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
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
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
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
        kanban: {
          provider: "vibe-kanban",
          projectId: null,
        },
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
    const projectPath = path.join(makeTempDir("pharo-nexus-project-parent-"), "project");
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
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      extensions: {
        [pharoNexusProjectExtensionConfigKey]: {
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectPath = controlProjectRootPath(homePath);
    const existingConfig = {
      ...createControlProjectConfig(),
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "existing-kanban-project",
      },
    };
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath);
    config.controlProject = {
      id: "custom-control",
      name: "Custom Control",
      root: path.join("nested", "control"),
      vibeKanbanProjectId: "kanban-control",
      vibeKanbanRepoId: "repo-control",
    };

    expect(validateHomeConfig(config, homePath).controlProject).toEqual({
      id: "custom-control",
      name: "Custom Control",
      root: path.join(homePath, "nested", "control"),
      vibeKanbanProjectId: "kanban-control",
      vibeKanbanRepoId: "repo-control",
    });
  });

  it("defaults integrations and the control project when loading older config files", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath);
    const legacyConfig = { ...config } as Partial<typeof config>;
    delete legacyConfig.integrations;
    delete legacyConfig.controlProject;

    expect(validateHomeConfig(legacyConfig, homePath)).toMatchObject({
      integrations: {
        vibeKanban: {
          executor: "CODEX",
          pharoNexusMcpServerName: "pharo_nexus",
          plexusMcpServerName: "plexus",
          installMcpOnStart: true,
          openBrowserOnStart: true,
          backend: {
            mode: "docker",
            sharedApiBase: "http://127.0.0.1:3100",
            healthPath: "/v1/health",
            sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
            autoBootstrap: true,
          },
        },
      },
      controlProject: {
        id: pharoNexusControlProjectId,
        name: pharoNexusControlProjectName,
        root: controlProjectRootPath(homePath),
        vibeKanbanProjectId: null,
        vibeKanbanRepoId: null,
      },
    });
  });

  it("resolves relative configured paths from the selected home", () => {
    const homePath = makeTempDir("pharo-nexus-home-");

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

  it("validates Vibe Kanban Docker, DinD, and external backend config", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const dockerConfig = createDefaultHomeConfig(homePath);
    dockerConfig.integrations.vibeKanban.backend = {
      mode: "docker",
      sharedApiBase: "http://127.0.0.1:3100",
      healthPath: "/v1/health",
      sourceRepositoryUrl: "https://github.com/example/vibe-kanban.git",
      autoBootstrap: false,
      composeCommand: "docker",
      composeArgs: ["--ansi", "never"],
      composeFile: path.join("vibe", "docker-compose.yml"),
      envFile: path.join("vibe", ".env.remote"),
      projectName: "custom-vibe",
      workingDirectory: "vibe",
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    };

    expect(validateHomeConfig(dockerConfig, homePath).integrations.vibeKanban.backend).toEqual({
      mode: "docker",
      sharedApiBase: "http://127.0.0.1:3100",
      healthPath: "/v1/health",
      sourceRepositoryUrl: "https://github.com/example/vibe-kanban.git",
      autoBootstrap: false,
      composeCommand: "docker",
      composeArgs: ["--ansi", "never"],
      composeFile: path.join(homePath, "vibe", "docker-compose.yml"),
      envFile: path.join(homePath, "vibe", ".env.remote"),
      projectName: "custom-vibe",
      workingDirectory: path.join(homePath, "vibe"),
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    });

    const dindConfig = createDefaultHomeConfig(homePath);
    dindConfig.integrations.vibeKanban.backend = {
      mode: "dind",
      sharedApiBase: "http://127.0.0.1:3101",
      healthPath: "/v1/health",
      sourceRepositoryUrl: "https://github.com/example/vibe-kanban.git",
      sourceRoot: "vibe-source",
      autoBootstrap: false,
      dockerCommand: "docker",
      dindImage: "docker:29-dind",
      containerName: "custom-vibe-dind",
      dataVolume: "custom-vibe-dind-data",
      projectName: "custom-vibe",
      composeFile: path.join("vibe-source", "crates", "remote", "docker-compose.yml"),
      envFile: path.join("vibe-source", "crates", "remote", ".env.remote"),
      workingDirectory: path.join("vibe-source", "crates", "remote"),
      containerSourceRoot: "/workspace/custom-vibe",
      containerWorkingDirectory: "/workspace/custom-vibe/crates/remote",
      containerComposeFile: "/workspace/custom-vibe/crates/remote/docker-compose.yml",
      containerEnvFile: "/workspace/custom-vibe/crates/remote/.env.remote",
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    };

    expect(validateHomeConfig(dindConfig, homePath).integrations.vibeKanban.backend).toEqual({
      mode: "dind",
      sharedApiBase: "http://127.0.0.1:3101",
      healthPath: "/v1/health",
      sourceRepositoryUrl: "https://github.com/example/vibe-kanban.git",
      sourceRoot: path.join(homePath, "vibe-source"),
      autoBootstrap: false,
      dockerCommand: "docker",
      dindImage: "docker:29-dind",
      containerName: "custom-vibe-dind",
      dataVolume: "custom-vibe-dind-data",
      projectName: "custom-vibe",
      composeFile: path.join(homePath, "vibe-source", "crates", "remote", "docker-compose.yml"),
      envFile: path.join(homePath, "vibe-source", "crates", "remote", ".env.remote"),
      workingDirectory: path.join(homePath, "vibe-source", "crates", "remote"),
      containerSourceRoot: "/workspace/custom-vibe",
      containerWorkingDirectory: "/workspace/custom-vibe/crates/remote",
      containerComposeFile: "/workspace/custom-vibe/crates/remote/docker-compose.yml",
      containerEnvFile: "/workspace/custom-vibe/crates/remote/.env.remote",
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    });

    const externalConfig = createDefaultHomeConfig(homePath);
    externalConfig.integrations.vibeKanban.backend = {
      mode: "external",
      sharedApiBase: "https://kanban.example.com",
      healthPath: "/v1/health",
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    };

    expect(validateHomeConfig(externalConfig, homePath).integrations.vibeKanban.backend).toEqual({
      mode: "external",
      sharedApiBase: "https://kanban.example.com",
      healthPath: "/v1/health",
      startOnPharoNexusStart: false,
      stopOnPharoNexusStop: false,
    });
  });

  it("preserves absolute configured paths", () => {
    const parentPath = makeTempDir("pharo-nexus-parent-");
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
      makeTempDir("pharo-nexus-home-"),
      {
        vibeKanbanPort: 1,
        pharoNexusMcpPort: 7330,
        plexusMcpPort: 65_535,
      },
    );

    expect(validateHomeConfig(validBoundaryConfig).ports).toEqual({
      vibeKanban: 1,
      pharoNexusMcp: 7330,
      plexusMcp: 65_535,
    });

    const config = createDefaultHomeConfig(makeTempDir("pharo-nexus-home-"));
    config.ports.vibeKanban = 7330;

    expect(() => validateHomeConfig(config)).toThrow(NexusConfigError);

    for (const invalidPort of [0, -1, 65_536, 3.14, "3000"]) {
      const invalidConfig = createDefaultHomeConfig(
        makeTempDir("pharo-nexus-home-"),
      ) as unknown as Record<string, unknown>;
      const ports = invalidConfig.ports as Record<string, unknown>;
      ports.vibeKanban = invalidPort;

      expect(() => validateHomeConfig(invalidConfig)).toThrow(
        NexusConfigError,
      );
    }
  });

  it("rejects duplicate project ids", () => {
    const config = createDefaultHomeConfig(makeTempDir("pharo-nexus-home-"));
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

  it("initializes a home directory, writes config, and creates runtime directories", () => {
    const homePath = makeTempDir("pharo-nexus-home-");

    const result = initPharoNexusHome({
      homePath,
      vibeKanbanPort: 3100,
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
      fs.existsSync(path.join(homePath, pharoNexusLogsDirectoryName)),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(homePath, pharoNexusGeneratedDirectoryName)),
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const existingControlConfig = {
      ...createControlProjectConfig(),
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "existing-control-board",
      },
    };
    saveProjectConfig(controlProjectRootPath(homePath), existingControlConfig);

    initPharoNexusHome({ homePath });
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      existingControlConfig,
    );

    initPharoNexusHome({ homePath, force: true });
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      createControlProjectConfig(),
    );
  });

  it("generates normalized home config JSON and creates parent directories", () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "nested", "home");
    const config = createDefaultHomeConfig(homePath, {
      projectsRoot: "projects-custom",
      workspacesRoot: "workspaces-custom",
      plexusStateRoot: path.join("state-custom", "plexus"),
      vibeKanbanPort: 3100,
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });

    expect(() => initPharoNexusHome({ homePath })).toThrow(
      NexusConfigError,
    );

    expect(() =>
      initPharoNexusHome({
        homePath,
        force: true,
        vibeKanbanPort: 3100,
        plexusMcpPort: 7332,
      }),
    ).not.toThrow();
    expect(loadHomeConfig(homePath).ports.vibeKanban).toBe(3100);
  });

  it("loads home config files that include a UTF-8 BOM", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
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
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "missing");

    expect(() => loadHomeConfig(homePath)).toThrow(
      /Run "pharo-nexus init" first/,
    );
  });
});
