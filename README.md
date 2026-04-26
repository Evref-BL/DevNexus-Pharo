# PharoNexus

PharoNexus is the user-environment orchestrator above Vibe Kanban and PLexus.

It owns the "start everything" experience:

- configure a user-level PharoNexus home
- start and monitor PLexus MCP
- start and monitor Vibe Kanban
- coordinate top-level ports and generated integration config
- register local Vibe repos and Vibe Kanban boards that map to PLexus projects

PLexus remains responsible for project/workspace/runtime-target/image behavior. MCP-PL remains responsible for PharoLauncher.

## First-Time Setup

From a source checkout:

```powershell
cd C:\dev\code\git\PharoNexus
npm install
npm run build
npm link
```

`npm link` makes the `pharo-nexus` command available in new terminals. If you
do not want a global link, run the built CLI directly with
`node C:\dev\code\git\PharoNexus\dist\cli.js`. This direct entrypoint is only
for running the CLI itself; MCP clients should use the supervised HTTP endpoint
installed by `pharo-nexus start`.

Prerequisites:

- Node.js 24 or newer with `npm` and `npx`
- Git
- Docker when using local Vibe backend modes. `docker` mode also needs host
  Docker Compose and Buildx; `dind` mode needs privileged containers.
- a working PLexus gateway command, currently expected as `plexus-gateway`

Platform notes:

- Windows examples in this README use `C:\...` paths and PowerShell. Windows
  service supervision handles `.cmd`/`.bat` shims and process-tree shutdown.
- macOS and Linux can use the same CLI with POSIX paths, for example
  `pharo-nexus init ~/dev/pharo-nexus` and `pharo-nexus project import
  ~/dev/code/MyProject`. Use `export PHARO_NEXUS_HOME=~/dev/pharo-nexus` when
  setting a default home in a shell profile.
- Local Vibe backend startup on macOS/Linux assumes Docker Engine or Docker
  Desktop can run Compose with Buildx. DinD mode requires permission to start
  privileged containers.
- PLexus gateway startup assumes `tools.plexus.command` resolves on that OS.
  Use an absolute command path in `pharo-nexus.home.json` if `plexus-gateway`
  is not on `PATH`.
- MCP config installation assumes the executor can connect to loopback HTTP
  endpoints such as `http://127.0.0.1:7330/mcp`. After changing MCP config,
  open a fresh Codex/Vibe executor session so tools are reloaded.

The PharoNexus home and project model is OS-neutral. OS-specific behavior
belongs in orchestration adapters and helpers for process supervision, browser
opening, Docker/Vibe backend startup, and MCP config generation.

Initialize the default home:

```powershell
pharo-nexus init
```

On macOS or Linux:

```bash
pharo-nexus init ~/dev/pharo-nexus
```

For guided setup:

```powershell
pharo-nexus init --interactive
```

By default this creates `~\.pharo-nexus`. To use a different home, either pass
the path to each command or set `PHARO_NEXUS_HOME`:

```powershell
$env:PHARO_NEXUS_HOME = "C:\dev\code\.pharo-nexus"
pharo-nexus init
```

```bash
export PHARO_NEXUS_HOME=~/dev/pharo-nexus
pharo-nexus init
```

Before starting, check `~\.pharo-nexus\pharo-nexus.home.json` if PLexus is not
on `PATH`. The default tool entry is:

```json
{
  "tools": {
    "plexus": {
      "command": "plexus-gateway",
      "args": []
    }
  }
}
```

Start the environment:

```powershell
pharo-nexus start
```

This starts the configured Vibe backend, starts Vibe Kanban, starts the PLexus
gateway, creates and links the PharoNexus control project, ensures the
`PharoNexus` Kanban board exists, opens Vibe Kanban once healthy, and installs
the `pharo_nexus` and `plexus` MCP servers into the configured Vibe Kanban
executor. The installed MCP entries connect to the supervised local HTTP
endpoints; coding agents do not need to spawn `pharo-nexus` or `plexus-gateway`
from `PATH`.

