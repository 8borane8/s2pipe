---
name: frontend
description: >-
    Conventions front (Slick, Preact, CSS structurel, islands).
    A utiliser des que l'on ecrit, modifie ou review du HTML, CSS, JSX/TSX,
    pages, templates, islands, components ou styles.
---

# Front

Appliquer ces regles a chaque tache front. Lire aussi [css-order.md](css-order.md) avant d'ecrire du CSS.

## Langue et prose

- Tout le contenu UI, commentaires utiles, labels, titres, messages et textes visibles en francais.
- Ne jamais utiliser le tiret cadratin (`—`). Preferer la virgule, les deux-points, les parentheses ou un tiret simple
  `-`.

## Stack et dossiers

Stack: Deno, `@webtools/slick-server`, Preact, CSS dans `static/styles/`.

| Dossier          | Role                                                 |
| ---------------- | ---------------------------------------------------- |
| `pages/`         | Routes SSR                                           |
| `templates/`     | Layouts                                              |
| `islands/`       | UI interactive hydratee                              |
| `components/`    | UI statique ou logique pure, sans hydratation propre |
| `static/styles/` | CSS (tokens, reset, pages, templates)                |

Reutiliser `tokens.css` (variables) et `reset.css`. Ne pas reinventer couleurs, rayons, espaces ou typos deja tokens.

## Polices et assets

- Importer les polices via `@import` dans le CSS (`tokens.css` ou fichier de zone), pas via `<link>` ou `preconnect`
  dans `head`.
- Laisser `head: null` sauf besoin exceptionnel (meta specifique, script tiers, etc.).

## HTML structurel

### Slick et `#root`

Le body rendu d'un template est deja injecte dans `div#root` par Slick. Inutile d'ajouter une div principale de coque
(`div#auth-shell`, etc.) : utiliser un fragment `<>...</>` quand plusieurs racines suffisent.

Le slot de page est `div#app` (pas un `main`) : Slick y injecte le body de la page. Les templates portent deja `header`
(et `nav` si besoin). Les pages injectees dans `#app` n'utilisent **pas** `main`, `header`, `footer`, `nav` : `section`
/ `aside` / `article` / `div`. `header` / `footer` restent valides **dans un `<dialog>`**.

Styler la coque via `#root` dans le CSS du template concerne.

### Semantique et wrappers

1. `main`, `header`, `footer`, `nav` : seulement dans le template (une fois). Pas de doublon dans la page injectee. Le
   slot du template est `div#app`.
2. Les pages injectent leur contenu dans `div#app` avec `section`, `aside`, `article`, puis elements semantiques ou
   `div` / `span` si besoin.
3. Preferer une hierarchie claire et semantique plutot que des wrappers inutiles.
4. Eviter les conteneurs sans but precis : pas de `nav > ol` si `ol` seul suffit (choisir l'un ou l'autre), pas de `div`
   autour d'un `h1` + `p` deja adjacents, etc.
5. Factoriser: pas de duplication de markup; extraire un component ou une island selon le cas.

Exemple template (slot Slick) :

```tsx
<div id="app">{/* contenu page */}</div>;
```

Exemple page avec aside :

```tsx
<section id="register">
	<aside>...</aside>
	<article>...</article>
</section>;
```

Exemple page simple :

```tsx
<section id="login">
	<article>...</article>
</section>;
```

## CSS structurel

### Selecteurs

- **Conteneur de page ou zone** : un `id` sur la coque unique (`#register`, `#billing`).
- **Balise unique dans le template** : pas besoin d'`id` si l'element n'existe qu'une fois (`aside`, `nav`, `header`
  dans ce template). Utiliser le selecteur de type directement (`aside > h1`, `nav > a`).
- **Motif reutilisable** : `class` sur le conteneur racine du motif (`.field`, `.btn`, `.brand`).
- **Enfants d'un conteneur identifie** : eviter les `id` enfants. Preferer le markup semantique (`h1`, `p`, `form`,
  `fieldset`) et des selecteurs structurels.
- A l'interieur d'un conteneur, **pas** de classes partout. Styler via cascade et selecteurs structurels:

```css
#register > article > form > fieldset > label > span {
	...
}
aside > h1 {
	...
}
aside > ol > li[aria-current="step"] > p {
	...
}
.field > input {
	...
}
```

- Factoriser les styles partages en classes courtes; eviter les utilitaires type Tailwind.
- Un fichier CSS par page ou zone, declare dans `styles` du template/page.

### Fichiers et specificite

L'ordre dans `styles` compte: a specificite egale, le fichier charge **plus tard** gagne.

Pour masquer une zone, le selecteur doit battre le `display` du fichier de zone. Preferer un enfant de la coque:

