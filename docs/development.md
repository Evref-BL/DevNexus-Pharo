# Development

Use Node.js 22 or newer.

```bash
npm install
npm run build
npm test
npm run check
```

Focused checks:

```bash
npx vitest run test/plugin/devNexusPharoPlugin.test.ts --no-file-parallelism
npx vitest run test/plugin/devNexusPharoExtension.test.ts --no-file-parallelism
npx vitest run test/plugin/devNexusPharoHostCapabilities.test.ts --no-file-parallelism
```

## Source Layout

- `src/devNexusPharoPlugin.ts`: DevNexus plugin capability declaration
- `src/devNexusPharoExtension.ts`: project file extension hook
- `src/devNexusPharoProjectFiles.ts`: generated project support files
- `src/plexusProjectConfig.ts`: PLexus project config defaults and validation
- `src/devNexusPharoHostCapabilities.ts`: host capability hints and runner
  profile templates
- `src/mcpPharoDomainSkills*`: projected Pharo support skills
- `src/pharoProjectLoadWorkspace.ts`: Pharo load workspace inference helpers
- `src/plexusWorkspaceHandoff.ts`: PLexus status handoff summarization

There should be no CLI entrypoint and no DevNexus-Pharo-owned MCP server.

## Boundary Rule

Before adding a feature, identify the owner:

- generic DevNexus behavior belongs in DevNexus core
- runtime lifecycle and MCP routing belong in PLexus
- image-local Pharo code tools belong in MCP-Pharo
- Pharo-specific DevNexus setup knowledge belongs in DevNexus-Pharo

Keep changes in DevNexus-Pharo limited to plugin metadata, setup guidance,
PLexus config defaults, and projected skills.