For PharoNexus-managed self-hosted backends, startup also signs the local Vibe
app in with the generated `SELF_HOST_LOCAL_AUTH_EMAIL` and
`SELF_HOST_LOCAL_AUTH_PASSWORD` from `.env.remote` when it is not already
signed in.

Open Vibe Kanban at:

```text
http://127.0.0.1:3000
```

Use the PharoNexus control project to ask agents to create or import real Pharo
projects. Example task:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

Agent contract: tasks like this should be handled by calling
`pharo_nexus_project_create`, not by manually creating folders or editing config
files.

After PharoNexus creates a real project, use that project's Kanban board for
feature work. Example issue:

```text
Plan persistence support for MyLibrary
```

Vibe agents should work those issues in isolated Vibe workspaces. PLexus will
later attach Pharo runtime images to those workspaces.

Check status or stop everything:

```powershell
pharo-nexus status --check-health
pharo-nexus stop
```

## Model

```text
PharoNexus           1:N  Vibe Kanban / PLexus projects
Vibe Kanban project  1:1  PLexus project

PLexus project       1:N  PLexus workspaces
PLexus workspace     1:1  runtime target
runtime target       1:N  Pharo images
```

## Development

```powershell
npm install
npm run build
npm test
```

Current CLI:

```powershell
pharo-nexus --help
pharo-nexus init
pharo-nexus start
pharo-nexus status --check-health
pharo-nexus stop
pharo-nexus mcp
pharo-nexus project create MyProject --git-init
pharo-nexus project create MyProject --from https://github.com/example/MyProject.git
pharo-nexus project import C:\dev\code\git\ExistingProject --name ExistingProject
pharo-nexus codex init C:\dev\code\git\ExistingProject
pharo-nexus codex doctor C:\dev\code\git\ExistingProject
pharo-nexus project link-kanban my-project --vibe-project-id <id>
pharo-nexus project sync-kanban my-project
pharo-nexus project list
pharo-nexus project status MyProject
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

By default, PharoNexus uses `PHARO_NEXUS_HOME`, then `~\.pharo-nexus`.

`init` creates `pharo-nexus.home.json` and the initial runtime directories:

```text
~\.pharo-nexus\
  pharo-nexus.home.json
  PharoNexus\
    pharo-nexus.project.json
    worktrees\
  projects\
  workspaces\
  state\plexus\
  logs\
  generated\
```

The `PharoNexus` directory is a reserved PharoNexus project. It is the Vibe
Kanban project where the user asks agents to create, import, and manage other
Pharo projects.

Its project config is:

```json
{
  "version": 1,
  "id": "pharo-nexus-control",
  "name": "PharoNexus",
  "home": null,
  "repo": {
    "kind": "local",
    "remoteUrl": null,
    "defaultBranch": null
  },
  "plexusProjectConfig": "plexus.project.json",
  "worktreesRoot": "worktrees",
  "kanban": {
    "provider": "vibe-kanban",
    "projectId": null
  }
}
```

General PharoNexus project configs use the same shape:

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
  "plexusProjectConfig": "plexus.project.json",
  "worktreesRoot": "worktrees",
  "kanban": {
    "provider": "vibe-kanban",
    "projectId": null
  }
}
```

`plexusProjectConfig` and `worktreesRoot` are resolved relative to the project
directory.

The generated home config includes default Vibe Kanban MCP integration settings:

