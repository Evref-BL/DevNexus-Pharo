# Troubleshooting

## Missing MCP Tools

If expected `dev_nexus_pharo`, `plexus_project`, `pharo_launcher`,
`route_control`, or `gateway` tools are missing:

```powershell
dev-nexus-pharo codex doctor <workspace>
```

Then open a fresh Codex chat after the checks pass. A running chat may keep the
MCP tool list it loaded at startup.

For shared DevNexus plugin roots, use `dev_nexus` for generic DevNexus tools and
`dev_nexus_pharo` only for DevNexus-Pharo project tools.

## Service Health Failures

Check the live service graph:

```powershell
dev-nexus-pharo status --check-health
```

Inspect logs under:

```text
<home>\logs\
```

Then rerun:

```powershell
dev-nexus-pharo start
```

## Port Conflicts

Update the configured ports in `dev-nexus.home.json` or stop the conflicting
process, then regenerate affected Codex config:

```powershell
dev-nexus-pharo codex init <workspace>
```

## MCP Handshake Failures

Check that `.codex\config.toml` points at the configured host and ports, and
that `dev-nexus-pharo start` is running.

For clients that cannot use URL MCP, command fallback mode should use the
current Node executable and an absolute DevNexus-Pharo CLI entrypoint:

```text
node <repo>\dist\cli.js mcp-stdio
```

Do not rely on a bare `dev-nexus-pharo` package-bin name in generated fallback
config.

## Missing Pharo Runtime Tools

DevNexus-Pharo does not itself expose image-local Pharo code tools. Those come
from PLexus routing to an MCP-Pharo worker inside a selected image.

If a Pharo code task lacks the expected `gateway` or image-local Pharo tool
surface, report the missing route/configuration as an infrastructure blocker.
Do not edit Pharo source files as a substitute for live-image inspection or
repository handoff tools.

## Static Setup Expectations

`project skills refresh`, `codex init`, and `codex doctor` are setup and
diagnostic operations. They should not launch Pharo images, create PLexus
routes, start Docker, or mutate Pharo Launcher state.

If one of those commands appears to require live runtime work, treat that as a
bug or a missing explicit runner policy.
