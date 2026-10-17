import type { Template } from "@webtools/slick-server";

export default {
	name: "app",
	favicon: "/favicon.svg",

	styles: [
		"/styles/reset.css",
		"/styles/tokens.css",
		"/styles/ui.css",
		"/styles/app.css",
	],
	scripts: [],

	head: null,
	body: (
		<div id="root">
			<div id="app"></div>
		</div>
	),

	onrequest: null,
} satisfies Template;