```json
{
  "ports": {
    "vibeKanban": 3000,
    "pharoNexusMcp": 7330,
    "plexusMcp": 7331
  },
  "mcp": {
    "host": "127.0.0.1"
  },
  "tools": {
    "pharoNexus": {
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "args": ["C:\\dev\\code\\git\\PharoNexus\\dist\\cli.js", "mcp"]
    },
    "vibeKanban": {
      "command": "npx",
      "args": ["-y", "vibe-kanban@0.1.43"]
    },
    "plexus": {
      "command": "plexus-gateway",
      "args": []
    }
  },
  "controlProject": {
    "id": "pharo-nexus-control",
    "name": "PharoNexus",
    "root": "C:\\Users\\you\\.pharo-nexus\\PharoNexus",
    "vibeKanbanProjectId": null,
    "vibeKanbanRepoId": null
  },
  "integrations": {
    "vibeKanban": {
      "executor": "CODEX",
      "pharoNexusMcpServerName": "pharo_nexus",
      "plexusMcpServerName": "plexus",
      "installMcpOnStart": true,
      "openBrowserOnStart": true,
      "backend": {
        "mode": "docker",
        "sharedApiBase": "http://127.0.0.1:3100",
        "healthPath": "/v1/health",
        "sourceRepositoryUrl": "https://github.com/BloopAI/vibe-kanban.git",
        "autoBootstrap": true,
        "composeCommand": "auto",
        "composeArgs": [],
        "composeFile": "C:\\Users\\you\\.pharo-nexus\\vibe-kanban\\crates\\remote\\docker-compose.yml",
        "envFile": "C:\\Users\\you\\.pharo-nexus\\vibe-kanban\\crates\\remote\\.env.remote",
        "projectName": "pharo-nexus-vibe",
        "workingDirectory": "C:\\Users\\you\\.pharo-nexus\\vibe-kanban\\crates\\remote",
        "startOnPharoNexusStart": true,
        "stopOnPharoNexusStop": true
      }
    }
  }
}
```

The generated `tools.pharoNexus` command uses the current Node executable and
an absolute `dist\cli.js` path so PharoNexus can supervise its control MCP
service without a global `pharo-nexus` shim.

Use flags when those paths or ports should live elsewhere:

```powershell
pharo-nexus init C:\dev\pharo-nexus `
  --projects-root C:\dev\code\git `
  --workspaces-root C:\dev\code\git\.vibe-kanban-workspaces `
  --plexus-state-root C:\dev\code\git\.plexus-state `
  --vibe-kanban-port 3000 `
  --plexus-mcp-port 7331
