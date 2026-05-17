# DevNexus-Pharo

DevNexus-Pharo is the Pharo plugin and user-environment layer for DevNexus. It
starts the local service graph, keeps project metadata consistent, and gives
agents MCP tools for creating and managing Pharo projects without replacing
DevNexus as the generic project, work-item, worktree, and target infrastructure.

DevNexus-Pharo owns:

- the user-level DevNexus-Pharo home
- Vibe Kanban backend and local app startup
- the PLexus gateway startup
- Codex/Vibe MCP configuration for DevNexus-Pharo, PLexus, and the projected Pharo
  MCP facade
- Pharo-oriented project creation/import helpers, home registry integration, and
  compatibility wrappers around older local Codex worktree metadata
- the DevNexus plugin declaration that contributes Pharo skills, scoped PLexus
  setup obligations, Pharo MCP projection, worker briefing fragments, and
  cleanup expectations for Pharo-capable agents

The bundled Pharo skills include DevNexus-Pharo workflow guidance plus copied
MCP-Pharo domain guidance for Pharo CI reproduction, image Git handoff, project
loading, and Pharo version compatibility. The MCP-Pharo copies are support
material projected under `.dev-nexus/skills`; MCP-Pharo remains the source for
image-side MCP server behavior and image-owned repository operations.

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
cd C:\dev\code\git\DevNexus-Pharo
npm install
npm run build
npm link
```

`npm link` exposes `dev-nexus-pharo` in new terminals. Without a global link, run
the built CLI directly:

```powershell
node C:\dev\code\git\DevNexus-Pharo\dist\cli.js --help
```

## Initialize A Home

```powershell
dev-nexus-pharo init
```

By default, DevNexus-Pharo uses `DEV_NEXUS_PHARO_HOME`, then `~\.dev-nexus-pharo`. To use a
specific home:

```powershell
$env:DEV_NEXUS_PHARO_HOME = "C:\dev\code\.dev-nexus-pharo"
dev-nexus-pharo init
```

```bash
export DEV_NEXUS_PHARO_HOME=~/dev/dev-nexus-pharo
dev-nexus-pharo init
```

For guided setup:

```powershell
dev-nexus-pharo init --interactive
```

If `plexus-gateway` is not on `PATH`, edit the generated
`dev-nexus.home.json` and set `tools.plexus.command` to an absolute path.

## Start And Stop

```powershell
dev-nexus-pharo start
```

This starts the configured Vibe backend, Vibe Kanban, the DevNexus-Pharo MCP
service, and the PLexus gateway. It also creates and links the reserved
`DevNexus-Pharo` control board, opens Vibe Kanban when healthy, and installs
`dev_nexus_pharo` and `plexus` MCP entries into the configured Vibe executor.

Open Vibe Kanban at:

```text
http://127.0.0.1:3000
```

Check status or stop the environment:

```powershell
dev-nexus-pharo status --check-health
dev-nexus-pharo stop
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

The `DevNexus-Pharo` Kanban board is the control board. Use it for environment and
project-management tasks, such as:

```text
Create a new Pharo project named MyLibrary from https://github.com/me/MyLibrary.git
```

Agents should satisfy that request with the DevNexus-Pharo MCP project factory, not
by manually creating folders or hand-editing project metadata.

After a project exists, use that project's own Kanban board for feature work.
Do not use the control board as the normal feature board for real projects.

## Create Or Import Projects

Create a new managed project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Create a project from a Git URL:

```powershell
dev-nexus-pharo project create MyProject --from https://github.com/example/MyProject.git
```

Import an existing local source checkout without writing DevNexus-Pharo metadata
into that checkout:

```powershell
dev-nexus-pharo project import C:\dev\code\git\ExistingProject --name ExistingProject
```

Inspect or refresh generated DevNexus support skills for a managed project:

```powershell
dev-nexus-pharo project skills status MyProject
dev-nexus-pharo project skills refresh MyProject
```

Managed DevNexus-Pharo projects receive copied support skills under
`.dev-nexus\skills`, including the MCP-Pharo-derived `pharo-ci-repro`,
`pharo-image-git-handoff`, `pharo-project-load`, and
`pharo-version-compat` skills. DevNexus-Pharo records the upstream MCP-Pharo
commit in each skill manifest so workers do not need a sibling MCP-Pharo checkout
to read the guidance.

Shared DevNexus project roots can also use DevNexus-Pharo as a plugin without
being created by `dev-nexus-pharo project create`. After the npm packages are
installed and the local DevNexus-Pharo home is initialized, run the static setup
from the shared meta root:

```powershell
dev-nexus-pharo init
dev-nexus-pharo project skills refresh C:\dev\code\dev-nexus-dogfood
dev-nexus-pharo codex init C:\dev\code\dev-nexus-dogfood
```

