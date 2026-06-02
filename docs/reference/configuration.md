# Configuration reference

DevNexus-Pharo has two configuration surfaces:

- `dev-nexus.home.json` in the DevNexus-Pharo home
- `dev-nexus.project.json` and `plexus.project.json` in managed project roots

DevNexus core owns generic project, component, work tracking, and publication
configuration. DevNexus-Pharo adds Pharo setup, skill projection, and PLexus
runtime metadata.

## Home config

`dev-nexus-pharo init` writes `dev-nexus.home.json` under the selected home.
The default home is resolved from `DEV_NEXUS_PHARO_HOME` or the platform default
for `.dev-nexus-pharo`.

Important fields:

```json
{
  "version": 1,
  "paths": {
    "projectsRoot": "<home>/projects",
    "workspacesRoot": "<home>/workspaces",
    "plexusStateRoot": "<home>/state/plexus"
  },
  "ports": {
    "devNexusPharoMcp": 7330,
    "plexusMcp": 7331
  },
  "mcp": {
    "host": "127.0.0.1"
  },
  "tools": {
    "nexus": {
      "command": "<node>",
      "args": ["<package>/dist/cli.js", "mcp"]
    },
    "plexus": {
      "command": "plexus-gateway",
      "args": []
    }
  },
  "controlProject": {
    "id": "dev-nexus-pharo-control",
    "name": "DevNexus-Pharo",
    "root": "<home>/DevNexus-Pharo"
  },
  "projects": []
}
```

The DevNexus-Pharo MCP port and PLexus MCP port must be distinct. Tool commands
are started as long-lived local services by `dev-nexus-pharo start`.

## Project config

Managed Pharo project roots use the standard DevNexus project schema plus the
DevNexus-Pharo extension entry:

```json
{
  "version": 1,
  "id": "my-project",
  "name": "MyProject",
  "home": null,
  "repo": {
    "kind": "git",
    "remoteUrl": "https://git.example.test/org/MyProject.git",
    "defaultBranch": "main",
    "sourceRoot": "git"
  },
  "worktreesRoot": "worktrees",
  "extensions": {
    "dev-nexus-pharo": {}
  },
  "plugins": [
    {
      "id": "dev-nexus-pharo",
      "name": "DevNexus-Pharo"
    }
  ]
}
```

Generic work tracking belongs in the provider-neutral `workTracking` block from
DevNexus core. DevNexus-Pharo does not define its own issue tracker schema.

## PLexus project config

`plexus.project.json` is generated beside the DevNexus project config for
DevNexus-Pharo-managed projects:

```json
{
  "id": "my-project",
  "name": "MyProject",
  "images": [],
  "imageExecution": {
    "mode": "disabled",
    "requireDisposableImage": true,
    "requireCleanupPlan": true,
    "docker": {
      "image": null,
      "network": "none",
      "autoRemove": true,
      "mountProjectReadOnly": true
    }
  },
  "runtime": {
    "gateway": {
      "mode": "project-local",
      "host": "127.0.0.1",
      "port": 17340,
      "agentMcpPath": "/mcp",
      "routeControlMcpPath": "/control-mcp"
    }
  }
}
```

The project-local gateway port is allocated from a deterministic range and is
kept separate from home-level MCP ports.

When `codex init` runs in a prepared DevNexus worktree, DevNexus-Pharo can
overlay the shared `plexus.project.json` with a setup-owned `dev` image profile.
If the worktree source has exactly one `BaselineOf...` package under `src`, the
profile receives a PLexus `repositoryWorkspace` with the component id, remote
URL when known, `sourceDirectory`, `baseline`, branch, base branch, and `copy`
materialization. The generated repository identity omits `originPath`; PLexus
uses the per-open workspace source path for the concrete worktree checkout.

## Image execution policy

The default image execution policy is disabled:

```json
{
  "mode": "disabled",
  "requireDisposableImage": true,
  "requireCleanupPlan": true,
  "docker": {
    "image": null,
    "network": "none",
    "autoRemove": true,
    "mountProjectReadOnly": true
  }
}
```

Projects may opt into Docker-backed image execution through
`extensions.dev-nexus-pharo.imageExecution` or through the generated PLexus
project config. When `mode` is `docker`, `docker.image` is required.

## Host capabilities

Host capability reports are advisory. They describe whether the local host has
tools such as Node.js, Git, PLexus, Pharo Launcher, and Docker available. They do
not grant permission to launch images or mutate a runtime.

## Pharo load workspaces

Managed project setup may declare Pharo load workspaces through generated PLexus
repository workspaces or project-specific skill material. DevNexus-Pharo keeps
that metadata outside the image so agents can load, test, and export Pharo code
through approved MCP routes.
