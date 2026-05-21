# DevNexus-Pharo Development

This document is for contributors working on DevNexus-Pharo itself. The root
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
node C:\work\src\DevNexus-Pharo\dist\cli.js --help
```

The package is TypeScript ESM targeting Node.js 24 or newer.

## Documentation Layout

- `README.md`: concise user-facing entry point and docs map.
- `docs/user/getting-started.md`: first-use setup paths.
- `docs/user/modes.md`: home/control-project mode, plugin mode, static
  projection, and live service boundaries.
- `docs/user/workflows.md`: project factory, control-project, managed project,
  skill projection, Codex setup, and work-tracking boundaries.
- `docs/reference/mcp.md`: MCP server commands, tools, and ownership.
- `docs/reference/configuration.md`: home shape, project shape, Vibe backend
  modes, image execution policy, load workspaces, and host capabilities.
- `docs/troubleshooting.md`: operational failures and recovery checks.
- `docs/documentation-refresh-plan.md`: durable notes for the documentation
  cleanup direction.
- `docs/architecture.md`: design boundaries and system model.
- `docs/development.md`: contributor commands and implementation notes.
- `AGENTS.md`: agent workflow contract for this repository.

## CLI Surface

Current top-level commands:

```powershell
dev-nexus-pharo --help
dev-nexus-pharo init
dev-nexus-pharo start
dev-nexus-pharo status --check-health
dev-nexus-pharo stop
dev-nexus-pharo mcp
dev-nexus-pharo mcp-stdio
```

Project commands:

```powershell
dev-nexus-pharo project create MyProject --git-init
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
dev-nexus-pharo project list
dev-nexus-pharo project status MyProject
dev-nexus-pharo project skills status MyProject
dev-nexus-pharo project skills refresh MyProject
```

Generic tracker configuration belongs to DevNexus core:

```powershell
dev-nexus project tracker configure MyProject --provider local --store-path .dev-nexus\work-items.json
dev-nexus project tracker link MyProject --tracker-project-id <id>
```

Project skill refresh materializes generic DevNexus skills, DevNexus-Pharo
workflow/runtime-boundary skills, and copied MCP-Pharo domain skills:
`pharo-ci-repro`, `pharo-image-git-handoff`, `pharo-project-load`, and
`pharo-version-compat`. Those MCP-Pharo-derived skills are bundled guidance with
upstream commit provenance in their `dev-nexus.skill.json` manifests. They must
not require a runtime sibling checkout; MCP-Pharo remains the source project for
image-side MCP behavior.

Codex workspace commands:

```powershell
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\ExistingProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\ExistingProject
```

Service subcommands:

```powershell
dev-nexus-pharo plexus-gateway start C:\dev\dev-nexus-pharo
dev-nexus-pharo plexus-gateway status C:\dev\dev-nexus-pharo --check-health
dev-nexus-pharo plexus-gateway stop C:\dev\dev-nexus-pharo
dev-nexus-pharo vibe-kanban start C:\dev\dev-nexus-pharo
dev-nexus-pharo vibe-kanban status C:\dev\dev-nexus-pharo --check-health
dev-nexus-pharo vibe-kanban stop C:\dev\dev-nexus-pharo
dev-nexus-pharo vibe-backend start C:\dev\dev-nexus-pharo
dev-nexus-pharo vibe-backend status C:\dev\dev-nexus-pharo --check-health
dev-nexus-pharo vibe-backend stop C:\dev\dev-nexus-pharo
dev-nexus-pharo vibe-kanban mcp-config install C:\dev\dev-nexus-pharo --executor CODEX
```

## Generated Home Shape

`dev-nexus-pharo init` creates `dev-nexus.home.json` and the initial runtime
directories:

```text
<home>\
  dev-nexus.home.json
  DevNexus-Pharo\
    dev-nexus.project.json
    plexus.project.json
    worktrees\
  projects\
  workspaces\
  state\
  logs\
  generated\
```

The `DevNexus-Pharo` directory is the reserved control project. It is not a normal
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
    "dev-nexus-pharo": {
      "plexusProjectConfig": "plexus.project.json"
    }
  }
}
```

Generic relative paths such as `worktreesRoot` resolve from the directory
containing `dev-nexus.project.json`. Pharo/PLexus-specific paths such as
`extensions.dev-nexus-pharo.plexusProjectConfig` are interpreted by the DevNexus-Pharo
extension, not by the generic project config loader.

`plexus.project.json` also contains the DevNexus-Pharo-authored `imageExecution`
policy consumed by future PLexus image work. Its default mode is `disabled`;
Docker mode requires an explicit runner image and keeps
`requireDisposableImage`, `requireCleanupPlan`, `autoRemove`, and
`mountProjectReadOnly` enabled by default.

For imported or cloned source repositories, `repo.sourceRoot` points from the
managed project root to the source checkout. The source checkout should not
receive DevNexus-Pharo metadata unless it is already a managed DevNexus-Pharo project.

