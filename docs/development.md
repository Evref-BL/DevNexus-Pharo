# PharoNexus Development

This document is for contributors working on PharoNexus itself. The root
README is intentionally user-facing.

## Local Commands

```powershell
npm install
npm run build
npm test
npm run check
```

The CLI entrypoint during development is:

```powershell
node C:\dev\code\git\PharoNexus\dist\cli.js --help
```

The package is TypeScript ESM targeting Node.js 24 or newer.

## Documentation Layout

- `README.md`: user setup, startup, project workflow, and troubleshooting.
- `docs/architecture.md`: design boundaries and system model.
- `docs/development.md`: contributor commands and implementation notes.
- `AGENTS.md`: agent workflow contract for this repository.

## CLI Surface

Current top-level commands:

```powershell
pharo-nexus --help
pharo-nexus init
pharo-nexus start
pharo-nexus status --check-health
pharo-nexus stop
pharo-nexus mcp
pharo-nexus mcp-stdio
```

Project commands:

```powershell
pharo-nexus project create MyProject --git-init
pharo-nexus project create MyProject --from https://github.com/example/MyProject.git
pharo-nexus project import C:\dev\code\git\ExistingProject --name ExistingProject
pharo-nexus project link-tracker my-project --tracker-project-id <id>
pharo-nexus project sync-tracker my-project
pharo-nexus project list
pharo-nexus project status MyProject
pharo-nexus project skills status MyProject
pharo-nexus project skills refresh MyProject
```

Codex workspace commands:

```powershell
pharo-nexus codex init C:\dev\code\pharo-nexus\ExistingProject
pharo-nexus codex doctor C:\dev\code\pharo-nexus\ExistingProject
```

Service subcommands:

```powershell
pharo-nexus plexus-gateway start C:\dev\pharo-nexus
pharo-nexus plexus-gateway status C:\dev\pharo-nexus --check-health
pharo-nexus plexus-gateway stop C:\dev\pharo-nexus
pharo-nexus vibe-kanban start C:\dev\pharo-nexus
pharo-nexus vibe-kanban status C:\dev\pharo-nexus --check-health
pharo-nexus vibe-kanban stop C:\dev\pharo-nexus
pharo-nexus vibe-backend start C:\dev\pharo-nexus
pharo-nexus vibe-backend status C:\dev\pharo-nexus --check-health
pharo-nexus vibe-backend stop C:\dev\pharo-nexus
pharo-nexus vibe-kanban mcp-config install C:\dev\pharo-nexus --executor CODEX
```

## Generated Home Shape

`pharo-nexus init` creates `dev-nexus.home.json` and the initial runtime
directories:

```text
<home>\
  dev-nexus.home.json
  PharoNexus\
    dev-nexus.project.json
    plexus.project.json
    worktrees\
  projects\
  workspaces\
  state\
  logs\
  generated\
```

The `PharoNexus` directory is the reserved control project. It is not a normal
Pharo application project.

## Project Config Shape

Each managed project has a `dev-nexus.project.json` file:

```json
{
  "version": 1,
  "id": "my-project",
  "name": "MyProject",
  "home": null,
  "repo": {
    "kind": "local",
    "remoteUrl": null,
    "defaultBranch": null
  },
  "worktreesRoot": "worktrees",
  "kanban": {
    "provider": "vibe-kanban",
    "projectId": null
  },
  "extensions": {
    "pharo-nexus": {
      "plexusProjectConfig": "plexus.project.json"
    }
  }
}
```

Generic relative paths such as `worktreesRoot` resolve from the directory
containing `dev-nexus.project.json`. Pharo/PLexus-specific paths such as
`extensions.pharo-nexus.plexusProjectConfig` are interpreted by the PharoNexus
extension, not by the generic project config loader.

`plexus.project.json` also contains the PharoNexus-authored `imageExecution`
policy consumed by future PLexus image work. Its default mode is `disabled`;
Docker mode requires an explicit runner image and keeps
`requireDisposableImage`, `requireCleanupPlan`, `autoRemove`, and
`mountProjectReadOnly` enabled by default.

For imported or cloned source repositories, `repo.sourceRoot` points from the
managed project root to the source checkout. The source checkout should not
receive PharoNexus metadata unless it is already a managed PharoNexus project.

## Start Orchestration

`pharo-nexus start`:

- loads `dev-nexus.home.json`
- starts the Vibe shared backend when configured
- starts the Vibe Kanban local app
- injects `VK_SHARED_API_BASE`
- waits for Vibe Kanban health
- signs into local self-hosted Vibe auth when generated credentials are present
- starts the PharoNexus HTTP MCP service
- starts the configured PLexus gateway
- ensures the reserved control project exists
- registers the control project repo with Vibe Kanban when needed
- ensures the `PharoNexus` Kanban board exists
- opens the board in the browser unless disabled
- installs PharoNexus and PLexus MCP entries into the configured executor

The command prints progress messages to stderr and keeps structured JSON output
on stdout when `--json` is used.

## Codex Config Generation

