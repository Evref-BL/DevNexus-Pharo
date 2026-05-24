import { defaultNexusHomePath } from "./config.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  type CreateDevNexusPharoProjectResult,
  type ImportDevNexusPharoProjectResult,
} from "./devNexusPharoProjectService.js";
import {
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  listNexusProjects,
  type CreateNexusProjectResult,
  type GetNexusProjectStatusResult,
  type ImportNexusProjectResult,
  type ListNexusProjectsResult,
  type NexusProjectStatus,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
  type ProjectSkillRefreshResult,
  type ProjectSkillStatusResult,
} from "./nexusProjectSkillService.js";

function defaultHomePath(): string {
  return defaultNexusHomePath();
}

interface ParsedProjectCreateCommand {
  homePath: string;
  name: string;
  from?: string;
  gitInit?: boolean;
  root?: string;
  generic?: boolean;
  json?: boolean;
}

interface ParsedProjectImportCommand {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  generic?: boolean;
  json?: boolean;
}

interface ParsedProjectSkillsCommand {
  homePath: string;
  action: "status" | "refresh";
  project: string;
  json?: boolean;
}

interface ParsedProjectListCommand {
  homePath: string;
  json?: boolean;
}

interface ParsedProjectStatusCommand {
  homePath: string;
  project: string;
  json?: boolean;
}

function parseProjectCreateCommand(argv: string[]): ParsedProjectCreateCommand {
  const [, command, name, ...rest] = argv;
  if (command !== "create") {
    throw new Error("project requires create");
  }

  if (!name || name.startsWith("--")) {
    throw new Error("project create requires a project name");
  }

  const parsed: Partial<ParsedProjectCreateCommand> = {
    name,
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--from":
        parsed.from = next();
        break;
      case "--git-init":
        parsed.gitInit = true;
        break;
      case "--root":
        parsed.root = next();
        break;
      case "--generic":
        parsed.generic = true;
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project create option: ${arg}`);
    }
  }

  return parsed as ParsedProjectCreateCommand;
}

function parseProjectImportCommand(argv: string[]): ParsedProjectImportCommand {
  const [, command, root, ...rest] = argv;
  if (command !== "import") {
    throw new Error("project requires import");
  }

  if (!root || root.startsWith("--")) {
    throw new Error("project import requires a project path");
  }

  const parsed: Partial<ParsedProjectImportCommand> = {
    root,
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--name":
        parsed.name = next();
        break;
      case "--project-root":
        parsed.projectRoot = next();
        break;
      case "--generic":
        parsed.generic = true;
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project import option: ${arg}`);
    }
  }

  return parsed as ParsedProjectImportCommand;
}

function parseProjectSkillsCommand(argv: string[]): ParsedProjectSkillsCommand {
  const [, command, action, project, ...rest] = argv;
  if (command !== "skills") {
    throw new Error(
      "project requires create, import, skills, list, or status",
    );
  }

  if (action !== "status" && action !== "refresh") {
    throw new Error("project skills requires status or refresh");
  }

  if (!project || project.startsWith("--")) {
    throw new Error(`project skills ${action} requires a project id or path`);
  }

  const parsed: Partial<ParsedProjectSkillsCommand> = {
    homePath: defaultHomePath(),
    action,
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project skills option: ${arg}`);
    }
  }

  return parsed as ParsedProjectSkillsCommand;
}

function parseProjectListCommand(argv: string[]): ParsedProjectListCommand {
  const [, command, ...rest] = argv;
  if (command !== "list") {
    throw new Error(
      "project requires create, import, list, or status",
    );
  }

  const parsed: Partial<ParsedProjectListCommand> = {
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project list option: ${arg}`);
    }
  }

  return parsed as ParsedProjectListCommand;
}

