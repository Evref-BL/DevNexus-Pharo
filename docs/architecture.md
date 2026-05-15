# Architecture

PharoNexus coordinates tools that should remain independently useful:

```text
PharoNexus
  -> Vibe Kanban shared backend
  -> Vibe Kanban
  -> PLexus MCP
      -> pharo-launcher-mcp
          -> PharoLauncher
      -> Pharo image MCP workers
```

## Responsibilities

PharoNexus owns:

- user home configuration
- the reserved control project where users ask agents to create and manage Pharo projects
- process startup and shutdown for top-level services
- top-level ports
- Vibe Kanban backend mode selection (`docker`, `dind`, or `external`)
- logs and generated integration files
- the registry of Vibe Kanban repo/project ids and their PLexus project roots
- installation of PharoNexus and PLexus MCP entries into Vibe Kanban executors

PharoNexus does not own:

- PharoLauncher CLI details
- Pharo image creation, launch, or kill semantics
- in-image Pharo code editing or test execution

Those belong to pharo-launcher-mcp, PLexus, and the Pharo MCP worker respectively.

## Boundary Rule

Dependencies point downward:

```text
PharoNexus -> PLexus -> pharo-launcher-mcp -> PharoLauncher
```

PLexus should not depend on PharoNexus.

## Platform Boundary

The home/project model is OS-neutral: a PharoNexus home contains the same
registry, service state, logs, generated files, control project, and project
entries on Windows, macOS, and Linux. Only filesystem path syntax differs.

OS-specific behavior belongs in orchestration adapters and helpers:

- command resolution for Windows `.cmd`/`.bat` shims and POSIX executables
- process-tree shutdown, including Windows `taskkill`
- release/detach defaults for supervised background services
- browser opening commands
- Docker/Vibe backend launch details
- MCP config command fallback for clients that cannot use URL MCP

Higher-level project creation, import, Vibe linking, and Codex config generation
should call those helpers instead of branching directly on platform details.

## Vibe Backend Modes

Vibe Kanban has two distinct pieces in the PharoNexus model:

```text
Vibe shared backend  -> project and issue data
Vibe local app       -> local repo/workspace runner and UI
```

PharoNexus configures the local app with `VK_SHARED_API_BASE`, so the app talks
to the intended shared backend instead of assuming the hosted default.
The default local app command is pinned to `npx -y vibe-kanban@0.1.43`; the
`0.1.44` package keeps the app local but routes project pages to an export-only
sunset screen.

The home config stores this under `integrations.vibeKanban.backend`:

```json
{
  "mode": "docker",
  "sharedApiBase": "http://127.0.0.1:3100",
  "healthPath": "/v1/health",
  "sourceRepositoryUrl": "https://github.com/BloopAI/vibe-kanban.git",
  "autoBootstrap": true,
  "composeCommand": "auto",
  "composeArgs": [],
  "composeFile": "<home>\\vibe-kanban\\crates\\remote\\docker-compose.yml",
  "envFile": "<home>\\vibe-kanban\\crates\\remote\\.env.remote",
  "projectName": "pharo-nexus-vibe",
  "workingDirectory": "<home>\\vibe-kanban\\crates\\remote",
  "startOnPharoNexusStart": true,
  "stopOnPharoNexusStop": true
}
```

`docker` mode is for the usual local self-hosted setup. PharoNexus runs Docker
Compose with argv arrays, captures stdout/stderr/exit code/duration, writes
state under `<home>\state\services\vibe-kanban-backend.json`, and health-checks
`sharedApiBase + healthPath`. Compose builds run with `DOCKER_BUILDKIT=1` and
`COMPOSE_DOCKER_CLI_BUILD=1`; PharoNexus checks for Buildx before starting the
backend so Docker prerequisite failures are reported directly.

