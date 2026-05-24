# Architecture

DevNexus-Pharo is a specialization layer. It adds Pharo-aware setup and runtime
projection to DevNexus without taking ownership of generic DevNexus workflow
features or Pharo image internals.

## Component boundaries

```text
DevNexus
  -> project registry, work tracking, worktrees, targets, publication

DevNexus-Pharo
  -> Pharo project setup, support skills, Codex projection, home services

PLexus
  -> project-local runtime routing and policy

pharo-launcher-mcp
  -> Pharo Launcher image lifecycle

MCP-Pharo
  -> image-local Pharo tools
```

DevNexus-Pharo should depend on published DevNexus APIs and PLexus command/MCP
surfaces. It should not reach into Pharo images directly.

## Home model

The home is host-local state. It contains:

- `dev-nexus.home.json`
- service logs
- service state files
- the reserved control project
- registered managed projects

The control project is for environment management only. Product work belongs in
the managed project root or the owning DevNexus component.

## Project model

A managed Pharo project can have a project root that differs from its source Git
checkout. This lets DevNexus-Pharo store generated support files without writing
into an existing source repository.

Generated project files include:

- `dev-nexus.project.json`
- `plexus.project.json`
- `AGENTS.md`
- `suggestedFirstPrompt.md`
- `.dev-nexus/skills`
- `.codex/config.toml`

The DevNexus project config remains the source of truth for project identity,
repository facts, worktree roots, extensions, plugins, and provider-neutral work
tracking.

## Runtime model

The live service graph has two home-level services:

- DevNexus-Pharo MCP
- PLexus gateway

`dev-nexus-pharo start` ensures the control project exists, starts PLexus, starts
DevNexus-Pharo MCP, and waits for DevNexus-Pharo MCP health. `stop` shuts down
DevNexus-Pharo MCP before PLexus.

Project-local runtime routing is represented in `plexus.project.json`. Codex
uses scoped MCP entries to reach project-local PLexus surfaces when a shared
DevNexus project enables the DevNexus-Pharo plugin.

## Codex projection

Home-level workspaces receive HTTP entries for DevNexus-Pharo MCP and PLexus.
Shared project roots receive command entries for DevNexus, DevNexus-Pharo, and
PLexus project tools plus HTTP entries for the scoped route-control and gateway
surfaces.

`codex init` replaces only managed entries and preserves unrelated user-managed
TOML. `codex doctor` verifies generated entries and performs live HTTP checks
only for home-level services.

## Image execution

DevNexus-Pharo records image execution policy but does not launch images during
static setup. The default policy disables image execution and requires disposable
images and cleanup planning when a project opts into runtime image work.

Live image operations belong behind PLexus policy and must have an explicit
project, workspace, target, and cleanup boundary.

## Work tracking

Work tracking is provider-neutral and owned by DevNexus core. DevNexus-Pharo
reads work tracking facts for status and MCP context, but it does not define a
tracker-specific schema.

## Design constraints

- Keep generic workflow logic in DevNexus core.
- Keep Pharo image lifecycle logic in pharo-launcher-mcp and PLexus.
- Keep image-local code execution inside MCP-Pharo routes.
- Keep generated support files out of source checkouts unless the checkout is
  explicitly the managed project root.
- Keep runtime mutation separate from static projection.
