import type { Page } from "@webtools/slick-server";

import Play from "../islands/play.tsx";
import { healthStatus, nodeUrl } from "../utils/authorization.ts";

export default {
	url: "/",
	template: "app",

	title: "s2pipe",

	styles: ["/styles/play.css"],
	scripts: [],

	head: null,
	body: () => <Play nodeUrl={nodeUrl()} />,

	onpost: null,
	onrequest: async (req, res) => {
		if (await healthStatus(nodeUrl(), req.cookies.nodePassword) === 401) {
			return res.redirect("/password");
		}
	},
} satisfies Page;
