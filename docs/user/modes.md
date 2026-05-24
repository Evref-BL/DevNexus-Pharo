# Modes

DevNexus-Pharo has three operating modes: home/control-project mode, plugin
mode, and live service mode.

## Home and control project mode

`dev-nexus-pharo init` creates a host-local home and a reserved control project.
The control project is the management surface for creating and importing real
Pharo projects.

Use this mode for:

- first-time setup
- registering projects
- checking project status
- refreshing projected support files

Do not use the control project as the normal source repository for product work.
Real work belongs in the managed project or the owning DevNexus component.

## Plugin mode

Plugin mode is for an existing DevNexus project root that enables the
`dev-nexus-pharo` plugin. It lets a shared workspace project Pharo support
skills and scoped MCP entries without being recreated by DevNexus-Pharo.

Plugin mode is a static projection path. It writes files such as:

- `.dev-nexus/skills/...`
- `.codex/config.toml`
- `plexus.project.json`

It does not launch images, PLexus project runtimes, Docker, or GUI tools.

## Live service mode

`dev-nexus-pharo start` starts the home-level service graph:

- DevNexus-Pharo MCP
- PLexus gateway

This mode is useful when a local Codex session needs the HTTP MCP services. Live
Pharo image work still requires an approved PLexus route and a clear runtime
boundary for the selected task.

## Static projection versus live runtime

Static projection commands are safe setup operations:

```powershell
dev-nexus-pharo project skills refresh MyProject
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\MyProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\MyProject
```

Live runtime commands can start or stop local services:

```powershell
dev-nexus-pharo start
dev-nexus-pharo status --check-health
dev-nexus-pharo stop
```

Treat live image work as a separate approval boundary from static setup.
