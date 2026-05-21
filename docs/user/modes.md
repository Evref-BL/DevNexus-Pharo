# Modes

DevNexus-Pharo can be used in two main ways.

## Home And Control Project Mode

Use this mode when DevNexus-Pharo should own a local Pharo environment entry
point.

```powershell
dev-nexus-pharo init
dev-nexus-pharo start
```

This creates or reuses a DevNexus-Pharo home and a reserved control project:

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

The control project is not a Pharo application repository. It is the management
surface where a user or agent asks for real Pharo projects to be created or
imported.

Use this mode for:

- creating or importing managed Pharo projects;
- supervising the local Vibe and PLexus service graph;
- keeping a registry of project roots and Vibe ids;
- installing DevNexus-Pharo and PLexus MCP entries into a Vibe executor.

## Plugin Mode

Use this mode when an existing DevNexus workspace wants Pharo capabilities
without being created by DevNexus-Pharo.

```powershell
dev-nexus-pharo init
dev-nexus-pharo project skills refresh C:\work\agent-workspace
dev-nexus-pharo codex init C:\work\agent-workspace
```

Plugin mode uses the `dev-nexus-pharo` plugin declaration from
`dev-nexus.project.json`. It projects Pharo-specific skills, setup obligations,
worker briefing fragments, and MCP configuration into the existing workspace.

Plugin mode does not require a Kanban block. It does not start PLexus, Pharo
Launcher, Vibe, Docker, or images.

## Static Projection

Static projection writes support files only.

Examples:

```powershell
dev-nexus-pharo project skills refresh <workspace-or-project>
dev-nexus-pharo codex init <workspace-or-project>
dev-nexus-pharo codex doctor <workspace-or-project>
```

Static projection is appropriate for setup, diagnosis, and generated agent
support. It must stay safe for ordinary workspaces and should not perform live
runtime mutations.

## Live Service Graph

The live service graph is started by:

```powershell
dev-nexus-pharo start
```

Depending on home configuration, it may start:

- a local Vibe shared backend;
- the Vibe Kanban local app;
- the DevNexus-Pharo MCP service;
- the PLexus gateway service.

The live service graph still does not mean "start a Pharo image." Image runtime
work belongs to PLexus project/workspace policy and the selected runner or
workspace boundary.

## Image Runtime Boundary

DevNexus-Pharo operates outside Pharo images. PLexus and MCP-Pharo handle the
runtime layers:

```text
DevNexus-Pharo -> PLexus -> pharo-launcher-mcp -> Pharo Launcher
                            -> MCP-Pharo worker in one image
```

DevNexus-Pharo can publish setup capabilities and default policy, but it must
not launch Docker, PLexus project runtimes, Pharo Launcher processes, or Pharo
images unless the selected task explicitly owns the runner, disposable image
boundary, and cleanup plan.
