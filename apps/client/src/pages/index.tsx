import type { Page } from "@webtools/slick-server";

import Play from "../islands/play.tsx";
import { nodeUrl, nodeUrlLocked } from "../client.ts";

export default {
	url: "/",
	template: "app",

	title: "s2pipe",

	styles: ["/styles/play.css"],
	scripts: [],

	head: null,
	body: (req) => (
		<Play
			nodeUrl={nodeUrl(req.cookies.nodeUrl)!}
			nodeLocked={nodeUrlLocked()}
		/>
	),

	onpost: null,
	onrequest: (req, res) => {
		if (!nodeUrl(req.cookies.nodeUrl)) return res.redirect("/set-node");
	},
} satisfies Page;