## Start Orchestration

`dev-nexus-pharo start`:

- loads `dev-nexus.home.json`
- starts the Vibe shared backend when configured
- starts the Vibe Kanban local app
- injects `VK_SHARED_API_BASE`
- waits for Vibe Kanban health
- signs into local self-hosted Vibe auth when generated credentials are present
- starts the DevNexus-Pharo HTTP MCP service
- starts the configured PLexus gateway
- ensures the reserved control project exists
- registers the control project repo with Vibe Kanban when needed
- ensures the `DevNexus-Pharo` Kanban board exists
- opens the board in the browser unless disabled
- installs DevNexus-Pharo and PLexus MCP entries into the configured executor

The command prints progress messages to stderr and keeps structured JSON output
on stdout when `--json` is used.

## Codex Config Generation

`dev-nexus-pharo codex init <workspace>` updates
`<workspace>\.codex\config.toml`. It preserves unrelated settings and replaces
only the managed MCP server entries:

```text
dev_nexus_pharo
plexus
vibe_kanban
pharo
```

Treat `.codex\config.toml` as local workspace state generated by this command,
not as source-controlled repository configuration.

Shared DevNexus-Pharo project roots emit command-based `plexus_project` and
`pharo_launcher` entries plus separate URL MCP entries for `route_control` and
the agent-facing `gateway`. The gateway URLs come from the project-local PLexus
runtime policy in `plexus.project.json`; obsolete home-scoped `plexus`,
`vibe_kanban`, and `pharo` entries are removed during regeneration.
Shared roots also include the generic `dev_nexus` server. Use `dev_nexus`, not
`dev_nexus_pharo`, for generic `project_*`, `work_item_*`,
`automation_status`, `target_cycle_*`, and `target_report`.

`codex doctor` validates managed config sections, endpoint health, MCP
`initialize`, `tools/list`, and expected tool names. For project-local
`gateway` and `route_control` entries it performs only a read-only config check,
so the check does not launch images or open PLexus routes.

## Agent Model Policy

Agent executor, model, and reasoning defaults are DevNexus-Pharo policy. They
belong in `dev-nexus.home.json`, `dev-nexus.project.json`, and future
issue/workspace-start inputs, not in PLexus or the PLexus gateway.

Resolution order:

1. issue-level override
2. project `agent` defaults
3. home `agent` defaults
4. executor profile fallback from Vibe/Codex

## Vibe Backend Modes

`integrations.vibeKanban.backend.mode` supports:

- `docker`: DevNexus-Pharo runs Docker Compose directly.
- `dind`: DevNexus-Pharo starts a privileged `docker:dind` container and runs
  Docker Compose inside it.
- `external`: DevNexus-Pharo records and health-checks a backend it does not own.

In managed backend modes, DevNexus-Pharo clones the Vibe source checkout when
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
- injects `DEV_NEXUS_PHARO_HOME`, `PLEXUS_HOST`, `PLEXUS_STATE_ROOT`,
  `PLEXUS_MCP_PORT`, and `PORT`
- stops the service by persisted pid
- optionally checks HTTP health on the configured PLexus MCP port

Codex workspaces prepared through DevNexus core depend on this gateway for direct
Pharo MCP access. When a Pharo code task lacks the `pharo` MCP surface, agents
should report the missing route/configuration as a blocker instead of editing
Pharo code through files.

## Vibe Kanban Backend Service

`src/vibeKanbanBackendService.ts` manages the shared Vibe backend:

- `docker` mode starts and stops Docker Compose with `--env-file`, `-f`, and
  `-p`
- `dind` mode starts a privileged `docker:dind` container and runs Docker
  Compose inside it
- `external` mode records and health-checks a backend that DevNexus-Pharo does not
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
- injects `DEV_NEXUS_PHARO_HOME`, `PORT`, `HOST`, `MCP_HOST`, `MCP_PORT`, and
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
entries, adds or replaces the DevNexus-Pharo and PLexus entries, and posts the
merged map back.

Use `--dry-run` to preview the merged server map:

```powershell
dev-nexus-pharo vibe-kanban mcp-config install C:\dev\dev-nexus-pharo --executor CODEX --dry-run
```

## Vibe Kanban Project And Repo Adapter

DevNexus-Pharo tracks two Vibe ids:

- `vibeKanbanRepoId`: Vibe's local repo registration id, used by workspaces.
- `vibeKanbanProjectId`: the Kanban board id, written into
  `dev-nexus.project.json` and `plexus.project.json`.

`dev-nexus-pharo start` ensures both ids exist for the reserved control project.
`dev-nexus-pharo project sync-kanban` does the same for real projects.

Repo registration uses Vibe Kanban's local repo API. Board creation uses Vibe
Kanban's local login session and shared project API, matching Vibe's Create
Project dialog.
