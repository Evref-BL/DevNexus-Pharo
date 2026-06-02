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

[mcp_servers.pharo_gateway]
type = "http"
url = "http://127.0.0.1:<project-port>/mcp"
```

Project-scoped entries include PLexus environment variables that identify the
project root, workspace root, workspace source path, target id, and PLexus state
root. When the workspace is a prepared DevNexus worktree, DevNexus-Pharo reads
`.dev-nexus/context/context.json`, derives a stable PLexus workspace id from the
component and work-item ids, and passes the worktree path as
`PLEXUS_WORKSPACE_SOURCE_PATH`. The scoped launcher entry also carries generic
PLexus image-lease metadata for the target and repository branch.

If the prepared worktree source contains exactly one `BaselineOf...` package
under `src`, Codex initialization also updates the shared `plexus.project.json`
with a setup-owned `dev` image `repositoryWorkspace`. That declaration records
the component id, source directory, baseline, branch, base branch when known,
and `copy` materialization, but leaves `originPath` unset so PLexus uses the
current workspace source path.

Prepared implementation worktrees receive the agent-facing `pharo_gateway`
entry, but not `route_control`. Shared project roots may keep `route_control`
for setup and supervision workflows.

`pharo_workspace_handoff_summarize` accepts an existing
`plexus_project_status` result and returns a provider-neutral handoff summary.
It reports the project/workspace/target ids, source path, runtime health,
image ids, image-local repository state, recovery actions, and cleanup guidance.
Clean workspaces are closeable, dirty image-local repository workspaces should
be archived or exported before close, unknown or failed repository workspace
state should be preserved for review, and failed images should be rescued before
raw cleanup.

## Image-Side Git Handoff

When image-side Pharo changes are exported and committed, treat the commit as a
new baseline before continuing in the same image:

1. Record image repository identity, path, branch, loaded commit/head, source
   directory, package set, and dirty state before export.
2. Export through the available Pharo MCP repository tool, then review and
   commit only the intended Tonel/project changes.
3. Record the commit id and refresh or adopt the image-side repository state to
   that Git HEAD before doing more image-side work.
4. Create any follow-up branch from that recorded baseline commit, then switch
   or reload/adopt the image-side repository to the same branch.
5. Verify that Iceberg/image repository state and disk Git report the same
   branch/head and that a fresh `git diff` has no leftover changes from the
   previous handoff.

If no image-side repository tool can refresh, adopt, switch, or reload the
committed state, report that as tooling friction instead of continuing in a
stale or detached image repository.

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
