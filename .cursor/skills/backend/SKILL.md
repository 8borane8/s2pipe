---
name: backend
description: >-
    Organization and style for the Deno API (Sequelize, apps/api) and the Expo app (apps/app).
    Simple, direct, no dead code, folders by role, line-by-line returns. Use whenever writing,
    changing, arranging, or reviewing code in apps/api or apps/app: routes, models, services,
    utils, screens, hooks, components, types.
---

# Structure and style

Apply this skill on every task in `apps/api` and `apps/app`. Web front (landing, store) follows the `frontend` skill.

Also read [expressapi.md](expressapi.md) before adding API routes, middlewares, or CORS.

## Project variables

Change this table when copying the skill to another project.

| Name            | This project   | Controls                                                               |
| --------------- | -------------- | ---------------------------------------------------------------------- |
| `UI_LANG`       | French         | User-visible copy in the app and API error messages shown to humans    |
| `COMMENTS_LANG` | English        | Code comments. Why only (security, idempotency, edge case), never what |
| `DASH`          | never `—`      | UI punctuation: comma, colon, or `-`                                   |
| `API_DIR`       | `apps/api/src` | API root                                                               |
| `APP_DIR`       | `apps/app/src` | Mobile app root                                                        |

Write UI in `UI_LANG`. Write comments in `COMMENTS_LANG`. Do not use `DASH` in UI copy.

## Principles

1. **Simple, direct, enough.** Do not add config, routes, fields, or options nobody asked for.
2. **No dead code.** Remove unused exports, imports, types, columns, routes, response fields the client never reads,
   temp files (`tmp_*`).
3. **A function used once is inlined**, unless its name isolates real logic. No rename-only wrappers.
4. **Use the stdlib and libraries already in the project** (`Buffer`, `decodeJwt` from `jose`, ...).
5. **Derive rather than store.** A count that can be queried is not a column (`Model.count(...)`).
6. **Closed values as enums**, not a free string with a misleading default.
7. **One path per rule.** Two near-identical blocks become one.

## Folders

### `API_DIR`

| Folder           | Role                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `routes/`        | `@webtools/expressapi` routers via `addRoute`. `routes/user/` for auth |
| `middlewares/`   | Middlewares (`requireUser`)                                            |
| `models/`        | Business tables                                                        |
| `models/events/` | Event tables: history, purchases, "already seen"                       |
| `services/`      | External integration, **one export** per file                          |
| `utils/`         | **Several exported functions** or shared business logic                |

- Many exported functions: util, not service.
- Two related operations: `export const google = { readTransaction, consumeTransaction }`. One operation: export the
  function.
- Imports via `@/...`. One model per file, loaded with `importModels("models/**/*.ts")`.
- Relations: `HasMany` on the parent is enough. Skip the reverse `BelongsTo` if it is unused (avoids circular imports).

### `APP_DIR`

| Folder               | Role                                   |
| -------------------- | -------------------------------------- |
| `app/`               | Expo-router screens and `_layout` only |
| `components/ui/`     | Generic UI                             |
| `components/<zone>/` | Zone UI (`home`, `account`, ...)       |
| `constants/`         | Theme, products, review                |
| `hooks/`             | Hooks shared across screens            |
| `providers/`         | Contexts                               |
| `services/`          | External access (`api.ts`, `store.ts`) |
| `types/`             | Shared types                           |
| `utils/`             | Pure functions                         |

- Imports via `@/...`. Never a relative path that climbs (`../../src/...`).
- Logic duplicated in two screens becomes a hook or a shared component.
- Shared UI lives in `components/`, not in a screen.
- File names: kebab-case.

## Code style

Read top to bottom. Strategic line breaks, one item per line.

- JSON and objects: one key per line as soon as there is more than one key or the line is longer than ~100 characters.
- Validation `body: z.object({...})`: one field per line. No `params` schema: `:id` in the path already types it.
- Sequelize options (`where`, `transaction`, `defaults`, `attributes`, `include`): multiple lines.
- Chains: one call per line.
- Blank line between handler steps (check, act, respond).
- In `addRoute`, a blank line between identity (`url`, `method`), execution (`middlewares`, `requestListener`), and
  `schemas`.

```ts
.addRoute({
	url: "/items/:id",
	method: HttpMethods.PATCH,

	middlewares: [requireAuth],
	requestListener: async (req, res) => {
		return res.json({ success: true as const });
	},

	schemas: {
		body: z.object({
			name: z.string().min(1),
		}),
	},
});
```

A tiny one-key response may stay on one line: `return res.json({ success: true as const });`.

## API rules

- Every route through `addRoute`. Not `.get` / `.post` / `.patch` / `.delete`.
- If every following route shares a middleware: `router.use(mw)` once, do not repeat it on each `addRoute`.
- CORS `allowOrigin: "*"` is the default: do not call `.cors()` unless you need another origin, credentials, or extra
  headers.
- Every response is `{ success: true, data? }` or `{ success: false, error }` with `as const`.
- Concurrent-sensitive work: conditional `UPDATE` or a unique constraint, in a transaction. No read-then-write.
- Idempotency via unique constraint, not a pre-check.
- Never trust the client: re-check identity, payment, and state at the source.
- `Authorization: Bearer` only for an access token. A secret or password goes raw in the header.
- Secrets stored encrypted. Do not read `.env` files in code or in commands.
- A model only has columns that are read somewhere. Add a column = use it in the same change.
- File DB plus `sync({ alter: true })`: after a large schema change, warn that the file may need to be recreated.

## App rules

- The client does not own business rules. The API decides. The app displays and refreshes the profile after an action.
- Network goes through `services/api.ts` (timeout, centralized 401). No `fetch` in a screen.
- Short screens: reusable logic in a hook, reusable UI in `components/`.
- Demo data only in `constants/`.

## Verify before shipping

From `apps/api`:

```bash
deno fmt src
deno check src/index.ts
deno lint src
```

From `apps/app`:

```bash
npx tsc --noEmit --noUnusedLocals --noUnusedParameters
```

Dead exports: the name of an export must appear at least once elsewhere in `src`. The only exports without another
reference are `export default` of routes.

## Checklist

- [ ] File in the right folder (service: one export, util: several)
- [ ] `@/` imports, no climbing relative paths
- [ ] No unused export, import, type, column, or route
- [ ] No one-call function that does not earn its name
- [ ] Enums for closed values, derived counts
- [ ] `addRoute`, shared `use`, default CORS, visual grouping
- [ ] JSON, schemas, Sequelize options line by line
- [ ] Sensitive operations atomic and idempotent
- [ ] Comments in `COMMENTS_LANG` (why only), UI in `UI_LANG`, no `DASH`
- [ ] `deno fmt`, `deno check`, `deno lint` (API) and `tsc` (app) pass
