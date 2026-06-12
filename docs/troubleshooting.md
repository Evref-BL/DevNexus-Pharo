# Troubleshooting

## Missing Pharo Runtime Tools

DevNexus-Pharo does not expose image-local Pharo code tools. Those come from
MCP-Pharo through the PLexus `pharo_gateway` route.

If a Pharo task lacks `pharo_gateway` or image-local Pharo tools, report missing
PLexus routing or image setup. Do not edit Pharo source files as a substitute for
live-image inspection or repository handoff tools.

## Missing PLexus MCP Surfaces

Expected PLexus-owned surfaces are:

- `plexus_project`
- `pharo_launcher`
- `route_control`
- `pharo_gateway`

If one is missing, regenerate the DevNexus plugin projection and verify PLexus
setup. Do not add a replacement MCP server to DevNexus-Pharo.

## Stale DevNexus-Pharo CLI References

There is no supported `dev-nexus-pharo` command. Any local config, docs, or
agent instructions that mention it are stale and should be updated to use
DevNexus for project/workspace actions and PLexus for runtime actions.

## Live Runtime Work

DevNexus-Pharo host capability hints do not grant permission to launch images,
start Docker, open Pharo Launcher, or mutate PLexus routes. Use an explicitly
approved runner profile and cleanup plan for live runtime work.
