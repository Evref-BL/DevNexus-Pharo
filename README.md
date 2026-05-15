# PharoNexus

PharoNexus is the user-environment orchestrator above Vibe Kanban and PLexus.
It starts the local service graph, keeps project metadata consistent, and gives
agents MCP tools for creating and managing Pharo projects.

PharoNexus owns:

- the user-level PharoNexus home
- Vibe Kanban backend and local app startup
- the PLexus gateway startup
- Codex/Vibe MCP configuration for PharoNexus and PLexus
- PharoNexus project creation, import, registry, work tracking, and local
  Codex worktree metadata

PLexus owns Pharo runtime/project/workspace behavior. pharo-launcher-mcp owns
PharoLauncher access.

## Requirements

- Node.js 24 or newer, with `npm` and `npx`
- Git
- Docker when using the local Vibe backend
- a working PLexus gateway command, usually `plexus-gateway`

Windows examples use PowerShell and `C:\...` paths. macOS and Linux can use the
same commands with POSIX paths.

## Install From Source

```powershell
cd C:\dev\code\git\PharoNexus
npm install
npm run build
npm link
```

`npm link` exposes `pharo-nexus` in new terminals. Without a global link, run
the built CLI directly:

```powershell
node C:\dev\code\git\PharoNexus\dist\cli.js --help
```

## Initialize A Home

```powershell
pharo-nexus init
```

By default, PharoNexus uses `PHARO_NEXUS_HOME`, then `~\.pharo-nexus`. To use a
specific home:

```powershell
$env:PHARO_NEXUS_HOME = "C:\dev\code\.pharo-nexus"
pharo-nexus init
```

```bash
export PHARO_NEXUS_HOME=~/dev/pharo-nexus
pharo-nexus init
```

For guided setup:

```powershell
pharo-nexus init --interactive
```

If `plexus-gateway` is not on `PATH`, edit the generated
`pharo-nexus.home.json` and set `tools.plexus.command` to an absolute path.

## Start And Stop

```powershell
pharo-nexus start
```

This starts the configured Vibe backend, Vibe Kanban, the PharoNexus MCP
service, and the PLexus gateway. It also creates and links the reserved
`PharoNexus` control board, opens Vibe Kanban when healthy, and installs
`pharo_nexus` and `plexus` MCP entries into the configured Vibe executor.

Open Vibe Kanban at:

```text
http://127.0.0.1:3000
```

Check status or stop the environment:

```powershell
pharo-nexus status --check-health
pharo-nexus stop
```

Useful startup options:

```text
--force                       restart already-running managed services
--executor <name>             install MCP config for a Vibe Kanban executor
--server-name <name>          PLexus MCP server name, default: plexus
--skip-mcp-config             start services without changing Vibe MCP config
--no-open-browser             do not open Vibe Kanban after startup
--vibe-health-timeout-ms <ms> Vibe Kanban startup wait timeout
```

## Control Board Workflow

The `PharoNexus` Kanban board is the control board. Use it for environment and
project-management tasks, such as:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

Agents should satisfy that request with the PharoNexus MCP project factory, not
by manually creating folders or hand-editing project metadata.

After a project exists, use that project's own Kanban board for feature work.
Do not use the control board as the normal feature board for real projects.

## Create Or Import Projects

Create a new managed project:

```powershell
pharo-nexus project create MyProject --git-init
```

Create a project from a Git URL:

```powershell
pharo-nexus project create MyProject --from https://github.com/example/MyProject.git
```

Import an existing local source checkout without writing PharoNexus metadata
into that checkout:

```powershell
pharo-nexus project import C:\dev\code\git\ExistingProject --name ExistingProject
```

By default, PharoNexus creates the managed project root under
`paths.projectsRoot` from `pharo-nexus.home.json`. Use `--root` on
`project create` or `--project-root` on `project import` to choose a different
managed root.

Project creation writes the managed project files:

```text
<project-root>\
  .codex\config.toml
  AGENTS.md
  suggestedFirstPrompt.md
  pharo-nexus.project.json
  plexus.project.json
  worktrees\
```

For `project create --from`, the source repository is cloned under
`<project-root>\git`. For `project import <source-checkout>`, the managed
project points at the existing source checkout.

Configure provider-neutral work tracking for a project:

```powershell
pharo-nexus project configure-tracker MyProject --provider local --store-path .pharo-nexus\work-items.json
pharo-nexus project configure-tracker MyProject --provider github --repository-owner example --repository-name MyProject
pharo-nexus project configure-tracker MyProject --provider github --host github.enterprise.test --repository-owner example --repository-name MyProject
pharo-nexus project configure-tracker MyProject --provider gitlab --repository-id example/MyProject
pharo-nexus project configure-tracker MyProject --provider gitlab --host gitlab.enterprise.test --repository-id example/MyProject
```

The GitHub provider uses the GitHub Issues REST API. It reads credentials in
this order: explicit provider token from code, `GITHUB_TOKEN`, `GH_TOKEN`, then
`git credential fill`. If Git Credential Manager is configured as Git's
credential helper, cached GitHub or GitHub Enterprise tokens are reused through
that standard Git credential protocol. Automation calls use non-interactive
credential lookup by default with `GCM_INTERACTIVE=0` and
`GIT_TERMINAL_PROMPT=0`, so they fail instead of hanging if no cached credential
exists.

