# Getting Started

This guide covers the first-use paths for DevNexus-Pharo.

Use DevNexus-Pharo when you want a DevNexus workspace or project to be ready for
Pharo work: Pharo support skills, Codex MCP configuration, optional Vibe Kanban
startup, PLexus gateway startup, and project factory tools.

## Requirements

- Node.js 24 or newer, with `npm` and `npx`
- Git
- Docker when using the local Vibe backend
- a working PLexus gateway command when live Pharo routing is needed

## Install From Source

```powershell
cd C:\work\src\DevNexus-Pharo
npm install
npm run build
npm link
```

Without a global link, run the built CLI directly:

```powershell
node C:\work\src\DevNexus-Pharo\dist\cli.js --help
```

## Initialize A Home

```powershell
dev-nexus-pharo init
```

By default, DevNexus-Pharo uses `DEV_NEXUS_PHARO_HOME`, then
`~\.dev-nexus-pharo`.

To use a specific home:

```powershell
$env:DEV_NEXUS_PHARO_HOME = "C:\work\.dev-nexus-pharo"
dev-nexus-pharo init
```

On macOS or Linux:

```bash
export DEV_NEXUS_PHARO_HOME=~/dev/.dev-nexus-pharo
dev-nexus-pharo init
```

For guided setup:

```powershell
dev-nexus-pharo init --interactive
```

If `plexus-gateway` is not on `PATH`, edit the generated
`dev-nexus.home.json` and set `tools.plexus.command` to an absolute path.

## Start The Service Graph

```powershell
dev-nexus-pharo start
```

This starts the configured Vibe backend, Vibe Kanban, the DevNexus-Pharo MCP
service, and the PLexus gateway. It also creates and links the reserved
`DevNexus-Pharo` control project, opens Vibe Kanban when healthy, and installs
DevNexus-Pharo and PLexus MCP entries into the configured Vibe executor.

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

## Create Or Import A Project

Create a new managed project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Create a project from a Git URL:

```powershell
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
```

Import an existing local source checkout without writing DevNexus-Pharo
metadata into that checkout:

```powershell
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
```

By default, managed project roots are created under `paths.projectsRoot` from
`dev-nexus.home.json`. Use `--root` on `project create` or `--project-root` on
`project import` to choose a different managed root.

Project creation writes:

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

## Prepare Codex

DevNexus-Pharo-managed Codex workspaces should connect to the supervised local
MCP endpoints started by `dev-nexus-pharo start`.

```powershell
dev-nexus-pharo start
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\MyProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\MyProject
```

`.codex\config.toml` is generated workspace state. Keep it local or projected
from a managed DevNexus project root; the source repository does not track a
live Codex config file.

Open a fresh Codex chat after `codex doctor` passes. A running chat may keep the
MCP tool list it loaded at startup.

## Existing DevNexus Workspace

For an existing DevNexus workspace with an enabled `dev-nexus-pharo` plugin:

```powershell
dev-nexus-pharo init
dev-nexus-pharo project skills refresh C:\work\agent-workspace
dev-nexus-pharo codex init C:\work\agent-workspace
```

This path performs static projection. It materializes Pharo skills and Codex MCP
configuration for the workspace. It does not start PLexus, Pharo Launcher,
images, Vibe, or Docker.

## Next Steps

- Read [Modes](modes.md) before deciding whether to use home/control-project
  mode or plugin mode.
- Read [User Workflows](workflows.md) for project factory, control-project, and
  Codex workflows.
- Read [Troubleshooting](../troubleshooting.md) if expected MCP tools are
  missing or services do not become healthy.
