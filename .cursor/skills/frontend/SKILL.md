---
name: frontend
description: >-
    Conventions for Slick 0.7, Preact islands, SSR-first data loading, and structural CSS.
    Use whenever writing, changing, or reviewing HTML, CSS, JSX/TSX, pages, templates,
    islands, components, or styles.
---

# Front

Apply this skill on every front-end task. Also read:

- [slick.md](slick.md) before adding pages, templates, islands, `onrequest`, `onpost`, env, or SPA navigation
- [css-order.md](css-order.md) before writing CSS

## Project variables

Change this table when copying the skill to another project.

| Name            | This project | Controls                                                                                                         |
| --------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `UI_LANG`       | French       | All user-visible copy: labels, titles, errors, `alt`, placeholders, `aria-*` text                                |
| `COMMENTS_LANG` | English      | Code comments. Why only, never what                                                                              |
| `HTML_LANG`     | `fr`         | `new Slick(..., { lang })`, the `<html lang>` attribute                                                          |
| `SLOT`          | `div#app`    | Template injection slot. Slick requires `id="app"` in the template markup. This project uses a `div`, not `main` |
| `DASH`          | never `—`    | UI punctuation: comma, colon, parentheses, or `-`                                                                |

Write UI in `UI_LANG`. Write comments in `COMMENTS_LANG`. Do not use `DASH` in UI copy.

## Golden rule: no client init fetch

The first paint of a page must not wait on a browser request. Auth, redirects, and data loading happen in SSR
`onrequest`. Islands receive the slice they need as props.

**Forbidden by default:** `useEffect` that `fetch`es the page payload, a "Loading..." shell that then hydrates data,
reading the API only after mount.

**Allowed:** island `fetch` after a user action (toggle, save, delete, submit). Then update the DOM in place, or
`Slick.redirect(url, { reload: true })` so `onrequest` runs again.

**Exception:** data that cannot exist at SSR time (device APIs, WebSocket, live cursor). Add a `COMMENTS_LANG` comment
that says why.

### Data flow

```
GET /page
  -> template.onrequest   (shared: session, auth gate, layout data)
  -> page.onrequest       (route data)
  -> fail: res.redirect / res.status  (never render an empty shell)
  -> ok: req.data = ...
  -> template body + page body read req.data  (SSR HTML)
  -> islands get JSON props from that data
```

1. Put checks and fetches in `onrequest` (template if every page of that shell needs it, page if only that route needs
   it).
2. Short-circuit with `return res.redirect(...)` or an error response when the check fails.
3. Assign the result to `req.data`. Type it: `satisfies Template<{ items: Item[] }>` and `satisfies Page<typeof app>`.
4. `body: (req) => ...` (and `title` / `head` / `favicon` if they depend on data) reads `req.data`.
5. Pass only what the island needs: `<Row item={item} />`. The island does not refetch that payload.

`req.data` is filled by middleware, typed through the template/page, and available in `title`, `head`, `body`,
`favicon`, later `onrequest`, and `onpost`. See [slick.md](slick.md).

Do not import a template from an island (that pulls server `onrequest` into the client bundle).

## Stack and folders

Deno, `@webtools/slick-server` 0.7, optional `@webtools/slick-client` 0.4 (`client: true`), Preact 10, CSS in
`static/styles/`.

| Folder           | Role                                          |
| ---------------- | --------------------------------------------- |
| `pages/`         | One route per file, `export default` a `Page` |
| `templates/`     | Shells, `export default` a `Template`         |
| `islands/`       | Interactive Preact, hydrated on the client    |
| `components/`    | Static UI or pure logic, no own hydration     |
| `static/styles/` | CSS (tokens, reset, templates, pages)         |

Reuse `tokens.css` and `reset.css`. Do not invent colors, radii, spacing, or type already in tokens.

`template` is the imported object, not a name string:

```tsx
import app from "../templates/app.tsx";

export default {
	url: "/items",
	template: app,
	body: (req) => <section id="items">{req.data.items.length}</section>,
} satisfies Page<typeof app>;
```

Omit optional fields (`onrequest`, `onpost`, `head`, empty `styles` / `scripts`) instead of `null` or `[]`.

Fonts: `@import` in CSS (`tokens.css` or a zone file). No `<link>` or `preconnect` for fonts in `head`. Omit `head`
unless you need a specific meta or third-party script.

## HTML

Slick injects the template body into `div#root`. Do not wrap the template in an extra shell (`div#auth-shell`). A
template may return a fragment `<>...</>` when several roots are enough. An island should still prefer a single element
root (see Islands).

The page slot is `SLOT` (`div#app`), written in the template markup itself, not returned by a component. Slick injects
the page `body` as its children. Style the shell via `#root` in that template's CSS.

`header` / `footer` / `nav` / `main` belong in the template, once. Pages injected into `#app` use `section` / `aside` /
`article` / `div`. `header` / `footer` are allowed **inside a `<dialog>`**.

