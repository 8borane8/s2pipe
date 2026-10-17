# Slick 0.7 and slick-client 0.4

Library surface. Project rules stay in [SKILL.md](SKILL.md) (`UI_LANG`, SSR-first, `SLOT`).

Slick is Deno + Preact 10 SSR (`@webtools/slick-server`), optional SPA (`@webtools/slick-client`). Preact 11 is not
supported. Built on `@webtools/expressapi` (typed `req` / `res` / `middleware`).

## Boot

```ts
import { Slick } from "@webtools/slick-server";

const app = new Slick(import.meta.dirname!, {
	env: {
		API_URL: Deno.env.get("API_URL")!,
	},
	port: Number(Deno.env.get("PORT")!),
	lang: "fr",
	r404: "/",
	client: true,
	hotReload: Deno.args.includes("--dev"),
});

await app.start();
```

`deno.json` JSX: `"jsxImportSource": "preact"`, `"jsx": "react-jsx"`. Imports must include `preact`. If `islands/`
exists, also `preact-root-fragment`. If `client: true`, also `@webtools/slick-client` (Slick bundles that version, it
does not pin its own).

Run with `-A`, or at least `--allow-net --allow-read --allow-env --allow-run --allow-write`.

### `Config`

| Option       | Default | Role                                                                   |
| ------------ | ------- | ---------------------------------------------------------------------- |
| `env`        | `{}`    | Compile-time constants (esbuild `define`)                              |
| `port`       | `5000`  | Listen port                                                            |
| `lang`       | `"en"`  | `<html lang>` (use `HTML_LANG` from the skill)                         |
| `r404`       | `"/"`   | Redirect when no page/asset matches. Must be an existing page URL      |
| `client`     | `false` | SPA navigation. Bundles slick-client from `deno.json`                  |
| `hotReload`  | `false` | Watch sources, reload affected modules                                 |
| `trustProxy` | `false` | `req.ip` from `X-Forwarded-For`. Only behind exactly one reverse proxy |
| `sharedLibs` | `[]`    | Extra island vendor bundles, merged with built-in Preact libs          |

### `Slick` methods

- `load()`: validate workspace, bundle vendors, register routes. No listen. Throws on missing dirs, bad default exports,
  duplicate `url` / `name`, bad `r404`, island that is not a function component.
- `start()`: `load()`, optional watcher, listen on `port`. Stop with `await server.shutdown()`.
- `fetch(request, info?)`: handle one request after `load()`, useful in tests.

## Workspace

Required: `pages/`, `templates/`, `static/`. Optional: `islands/`. Scanned recursively. Two pages cannot share a `url`.
Two templates cannot share a `name`.

| Path           | Default export                                             |
| -------------- | ---------------------------------------------------------- |
| `pages/**`     | `Page`                                                     |
| `templates/**` | `Template`                                                 |
| `islands/**`   | Preact function component                                  |
| `static/**`    | Public files. `static/styles/app.css` -> `/styles/app.css` |

Reserved prefixes (do not use as routes or static files): `/~islands/*` (island bundles), `/~vendors/*` (shared libs).

## Env (`config.env`)

Injected as **bare identifiers** (`API_URL`), not `Deno.env.get`, not `process.env`. Available at SSR in pages and
templates, and on the client in islands, `static` JS/TS, and vendor bundles.

Declare them for TypeScript:

```ts
export {};
declare global {
	const API_URL: string;
}
```

Values bake in at compile / hot reload / static serve. Changing `config.env` requires a process restart. `Deno.env.get`
belongs only in the server entry that fills `config.env`.

## Templates

Only `name` and `body` are required.

```ts
interface Template<TData extends object = {}> {
	name: string;
	favicon?: Render<string>;
	styles?: readonly string[];
	scripts?: readonly string[];
	head?: Render<VNode>;
	body: Render<VNode>;
	onrequest?: Middleware<TData>;
}
```

`body` must contain **exactly one** element with `id="app"` in the template markup (not inside a component). The page
body is injected as its children.

