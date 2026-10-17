# expressapi 0.10

Library surface used by `apps/api`. Project rules stay in [SKILL.md](SKILL.md).

`@webtools/expressapi` is a small typed HTTP layer on Deno `Request` / `Response`. End-to-end types:
`export type AppRouter = typeof server` then `new HttpClient<AppRouter>({ baseUrl })`.

## Boot

```ts
import { HttpServer } from "@webtools/expressapi";
import mainRouter from "@/routes/index.ts";

new HttpServer()
	.use(mainRouter)
	.listen(Number(Deno.env.get("API_PORT")));
```

Mount routers with `.use()`. Do not re-declare CORS when `allowOrigin: "*"` is enough (that is the default). Call
`.cors({ ... })` only for another origin, credentials, or extra headers.

## `addRoute`

Declare every route with `addRoute`. Do not use `.get` / `.post` / `.patch` / `.delete`.

```ts
import { HttpMethods, Router, z } from "@webtools/expressapi";

export default new Router()
	.use(requireAuth)
	.addRoute({
		url: "/items/:id",
		method: HttpMethods.PATCH,

		middlewares: [requireOwner],
		requestListener: async (req, res) => {
			return res.json({
				success: true as const,
				data: { id: req.params.id },
			});
		},

		schemas: {
			body: z.object({
				name: z.string().min(1),
			}),
			query: z.object({
				tab: z.optional(z.string()),
			}),
		},
	});
```

Blank line between identity (`url`, `method`), execution (`middlewares`, `requestListener`), and `schemas`.

| Field             | Role                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `url`             | Path. `:id` is typed on `req.params`. Static segments win over params        |
| `method`          | `HttpMethods.GET` / `POST` / `PATCH` / `DELETE` / ...                        |
| `middlewares`     | Extra middlewares for this route. Skip if `router.use(mw)` already covers it |
| `requestListener` | Handler. `req` / `res` are typed from schemas and middlewares                |
| `schemas.body`    | JSON (or form) body                                                          |
| `schemas.query`   | Query string                                                                 |
| `schemas.params`  | **Do not set.** The `:param` in `url` already types `req.params`             |

If every following route shares a middleware, `router.use(mw)` once. Per-route `middlewares` only when this route
differs (extra `single`, extra `attributes` on `requireUser`, ...).

## Middleware and `req.data`

```ts
import { type Middleware, middleware } from "@webtools/expressapi";

export interface AuthData {
	user: User;
}

export const requireAuth: Middleware<AuthData> = middleware<AuthData>(async (req, res) => {
	const token = req.headers.get("authorization")?.split(" ")[1] || "";
	const payload = await jsonToken.verify<{ type: "user"; id: string }>(token);
	if (!payload || payload.type !== "user") {
		return res.status(401).json({
			success: false as const,
			error: "401 Unauthorized.",
		});
	}

	req.data.user = await User.findByPk(payload.id);
	if (!req.data.user) {
		return res.status(401).json({
			success: false as const,
			error: "401 Unauthorized.",
		});
	}
});
```

- Return a response to stop. Return nothing to continue.
- Context accumulates in `req.data`. Wrong middleware order fails at compile time.
- `Authorization: Bearer` only for an access token. A secret or password is compared to the raw `authorization` header
  (no `split(" ")`).

## Validation (`z`)

Built-in. No extra Zod package. One field per line. `z.optional(...)` for omitted keys (empty numbers / missing files
from slick `parseForm` are omitted, not `null`).

Typical: `z.string().min().max()`, `z.number().int().min()`, `z.boolean()`, `z.optional(...)`.

## Responses

Always:

```ts
{ success: true as const, data?: ... }
{ success: false as const, error: string }
```

Human-facing `error` strings follow `UI_LANG` when the client shows them as-is. Machine-facing API errors in this
project stay short English status phrases (`"401 Unauthorized."`) when the app maps them.

## `JsonToken`

```ts
import { JsonToken } from "@webtools/expressapi";

export const jsonToken = new JsonToken(Deno.env.get("JWT_SECRET")!);
```

`sign` / `verify` for access tokens. Secret from env in the server entry or the service file via `Deno.env.get`, never
from a committed `.env` read in commands.

## `HttpClient` (typed consumer)

```ts
import { HttpClient } from "@webtools/expressapi";
import type { AppRouter } from "./server.ts";

const client = new HttpClient<AppRouter>({ baseUrl: "http://localhost:5050" });
const item = await client.get("/items/:id", { params: { id: "42" } });
```

The mobile app may wrap this (timeout, 401). Do not `fetch` from screens.

## Request shape (useful fields)

`req.params`, `req.query`, `req.body`, `req.headers`, `req.cookies`, `req.data`, `req.ip` (`trustProxy` / forwarded-for
is a server concern). `res.status().json()`, `res.redirect()`, `res.json()`.