`dind` mode is for hosts where Vibe needs to be composed inside an isolated
Linux Docker daemon. PharoNexus starts a privileged `docker:dind` container,
bind-mounts the Vibe checkout into `/workspace/vibe-kanban`, waits for the inner
Docker daemon, verifies `docker compose`, and runs the same Vibe Compose stack
inside that container. The DinD container publishes the backend port back to the
host, while the inner Compose stack uses `REMOTE_SERVER_PORTS=0.0.0.0:3100:8081`
so the nested remote server is reachable through the outer container mapping.

When `autoBootstrap` is true, PharoNexus also owns first-run setup for the local
backend: it clones `sourceRepositoryUrl` into `<home>\vibe-kanban` if the
checkout is missing, then generates `<home>\vibe-kanban\crates\remote\.env.remote`
with local-only secrets and bootstrap local-auth credentials if that file is
missing.

After the local Vibe app is healthy, PharoNexus reads those generated
`SELF_HOST_LOCAL_AUTH_EMAIL` and `SELF_HOST_LOCAL_AUTH_PASSWORD` values and calls
the local app's `/api/auth/local/login` endpoint when the app is not already
signed in. That keeps the self-hosted path local and avoids asking the user to
copy the bootstrap password from `.env.remote` into the browser.

GitHub login is available when the user supplies Vibe-compatible GitHub OAuth
app credentials through `PHARO_NEXUS_GITHUB_OAUTH_CLIENT_ID` and
`PHARO_NEXUS_GITHUB_OAUTH_CLIENT_SECRET` or the equivalent `GITHUB_OAUTH_*`
environment variables. Existing Git config can provide an email identity hint
for fallback local auth, but it cannot supply the OAuth client secret required
by Vibe's backend.

The default backend port is 3100 to avoid colliding with the Vibe local app's
default port 3000. The generated Vibe `.env.remote` exposes the remote server
with `REMOTE_SERVER_PORTS=127.0.0.1:3100:8081`, unless both ports are changed
together.

`external` mode is for a remote or manually managed Vibe backend:

```json
{
  "mode": "external",
  "sharedApiBase": "https://kanban.example.com",
  "healthPath": "/v1/health",
  "startOnPharoNexusStart": false,
  "stopOnPharoNexusStop": false
}
```

In `external` mode, PharoNexus does not own the backend lifecycle; it only
records the configured target and can health-check it.

## Control Project

Every PharoNexus home contains one reserved project:

```text
<home>\PharoNexus\
  dev-nexus.project.json
  worktrees\
```

The home config records that project explicitly:

```json
{
  "controlProject": {
    "id": "pharo-nexus-control",
    "name": "PharoNexus",
    "root": "<home>\\PharoNexus",
    "vibeKanbanProjectId": null,
    "vibeKanbanRepoId": null
  },
  "projects": []
}
```

This project is the management surface for Vibe Kanban. The user can create
tasks there such as "create a new Pharo project from this GitHub repository",
and agents can call PharoNexus tools to create or import the real project on
disk.

The control project is not itself a Pharo application repository. It is the
durable local workspace for PharoNexus management tasks.

`pharo-nexus start` ensures this control project exists, registers its root as a
Vibe Kanban repo when no `vibeKanbanRepoId` is stored yet, and ensures a Vibe
Kanban project/board named `PharoNexus` exists when no `vibeKanbanProjectId` is
stored yet. The board id is written to both:

```text
<home>\dev-nexus.home.json
<home>\PharoNexus\dev-nexus.project.json
```

Registration is best-effort. If Vibe Kanban is healthy but repo registration is
or board creation is not available, start continues and reports the error in its
structured result.

## Project Config

Each PharoNexus project has a `dev-nexus.project.json` file:

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

Generic relative project paths, such as `worktreesRoot`, resolve from the
directory containing `dev-nexus.project.json`. Pharo/PLexus paths, such as
`extensions.pharo-nexus.plexusProjectConfig`, are interpreted by the
PharoNexus extension.

## Project Creation

`pharo-nexus project create <name>` is the project factory entrypoint used by
agents working from the control project. `pharo-nexus project import <path>`
imports a local source Git checkout while keeping PharoNexus runtime metadata in
a managed PharoNexus project root.

