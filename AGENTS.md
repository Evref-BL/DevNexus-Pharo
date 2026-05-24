# Agent Guide For DevNexus-Pharo Workflows

This repository can be used inside a DevNexus-Pharo-managed environment.
Agents should use the DevNexus-Pharo workflow tools instead of hand-editing runtime
state or assuming a single repository layout.

## Tool Roles

- Use DevNexus workspace tools for component metadata, provider-backed work
  items, isolated worktrees, coordination handoffs, and publication policy.
- Use `dev_nexus_pharo` only for Pharo-specific project, home, setup, MCP, and
  skill-projection operations.
- Do not create Vibe Kanban workspaces, sessions, or executions for
  DevNexus-Pharo source work. Vibe support in this repository is managed
  runtime compatibility code, not the default work tracker for this component.
- Use `pharo_launcher` for Pharo image creation and launch operations only when
  an approved live-runtime boundary exists. In the intended architecture, this
  surface is provided through PLexus, which uses pharo-launcher-mcp underneath.
- Use `pharo` tools to execute code inside images only when the runtime is
  approved and reachable. In the intended architecture, this surface is reached
  through the PLexus gateway and backed by the Evref-BL/MCP Pharo project. If a
  task requires Pharo code changes and the `pharo` MCP surface is missing or
  unreachable, stop and report the MCP infrastructure blocker instead of editing
  Pharo code through files.

## System Shape

Keep the dependency direction:

```text
DevNexus-Pharo -> PLexus -> pharo-launcher-mcp -> PharoLauncher
```

Pharo execution is a runtime capability behind PLexus. DevNexus-Pharo should not
depend on implementation details inside Pharo images.

## Working With Projects

- The DevNexus-Pharo control project is reserved for managing the environment:
  creating/importing/linking projects, checking status, and orchestrating
  services. Do not use it as the normal tracker for a source repository.
- A real project is where product work happens. Use the configured DevNexus
  component work tracker for that repository or application.
- DevNexus-Pharo source changes belong to the DevNexus-Pharo component tracker,
  normally GitHub Issues in the DevNexus dogfood workspace.
- A DevNexus-Pharo project root is the managed project context. It may contain
  Codex configuration, agent instructions, worktrees, and project metadata.
- The source Git checkout may be separate from that root, or may live in a
  subdirectory such as `git`; do not assume the project root is the source repo.
- Installed support skills live under `.dev-nexus/skills` in the managed
  project root. Load only the skill that matches the current task instead of
  copying skill text into prompts or source files.
- Do not create a new Kanban project for every task.
- Prefer MCP tools for project creation, import, list, status, workspace, and
  image operations. Manual edits to DevNexus-Pharo/PLexus config files are for
  implementation or repair work only.
- Codex worktrees prepared by DevNexus core should inherit generated Codex MCP
  configuration from their managed project root; source checkouts should not
  track local `.codex/config.toml` files. Verify direct `pharo` MCP
  availability before changing Pharo code.

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
- Keep the owning work item aligned with commits, verification, and remaining
  risks.

## Work Item Choice

- Use DevNexus-Pharo project/home tooling for instructions like
  "create/import/register/sync a project" or "start/check/fix the
  DevNexus-Pharo environment".
- Use the owning component tracker, such as DevNexus-Pharo, PLexus, or
  pharo-launcher-mcp, for source changes, design notes, tests, and
  implementation work in that project.
- If a task mentions "DevNexus-Pharo" but asks for source-code changes, treat it as
  DevNexus-Pharo component source work, not control-project runtime work.
