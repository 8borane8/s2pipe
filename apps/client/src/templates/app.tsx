import type { Template } from "@webtools/slick-server";

import { nodeUrl } from "../client.ts";

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
	body: (req) => (
		<div id="root" data-node-url={nodeUrl(req.cookies.nodeUrl) || ""}>
			<div id="app"></div>
		</div>
	),

	onrequest: null,
} satisfies Template;