`pharo-nexus codex init <workspace>` updates
`<workspace>\.codex\config.toml`. It preserves unrelated settings and replaces
only the managed MCP server entries:

```text
pharo_nexus
plexus
vibe_kanban
```

PharoNexus and PLexus entries use URL MCP connections to supervised local
endpoints. `vibe_kanban` remains a pinned command entry for Vibe's own MCP
mode.

`codex doctor` validates managed config sections, endpoint health, MCP
`initialize`, `tools/list`, and expected tool names.

## Agent Model Policy

Agent executor, model, and reasoning defaults are PharoNexus policy. They
belong in `dev-nexus.home.json`, `dev-nexus.project.json`, and future
issue/workspace-start inputs, not in PLexus or the PLexus gateway.

Resolution order:

1. issue-level override
2. project `agent` defaults
3. home `agent` defaults
4. executor profile fallback from Vibe/Codex

## Vibe Backend Modes

`integrations.vibeKanban.backend.mode` supports:

- `docker`: PharoNexus runs Docker Compose directly.
- `dind`: PharoNexus starts a privileged `docker:dind` container and runs
  Docker Compose inside it.
- `external`: PharoNexus records and health-checks a backend it does not own.

In managed backend modes, PharoNexus clones the Vibe source checkout when
`autoBootstrap` is true and the checkout is missing, then generates
`.env.remote` with local secrets and bootstrap local-auth credentials when
needed.

Compose operations run with argv arrays, not concatenated shell strings. Build
startup sets `DOCKER_BUILDKIT=1` and `COMPOSE_DOCKER_CLI_BUILD=1`.

## Process Supervisor

`src/processSupervisor.ts` provides low-level service primitives:

- `startManagedProcess(...)`: starts a command with argv args, captures its
  pid, and writes stdout/stderr/lifecycle logs.
- `stopProcessByPid(...)`: stops a persisted process by pid, including Windows
  process-tree shutdown when needed.
- `checkHttpPort(...)`: checks whether an HTTP endpoint answers with a healthy
  status.
- `waitForHttpPort(...)`: polls an HTTP endpoint until healthy or timed out.

## PLexus Gateway Service

`src/plexusGatewayService.ts` manages the configured PLexus gateway process:

- starts `tools.plexus.command` with `tools.plexus.args`
- writes logs under `<home>\logs\plexus-gateway`
- writes service state under `<home>\state\services\plexus-gateway.json`
- injects `PHARO_NEXUS_HOME`, `PLEXUS_HOST`, `PLEXUS_STATE_ROOT`,
  `PLEXUS_MCP_PORT`, and `PORT`
- stops the service by persisted pid
- optionally checks HTTP health on the configured PLexus MCP port

## Vibe Kanban Backend Service

`src/vibeKanbanBackendService.ts` manages the shared Vibe backend:

- `docker` mode starts and stops Docker Compose with `--env-file`, `-f`, and
  `-p`
- `dind` mode starts a privileged `docker:dind` container and runs Docker
  Compose inside it
- `external` mode records and health-checks a backend that PharoNexus does not
  own
- command output is captured in backend state and logs
- service state is written under
  `<home>\state\services\vibe-kanban-backend.json`
- health checks call `sharedApiBase + healthPath`

## Vibe Kanban Service

`src/vibeKanbanService.ts` manages the configured Vibe Kanban process:

- starts `tools.vibeKanban.command` with `tools.vibeKanban.args`
- defaults new homes to `npx -y vibe-kanban@0.1.43`
- writes logs under `<home>\logs\vibe-kanban`
- writes service state under `<home>\state\services\vibe-kanban.json`
- injects `PHARO_NEXUS_HOME`, `PORT`, `HOST`, `MCP_HOST`, `MCP_PORT`, and
  `VK_SHARED_API_BASE`
- stops the service by persisted pid
- optionally checks HTTP health on the configured Vibe Kanban port

## Vibe Kanban MCP Adapter

Vibe Kanban stores MCP server config per coding-agent executor. Its local REST
API exposes:

```text
GET  /api/mcp-config?executor=CODEX
POST /api/mcp-config?executor=CODEX
```

`src/vibeKanbanMcpConfig.ts` reads existing servers, preserves unrelated
entries, adds or replaces the PharoNexus and PLexus entries, and posts the
merged map back.

Use `--dry-run` to preview the merged server map:

```powershell
pharo-nexus vibe-kanban mcp-config install C:\dev\pharo-nexus --executor CODEX --dry-run
```

## Vibe Kanban Project And Repo Adapter

PharoNexus tracks two Vibe ids:

- `vibeKanbanRepoId`: Vibe's local repo registration id, used by workspaces.
- `vibeKanbanProjectId`: the Kanban board id, written into
  `dev-nexus.project.json` and `plexus.project.json`.

`pharo-nexus start` ensures both ids exist for the reserved control project.
`pharo-nexus project sync-kanban` does the same for real projects.

Repo registration uses Vibe Kanban's local repo API. Board creation uses Vibe
Kanban's local login session and shared project API, matching Vibe's Create
Project dialog.
