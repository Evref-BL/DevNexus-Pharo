# MCP Reference

DevNexus-Pharo exposes project factory and registry tools through MCP.

## Server Commands

`dev-nexus-pharo start` supervises the HTTP MCP endpoint automatically.

For direct MCP server use:

```powershell
dev-nexus-pharo mcp
```

Compatibility mode for clients without URL MCP support:

```powershell
dev-nexus-pharo mcp-stdio
```

## Tool Surface

DevNexus-Pharo exposes these Pharo-project tools:

```text
pharo_project_create
pharo_project_import
pharo_project_list
pharo_project_status
pharo_project_skill_status
pharo_project_skill_refresh
```

All DevNexus-Pharo MCP tools default to compact `detail: "summary"` responses.
Pass `detail: "full"` when an agent needs complete generated project config,
Codex MCP config, PLexus config, Git command records, or per-skill file paths.

## Tool Ownership

Generic DevNexus MCP tools are intentionally exposed only by `dev_nexus`.

Use `dev_nexus` for:

```text
project_*
work_item_*
automation_status
target_cycle_*
target_report
coordination_*
```

Calls to those generic names through `dev_nexus_pharo` are unknown tools.

PLexus owns project/runtime lifecycle tools such as `plexus_project`.

pharo-launcher-mcp owns Pharo Launcher image, template, VM, and process tools.

MCP-Pharo owns image-local Pharo code, test, repository, screenshot, and
environment tools.

## Control Project Prompt Contract

For a control-project request like:

```text
Create a new Pharo project named MyLibrary from https://git.example.test/org/MyLibrary.git
```

the agent should call `pharo_project_create` on `dev_nexus_pharo` with:

```json
{
  "name": "MyLibrary",
  "remoteUrl": "https://git.example.test/org/MyLibrary.git"
}
```

The agent should not manually create directories, hand-edit project config
files, or call Vibe Kanban directly for this workflow.

## Vibe Executor Entries

On start, DevNexus-Pharo installs MCP server entries into the selected Vibe
Kanban executor. Server names, HTTP host, and ports come from
`dev-nexus.home.json`.

Existing Vibe Kanban MCP servers are preserved.

Fresh executor sessions may be required after MCP config changes because agents
usually load tool catalogs at session startup.
