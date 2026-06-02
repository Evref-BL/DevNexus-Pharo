# User workflows

This page lists the common DevNexus-Pharo workflows and the command surface that
owns each one.

## Create a project

Create an empty managed project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Create one from a remote repository:

```powershell
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
```

DevNexus-Pharo writes:

- `dev-nexus.project.json`
- `plexus.project.json`
- `AGENTS.md`
- `suggestedFirstPrompt.md`
- projected support skills under `.dev-nexus/skills`
- Codex MCP entries under `.codex/config.toml`

## Import a project

Import an existing Git checkout:

```powershell
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
```

The source checkout remains source-owned. DevNexus-Pharo creates or updates the
managed project root and does not write project metadata into the source
checkout unless that checkout is already the project root.

## Inspect projects

```powershell
dev-nexus-pharo project list
dev-nexus-pharo project status MyProject
dev-nexus-pharo project status C:\work\.dev-nexus-pharo\projects\MyProject
```

Status includes source checkout paths, PLexus project config state, worktree
roots, projected skills, and provider-neutral work tracking facts from DevNexus
core.

## Refresh skills

```powershell
dev-nexus-pharo project skills status MyProject
dev-nexus-pharo project skills refresh MyProject
```

Skill refresh materializes the core DevNexus skill pack and the Pharo-specific
skills declared by this plugin. It is safe to run repeatedly.

## Configure Codex

```powershell
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\MyProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\MyProject
```

`codex init` preserves unrelated Codex settings and unrelated MCP servers. For
project-scoped DevNexus-Pharo roots it removes obsolete home-scoped `plexus`,
`vibe_kanban`, and `pharo` entries and writes the current project-scoped
`plexus_project`, `pharo_launcher`, `route_control`, and `pharo_gateway` entries.

For shared DevNexus plugin roots, `codex init` writes the root project surface:
`dev_nexus`, `dev_nexus_pharo`, `plexus_project`, `pharo_launcher`,
`route_control`, and the live `pharo_gateway` endpoint.

For prepared implementation worktrees, `codex init` reads
`.dev-nexus/context/context.json`, maps the worktree path to
`PLEXUS_WORKSPACE_SOURCE_PATH`, and can project the worktree checkout into the
shared `plexus.project.json` as a PLexus repository workspace. The projection is
created when the worktree has exactly one `BaselineOf...` package under `src`;
it uses the worktree source path at runtime instead of storing a fixed
`originPath` in shared config.

`codex doctor` checks generated entries and performs HTTP checks for home-level
MCP services when applicable.

## Work items

DevNexus core owns work-item configuration and provider integrations. Configure
tracking through provider-neutral DevNexus project config and DevNexus commands.
DevNexus-Pharo only reads that information when reporting project status or when
MCP tools need to resolve the owning project context.

## Live runtime

Start and stop the home-level services:

```powershell
dev-nexus-pharo start
dev-nexus-pharo status --check-health
dev-nexus-pharo stop
```

Live Pharo image changes should go through PLexus and an approved runtime
boundary. Static project setup does not imply permission to launch or mutate an
image.
