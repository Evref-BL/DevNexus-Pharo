# MCP reference

DevNexus-Pharo exposes project and environment operations through MCP while
leaving generic DevNexus work tracking and Pharo image execution to their owning
systems.

## Server entries

`dev-nexus-pharo codex init <workspace>` writes managed Codex MCP entries.

For a normal DevNexus-Pharo home workspace it writes:

```toml
[mcp_servers.dev_nexus_pharo]
type = "http"
enabled = true
required = true
url = "http://127.0.0.1:7330/mcp"
default_tools_approval_mode = "approve"

[mcp_servers.plexus]
type = "http"
enabled = true
url = "http://127.0.0.1:7331/mcp"
default_tools_approval_mode = "approve"
```

For a shared DevNexus project root with the DevNexus-Pharo plugin enabled it
writes scoped command and HTTP entries:

```toml
[mcp_servers.dev_nexus]
command = "dev-nexus"
args = ["mcp-stdio"]

[mcp_servers.dev_nexus_pharo]
command = "dev-nexus-pharo"
args = ["mcp-stdio"]

[mcp_servers.plexus_project]
command = "plexus"
args = ["mcp", "project"]

[mcp_servers.pharo_launcher]
command = "plexus"
args = ["mcp", "pharo-launcher", "--project-path", "<project>"]

[mcp_servers.route_control]
type = "http"
url = "http://127.0.0.1:<project-port>/control-mcp"

[mcp_servers.gateway]
type = "http"
url = "http://127.0.0.1:<project-port>/mcp"
```

Project-scoped entries include PLexus environment variables that identify the
project root, workspace root, target id, and PLexus state root.

## Tool ownership

DevNexus-Pharo tools own:

- Pharo project creation and import
- project registration and status
- projected Pharo support skills
- home setup checks
- Codex MCP projection for Pharo-capable workspaces

DevNexus core owns:

- generic work items and trackers
- component metadata
- worktrees
- target cycles
- publication policy

PLexus and its MCP surfaces own:

- project-local runtime routing
- Pharo Launcher access
- image lifecycle coordination
- routed image-local MCP calls

## Direct server commands

Run the HTTP MCP server:

```powershell
dev-nexus-pharo mcp
```

Run stdio compatibility mode:

```powershell
dev-nexus-pharo mcp-stdio
```

## Doctor checks

`dev-nexus-pharo codex doctor <workspace>` checks that generated MCP entries are
present. For home-level HTTP entries it also checks `/health`, `initialize`, and
`tools/list`. For shared project roots it checks generated config and skips live
gateway reachability because that depends on the runtime profile selected for
the current work.
