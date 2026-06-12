# Modes

DevNexus-Pharo has one mode: DevNexus plugin bridge.

It does not run a local service graph and it does not provide a standalone
command. DevNexus loads the plugin to project skills, setup guidance, host
capability hints, and PLexus metadata into Pharo-capable workspaces.

## Plugin Bridge Mode

Use this when a DevNexus project needs Pharo development support. The plugin
contributes:

- Pharo support skills
- PLexus project config defaults
- PLexus MCP surface declarations
- host capability hints
- runner profile templates
- worker context and briefing fragments

Generic project, work item, worktree, and publication operations still belong to
DevNexus.

## Runtime Mode

Runtime work belongs to PLexus. Use PLexus surfaces for:

- project lifecycle status/open/close
- Pharo Launcher image lifecycle
- route control
- gateway access to image-local MCP-Pharo tools

Live runtime work still requires an approved runner and cleanup plan.
