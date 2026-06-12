# Workflows

## Enable Pharo Support In A DevNexus Project

1. Install the package as a development dependency.
2. Enable the `dev-nexus-pharo` plugin in the DevNexus project configuration.
3. Refresh DevNexus plugin projection so workers receive the Pharo skills and
   PLexus guidance.

Use DevNexus commands for generic project, component, work item, worktree, and
publication tasks.

## Prepare PLexus Runtime Context

For Pharo runtime work, configure PLexus for the project. DevNexus-Pharo can
provide PLexus project defaults, but PLexus owns the runtime schema and commands.

Expected PLexus-owned MCP surfaces are:

- `plexus_project`
- `pharo_launcher`
- `route_control`
- `pharo_gateway`

## Work On Pharo Code

Use the PLexus gateway to reach image-local MCP-Pharo tools. Do not edit Pharo
source files as a substitute for live-image inspection or repository handoff
tools when the task requires image state.

## Close Runtime Work

Record the image id, route identity, and workspace target in the handoff. Clean
only PLexus routes, images, and runtime resources owned by the current
workspace/target.
