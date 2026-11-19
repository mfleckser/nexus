# Nexus mobile

The phone companion app (roadmap step 5). Not started yet. It will talk to the
backend through `@nexus/shared` (`packages/shared`): `createNexusClient` with
`fetchTransport({ origin, token, client: "mobile" })`, plus the shared task
grouping and repeat-rule helpers. Add it to the root `package.json` workspaces
when it gets a `package.json`.
