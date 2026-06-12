# DevNexus Dependency Mechanism Note

DevNexus-Pharo depends on DevNexus as a plugin API provider. The package should
publish plugin metadata and helper libraries only.

Do not restore a DevNexus-Pharo command or MCP server to work around dependency
projection issues. Fix plugin loading, dependency projection, or PLexus runtime
wiring in the owning package.
