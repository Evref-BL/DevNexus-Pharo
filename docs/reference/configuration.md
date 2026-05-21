# Configuration Reference

This reference summarizes DevNexus-Pharo configuration owned by this package.

## Home Shape

`dev-nexus-pharo init` creates `dev-nexus.home.json` and initial runtime
directories:

```text
<home>\
  dev-nexus.home.json
  DevNexus-Pharo\
    dev-nexus.project.json
    plexus.project.json
    worktrees\
  projects\
  workspaces\
  state\
  logs\
  generated\
```

The `DevNexus-Pharo` directory is the reserved control project. It is not a
normal Pharo application project.

## Project Shape

Each managed project has a `dev-nexus.project.json` file:

```json
{
  "version": 1,
  "id": "my-project",
  "name": "MyProject",
  "home": null,
  "repo": {
    "kind": "local",
    "remoteUrl": null,
    "defaultBranch": null
  },
  "worktreesRoot": "worktrees",
  "kanban": {
    "provider": "vibe-kanban",
    "projectId": null
  },
  "extensions": {
    "dev-nexus-pharo": {
      "plexusProjectConfig": "plexus.project.json"
    }
  }
}
```

Generic relative paths, such as `worktreesRoot`, resolve from the directory
containing `dev-nexus.project.json`. Pharo/PLexus paths, such as
`extensions.dev-nexus-pharo.plexusProjectConfig`, are interpreted by the
DevNexus-Pharo extension.

## Vibe Backend Modes

Vibe Kanban has two distinct pieces in the DevNexus-Pharo model:

```text
Vibe shared backend  -> project and issue data
Vibe local app       -> local repo/workspace runner and UI
```

DevNexus-Pharo configures the local app with `VK_SHARED_API_BASE`, so the app
talks to the intended shared backend.

`integrations.vibeKanban.backend.mode` supports:

- `docker`: DevNexus-Pharo runs Docker Compose directly.
- `dind`: DevNexus-Pharo starts a privileged `docker:dind` container and runs
  Docker Compose inside it.
- `external`: DevNexus-Pharo records and health-checks a backend it does not
  own.

The default local app command is pinned to `npx -y vibe-kanban@0.1.43`.

In managed backend modes, DevNexus-Pharo clones the Vibe source checkout when
`autoBootstrap` is true and the checkout is missing, then generates
`.env.remote` with local-only secrets and bootstrap local-auth credentials when
needed.

## GitHub Sign-In For Vibe

For GitHub sign-in with the self-hosted Vibe backend, set GitHub OAuth
credentials before startup:

```powershell
$env:DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_ID = "<github-oauth-client-id>"
$env:DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_SECRET = "<github-oauth-client-secret>"
```

Existing Git config can provide an email identity hint for fallback local auth,
but it cannot supply the OAuth client secret required by Vibe's backend.

## Image Execution Policy

DevNexus-Pharo writes a PLexus-facing `imageExecution` policy into
`plexus.project.json` for managed projects. The default policy is disabled and
requires disposable images plus an explicit cleanup plan before any launch work.

Docker-backed image execution must be enabled explicitly with a runner image:

```json
{
  "imageExecution": {
    "mode": "docker",
    "requireDisposableImage": true,
    "requireCleanupPlan": true,
    "docker": {
      "image": "ghcr.io/example/pharo-runner:test",
      "network": "none",
      "autoRemove": true,
      "mountProjectReadOnly": true
    }
  }
}
```

This policy is configuration only. DevNexus-Pharo must not launch Docker,
PLexus projects, or Pharo images unless the selected task names the isolated
runner, disposable image boundary, and cleanup command sequence.

## Pharo Load Workspaces

DevNexus-Pharo provides `preparePharoProjectLoadWorkspace` for setup flows that
need reliable local image loads.

The helper copies the project repository and declared Metacello dependency
repositories into a scoped workspace directory, then writes a Smalltalk load
script that loads every baseline through local `tonel://` repositories.

If a declared repository is missing its `BaselineOf<Name>` package, the helper
returns preflight diagnostics instead of writing a partial workspace.

Generated load workspaces are runtime support. They follow the image or
workspace lifecycle and should not be committed to the source checkout.

## Host Capabilities

DevNexus-Pharo exports static host capability helpers for DevNexus remote runner
planning.

`devNexusPharoHostCapabilityTags` contributes:

```text
pharo
pharo-launcher
plexus
mcp
dev-nexus-pharo
gui-adjacent
```

`evaluateDevNexusPharoStaticHostCapabilities` consumes mocked or setup-collected
facts and reports missing command, missing MCP config, missing PLexus gateway
command, and missing Pharo Launcher installation separately.

The published runner profile templates are:

```text
pharo-read-only-status
pharo-mcp-tool-list
pharo-verification
pharo-live-runtime
```

`pharo-live-runtime` remains approval-gated. It is not permission to launch
images, PLexus services, Docker, or GUI automation by itself.
