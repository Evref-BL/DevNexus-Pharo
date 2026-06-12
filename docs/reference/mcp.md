# MCP Boundary

DevNexus-Pharo does not implement MCP servers.

The plugin declares which PLexus-owned surfaces a DevNexus worker may need:

```toml
[mcp_servers.plexus_project]
command = "plexus"
args = ["mcp", "project"]

[mcp_servers.pharo_launcher]
command = "plexus"
args = ["mcp", "pharo-launcher", "--project-path", "<project>"]

[mcp_servers.route_control]
type = "http"
url = "http://127.0.0.1:<project-port>/control-mcp"

[mcp_servers.pharo_gateway]
type = "http"
url = "http://127.0.0.1:<project-port>/mcp"
```

PLexus owns those commands, routes, and tools.

DevNexus owns generic MCP surfaces such as project, work item, target cycle, and
workspace operations.

MCP-Pharo owns image-local Pharo tools behind the PLexus gateway.

## Deprecated Surface

There is no supported `dev_nexus_pharo` MCP server. If generated configuration
or documentation asks for `dev-nexus-pharo mcp`, `dev-nexus-pharo mcp-stdio`, or
an MCP server named `dev_nexus_pharo`, treat that as stale setup data and
regenerate the DevNexus plugin projection.