1. Clear semantic hierarchy. No wrappers with no job.
2. Do not duplicate landmark tags in the page. The slot is `div#app`, not `main`.
3. No `nav > ol` if `ol` is enough. No `div` around an already adjacent `h1` + `p`.
4. Extract a component or an island instead of copying markup.

```tsx
<div id="app">{/* page body */}</div>;
```

```tsx
<section id="register">
	<aside>...</aside>
	<article>...</article>
</section>;
```

## CSS

Read [css-order.md](css-order.md). Flex by default. Grid only when it is clearly better. No `float`, no absolute
positioning as layout, unless there is a real need.

- **Page or zone shell:** one `id` (`#register`, `#billing`).
- **Unique tag in a template:** type selector (`aside > h1`, `nav > a`). No extra `id`.
- **Reusable pattern:** `class` on the pattern root (`.field`, `.btn`, `.brand`).
- **Inside an identified shell:** no child `id`s. Semantic tags + structural selectors. No class on every child.

```css
#register > article > form > fieldset > label > span {
	...
}
```

One CSS file per page or zone, listed in `styles` of the template or page. Order in `styles` matters: later file wins at
equal specificity. To hide a zone, beat the later `display` with a child of the shell (`#page > #panel`), not a bare
`#panel`.

Short shared classes for patterns. No Tailwind-style utilities.

## Islands vs components

| Need                                               | Where         |
| -------------------------------------------------- | ------------- |
| Interactive (state, events, client forms, signals) | `islands/`    |
| Non-hydrated markup or UI logic                    | `components/` |

Islands are small. A switch, a row action, a dialog trigger. The list, headings, and stats stay SSR.

1. `export default` a Preact function. Prefer **one root element**. A fragment of elements is allowed by Slick; `null`,
   text-only, or mixed text+elements at the root is not.
2. Props are JSON: strings, numbers, booleans, arrays, objects. No functions, no classes, no `children`.
3. Pages and templates import islands. Islands import components. Do not import a template from an island.
4. Nested island imports are compiled into the parent bundle (only the outer island hydrates). Avoid unless it is
   clearly simpler.
5. Do not hydrate a block that only displays SSR data.

```txt
page / template
  -> island (interactive slice)
       -> component
  -> component (static SSR)
```

## Client libraries

Slick 0.7 compiles `static/` scripts and islands with esbuild.

- `client: true` bundles `@webtools/slick-client` from `deno.json`. Do not add it to `sharedLibs`.
- `preact`, `preact/hooks`, `preact/jsx-runtime`, `preact-root-fragment`, and `@preact/signals` (if imported in
  `deno.json`) are already shared. Do not add them to `sharedLibs`.
- Any other package used in an island: specifier in `deno.json` `imports` **and** in `sharedLibs` (if more than one
  island uses it, or it is large). No `esm.sh` URLs.
- Compile-time env: `config.env`, then bare identifiers (`API_URL`). No `Deno.env.get` in pages, templates, islands, or
  `static/` scripts. Declare them with `declare global` (for example `env.ts`) for TypeScript.
- Dev: pass `--dev`. `hotReload` only in that case. Changing `config.env`, `port`, or `sharedLibs` still needs a
  restart.

## Navigation

Forbidden: `location.reload()`, `location.assign()`, `location.href =`.

- Internal link: `<a href>`. Slick intercepts when `client: true`.
- Programmatic navigation: `Slick.redirect(url)` from `@webtools/slick-client`.
- Refresh SSR data on the same URL: `Slick.redirect(url, { reload: true, replace: true })`.
- Stay on the page after a mutation: update the DOM / signals (keep media, scroll, local state).
- `data-slick-ignore` on a link leaves it to the browser. `data-slick-reload` refetches the template.

POST forms are a full page load unless you `preventDefault` and `fetch`, or you handle them in `onpost`. GET forms
become query navigation.

## UX

- List / catalogue is the main content. Create and edit in a `<dialog>`, not a form always visible beside the list.
- Empty inputs: short `placeholder`s.
- Reset applies immediately. No second "Confirm" after Reset.
- An active filter or state must be visible (count, badge, `aria-pressed`).
- No control without a real use. Responsive: an intermediate breakpoint, not only desktop vs tiny phone.

## Factoring

Extract as soon as a pattern repeats. Two identical screens: one parameterized island, not two. Short props. Reuse
tokens before adding new ones.

## Checklist

- [ ] UI in `UI_LANG`, comments in `COMMENTS_LANG`, no `DASH`
- [ ] No client init fetch; `onrequest` -> `req.data` -> body -> island props
- [ ] Fonts via CSS `@import`, no font `<link>` in `head`
- [ ] `SLOT` in the template markup, no extra shell, no landmarks in the injected page
- [ ] Ids on shells, classes on patterns, structural CSS, property order
- [ ] Small islands, JSON props, one root, no template import from an island
- [ ] `config.env` globals, `sharedLibs` only for extra packages
- [ ] No hard reload; `Slick.redirect` or in-place update
- [ ] Placeholders, visible active state, intermediate breakpoint