GitHub Projects v2 is optional. If the project config includes a
`workTracking.board` with `kind: "github-project-v2"` and a project node id,
new and status-updated GitHub issues are added to that project through
GitHub's GraphQL API. To map PharoNexus statuses to a Projects v2 single-select
Status field, configure the field node id and option ids:

```json
{
  "workTracking": {
    "provider": "github",
    "repository": {
      "owner": "example",
      "name": "MyProject"
    },
    "board": {
      "kind": "github-project-v2",
      "projectId": "PVT_project_node_id",
      "statusFieldId": "PVTSSF_status_field_id",
      "statusOptions": {
        "ready": "status_option_id",
        "in_progress": "status_option_id",
        "blocked": "status_option_id",
        "done": "status_option_id"
      }
    }
  }
}
```

GitHub requires those Project v2 project, field, and option node ids for GraphQL
updates. If `statusOptions` does not include a status, PharoNexus still adds
the issue to the project but skips the status-field update for that status.

The GitLab provider uses the GitLab project Issues and Notes REST APIs under
`/api/v4`. Configure `repository.id` as the GitLab project id or namespace path,
such as `example/MyProject`. It reads credentials in this order: explicit
provider token from code, `GITLAB_TOKEN`, `GL_TOKEN`, then `git credential fill`.
Credential-helper lookup is also non-interactive by default. GitLab write
operations that set assignees or milestones currently require numeric GitLab
assignee and milestone ids.

Existing local Vibe Kanban installations can still be used as a tracker
provider for board/repo registration:

```powershell
pharo-nexus project create MyProject --git-init --tracker-project-id <id>
pharo-nexus project create MyProject --git-init --sync-tracker
pharo-nexus project import C:\dev\code\git\ExistingProject --name ExistingProject --sync-tracker
pharo-nexus project link-tracker my-project --tracker-project-id <id>
pharo-nexus project sync-tracker my-project
```

List and inspect projects:

```powershell
pharo-nexus project list
pharo-nexus project status MyProject
pharo-nexus project status C:\dev\code\pharo-nexus\MyProject
```

Use `--json` for machine-readable output.

## Codex Workspace Setup

PharoNexus-managed Codex workspaces should connect to the supervised local MCP
endpoints started by `pharo-nexus start`.

```powershell
pharo-nexus start
pharo-nexus codex init C:\dev\code\pharo-nexus\MyProject
pharo-nexus codex doctor C:\dev\code\pharo-nexus\MyProject
```

Open a fresh Codex chat from that workspace after `codex doctor` passes. A
running chat may keep the MCP tool list it loaded at startup.

`codex init` preserves unrelated Codex settings and unrelated MCP servers. It
replaces only the PharoNexus-managed `pharo_nexus`, `plexus`, and
`vibe_kanban` entries.

## MCP Server

`pharo-nexus start` supervises the HTTP MCP endpoint automatically. For direct
MCP server use:

```powershell
pharo-nexus mcp
```

Compatibility mode for clients without URL MCP support:

```powershell
pharo-nexus mcp-stdio
```

PharoNexus exposes these project-management tools:

```text
project_create
project_import
project_configure_tracker
project_link_tracker
project_sync_tracker
project_list
project_status
work_item_create
work_item_list
work_item_get
work_item_update
work_item_comment
work_item_set_status
codex_worktree_prepare
codex_worktree_guide
codex_worktree_list
codex_worktree_status
codex_worktree_record_execution
codex_worktree_archive
```

## Configuration Notes

Vibe backend modes are configured in `pharo-nexus.home.json`:

- `docker`: local self-hosted Vibe backend through Docker Compose
- `dind`: local self-hosted Vibe backend inside a Docker-in-Docker container
- `external`: remote or manually managed Vibe backend

For GitHub sign-in with the self-hosted Vibe backend, set GitHub OAuth
credentials before startup:

```powershell
$env:PHARO_NEXUS_GITHUB_OAUTH_CLIENT_ID = "<github-oauth-client-id>"
$env:PHARO_NEXUS_GITHUB_OAUTH_CLIENT_SECRET = "<github-oauth-client-secret>"
```

## Troubleshooting

- Missing `pharo_nexus` or `plexus` tools: run `pharo-nexus codex doctor
  <workspace>`, then open a fresh Codex chat after the checks pass.
- Service health failures: run `pharo-nexus status --check-health`, inspect
  logs under `<home>\logs\`, then rerun `pharo-nexus start`.
- Port conflicts: update the ports in `pharo-nexus.home.json` or stop the
  conflicting process, then rerun `pharo-nexus codex init <workspace>`.
- MCP handshake failures: make sure `.codex\config.toml` points at the
  configured host and ports, and that `pharo-nexus start` is running.
- Command fallback mode should use the current Node executable and an absolute
  PharoNexus CLI entrypoint, not a bare `pharo-nexus` package-bin name.

## More Documentation

- [Architecture](docs/architecture.md) covers system boundaries and design.
- [Development](docs/development.md) covers contributor commands and internal
  service implementation notes.