```

For guided setup, use:

```powershell
pharo-nexus init --interactive
```

`init` prints a human-readable summary by default. Use `--json` when scripting:

```powershell
pharo-nexus init C:\dev\pharo-nexus --json
```

## Start Everything

`pharo-nexus start` is the first top-level orchestration command. It:

- loads `pharo-nexus.home.json`
- starts the Vibe shared backend first when `integrations.vibeKanban.backend.mode` is `docker` or `dind`
- starts the configured Vibe Kanban process unless it is already running; new
  homes pin the local app to `vibe-kanban@0.1.43`, because `0.1.44` routes
  project pages to an export-only sunset screen
- injects `VK_SHARED_API_BASE` so Vibe Kanban uses the configured shared backend
- waits for Vibe Kanban to answer on the configured port
- signs into the local Vibe app with self-hosted local auth credentials from the managed backend env file when available
- starts the configured PLexus gateway process unless it is already running
- ensures the reserved control project exists
- registers the control project repo with Vibe Kanban when no repo id is stored yet
- ensures the Vibe Kanban board named `PharoNexus` exists and stores its project id
- opens the `PharoNexus` board in the browser unless disabled; if the stock Vibe
  Kanban app just opened a browser tab itself, PharoNexus skips its own duplicate open
- installs the PharoNexus and PLexus MCP server entries into Vibe Kanban using the configured executor unless disabled

The CLI prints progress messages to stderr, for example when cloning Vibe
Kanban, generating `.env.remote`, starting Docker Compose, waiting for health
checks, opening the browser, and installing MCP config. The final structured
JSON result remains on stdout.

Run it from any directory:

```powershell
pharo-nexus start
```

Or pass the home explicitly:

```powershell
pharo-nexus start C:\dev\pharo-nexus --executor CODEX
```

Useful options:

```text
--force                       restart already-running managed services
--executor <name>             install MCP config for a Vibe Kanban executor
--server-name <name>          PLexus MCP server name to write, defaults to plexus
--skip-mcp-config             start services without touching Vibe Kanban MCP config
--no-open-browser             do not open Vibe Kanban after startup
--vibe-health-timeout-ms <ms> Vibe Kanban startup wait timeout
```

If no home is passed, PharoNexus uses `PHARO_NEXUS_HOME`, then `~\.pharo-nexus`.

## Codex Workspace Setup

PharoNexus owns service startup. Codex workspace config should connect to the
stable local endpoints that `pharo-nexus start` supervises, rather than spawning
new `pharo-nexus` or `plexus-gateway` processes per chat.

For a fresh project workspace:

```powershell
pharo-nexus start
pharo-nexus codex init C:\dev\code\git\MyProject
pharo-nexus codex doctor C:\dev\code\git\MyProject
```

Open a new Codex chat from that workspace after doctor passes. Existing chats
may keep the MCP tool list they loaded at startup.

`pharo-nexus codex init <workspace>` writes or updates
`<workspace>\.codex\config.toml`. The command preserves unrelated Codex settings
and unrelated MCP servers. It replaces only the PharoNexus-managed
`pharo_nexus`, `plexus`, and `vibe_kanban` sections. `pharo_nexus` and `plexus`
are URL-based entries that connect to the supervised local MCP endpoints started
by `pharo-nexus start`. `vibe_kanban` remains a pinned command entry for Vibe
Kanban's own MCP mode.

Doctor checks that the managed config sections exist, then checks health,
MCP `initialize`, `tools/list`, and expected tool names for the supervised
PharoNexus and PLexus endpoints. Use `--json` for machine-readable output.

Migration for an existing workspace is the same command: run `codex init` in the
workspace to replace the old managed `pharo_nexus`, `plexus`, and `vibe_kanban`
entries while preserving unrelated settings. Then run `codex doctor` and start a
fresh chat.

Troubleshooting:

- Missing `pharo_nexus` or `plexus` tools: run `pharo-nexus codex doctor
  <workspace>`. If config checks pass, open a fresh Codex chat or restart the
  executor session so it reloads MCP config.
- Health check failures or unavailable ports: run `pharo-nexus status
  --check-health`, then `pharo-nexus start` if the supervised services are not
  running. If a port is occupied by another process, update the port in
  `pharo-nexus.home.json` or stop the conflicting process, then rerun
  `codex init`.
- MCP handshake failures: check the service logs under `<home>\logs\` and make
  sure the URL in `.codex\config.toml` matches the configured host and ports.
- Missing expected tools after a successful handshake: rebuild and restart
  PharoNexus, then rerun doctor. The service may be older than the workspace
  config.
- Command fallback mode is only for MCP clients without URL support. Use the
  current Node executable and an absolute PharoNexus entrypoint, for example
  `node C:\dev\code\git\PharoNexus\dist\cli.js mcp-stdio`; do not use a bare
  `pharo-nexus` package-bin name in long-lived generated config.

## Agent Model Configuration

PharoNexus owns agent model selection for Kanban-started work. PLexus and the
PLexus gateway should not know which coding agent model or reasoning profile is
chosen.

Project defaults live in `pharo-nexus.project.json`:

```json
{
  "agent": {
    "executor": "CODEX",
    "model": "gpt-5.3-codex",
    "reasoning": "high"
  }
}
```

Home-level defaults may live in `pharo-nexus.home.json` with the same shape.
When PharoNexus starts work from a Kanban issue, the intended precedence is:

1. issue-level override
2. project `agent` defaults
3. home `agent` defaults
4. executor profile fallback from Vibe/Codex

Issue-level overrides are reserved for the workspace-start path and may come
from structured issue fields, tags such as `model:gpt-5.3-codex`, or an explicit
future MCP argument. The config model and resolver are in PharoNexus now so that
future Vibe workspace creation can pass the resolved executor/model/reasoning
without hardcoding a global Codex profile.

### Vibe Backend Modes

Vibe Kanban's project and issue data live in its shared backend. PharoNexus
supports three backend modes:

```json
{
  "integrations": {
    "vibeKanban": {
      "backend": {
        "mode": "docker",
        "sharedApiBase": "http://127.0.0.1:3100",
        "healthPath": "/v1/health",
        "sourceRepositoryUrl": "https://github.com/BloopAI/vibe-kanban.git",
        "autoBootstrap": true,
        "composeCommand": "auto",
        "composeFile": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote\\docker-compose.yml",
        "envFile": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote\\.env.remote",
        "projectName": "pharo-nexus-vibe",
        "workingDirectory": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote",
        "startOnPharoNexusStart": true,
        "stopOnPharoNexusStop": true
      }
    }
  }
}
```

`autoBootstrap: true` means the user does not need to clone Vibe Kanban by
hand. If `<home>\vibe-kanban\crates\remote` is missing, PharoNexus runs
`git clone --depth 1 https://github.com/BloopAI/vibe-kanban.git <home>\vibe-kanban`.
If `.env.remote` is missing, PharoNexus generates a local-only file with fresh
secrets and bootstrap local-auth credentials.