It supports two source modes:

```text
--git-init
--from <git-url>
```

If `--root` is omitted, the project root is created under
`dev-nexus.home.json`'s `paths.projectsRoot`.

For `project import`, `<path>` is the source Git checkout, not the metadata
root. Use `--project-root <path>` only when the managed PharoNexus project root
needs to be placed somewhere other than `paths.projectsRoot`.

Creation writes:

```text
<project-root>\
  dev-nexus.project.json
  plexus.project.json
  .codex\config.toml
  AGENTS.md
  suggestedFirstPrompt.md
  worktrees\
```

For `project create --from`, the source repository is cloned under
`<project-root>\git` and referenced from `repo.sourceRoot`. For `project import
<source-checkout>`, `repo.sourceRoot` points at the existing checkout. The
source checkout must not receive PharoNexus metadata files unless it is already a
managed PharoNexus project.

`suggestedFirstPrompt.md` is a generated first-session prompt for agents. It
points at the managed project root, source checkout, known Kanban id when
available, and asks the agent to update local notes and refine `AGENTS.md` only
where project-specific workflow guidance is needed.

The home config `projects` registry is updated with the PharoNexus project id,
display name, PLexus project root, and any known Vibe ids.

If a Vibe Kanban project id is already known, project creation can store it at
creation time. Otherwise the project remains unlinked until a user or agent
links it:

```text
pharo-nexus project link-kanban <id-or-path> --vibe-project-id <id>
```

If Vibe Kanban is running, PharoNexus can also register the project's source
checkout as a local Vibe repo and ensure a Vibe project/board exists:

```text
pharo-nexus project create <name> --git-init --sync-vibe-kanban
pharo-nexus project import <path> --name <name> --sync-vibe-kanban
pharo-nexus project sync-kanban <id-or-path>
```

The link and sync operations update three places so all layers agree:

```text
<home>\dev-nexus.home.json
<project-root>\dev-nexus.project.json
<project-root>\plexus.project.json
```

The repo adapter uses Vibe Kanban's local repo API (`POST /api/repos`) and
stores that id as `vibeKanbanRepoId`. For imported or cloned repositories, this
repo path is the source checkout (`repo.sourceRoot`), not the managed
PharoNexus project root. PharoNexus then refreshes the Vibe repo setup script
from managed project metadata so future Vibe worktrees receive local support
files without committing them:

- copy `AGENTS.md` from the managed project root when the worktree lacks one
- copy managed `.codex/config.toml` when the worktree lacks Codex config
- add `AGENTS.md`, `.codex/`, and `node_modules/` to `.git/info/exclude`
- link to source checkout `node_modules` when it already exists, and report
  when local dependencies are missing instead of hiding that failure

This setup-script provisioning is environment wiring only. Implementation work
should be done by the Codex automation process against the owning checkout; Vibe
Kanban remains the board and workspace history system, not the normal source
worker dispatcher.

The board adapter uses Vibe Kanban's local auth session and shared project API
to find or create the Kanban board, then stores that id as
`vibeKanbanProjectId`. `link-kanban` remains the fallback when the Vibe board is
created manually or by another agent.

Project discovery commands read that registry:

```text
pharo-nexus project list
pharo-nexus project status <id-or-path>
```

`project list` reports registered real Pharo projects. `project status` accepts
either a registered project id or a path to a project root or
`dev-nexus.project.json` file. Both commands resolve the PLexus config path
and worktrees root from the project config.

## MCP Surface

PharoNexus exposes its project factory and registry through a supervised local
HTTP MCP server:

```text
pharo-nexus mcp
```

The control project should make this server available to agents. The first MCP
tools are:

```text
pharo_nexus_project_create
pharo_nexus_project_import
pharo_nexus_project_link_kanban
pharo_nexus_project_sync_kanban
pharo_nexus_project_list
pharo_nexus_project_status
```

The MCP surface belongs to PharoNexus rather than PLexus because these tools
create and register repositories. PLexus remains responsible for opening,
closing, and routing runtime targets inside an already-created project.