`onrequest` runs for every page that uses this template, before the page `onrequest`. Use it for shared auth, shared
fetches, filling `req.data`. Return `res.redirect(...)` (or another response) to stop. Assign `req.data.*` and type it:

```tsx
export default {
	name: "app",
	body: (req) => (
		<>
			<header>{req.data.user?.name ?? "Guest"}</header>
			<div id="app"></div>
		</>
	),
	onrequest: async (req, res) => {
		const token = req.cookies.session;
		if (!token) return res.redirect("/login");
		req.data.user = await findUser(token);
	},
} satisfies Template<{ user: User }>;
```

Omit unused optional fields.

## Pages

Only `url` and `template` are required. `template` is the **imported template object**.

```ts
interface Page<TTemplate extends Template, TExtra = {}> {
	url: string;
	template: TTemplate;
	title?: Render<string>;
	styles?: readonly string[];
	scripts?: readonly string[];
	head?: Render<VNode>;
	body?: Render<VNode>;
	onpost?: RequestListener;
	onrequest?: Middleware;
}
```

`url` starts with `/`. `:params` are allowed. Static segments win (`/users/me` before `/users/:id`).

`satisfies Page<typeof app>` types `req.data` from the template. Extra page data / params / query:

```tsx
} satisfies Page<
	typeof app,
	{
		data: { item: Item };
		params: { id: string };
		query: { tab?: string };
	}
>;
```

Defaults: `params` is `Record<string, string>`, `query` is `Record<string, string | undefined>`.

Helpers that infer types: `template()`, `page()`, `middleware()` from `@webtools/slick-server`.
`TemplateData<typeof app>` is the template's `req.data`. This repo uses `satisfies` plus an explicit type parameter.

### `onrequest` (page)

Runs after `template.onrequest`, before render, and before `onpost`. Same contract: fill `req.data` or return a
response.

### `onpost`

POST to the page URL after both `onrequest`s. `req.body` is parsed from the content type. Without `onpost`: `405` in
client mode, `404` otherwise.

In client mode, POST with header `X-Slick-Template` is SPA navigation, not your `onpost`. Use `onpost` for real form/API
POSTs.

### `Render<T>`

`title`, `favicon`, `head`, `body`: a static value, or `(req) => T`, possibly async. `req` is expressapi `HttpRequest`:
`path`, `params`, `query`, `cookies`, `headers`, `data`, `ip`, ...

Fetching in `body` works, but prefer `onrequest` so redirects happen before render and `req.data` is typed for every
field.

## Static files

| Type                      | Handling                         |
| ------------------------- | -------------------------------- |
| `.css`                    | Minified, `text/css`             |
| `.js` `.ts` `.jsx` `.tsx` | Transpiled, minified, ES modules |
| Other                     | As-is                            |

Production: in-memory compile cache, `ETag`, `Cache-Control: no-cache` (304 when unchanged). `hotReload`: recompile
every request, no cache. Path traversal outside `static/` is refused. Static scripts get `config.env`.

## Islands

SSR + hydrate. Only islands ship component JS.

- `export default` a function component.
- Props JSON-serializable. No functions, classes, `children`.
- At least one root element. Fragment of elements: OK (one island, several tagged roots; first root holds
  `data-slick-props`). `null`, text-only, or mixed text+elements at the root: throws.
- Import from pages/templates. An island imported by another island is inlined in the parent; only the outer one
  hydrates.
- Tagged in HTML: `data-slick-island`, `data-slick-island-id`, `data-slick-props` on the first root. Hydration script
  loads `/~islands/`. `MutationObserver` hydrates islands added by SPA navigation.

This project: keep islands small, prefer one root, pass SSR data as props, no init `fetch`.

## Shared libraries

Each island is bundled alone. Without `sharedLibs`, a package imported by three islands is copied three times.