For GitHub sign-in, Vibe Kanban needs a GitHub OAuth app, not only normal Git
credentials. When these environment variables are present, PharoNexus writes
them into the generated backend env and Vibe can offer GitHub login:

```powershell
$env:PHARO_NEXUS_GITHUB_OAUTH_CLIENT_ID = "<github-oauth-client-id>"
$env:PHARO_NEXUS_GITHUB_OAUTH_CLIENT_SECRET = "<github-oauth-client-secret>"
```

If `.env.remote` already exists and those GitHub fields are still empty,
`pharo-nexus start` fills them from the same environment variables before
starting the backend. Existing `git config user.email` is used only as an
identity hint for the fallback local-auth email; Git config cannot provide the
OAuth client secret.

`composeCommand: "auto"` tries `docker compose` first, then `docker-compose`.
PharoNexus runs Git and Compose with argv arrays and never shells a concatenated
command. It sets `DOCKER_BUILDKIT=1` and `COMPOSE_DOCKER_CLI_BUILD=1` for the
Compose build because Vibe's Dockerfile needs BuildKit/buildx features. Because
PharoNexus runs the Vibe local app on port 3000 by default, the generated
backend env exposes the shared backend on port 3100 with
`REMOTE_SERVER_PORTS=127.0.0.1:3100:8081`.

For hosts where Vibe must be composed inside an isolated Linux Docker daemon,
use `dind` mode:

```json
{
  "integrations": {
    "vibeKanban": {
      "backend": {
        "mode": "dind",
        "sharedApiBase": "http://127.0.0.1:3100",
        "healthPath": "/v1/health",
        "sourceRepositoryUrl": "https://github.com/BloopAI/vibe-kanban.git",
        "sourceRoot": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban",
        "autoBootstrap": true,
        "dockerCommand": "docker",
        "dindImage": "docker:29-dind",
        "containerName": "pharo-nexus-vibe-dind",
        "dataVolume": "pharo-nexus-vibe-dind-data",
        "projectName": "pharo-nexus-vibe",
        "composeFile": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote\\docker-compose.yml",
        "envFile": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote\\.env.remote",
        "workingDirectory": "C:\\dev\\code\\.pharo-nexus\\vibe-kanban\\crates\\remote",
        "containerSourceRoot": "/workspace/vibe-kanban",
        "containerWorkingDirectory": "/workspace/vibe-kanban/crates/remote",
        "containerComposeFile": "/workspace/vibe-kanban/crates/remote/docker-compose.yml",
        "containerEnvFile": "/workspace/vibe-kanban/crates/remote/.env.remote",
        "startOnPharoNexusStart": true,
        "stopOnPharoNexusStop": true
      }
    }
  }
}
```