For roots whose `dev-nexus.project.json` has both a DevNexus `mcp` block and an
enabled `dev-nexus-pharo` plugin, `project skills refresh` materializes only the
plugin-declared Pharo skills. It does not require a legacy `kanban` block and it
does not start PLexus, Pharo Launcher, images, or Docker.

`codex init` also materializes the static `plexus.project.json` file required by
the scoped `plexus_project` and `pharo_launcher` MCP servers. If a project-local
runtime install exists under `.dev-nexus/runtime/npm-tools`, generated Codex MCP
commands use those package-local binaries instead of requiring global
`dev-nexus-pharo` or `plexus` commands.

By default, DevNexus-Pharo creates the managed project root under
`paths.projectsRoot` from `dev-nexus.home.json`. Use `--root` on
`project create` or `--project-root` on `project import` to choose a different
managed root.

Project creation writes the managed project files:

```text
<project-root>\
  .codex\config.toml
  AGENTS.md
  suggestedFirstPrompt.md
  dev-nexus.project.json
  plexus.project.json
  worktrees\
```

For `project create --from`, the source repository is cloned under
`<project-root>\git`. For `project import <source-checkout>`, the managed
project points at the existing source checkout.

Configure provider-neutral work tracking through DevNexus core. DevNexus owns
generic project and component work tracking; DevNexus-Pharo only contributes the
Pharo plugin layer.

```powershell
dev-nexus project tracker configure C:\dev\code\MyProject --provider local --store-path .dev-nexus\work-items.json
dev-nexus project tracker configure C:\dev\code\MyProject --provider github --repository-owner example --repository-name MyProject
dev-nexus project tracker configure C:\dev\code\MyProject --provider github --host github.enterprise.test --repository-owner example --repository-name MyProject
dev-nexus project tracker configure C:\dev\code\MyProject --provider gitlab --repository-id example/MyProject
dev-nexus project tracker configure C:\dev\code\MyProject --provider gitlab --host gitlab.enterprise.test --repository-id example/MyProject
dev-nexus project tracker configure C:\dev\code\MyProject --provider jira --host example.atlassian.net --project-key FCD
```

`dev-nexus-pharo project configure-tracker` remains as a legacy convenience
wrapper for projects registered in a DevNexus-Pharo home. New automation and
documentation should prefer the DevNexus command above.

