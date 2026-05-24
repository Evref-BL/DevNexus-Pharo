# Development

This page is for contributors working on DevNexus-Pharo source.

## Local checks

```bash
npm run build
npm test
npm run check
```

Use focused Vitest runs while iterating:

```bash
npx vitest run test/config/config.test.ts --no-file-parallelism
npx vitest run test/runtime/devNexusPharoRuntime.test.ts --no-file-parallelism
```

`npm run check` is the final local gate for this package.

## Source layout

- `src/config.ts`: home config, control project setup, and config validation
- `src/devNexusPharoProjectService.ts`: Pharo-specific create/import orchestration
- `src/nexusProjectService.ts`: wrappers around DevNexus core project services
- `src/codexConfig.ts`: Codex MCP projection and doctor checks
- `src/devNexusPharoRuntime.ts`: home-level service start/status/stop
- `src/devNexusPharoExtension.ts`: project files, PLexus metadata, skill pack
- `src/mcpServer.ts`: MCP tool surface
- `test/`: Vitest coverage grouped by owning module or workflow

## Runtime services

`dev-nexus-pharo start` owns two home-level services:

- DevNexus-Pharo MCP
- PLexus gateway

Both are long-lived local processes. Their state files live under
`<home>/state/services`; logs live under `<home>/logs`.

The runtime start path:

1. loads the home config
2. ensures the reserved control project exists
3. starts PLexus gateway if needed
4. starts DevNexus-Pharo MCP if needed
5. waits for DevNexus-Pharo MCP health

Stop shuts down DevNexus-Pharo MCP first, then PLexus gateway.

## Project setup

Managed Pharo project creation/import uses DevNexus core for project registry
and Git behavior. DevNexus-Pharo adds:

- the `dev-nexus-pharo` extension entry
- the packaged DevNexus-Pharo plugin entry
- `plexus.project.json`
- default `AGENTS.md`
- projected skills
- Codex MCP config

Generic projects created through this package do not receive Pharo-specific
files.

## Codex MCP projection

For normal home workspaces, Codex config receives HTTP entries for
`dev_nexus_pharo` and `plexus`.

For shared DevNexus project roots with the plugin enabled, Codex config receives
scoped entries for:

- `dev_nexus`
- `dev_nexus_pharo`
- `plexus_project`
- `pharo_launcher`
- `route_control`
- `gateway`

When replacing managed entries, preserve unrelated user-managed TOML.

## PLexus metadata

`plexus.project.json` stores project-local gateway and image execution policy.
Default image execution is disabled. When Docker execution is enabled,
`docker.image` must be set and the runtime still needs an explicit task
boundary before images are launched.

## Release notes for contributors

Keep commits focused. Update tests with behavior changes and update active docs
when commands, config shape, or runtime ownership changes. Historical design
notes should not contradict the active README or references.