PharoNexus starts a privileged `docker:dind` container, bind-mounts the Vibe
checkout into it, waits for the inner Docker daemon, then runs
`docker compose up -d --build` inside that container. The generated env file for
new DinD homes exposes the inner remote server with
`REMOTE_SERVER_PORTS=0.0.0.0:3100:8081`; PharoNexus publishes the DinD
container's port 3100 back to `127.0.0.1:3100` on the host.

For a remote or manually managed backend, use:

```json
{
  "integrations": {
    "vibeKanban": {
      "backend": {
        "mode": "external",
        "sharedApiBase": "https://kanban.example.com",
        "healthPath": "/v1/health",
        "startOnPharoNexusStart": false,
        "stopOnPharoNexusStop": false
      }
    }
  }
}
```

## Status And Stop

`pharo-nexus status` reports the Vibe backend, Vibe Kanban, and PLexus gateway:

```powershell
pharo-nexus status C:\dev\pharo-nexus --check-health
```

It returns each service state, whether the environment is running, whether any persisted state is stale, and optional HTTP health checks.

`pharo-nexus stop` shuts down Vibe Kanban first, then the PLexus gateway, then
the Vibe backend if `stopOnPharoNexusStop` is true:

```powershell
pharo-nexus stop C:\dev\pharo-nexus
```

Useful options:

```text
status:
  --check-health              check HTTP health for running services
  --health-timeout-ms <ms>    per-service health check timeout

stop:
  --force                     force process-tree shutdown when supported
  --timeout-ms <ms>           process shutdown timeout
  --poll-interval-ms <ms>     process shutdown polling interval
```

## Project Creation

Create a new Pharo project from scratch:

```powershell
pharo-nexus project create MyProject --git-init
```

Clone an existing Git repository:

```powershell
pharo-nexus project create MyProject --from https://github.com/example/MyProject.git
```

Import an existing local Git repository:

```powershell
pharo-nexus project import C:\dev\code\git\PharoNexus --name MetaPharoNexus
```

Use `--root` to choose the exact project root. Otherwise PharoNexus creates the
project under `paths.projectsRoot` from `pharo-nexus.home.json`.

```powershell
pharo-nexus project create MyProject --git-init --root C:\dev\code\git\MyProject
```

The command:

- runs `git init` or `git clone`
- writes `pharo-nexus.project.json`
- writes a minimal `plexus.project.json`
- creates `worktrees\`
- registers the project in `pharo-nexus.home.json`

If the Vibe Kanban project already exists, pass its id while creating:

```powershell
pharo-nexus project create MyProject --git-init --vibe-project-id <id>
```

If Vibe Kanban is running and reachable, PharoNexus can sync both Vibe records:
the local repo registration used by Vibe workspaces and the Kanban project/board
used for issues:

```powershell
pharo-nexus project create MyProject --git-init --sync-vibe-kanban
pharo-nexus project import C:\dev\code\git\PharoNexus --name MetaPharoNexus --sync-vibe-kanban
pharo-nexus project sync-kanban my-project
```

By default it prints a human summary plus the structured JSON payload. Use
`--json` for machine-only output.

List registered projects:

```powershell
pharo-nexus project list
```

Inspect one project by id or path:

```powershell
pharo-nexus project status my-project
pharo-nexus project status C:\dev\code\git\MyProject
```

Link a project to Vibe Kanban after the Vibe project is created:

```powershell
pharo-nexus project link-kanban my-project --vibe-project-id <id>
pharo-nexus project link-kanban C:\dev\code\git\MyProject --vibe-project-id <id>
```

This updates `pharo-nexus.project.json`, `plexus.project.json`, and the home
project registry. `sync-kanban` registers the local repository with Vibe Kanban
via `POST /api/repos`, ensures a Vibe project/board exists, stores the repo id
as `vibeKanbanRepoId`, and stores the board id as `vibeKanbanProjectId`.

The list and status commands report:

- project id, name, and root
- repo origin and default branch from `pharo-nexus.project.json`
- linked Vibe Kanban project/board id when known
- Vibe Kanban repo registration id when known
- resolved `plexus.project.json` path
- resolved worktrees root

Use `--home <path>` to target a non-default PharoNexus home and `--json` for
machine-only output.

## PharoNexus MCP Server

PharoNexus exposes project-management tools over a local HTTP MCP endpoint:

```powershell
pharo-nexus mcp
```

`pharo-nexus start` supervises this HTTP MCP service automatically and installs
a URL-based MCP entry for Vibe Kanban/Codex. `pharo-nexus mcp-stdio` remains as
an explicit compatibility command for clients that cannot use HTTP yet.

The MCP server tools are:

```text
pharo_nexus_project_create
pharo_nexus_project_import
pharo_nexus_project_link_kanban
pharo_nexus_project_sync_kanban
pharo_nexus_project_list
pharo_nexus_project_status
```

### Control Board Prompt Contract

From the Vibe Kanban `PharoNexus` board, the user can write:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

The agent should call `pharo_nexus_project_create` with:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://github.com/me/MyLibrary.git"
}
```

