# Getting Started

Install DevNexus-Pharo as a DevNexus plugin:

```bash
npm install --save-dev @evref-bl/dev-nexus-pharo
```

Enable the plugin in the DevNexus project configuration. DevNexus then projects
the plugin capabilities, skills, and worker guidance.

For runtime work, configure PLexus for the project. PLexus owns project lifecycle,
Pharo Launcher access, and gateway MCP routing.

Use DevNexus commands for generic workspace, component, work item, and worktree
operations. Use PLexus commands or MCP tools for runtime and image lifecycle
operations.
