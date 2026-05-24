# DevNexus-Pharo

DevNexus-Pharo is the Pharo environment layer for DevNexus.

It prepares Pharo-ready DevNexus projects, projects Pharo support skills and
Codex MCP configuration, and starts the local service graph that connects agents
to PLexus and image-local Pharo MCP workers.

DevNexus remains the generic workspace, component, work-item, worktree, and
target infrastructure. PLexus owns Pharo runtime targets and image routing.
pharo-launcher-mcp owns Pharo Launcher access. MCP-Pharo runs inside one Pharo
image and exposes image-local code and environment tools.

## Where it fits

```text
DevNexus workspace
  -> DevNexus-Pharo environment layer
      -> PLexus project/runtime context
          -> pharo-launcher-mcp
              -> Pharo Launcher
          -> image-local MCP-Pharo workers
```

The main design point is outside-image orchestration. DevNexus-Pharo and PLexus
keep setup, project metadata, service state, routing, and agent support outside
the Pharo image. Each image is a runtime process that agents inspect or modify
through scoped MCP tools.

## What it owns

DevNexus-Pharo owns:

- the user-level DevNexus-Pharo home
- the reserved control project for creating and importing Pharo projects
- Pharo project creation/import helpers and home registry integration
- PLexus gateway startup for Pharo-capable environments
- Codex MCP configuration for DevNexus-Pharo, PLexus, and scoped project tools
- DevNexus plugin capabilities for Pharo skills, setup checks, MCP projection,
  worker briefing fragments, and cleanup expectations

DevNexus-Pharo does not own:

- generic DevNexus project, component, tracker, work-item, worktree, target, or
  publication behavior
- Pharo Launcher CLI semantics
- Pharo image creation, launch, stop, deletion, or process killing
- image-local Pharo code editing, test execution, repository export, or image
  save behavior

Those belong to DevNexus core, pharo-launcher-mcp, PLexus, and MCP-Pharo.

## Terms

- A **DevNexus-Pharo home** is host-local state, normally
  `~/.dev-nexus-pharo`, containing service config, logs, runtime state, the
  control project, and registered Pharo projects.
- The **control project** is a reserved DevNexus project named
  `DevNexus-Pharo`. It is for creating, importing, and managing real Pharo
  projects.
- A **managed Pharo project** is a DevNexus project root that points at a Pharo
  source checkout and contains generated agent and PLexus support files.
- **Plugin mode** means an existing DevNexus workspace uses DevNexus-Pharo
  capabilities without being created by `dev-nexus-pharo project create`.
- **Static projection** writes skills, support config, and MCP entries. It does
  not start PLexus, Pharo Launcher, images, Docker, or GUI tools.
- The **live service graph** is the supervised local set of DevNexus-Pharo MCP
  and PLexus gateway services started by `dev-nexus-pharo start`.

## Requirements

- Node.js 24 or newer, with `npm`
- Git
- a working PLexus command, usually `plexus-gateway`, when live Pharo routing is
  needed

Windows examples use PowerShell and `C:\...` paths. macOS and Linux can use the
same commands with POSIX paths.

## Quick start

Install from a source checkout:

```powershell
cd C:\work\src\DevNexus-Pharo
npm install
npm run build
npm link
```

Initialize the host-local DevNexus-Pharo home:

```powershell
dev-nexus-pharo init
```

Start the local service graph:

```powershell
dev-nexus-pharo start
```

This starts the DevNexus-Pharo MCP service and the PLexus gateway, then ensures
the reserved control project exists.

Create a managed Pharo project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Or create one from an existing Git URL:

```powershell
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
```

Prepare a Codex workspace for a managed project:

```powershell
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\MyProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\MyProject
```

Open a fresh Codex chat from that workspace after `codex doctor` passes. A
running chat may keep the MCP tool list it loaded at startup.

## Existing DevNexus workspace

Shared DevNexus project roots can use DevNexus-Pharo as a plugin without being
created by `dev-nexus-pharo project create`.

From the shared DevNexus workspace root:

```powershell
dev-nexus-pharo init
dev-nexus-pharo project skills refresh C:\work\agent-workspace
dev-nexus-pharo codex init C:\work\agent-workspace
```

For roots whose `dev-nexus.project.json` has both a DevNexus `mcp` block and an
enabled `dev-nexus-pharo` plugin, `project skills refresh` materializes only the
plugin-declared Pharo skills. It does not start PLexus, Pharo Launcher, images,
or Docker.

## Common workflows

Create or import a Pharo project:

```powershell
dev-nexus-pharo project create MyProject --git-init
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
```

Inspect registered projects:

```powershell
dev-nexus-pharo project list
dev-nexus-pharo project status MyProject
dev-nexus-pharo project status C:\work\.dev-nexus-pharo\projects\MyProject
```

Refresh projected Pharo support skills:

```powershell
dev-nexus-pharo project skills status MyProject
dev-nexus-pharo project skills refresh MyProject
```

Check or stop the live service graph:

```powershell
dev-nexus-pharo status --check-health
dev-nexus-pharo stop
```

Run the DevNexus-Pharo MCP server directly:

```powershell
dev-nexus-pharo mcp
```

Compatibility mode for clients without URL MCP support:

```powershell
dev-nexus-pharo mcp-stdio
```

## Safety notes

`dev-nexus-pharo codex init`, `project skills refresh`, and static plugin setup
are projection operations. They should not start live Pharo images, Docker,
PLexus project runtimes, or Pharo Launcher processes.

Live Pharo image work belongs behind PLexus policy and the selected workspace or
runner boundary. DevNexus-Pharo publishes host capability tags and runner
profile templates, but the `pharo-live-runtime` profile remains approval-gated.
It is not permission to launch images, PLexus services, Docker, or GUI
automation by itself.

Generic work tracking belongs to DevNexus core. Configure provider-neutral
trackers with `dev-nexus` commands, not DevNexus-Pharo commands.

## Documentation

- [Getting Started](docs/user/getting-started.md) gives the first-use paths.
- [Modes](docs/user/modes.md) explains home/control-project mode, plugin mode,
  static projection, and live services.
- [User Workflows](docs/user/workflows.md) covers project creation, import,
  control-project tasks, project work, and Codex setup.
- [MCP Reference](docs/reference/mcp.md) lists DevNexus-Pharo MCP surfaces and
  tool ownership.
- [Configuration Reference](docs/reference/configuration.md) covers home
  config, image execution policy, host capabilities, and Pharo load workspaces.
- [Troubleshooting](docs/troubleshooting.md) covers missing MCP tools, service
  health failures, port conflicts, and stale Codex sessions.
- [Architecture](docs/architecture.md) covers component boundaries and design.
- [Development](docs/development.md) covers contributor commands and internal
  implementation notes.
- [Documentation Refresh Plan](docs/documentation-refresh-plan.md) records the
  reusable documentation direction for the Pharo component family.

## License

DevNexus-Pharo is licensed under the [Apache License 2.0](LICENSE).
