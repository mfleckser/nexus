# Nexus mobile

The phone app (Expo SDK 58, React Native). One screen: an agenda of today and the
next 7 days (events plus due tasks, overdue tasks on top, later and undated tasks
folded at the bottom), checking tasks off, and a quick-add sheet for a task or a
one-off event. No calendar grid, projects or notifications yet.

It talks to the backend through `@nexus/shared`: `createNexusClient` over
`fetchTransport` against `/api/v1`, sending `X-Nexus-Client: mobile` (rows it
creates get `created_via = mobile`). The agenda uses the shared due-date task groups
and all-day day mapping, so it matches the desktop app.

## Setup

From the repo root (one `node_modules` for every workspace):

```sh
npm install
cp mobile/.env.example mobile/.env   # API URL + token, see below
```

`mobile/.env`:

- `EXPO_PUBLIC_NEXUS_API_URL`: backend origin. Defaults to `http://127.0.0.1:5055`
  (`NEXUS_PORT=5055 backend/start`), which only the web preview or a simulator on
  this Mac can reach (the dev backend binds 127.0.0.1). On the phone, point it at the
  Pi's tailscale HTTPS URL (`https://<pi-name>.<tailnet>.ts.net`) once that host is up;
  the phone has to be on the tailnet.
- `EXPO_PUBLIC_NEXUS_API_TOKEN`: the backend's `NEXUS_API_TOKEN`. It's compiled into
  the JS bundle, which is fine for a personal build; don't publish one.

## Run

```sh
cd mobile
npx expo start        # scan the QR code with Expo Go on the phone
npx expo start --web  # quick look in a browser (needs a backend that allows CORS,
                      # or a same-origin proxy; the native app doesn't care)
```

## Offline

Every successful fetch is saved on the phone (AsyncStorage). When the backend can't
be reached, the app shows that last copy under an "Offline" banner with its time and a
Retry button. While offline nothing can be changed: checkboxes and quick add are off,
and writes are never queued. It refetches on pull-to-refresh, when the app comes to
the foreground and every minute.

## Checks

`npm run typecheck && npm run lint && npm test` from the repo root covers this
workspace too. `vitest` tests the pure helpers in `src/lib` (agenda building, labels,
quick-add bodies, the stored snapshot).
