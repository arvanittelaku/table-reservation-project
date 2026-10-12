# TypeScript

The web app is TypeScript (`strict`). `allowJs` is on, so any leftover `.js`/`.jsx` file still builds and imports.

## Commands

| Command | Use |
|---|---|
| `npm run typecheck` | `tsc --noEmit` with `tsconfig.json`, against the real `@types/react`, `@types/react-dom`, `vite/client` and the types shipped by `react-router` / `@tanstack/react-query`. The normal check, once `npm install` has run. |
| `npm run typecheck:offline` | `tsc --noEmit -p tsconfig.offline.json`: the same check against the local shims (below). Only needed where `node_modules` cannot be installed. |

Both passed with 0 errors when the migration was finished. The real-types check was run against React 19 `@types` built from DefinitelyTyped source plus react-router 7.18 / react-query 5.90 declarations.

## Offline shim: delete after `npm install`

The migration was done in a sandbox without npm, so React's types were not installed. These files stand in for them:

- `src/types/react-shim.d.ts`: the subset of `react`, `react/jsx-runtime` and `react-dom/client` the app uses (hooks with their real generic signatures, `createContext`, `lazy`, `Suspense`, `memo`, `FC`, `ReactNode`, synthetic events). `JSX.IntrinsicElements` is loose: common attributes and every event handler are typed, and any other attribute is accepted unchecked.
- `src/types/vendor-shim.d.ts`: the parts of `@tanstack/react-query` and `react-router` the app uses, plus `*.css` imports.
- `tsconfig.offline.json`: the only config that includes them. `tsconfig.json` excludes both files.

Once `npm install` has run and `npm run typecheck` passes, delete these three files and the `typecheck:offline` script. Do not keep the shims around: they are ambient `declare module` blocks, and if a config ever included them they would hide the real types.

## Layout

- `src/types/db.ts`: one interface per database row the app reads, with columns taken from `backend/ejb/models.py`. It also holds the RPC result shapes (`MyPlan`, `MyWednesday`, `SharePreview`, lessons listings).
- `src/components/admin/adminTypes.ts`: the `admin_*` RPC results (from `backend/ejb/services/`).
- `src/types/globals.d.ts`: browser APIs the DOM lib lacks (FaceDetector, Jitsi) and the `window.*` globals the app uses.
- `src/vite-env.d.ts`: the `VITE_*` env variables.
- `src/backendClient.ts`: a generic query builder. `sb.from('profiles')` is typed by `DbTables` in `db.ts`. `.single()`, `.maybeSingle()` and `.returns<R>()` narrow the result type.

## Remaining loose spots

- `backendClient.ts`: the builder changes its own result type with `this as unknown as Query<...>` (8 places). The runtime object is the same and only the declared result shape changes. This is the usual builder pattern.
- `Record<string, unknown>` at true JSON boundaries: `api/rpc.ts` (RPC args), `components/admin/adminApi.ts`, `backendClient.ts` (filters and request bodies), `globals.d.ts` (Jitsi config overrides).
- `profiles.user_preferences` and other `jsonb` columns are typed as `Json`, then narrowed where they are read.
- A few `useEffect`s deliberately leave out deps (they carry the existing `eslint-disable` comments). This is behaviour as before, not a typing hole.
- `src/api/lessons.ts` and `src/components/lessons/*` are owned by another engineer and were not edited as part of this migration.
