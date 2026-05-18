# DevNexus Dependency Mechanism Plan

## Finding

DevNexus-Pharo is a separate npm package and imports DevNexus core APIs from
the package name `dev-nexus`. The current dependency is pinned in
`package.json` and `package-lock.json` as:

```json
"dev-nexus": "npm:@evref-bl/dev-nexus@0.1.0-alpha.12"
```

That is stale. The npm registry currently has `@evref-bl/dev-nexus` versions
through `0.1.0-alpha.15`, and the dogfood dist-tag points at `0.1.0-alpha.15`.
The current source-side MCP stdio fix is newer than that published package, so
there is no clean npm version for DevNexus-Pharo to consume yet.

This is not a Mac-specific problem. The Mac workaround of refreshing
`node_modules/dev-nexus/dist` from a sibling source checkout made the local
machine work, but it is not a durable project mechanism and should not be part
of normal setup.

## Decision

Use two explicit dependency lanes:

1. Released package lane for normal use, CI, and published DevNexus-Pharo.
2. DevNexus-managed source dependency lane for dogfood work that must consume an
   unreleased sibling component.

The released package lane is the default. The source dependency lane must be
explicit, generated, host-local, reproducible on macOS, Windows, and Linux, and
visible in setup/status output. It must never require hand-editing
`node_modules`, global `npm link`, or committed absolute paths.

## Released Package Lane

Required near-term cleanup:

1. Publish the current DevNexus source as a new prerelease, for example
   `@evref-bl/dev-nexus@0.1.0-alpha.16`, including the MCP stdio transport fix.
2. Move the `dogfood` dist-tag to that version.
3. Decide whether `latest` should also track the newest alpha. Today it points
   at `0.1.0-alpha.0`, which is surprising because all current packages are
   alpha-only.
4. Bump DevNexus-Pharo's direct dependency to the exact published DevNexus
   prerelease that it requires.
5. Update `package-lock.json` from npm, not from local source.
6. Run DevNexus-Pharo verification on a clean install path.
7. Publish a matching DevNexus-Pharo prerelease, for example
   `@evref-bl/dev-nexus-pharo@0.1.0-alpha.10`.

This lane makes normal install and CI behavior platform-neutral. Any macOS,
Windows, or Linux host with Node 24 and npm can run `npm ci` and receive the
same dependency graph.

## Source Dependency Lane

The source lane is for a bounded dogfood case: DevNexus-Pharo needs to test
against a DevNexus source checkout before that DevNexus change is published.

The clean mechanism should be implemented by DevNexus setup/worktree tooling,
not by manual shell steps:

1. Model component source dependencies in project metadata, for example
   DevNexus-Pharo depends on DevNexus source for local dogfood runs.
2. Resolve dependency paths through portable bases such as `sourcesRoot:` and
   `componentsRoot:`, never committed absolute host paths.
3. Materialize a host-local dependency overlay during setup or worktree
   preparation.
4. Prefer a deterministic package-manager-supported artifact, such as building
   and packing the sibling DevNexus checkout and installing that generated
   tarball into the DevNexus-Pharo worktree.
5. Record the overlay in ignored DevNexus state with source commit, package
   version, artifact path, and target package.
6. Report stale or missing overlays in setup/status before tests run.
7. Provide cleanup that removes only DevNexus-owned generated dependency state.

This avoids global links and direct `node_modules` surgery while still allowing
same-project source work before an npm publish.

## Non-Goals

- Do not commit `file:` dependencies that point outside the package. They would
  leak dogfood checkout topology into the published package.
- Do not rely on global `npm link`. It is host-global mutable state and is hard
  to audit.
- Do not commit generated `node_modules` content.
- Do not make DevNexus-Pharo require a sibling DevNexus checkout for normal
  package installation.

## Proposed Implementation Order

1. Release current DevNexus as a new prerelease and fix npm dist-tags.
2. Bump DevNexus-Pharo to that released DevNexus version and verify with
   `npm ci`, `npm run build`, and focused MCP startup tests.
3. Publish DevNexus-Pharo as a new prerelease.
4. Add DevNexus work-item coverage for the source dependency lane:
   portable source dependency metadata, setup/worktree materialization,
   status diagnostics, and cleanup.
5. Only after that exists, remove any undocumented dogfood-only local dependency
   refresh steps from runbooks.