## Control Board Prompt Contract

The PharoNexus control board is the human entrypoint for creating or importing
real Pharo projects.

When the user writes a task like:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

the agent should call `pharo_nexus_project_create` with:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://github.com/me/MyLibrary.git"
}
```

The agent should not manually create directories, hand-edit project config
files, or call Vibe Kanban directly for this workflow. PharoNexus owns the
transaction: Git clone or init, `dev-nexus.project.json`,
`plexus.project.json`, `.codex\config.toml`, `AGENTS.md`, `worktrees\`, Vibe
repo registration, Vibe board creation or linking, and the home project
registry update.

## Project Board Feature Contract

Once a real Pharo project exists, feature planning and implementation happen on
that project's Vibe Kanban board, not on the PharoNexus control board.

When the user writes an issue like:

```text
Plan persistence support for MyLibrary
```

the Vibe agent should work the issue in an isolated Vibe workspace for that
project repository. The expected agent behavior is:

- plan the requested feature in the issue context
- make code and documentation changes inside the isolated workspace
- run the relevant checks available in that workspace
- report the outcome back to the issue

PharoNexus does not create another PharoNexus project for feature issues. It
only ensures the project exists and is linked to Vibe Kanban. PLexus later owns
the Pharo runtime layer for each workspace: deciding which Pharo image(s) are
active, starting them, loading the in-image MCP server, assigning ports, and
routing Pharo-specific MCP calls to the correct image.

The intended first scenario is that a user creates a task in the PharoNexus
control project:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

The agent calls:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://github.com/me/MyLibrary.git"
}
```

on `pharo_nexus_project_create`. `remoteUrl` is the MCP-facing name for the Git
source URL; `from` remains accepted as a compatibility alias. When no explicit
`vibeKanbanProjectId` is supplied, MCP create/import calls sync Vibe Kanban by
default: they register the local repo and ensure the project board exists.

On start, PharoNexus installs two MCP server entries into the selected Vibe
Kanban executor:

```text
pharo_nexus -> http://127.0.0.1:<pharoNexusMcp>/mcp
plexus       -> http://127.0.0.1:<plexusMcp>/mcp
```

Existing Vibe Kanban MCP servers are preserved. The server names, HTTP host,
and ports come from `dev-nexus.home.json`.

## Codex Workspace Config

Codex workspaces should be connection-first:

```powershell
pharo-nexus start
pharo-nexus codex init <workspace>
pharo-nexus codex doctor <workspace>
```

`codex init` updates `<workspace>\.codex\config.toml` and preserves unrelated
Codex settings and unrelated MCP servers. It owns only the managed
`pharo_nexus`, `plexus`, and `vibe_kanban` sections. The PharoNexus and PLexus
entries use URL MCP connections to the supervised endpoints. This keeps one
PharoNexus-controlled service graph per home instead of one ad hoc process tree
per Codex chat.

`codex doctor` validates the generated config, endpoint health, MCP
`initialize`, `tools/list`, and the expected tool names. A stale Codex chat may
still miss tools after the config is correct because MCP tools are loaded when
the executor session starts; open a fresh chat after the doctor passes.

Command-mode fallback is for clients that cannot use URL MCP. The fallback must
use the current Node executable and an absolute PharoNexus entrypoint, such as
`node <repo>\dist\cli.js mcp-stdio`, rather than a bare package-bin command.

## Agent Model Policy

Agent executor, model, and reasoning defaults are PharoNexus policy. They belong
in `dev-nexus.home.json`, `dev-nexus.project.json`, and future
issue/workspace-start inputs, not in PLexus or PLexus gateway.

Resolution order is:

1. issue-level override
2. project `agent` defaults
3. home `agent` defaults
4. executor profile fallback from Vibe/Codex

This keeps PLexus focused on project/workspace/runtime routing while giving
PharoNexus a single place to resolve the values that a future Vibe workspace
start API call can pass as model/reasoning ids.
