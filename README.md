# DevNexus-Pharo

DevNexus-Pharo is a DevNexus plugin for Pharo projects. It does not ship a
standalone CLI and does not implement MCP servers.

Its role is to bridge DevNexus and PLexus:

- projects Pharo-oriented agent skills into DevNexus workers
- declares PLexus-owned MCP surfaces to DevNexus
- generates PLexus project metadata defaults
- contributes host capability hints and runner profile templates
- documents Pharo runtime boundaries for agents

PLexus owns Pharo runtime orchestration, Pharo Launcher access, and MCP routing.
Its agent-facing surfaces include `plexus_project`, `pharo_launcher`,
`route_control`, and `pharo_gateway`.

DevNexus remains the owner of generic workspace, component, work-item, worktree,
target, and publication infrastructure.

## Install

```bash
npm install --save-dev @evref-bl/dev-nexus-pharo
```

Enable the plugin through the DevNexus project plugin configuration. DevNexus
loads `devNexusPharoDevNexusPluginConfig` from this package.

## Development

```bash
npm install
npm run build
npm test
npm run check
```

Use focused Vitest runs while iterating:

```bash
npx vitest run test/plugin/devNexusPharoPlugin.test.ts --no-file-parallelism
npx vitest run test/plugin/devNexusPharoExtension.test.ts --no-file-parallelism
```

## Package Boundary

DevNexus-Pharo should not grow a user command, service manager, project manager,
or MCP server. Add those capabilities to the owning package instead:

- DevNexus core for generic project/workspace/work-item behavior
- PLexus for runtime lifecycle, Pharo Launcher, gateway, and MCP routing
- MCP-Pharo for image-local Pharo tools

## Documentation

- [Architecture](docs/architecture.md)
- [Development](docs/development.md)
- [Configuration](docs/reference/configuration.md)
- [MCP Boundary](docs/reference/mcp.md)
- [Troubleshooting](docs/troubleshooting.md)
