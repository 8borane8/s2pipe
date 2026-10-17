import type { Page } from "@webtools/slick-server";

import Play from "../islands/play.tsx";
import { nodeUrl, nodeUrlLocked } from "../client.ts";
import { healthStatus } from "../utils/authorization.ts";

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
	onrequest: async (req, res) => {
		const url = nodeUrl(req.cookies.nodeUrl);
		if (!url) return res.redirect("/set-node");

		const status = await healthStatus(url, req.cookies.nodePassword);
		if (status === 401) return res.redirect("/set-node");
	},
} satisfies Page;