```css
#page > #panel {
	display: none;
}
```

pas `#panel { display: none }` si `#panel { display: flex }` est declare plus loin.

### Layout

- Preferer **flexbox** par defaut.
- Utiliser **grid** seulement quand c'est clairement mieux (grilles 2D, alignements complexes).
- Eviter `float`, et les proprietes layout exotiques ou fragiles (`position` absolu partout, hacks, etc.) sauf besoin
  reel.

### Ordre des proprietes

Toujours le meme ordre de groupes. Mieux vaut declarer explicitement (ex. `flex-direction: row`) que d'omettre. Details
et liste complete: [css-order.md](css-order.md).

```css
.box {
	width: 100%;
	height: auto;
	max-width: 28rem;

	color: var(--color-text);
	font-size: var(--text-md);
	font-weight: 400;
	font-family: var(--font-sans);
	line-height: 1.5;

	text-align: left;
	text-transform: none;

	display: flex;
	flex-direction: row;
	justify-content: flex-start;
	align-items: center;
	flex-wrap: nowrap;
	gap: var(--space-3);

	margin: 0;
	padding: var(--space-4);

	overflow: visible;
	background: var(--color-bg-elevated);
	border: 1px solid var(--color-border);
	border-radius: var(--radius-md);
}
```

## Islands vs components

| Besoin                                                          | Emplacement   |
| --------------------------------------------------------------- | ------------- |
| Element interactif (etat, events, formulaires client, signals)  | `islands/`    |
| Markup / UI non hydratee, ou logique UI sans hydratation propre | `components/` |

Regles strictes:

1. Une island = racine d'interactivite. Export default Preact depuis `islands/`.
2. Les components peuvent etre dynamiques (props, rendu conditionnel) mais **doivent etre importes depuis une island**
   (ou depuis une page/template s'ils restent 100% statiques SSR).
3. **Interdit**: importer une island depuis une autre island.
4. Pages et templates importent les islands; les islands importent des components, jamais l'inverse pour l'hydratation.
5. Minimiser le JS client: ne pas hydrater ce qui peut rester HTML statique.

```txt
page / template
  -> island (interactive)
       -> component (sous-UI, factorisee)
  -> component (statique SSR ok)
```

## Navigation

Interdit: `location.reload()`, `location.assign()`, `location.href =`.

- Changer de page: `Slick.redirect(url)` (`@webtools/slick-client`).
- Rester sur la page apres une mutation: mettre a jour le DOM et les signals (conserver media, scroll, etat local).
- Lien interne: `<a href>` suffit (Slick intercepte).

## UX

- Liste / catalogue: la liste est le contenu principal. Creation et edition dans un `<dialog>`, pas un formulaire
  toujours visible a cote.
- Champs de saisie vides: `placeholder` (exemples courts).
- "Reinitialiser" applique tout de suite. Pas besoin d'une seconde confirmation du type Valider.
- Un filtre ou etat actif doit se voir (compteur, pastille, `aria-pressed`).
- Ne pas garder de controle UI sans usage reel.

## Factorisation

- Extraire des qu'un motif se repete (markup, CSS, logique).
- Preferer un component/island clair plutot que copier-coller. Deux ecrans identiques = une island parametree, pas deux.
- CSS: classes partagees pour les motifs; ids pour les coques de page.
- Props et API internes courtes; pas d'abstractions prematurees inutiles.
- Reutiliser tokens et styles existants avant d'en ajouter.

## Checklist avant de livrer

- [ ] Textes FR, aucun tiret cadratin
- [ ] Polices via `@import` CSS, pas de `<link>` font dans `head`
- [ ] Pas de div coque inutile dans le template (`#root` suffit)
- [ ] `div#app` dans le template (slot Slick), pas de `main` sur le slot
- [ ] Pas de `main` / `header` / `footer` / `nav` dans la page injectee (deja dans le template)
- [ ] Balises uniques sans `id` superflu; pas d'`id` sur les enfants d'une coque
- [ ] Markup semantique (`h1`, `p`, `ol`) plutot que `id` descriptifs
- [ ] Pas de wrappers inutiles (`nav > ol`, `div` autour de `h1` + `p`, etc.)
- [ ] Ids sur conteneurs de page, classes sur motifs reutilisables
- [ ] CSS structurel dans les sous-arbres (pas de classes sur chaque enfant)
- [ ] Proprietes CSS dans l'ordre defini, flex explicite
- [ ] Interactif = island; pas d'import island -> island
- [ ] Factorise, tokens reutilises, peu de JS client
- [ ] Pas de reload hard; mutation sur place ou `Slick.redirect`
- [ ] Placeholders; reinitialiser applique sans etape de plus
- [ ] Responsive: palier intermediaire
