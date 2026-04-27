# Agent Guide For PharoNexus Workflows

This repository can be used inside a PharoNexus-managed environment.
Agents should use the PharoNexus workflow tools instead of hand-editing runtime
state or assuming a single repository layout.

## Tool Roles

- Use `pharo_nexus` to organize and orchestrate projects, homes, workspaces,
  MCP configuration, and project/board linkage.
- Use `vibe_kanban` to plan and track feature work through project boards,
  issues, workspaces, and sessions.
- Use `pharo_launcher` for Pharo image creation and launch operations. In the
  intended architecture, this surface is provided through PLexus, which uses
  pharo-launcher-mcp underneath.
- Use `pharo` tools to execute code inside images. In the intended
  architecture, this surface is reached through the PLexus gateway and backed
  by the Evref-BL/MCP Pharo project.

## System Shape

Keep the dependency direction:

```text
PharoNexus -> PLexus -> pharo-launcher-mcp -> PharoLauncher
```

Pharo execution is a runtime capability behind PLexus. PharoNexus should not
depend on implementation details inside Pharo images.

## Working With Projects

- The PharoNexus control project is reserved for managing the environment:
  creating/importing/linking projects, checking status, and orchestrating
  services. Do not use it as the normal feature board for a source repository.
- A real project is where product work happens. Its Kanban board represents one
  source repository or application, and its issues represent feature, bugfix,
  planning, or maintenance work.
- `MetaPharoNexus` is the real project for developing PharoNexus itself. It is
  distinct from the reserved control project, even though both are related to
  PharoNexus.
- A PharoNexus project root is the managed project context. It may contain
  Codex configuration, agent instructions, worktrees, and project metadata.
- The source Git checkout may be separate from that root, or may live in a
  subdirectory such as `git`; do not assume the project root is the source repo.
- Do not create a new Kanban project for every task.
- Prefer MCP tools for project creation, import, list, status, workspace, and
  image operations. Manual edits to PharoNexus/PLexus config files are for
  implementation or repair work only.

## Git Workflow

- Before changing files, inspect the relevant Git working tree and distinguish
  user changes from your own.
- Keep commits focused on the completed prompt or issue. Do not include
  unrelated user edits.
- After code or documentation changes are complete and verified, commit the
  work in the relevant source repository unless the user explicitly asked not to
  commit.
- Push only when the user asked for it, the project instructions say pushing is
  expected, or the current task clearly requires publishing the commit.
- Keep the Kanban issue or project notes aligned with commits, verification,
  and remaining risks.

## Board Choice

- Use the control board for instructions like "create/import/register/sync a
  project" or "start/check/fix the PharoNexus environment".
- Use a real project board, such as `MetaPharoNexus`, `PLexus`, or `pharo-launcher-mcp`,
  for source changes, design notes, tests, and implementation work in that
  project.
- If a task mentions "PharoNexus" but asks for source-code changes, treat it as
  `MetaPharoNexus`, not the control project.
