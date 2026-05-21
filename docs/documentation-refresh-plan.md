# Documentation Refresh Plan

This note records a reusable documentation direction for DevNexus-Pharo and the
related Pharo components. It is intentionally generic: it describes component
roles, reader paths, and documentation structure rather than a specific project
event or investigation.

## Shared Shape

Each component README should be a short, useful entry point:

1. one-paragraph promise
2. where the component fits in the stack
3. what it owns and does not own
4. requirements
5. one happy-path quick start
6. common workflows
7. safety or boundary notes
8. docs map

READMEs should not carry every tool, configuration field, backend mode, or
implementation note. Those details belong in user, reference, architecture, and
development docs.

## Shared Terms

- **workspace control plane**: DevNexus
- **Pharo environment layer**: DevNexus-Pharo
- **outside-image runtime control plane**: PLexus
- **Launcher adapter**: pharo-launcher-mcp
- **image-local worker**: MCP-Pharo
- **runtime target**: a scoped PLexus runtime that an agent routes to
- **image handle** or **imageId**: explicit image route identity

## Component Direction

Use the DevNexus README style as a baseline where it improves clarity: concise
terms, practical quick starts, and a docs map that points readers to deeper
material.

DevNexus-Pharo should explain two user paths:

- using a DevNexus-Pharo home and control project to create/import Pharo
  projects and supervise local services;
- using DevNexus-Pharo as an additive plugin in an existing DevNexus workspace.

PLexus should foreground outside-image runtime control: projects, workspaces,
targets, images, stable `imageId` routing, route-control separation, and
recoverability when images fail.

pharo-launcher-mcp should foreground its standalone role as the Pharo Launcher
MCP adapter, with separate docs for no-profile mode, explicit profile mode,
tool reference, result envelope, and cleanup behavior.

MCP-Pharo should explain that it is the image-local worker. It runs inside one
Pharo image and exposes live image code, test, repository, screenshot, and
environment tools. It is not the external orchestrator.

## DevNexus-Pharo README And Docs

For DevNexus-Pharo, documentation should:

- shorten the README into a clear entry point;
- add user docs for getting started, modes, and workflows;
- add reference docs for MCP and configuration;
- keep architecture focused on boundaries and design;
- keep development focused on contributors;
- move troubleshooting out of the README;
- avoid duplicating generic DevNexus tracker/provider documentation.

## Boundary Message

The consistent message should be:

DevNexus and PLexus operate outside Pharo images. Images are scoped runtime
targets. MCP-Pharo is the image-local worker. pharo-launcher-mcp is the Launcher
adapter. DevNexus-Pharo wires that into a Pharo-ready DevNexus environment.
