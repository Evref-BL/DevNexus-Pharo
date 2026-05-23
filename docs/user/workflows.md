# User Workflows

This guide covers the workflows DevNexus-Pharo expects users and agents to
follow.

## Control Project Workflow

The reserved `DevNexus-Pharo` project is the control project. Use it for
environment and project-management tasks.

Example request:

```text
Create a new Pharo project named MyLibrary from https://git.example.test/org/MyLibrary.git
```

Agents should satisfy that request with the DevNexus-Pharo project factory MCP
tool or CLI command. They should not manually create folders, hand-edit project
metadata, or call Vibe Kanban directly for this workflow.

CLI equivalent:

```powershell
dev-nexus-pharo project create MyLibrary --from https://git.example.test/org/MyLibrary.git
```

MCP equivalent:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://git.example.test/org/MyLibrary.git"
}
```

The project factory owns the transaction: Git clone or init,
`dev-nexus.project.json`, `plexus.project.json`, `.codex\config.toml`,
`AGENTS.md`, `worktrees\`, optional Vibe registration, optional Vibe board
creation or linking, and the home project registry update.

## Managed Project Workflow

After a real Pharo project exists, use that project's own project surface for
feature planning and implementation. Do not use the control project as the
normal feature board for real projects.

Expected agent behavior for a feature task:

- work inside the owning project or generated worktree;
- use DevNexus for generic work items, worktrees, target facts, and publication
  policy;
- use PLexus and MCP-Pharo for live image work when the selected task has an
  approved runtime boundary;
- report missing Pharo MCP routes as infrastructure blockers instead of editing
  Pharo source files as a substitute for live-image tools.

## Create And Import

Create a new project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Create from a remote repository:

```powershell
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
```

Import an existing checkout:

```powershell
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
```

For `project import`, the path is the source Git checkout, not the metadata
root. Use `--project-root <path>` only when the managed DevNexus-Pharo project
root needs to live somewhere other than `paths.projectsRoot`.

## Project Skill Projection

Managed DevNexus-Pharo projects receive support skills under
`.dev-nexus\skills`, including MCP-Pharo-derived guidance for:

- Pharo CI reproduction;
- image-to-Tonel Git handoff;
- project loading;
- cross-version PharoCompatibility work.

Refresh or inspect skills with:

```powershell
dev-nexus-pharo project skills status MyProject
dev-nexus-pharo project skills refresh MyProject
```

The copied MCP-Pharo skills are worker guidance with upstream commit
provenance. They do not make DevNexus-Pharo the owner of image-side MCP runtime
behavior.

## Codex Workspace Setup

Prepare Codex after the DevNexus-Pharo service graph is available:

```powershell
dev-nexus-pharo start
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

`codex doctor` validates generated config and expected endpoint/tool
availability without opening images or creating routes for project-local
gateway entries.

## Work Tracking

Generic work tracking belongs to DevNexus core. Use DevNexus provider-neutral
commands and MCP tools for tracker configuration, work-item creation, status
updates, comments, target cycles, and publication policy.

DevNexus-Pharo only contributes the Pharo plugin layer.