function parseProjectStatusCommand(argv: string[]): ParsedProjectStatusCommand {
  const [, command, project, ...rest] = argv;
  if (command !== "status") {
    throw new Error(
      "project requires create, import, list, or status",
    );
  }

  if (!project || project.startsWith("--")) {
    throw new Error("project status requires a project id or path");
  }

  const parsed: Partial<ParsedProjectStatusCommand> = {
    homePath: defaultHomePath(),
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project status option: ${arg}`);
    }
  }

  return parsed as ParsedProjectStatusCommand;
}

function printProjectCreateResult(
  result: CreateDevNexusPharoProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project created.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  console.log(`  Git: ${result.git.operation}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectImportResult(
  result: ImportDevNexusPharoProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project imported.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printNexusProjectCreateResult(
  result: CreateNexusProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus project created.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  console.log(`  Git: ${result.git.operation}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printNexusProjectImportResult(
  result: ImportNexusProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus project imported.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatus(project: NexusProjectStatus): void {
  console.log(`  ${project.id} (${project.name})`);
  console.log(`    Root: ${project.projectRoot}`);
  console.log(`    Repo origin: ${project.repo?.remoteUrl ?? "(none)"}`);
  console.log(
    `    Default branch: ${project.repo?.defaultBranch ?? "(unknown)"}`,
  );
  console.log(
    `    Work tracker: ${project.workTracking?.provider ?? "(not configured)"}`,
  );
  console.log(`    PLexus config: ${project.plexusProjectConfigPath ?? "(not managed)"}`);
  console.log(`    Worktrees: ${project.worktreesRoot}`);
}

function printProjectListResult(
  result: ListNexusProjectsResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`DevNexus-Pharo projects: ${result.projects.length}`);
  for (const project of result.projects) {
    printProjectStatus(project);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatusResult(
  result: GetNexusProjectStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project status.");
  printProjectStatus(result.project);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function skillStatusSummaryLine(
  summary: ProjectSkillStatusResult["skillStatus"]["summary"],
): string {
  return [
    `expected ${summary.expected}`,
    `installed ${summary.installed}`,
    `missing ${summary.missing}`,
    `stale ${summary.stale}`,
    `unexpected ${summary.unexpected}`,
    `invalid ${summary.invalid}`,
  ].join(", ");
}

function printProjectSkillStatusResult(
  result: ProjectSkillStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project skill status.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Skills directory: ${result.skillStatus.skillsDirectory}`);
  console.log(`  Summary: ${skillStatusSummaryLine(result.skillStatus.summary)}`);
  for (const skill of result.skillStatus.skills) {
    if (skill.state === "installed") {
      continue;
    }

    console.log(`  ${skill.id}: ${skill.state}`);
    for (const reason of skill.reasons) {
      console.log(`    - ${reason}`);
    }
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectSkillRefreshResult(
  result: ProjectSkillRefreshResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project skills refreshed.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Before: ${skillStatusSummaryLine(result.refresh.before.summary)}`);
  console.log(`  After: ${skillStatusSummaryLine(result.refresh.after.summary)}`);
  console.log(`  Materialized: ${result.refresh.materialized.installed.length}`);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

export async function handleProjectCommand(argv: string[]): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseProjectCreateCommand(argv);
    if (parsed.generic) {
      const result = createNexusProject(parsed);
      printNexusProjectCreateResult(result, parsed.json);
      return 0;
    }

    const result = createDevNexusPharoProject(parsed);
    printProjectCreateResult(result, parsed.json);
    return 0;
  }

  if (command === "import") {
    const parsed = parseProjectImportCommand(argv);
    if (parsed.generic) {
      const result = importNexusProject(parsed);
      printNexusProjectImportResult(result, parsed.json);
      return 0;
    }

    const result = importDevNexusPharoProject(parsed);
    printProjectImportResult(result, parsed.json);
    return 0;
  }

  if (command === "skills") {
    const parsed = parseProjectSkillsCommand(argv);
    if (parsed.action === "status") {
      const result = getProjectSkillStatus(parsed);
      printProjectSkillStatusResult(result, parsed.json);
      return 0;
    }

    const result = refreshProjectSkills(parsed);
    printProjectSkillRefreshResult(result, parsed.json);
    return 0;
  }

  if (command === "list") {
    const parsed = parseProjectListCommand(argv);
    const result = listNexusProjects({ homePath: parsed.homePath });
    printProjectListResult(result, parsed.json);
    return 0;
  }

  if (command === "status") {
    const parsed = parseProjectStatusCommand(argv);
    const result = getNexusProjectStatus(parsed);
    printProjectStatusResult(result, parsed.json);
    return 0;
  }

  throw new Error(
    "project requires create, import, skills, list, or status",
  );
}
