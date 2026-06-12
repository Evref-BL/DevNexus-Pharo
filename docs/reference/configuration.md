# Configuration

DevNexus-Pharo is configured as a DevNexus plugin. It does not have a separate
home directory, service state, or command-line configuration file.

## DevNexus Project Entry

A Pharo-capable DevNexus project enables the plugin:

```json
{
  "plugins": [
    {
      "id": "dev-nexus-pharo",
      "name": "DevNexus-Pharo",
      "enabled": true
    }
  ],
  "extensions": {
    "dev-nexus-pharo": {
      "plexusProjectConfig": "plexus.project.json"
    }
  }
}
```

## PLexus Project Config

DevNexus-Pharo can generate or normalize `plexus.project.json` defaults, but
PLexus owns the schema at runtime.

```json
{
  "id": "my-project",
  "name": "MyProject",
  "images": [],
  "imageExecution": {
    "mode": "disabled",
    "requireDisposableImage": true,
    "requireCleanupPlan": true
  },
  "runtime": {
    "gateway": {
      "mode": "project-local",
      "host": "127.0.0.1",
      "port": 17340,
      "agentMcpServerName": "pharo_gateway",
      "agentMcpPath": "/mcp",
      "routeControlMcpPath": "/control-mcp"
    }
  }
}
```

## Image Execution Policy

Default image execution is disabled. Projects may opt into scoped project-local
or Docker-backed image execution through `extensions.dev-nexus-pharo.imageExecution`
or through PLexus project config. Runtime work still requires an approved
runner and cleanup plan.
