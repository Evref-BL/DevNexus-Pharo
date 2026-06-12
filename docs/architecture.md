# Architecture

DevNexus-Pharo is a bridge plugin. It contributes Pharo-specific knowledge to
DevNexus and points DevNexus at PLexus-owned runtime surfaces.

```text
DevNexus project
  -> DevNexus-Pharo plugin metadata
  -> PLexus project/runtime context
  -> Pharo Launcher and image-local MCP-Pharo tools
```

## Ownership

DevNexus owns generic orchestration:

- workspace and component metadata
- work items and coordination
- worktrees and worker context
- target cycles and publication policy
- generic MCP and setup infrastructure

DevNexus-Pharo owns plugin bridge data:

- Pharo support skills
- PLexus project config defaults
- host capability hints
- runner profile templates
- worker context and briefing fragments
- documentation for Pharo runtime boundaries

PLexus owns runtime behavior:

- project lifecycle
- Pharo Launcher access
- gateway routing
- `plexus_project`, `pharo_launcher`, `route_control`, and `pharo_gateway`
  MCP surfaces

## Non-Goals

DevNexus-Pharo does not provide:

- a standalone `dev-nexus-pharo` command
- DevNexus-Pharo-owned MCP tools
- generic project creation or work tracking
- home-level service start/stop/status commands
- image-local Pharo code tools

When a required capability fits one of those areas, add it to DevNexus, PLexus,
or MCP-Pharo instead of reintroducing it here.