The agent should not manually create the project directory, hand-edit
`pharo-nexus.project.json`, or create the Vibe Kanban board directly for this
case. PharoNexus owns that workflow so Git, PLexus config, worktrees, Vibe repo
registration, Vibe board creation, and the home registry stay consistent.

### Project Board Feature Contract

After a PharoNexus project exists, its own Vibe Kanban board is the place for
feature planning and implementation work.

In a project's Kanban board, the user can create issues like:

```text
Plan persistence support for MyLibrary
```

The Vibe agent should treat that issue as work inside the project's repository,
using Vibe Kanban's isolated workspace for the issue. The agent should plan,
edit, test, and report from that workspace according to the issue scope.

PharoNexus does not create a second project for these issues. PLexus later
handles the Pharo side of the runtime: opening the matching PLexus workspace,
starting or stopping the configured Pharo image(s), and routing Pharo MCP calls
to the image(s) assigned to that workspace.

The first usable control-board flow is:

```powershell
pharo-nexus init
pharo-nexus start
```

Then create a task in the Vibe Kanban PharoNexus control project, for example:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

An agent can satisfy it by calling:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://github.com/me/MyLibrary.git"
}
```

through `pharo_nexus_project_create`. PharoNexus clones the repository under
`<home>\projects\MyLibrary`, writes `pharo-nexus.project.json`, writes
`plexus.project.json`, creates `worktrees\`, registers the local repo with Vibe,
ensures a Kanban board exists, and stores both ids in the home config for later
kanban, worktree, and runtime orchestration.

MCP create/import calls sync Vibe Kanban by default when no explicit
`vibeKanbanProjectId` is provided. Pass `syncVibeKanban: false` for a local-only
operation.

Configure it in an MCP client with:

```json
{
  "mcpServers": {
    "pharo_nexus": {
      "type": "http",
      "url": "http://127.0.0.1:7330/mcp"
    }
  }
}
```

This is the MCP server that Codex agents should use from the PharoNexus control
project to create or import real Pharo project repositories.

## Process Supervisor

PharoNexus includes low-level supervisor primitives in `src/processSupervisor.ts`:

- `startManagedProcess(...)`: starts a command with argv args, captures its pid, and writes stdout/stderr/lifecycle logs
- `stopProcessByPid(...)`: stops a running process by pid, using Windows process-tree shutdown when needed
- `checkHttpPort(...)`: checks whether an HTTP endpoint on a port answers with a healthy status
- `waitForHttpPort(...)`: polls an HTTP port until healthy or timed out

## PLexus Gateway Service

`src/plexusGatewayService.ts` manages the configured PLexus gateway process:

- starts `tools.plexus.command` with `tools.plexus.args`
- writes logs under `<home>\logs\plexus-gateway`
- writes service state under `<home>\state\services\plexus-gateway.json`
- injects `PHARO_NEXUS_HOME`, `PLEXUS_HOST`, `PLEXUS_STATE_ROOT`, `PLEXUS_MCP_PORT`, and `PORT`
- stops the service by persisted pid
- optionally checks HTTP health on the configured PLexus MCP port

## Vibe Kanban Backend Service

`src/vibeKanbanBackendService.ts` manages the shared Vibe backend configured in
`integrations.vibeKanban.backend`:

- `docker` mode starts and stops Docker Compose with `--env-file`, `-f`, and `-p`
- `dind` mode starts a privileged `docker:dind` container and runs Docker Compose
  inside it
- if the default Vibe checkout is missing, clones the official Vibe Kanban repo into `<home>\vibe-kanban`
- if `.env.remote` is missing, generates local secrets and bootstrap local-auth settings
- `external` mode records and health-checks a backend that PharoNexus does not own
- command output is captured in backend state and logs under `<home>\logs\vibe-kanban-backend`
- state is written under `<home>\state\services\vibe-kanban-backend.json`
- health checks call `sharedApiBase + healthPath`

Useful direct commands:

```powershell
pharo-nexus vibe-backend start C:\dev\pharo-nexus
pharo-nexus vibe-backend status C:\dev\pharo-nexus --check-health
pharo-nexus vibe-backend stop C:\dev\pharo-nexus
```

## Vibe Kanban Service

`src/vibeKanbanService.ts` manages the configured Vibe Kanban process:

- starts `tools.vibeKanban.command` with `tools.vibeKanban.args`
- defaults to `npx -y vibe-kanban@0.1.43` so the project board UI stays
  available while the upstream `0.1.44` package sunsets project routes
- writes logs under `<home>\logs\vibe-kanban`
- writes service state under `<home>\state\services\vibe-kanban.json`
- injects `PHARO_NEXUS_HOME`, `PORT`, `HOST`, `MCP_HOST`, `MCP_PORT`, and `VK_SHARED_API_BASE`
- stops the service by persisted pid
- optionally checks HTTP health on the configured Vibe Kanban port

## Vibe Kanban MCP Adapter

Vibe Kanban configures MCP servers per coding agent. Its UI shows the familiar MCP shape:

```json
{
  "mcpServers": {
    "my_custom_server": {
      "command": "node",
      "args": ["/path/to/my-server.js"]
    }
  }
}
```

Its local REST API exposes the same concept through:

```text
GET  /api/mcp-config?executor=CODEX
POST /api/mcp-config?executor=CODEX
```

The POST body uses a `servers` map:

```json
{
  "servers": {
    "pharo_nexus": {
      "type": "http",
      "url": "http://127.0.0.1:7330/mcp"
    },
    "plexus": {
      "type": "http",
      "url": "http://127.0.0.1:7331/mcp"
    }
  }
}
```

`src/vibeKanbanMcpConfig.ts` implements that adapter. It reads existing Vibe Kanban MCP servers for an executor, preserves them, adds or replaces the PharoNexus and PLexus server entries, and posts the merged map back.

```powershell
pharo-nexus vibe-kanban mcp-config install C:\dev\pharo-nexus --executor CODEX
```

Use `--dry-run` to preview the merged server map without posting it.

## Vibe Kanban Project And Repo Adapter

PharoNexus uses two Vibe Kanban concepts:

- a Vibe repo, tracked as `controlProject.vibeKanbanRepoId`, so Vibe workspaces can use the local `PharoNexus` directory
- a Vibe project/board, tracked as `controlProject.vibeKanbanProjectId`, so the user has a Kanban board named `PharoNexus`

Real Pharo projects use the same split in the home `projects` registry:
`vibeKanbanRepoId` is Vibe's local repo registration id and
`vibeKanbanProjectId` is the Kanban board id written into
`pharo-nexus.project.json` and `plexus.project.json`.

`pharo-nexus start` ensures both exist for the control project.
`pharo-nexus project sync-kanban` does the same for a real project. Board
creation uses Vibe Kanban's local login session to call its shared project API,
matching the behavior of Vibe's own Create Project dialog.

## Initial Roadmap

1. Add user-level default executor configuration.
2. Add project registration commands.