Always shared when `islands/` exists: `preact`, `preact/hooks`, `preact/jsx-runtime`, `preact-root-fragment` (version
from `deno.json`). `@preact/signals` if it is in `deno.json`. With `client: true`: `@webtools/slick-client`.

Add other specifiers to `sharedLibs` **and** `deno.json` `imports`. Rule of thumb: any third-party lib used by more than
one island, or any large lib used even once.

Slick resolves the closest `deno.json` above the workspace, including a Deno workspace root. Creating `islands/` for the
first time requires a restart.

## Client mode (SPA)

First request: full SSR. Later same-origin navigations: `fetch` + JSON patch (page, and template only if it changed).
Template and page `onrequest` still run. Unknown URL: redirect `r404`.

`styles` / `scripts` get `slick-type="template"|"page"` so the client can swap them. The document keeps `html`, `title`,
favicon (`data:,` if none).

### slick-client 0.4

```ts
import { Cookies, encodeBody, FormHandler, parseForm, Slick } from "@webtools/slick-client";

await Slick.redirect("/items");
await Slick.redirect("/items", { reload: true, scroll: false, replace: true });
```

| API                             | Role                                                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Slick.redirect(url, options?)` | Client navigation. `reload` refetches the template. `scroll: false` keeps position. `replace` replaces history                                        |
| `Slick.addOnloadListener(fn)`   | After each navigation (not the first load). Returns an unsubscribe. Page scripts re-run: remove the listener or it stacks                             |
| Links                           | Same-origin `<a>` intercepted. Hash-only: scroll. Left to the browser: `target`, `download`, cross-origin, `data-slick-ignore`, modifier/middle click |
| `data-slick-reload`             | Refetch template even on the current page                                                                                                             |
| GET forms                       | Fields become the query string                                                                                                                        |
| POST forms                      | Full page load. To stay in the SPA: `preventDefault` + `fetch` / `FormHandler`                                                                        |
| `parseForm(form)`               | Object matching expressapi schemas (numbers, checkboxes, files, `data-transform="csv"                                                                 |
| `encodeBody(body)`              | JSON, or multipart if a `File` is present                                                                                                             |
| `FormHandler(form, handler)`    | Submit: parsed body + submitter. `aria-busy`, disables the button, ignores double submit                                                              |
| `Cookies.get/set/delete`        | Same rules as expressapi cookies. `set` throws on forbidden characters                                                                                |
| `html[data-slick-loading]`      | While a navigation is in flight                                                                                                                       |
| `slick:navigate`                | CustomEvent, `detail.url`, after navigation                                                                                                           |

Latest navigation wins (cancels the previous). Failure / timeout (30s) / unexpected response: full page load. After
navigation, focus moves to `#app` (`tabindex="-1"`). Scroll is saved in history.

Do not use `location.reload` / `assign` / `href =`. `Slick.initialize(template)` (no second argument). Old
`redirect(url, reload, goTop, fromHistory)` is `{ reload, scroll, replace }`.

## HTTP routing

For each page:

- `GET` / `HEAD` `page.url`: SSR HTML, or SPA JSON in client mode
- `POST` `page.url`: `onpost`, or SPA when `X-Slick-Template` is set

Unmatched GET/HEAD: redirect `r404`. Bundles and static files use `ETag`.

## Hot reload

Watches the workspace except `static/`, `node_modules/`, hidden folders. Reloads the affected page/template/island
graph. Syntax error: log, keep the previous version. Visible on the next request (refresh to re-hydrate islands).

Restart still required for `config.env`, `port`, `sharedLibs`, other server options, or the first `islands/` directory.

## Types to import

`Slick`, `Config`, `Page`, `Template`, `Render`, `SlickRequest`, `TemplateData`, `UrlParams`, `template`, `page`,
`middleware`.

## From 0.6

- `template` is the object, not `"app"`.
- Optional fields are optional: omit them.
- `client: true` bundles slick-client from `deno.json`.
- Env is `config.env` identifiers.
- `Slick.redirect` takes an options object.
- Nested islands are inlined; fragments of elements are hydratable.
