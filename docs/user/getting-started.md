# Getting started

Use DevNexus-Pharo when a DevNexus project needs Pharo support skills, Codex MCP
projection, and a PLexus route into Pharo runtime tooling.

## Requirements

- Node.js 24 or newer
- Git
- a working `plexus-gateway` command when live routing is needed
- Pharo Launcher and MCP-Pharo only when the selected task requires live image
  work

## Install from source

```powershell
cd C:\work\src\DevNexus-Pharo
npm install
npm run build
npm link
```

## Initialize the home

```powershell
dev-nexus-pharo init
```

This writes `dev-nexus.home.json`, creates runtime directories, and creates the
reserved `DevNexus-Pharo` control project.

## Start services

```powershell
dev-nexus-pharo start
```

This starts:

- the DevNexus-Pharo MCP HTTP service
- the PLexus gateway service

It also ensures the control project exists. It does not launch Pharo images.

Check the service graph:

```powershell
dev-nexus-pharo status --check-health
```

Stop it:

```powershell
dev-nexus-pharo stop
```

## Create a Pharo project

Create an empty Git-backed project:

```powershell
dev-nexus-pharo project create MyProject --git-init
```

Create a managed project from a remote repository:

```powershell
dev-nexus-pharo project create MyProject --from https://git.example.test/org/MyProject.git
```

Import an existing checkout:

```powershell
dev-nexus-pharo project import C:\work\src\ExistingProject --name ExistingProject
```

## Prepare Codex

Run Codex setup from the managed project root:

```powershell
dev-nexus-pharo codex init C:\work\.dev-nexus-pharo\projects\MyProject
dev-nexus-pharo codex doctor C:\work\.dev-nexus-pharo\projects\MyProject
```

Open a new Codex chat after `doctor` passes. Existing chats may keep the MCP
tool list they loaded at startup.

## Existing DevNexus workspaces

For an existing DevNexus project with the `dev-nexus-pharo` plugin enabled:

```powershell
dev-nexus-pharo project skills refresh C:\work\agent-workspace
dev-nexus-pharo codex init C:\work\agent-workspace
dev-nexus-pharo codex doctor C:\work\agent-workspace
```

This projects Pharo skills and scoped MCP entries. It does not start images,
PLexus project runtimes, Docker, or GUI tools.