```powershell
dev-nexus-pharo project configure-tracker MyProject --provider local --store-path .dev-nexus-pharo\work-items.json
dev-nexus-pharo project configure-tracker MyProject --provider github --repository-owner example --repository-name MyProject
dev-nexus-pharo project configure-tracker MyProject --provider github --host github.enterprise.test --repository-owner example --repository-name MyProject
dev-nexus-pharo project configure-tracker MyProject --provider gitlab --repository-id example/MyProject
dev-nexus-pharo project configure-tracker MyProject --provider gitlab --host gitlab.enterprise.test --repository-id example/MyProject
dev-nexus-pharo project configure-tracker MyProject --provider jira --host example.atlassian.net --project-key FCD
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
GitHub's GraphQL API. To map DevNexus statuses to a Projects v2 single-select
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
updates. If `statusOptions` does not include a status, DevNexus still adds
the issue to the project but skips the status-field update for that status.

The GitLab provider uses the GitLab project Issues and Notes REST APIs under
`/api/v4`. Configure `repository.id` as the GitLab project id or namespace path,
such as `example/MyProject`. It reads credentials in this order: explicit
provider token from code, `GITLAB_TOKEN`, `GL_TOKEN`, then `git credential fill`.
Credential-helper lookup is also non-interactive by default. GitLab write
operations that set assignees or milestones currently require numeric GitLab
assignee and milestone ids.

The Jira provider uses the Jira Cloud REST API v3 under `/rest/api/3`.
Configure `host` as the Jira site host, such as `example.atlassian.net`, and
`projectKey` as the Jira project key. It reads credentials in this order:
explicit provider OAuth bearer token from code, `JIRA_TOKEN`, explicit
email/API-token credentials from code, `JIRA_EMAIL` plus `JIRA_API_TOKEN`
or `ATLASSIAN_EMAIL` plus `ATLASSIAN_API_TOKEN`, then `git credential fill`.
Credential-helper lookup is non-interactive by default, so Git Credential
Manager can supply cached Jira site credentials without hanging automation.
Jira issue descriptions and comments are sent as Atlassian Document Format.
Assignees are Jira account ids, and Jira milestones are intentionally not
mapped yet.

Jira workflow transitions are project-specific. To let DevNexus move Jira
issues through the real Jira workflow when setting a neutral status, configure
transition ids in `workTracking.board.statusOptions` with
`kind: "jira-workflow"`:

```json
{
  "workTracking": {
    "provider": "jira",
    "host": "example.atlassian.net",
    "projectKey": "FCD",
    "board": {
      "kind": "jira-workflow",
      "statusOptions": {
        "blocked": "31",
        "done": "41"
      }
    }
  }
}
```

When no transition id is configured for a status, DevNexus still records the
neutral status with a `status:<name>` Jira label and skips the workflow
transition.

Existing local Vibe Kanban installations can still be used as a tracker
provider for board/repo registration:

```powershell
dev-nexus-pharo project create MyProject --git-init --tracker-project-id <id>
dev-nexus-pharo project create MyProject --git-init --sync-tracker
dev-nexus-pharo project import C:\dev\code\git\ExistingProject --name ExistingProject --sync-tracker
dev-nexus-pharo project link-tracker my-project --tracker-project-id <id>
dev-nexus-pharo project sync-tracker my-project
```

List and inspect projects:

```powershell
dev-nexus-pharo project list
dev-nexus-pharo project status MyProject
dev-nexus-pharo project status C:\dev\code\dev-nexus-pharo\MyProject
```

Use `--json` for machine-readable output.

## Codex Workspace Setup

DevNexus-Pharo-managed Codex workspaces should connect to the supervised local MCP
endpoints started by `dev-nexus-pharo start`.

```powershell
dev-nexus-pharo start
dev-nexus-pharo codex init C:\dev\code\dev-nexus-pharo\MyProject
dev-nexus-pharo codex doctor C:\dev\code\dev-nexus-pharo\MyProject
```

Open a fresh Codex chat from that workspace after `codex doctor` passes. A
running chat may keep the MCP tool list it loaded at startup.

`codex init` preserves unrelated Codex settings and unrelated MCP servers. It
replaces only the DevNexus-Pharo-managed `dev_nexus_pharo`, `plexus`, `vibe_kanban`,
and, for DevNexus-Pharo-managed projects, `pharo` entries. The `pharo` entry is a
command facade for the PLexus gateway; `codex doctor` verifies that it is
projected without spawning the command, opening images, or creating routes.
For shared DevNexus plugin roots, `codex init` writes the root project surface
instead: `dev_nexus`, `dev_nexus_pharo`, `plexus_project`, `pharo_launcher`, and
the live `pharo` gateway endpoint. In that mode it removes the older managed
`plexus` and `vibe_kanban` entries so fresh Codex sessions load the intended
project/plugin tool surface.

`worktree_prepare` creates component-scoped worktrees under
`worktrees\<component-id>\...` and refreshes the worktree `.codex\config.toml`
with the same projected Pharo MCP facade. Workers changing Pharo code should
use the direct `pharo` MCP tools. If those tools are missing or unreachable,
report the MCP infrastructure blocker and use read-only PLexus status or route
discovery instead of editing Pharo code through files.

## MCP Server

`dev-nexus-pharo start` supervises the HTTP MCP endpoint automatically. For direct
MCP server use:

```powershell
dev-nexus-pharo mcp
```

Compatibility mode for clients without URL MCP support:

```powershell
dev-nexus-pharo mcp-stdio
```

DevNexus-Pharo exposes these project-management tools:

```text
project_create
project_import
project_configure_tracker
project_link_tracker
project_sync_tracker
project_list
project_status
project_skill_status
project_skill_refresh
work_item_create
work_item_list
work_item_get
work_item_update
work_item_comment
work_item_set_status
worktree_prepare
worktree_guide
worktree_list
worktree_status
worktree_record_execution
worktree_archive
```

## Configuration Notes

Vibe backend modes are configured in `dev-nexus.home.json`:

- `docker`: local self-hosted Vibe backend through Docker Compose
- `dind`: local self-hosted Vibe backend inside a Docker-in-Docker container
- `external`: remote or manually managed Vibe backend

Managed project `plexus.project.json` files include an `imageExecution` policy.
It defaults to `disabled` and requires disposable images plus an explicit
cleanup plan before future PLexus image launch work can opt into Docker mode.

For GitHub sign-in with the self-hosted Vibe backend, set GitHub OAuth
credentials before startup:

```powershell
$env:DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_ID = "<github-oauth-client-id>"
$env:DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_SECRET = "<github-oauth-client-secret>"
```

## Troubleshooting

- Missing `dev_nexus_pharo`, `plexus`, or `pharo` tools: run `dev-nexus-pharo codex doctor
  <workspace>`, then open a fresh Codex chat after the checks pass.
- Service health failures: run `dev-nexus-pharo status --check-health`, inspect
  logs under `<home>\logs\`, then rerun `dev-nexus-pharo start`.
- Port conflicts: update the ports in `dev-nexus.home.json` or stop the
  conflicting process, then rerun `dev-nexus-pharo codex init <workspace>`.
- MCP handshake failures: make sure `.codex\config.toml` points at the
  configured host and ports, and that `dev-nexus-pharo start` is running.
- Command fallback mode should use the current Node executable and an absolute
  DevNexus-Pharo CLI entrypoint, not a bare `dev-nexus-pharo` package-bin name.

## More Documentation

- [Architecture](docs/architecture.md) covers system boundaries and design.
- [Development](docs/development.md) covers contributor commands and internal
  service implementation notes.
