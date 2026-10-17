import type { Page } from "@webtools/slick-server";

import Password from "../islands/password.tsx";
import { healthStatus, nodeUrl } from "../utils/authorization.ts";

export default {
	url: "/password",
	template: "app",

	title: "Node password | s2pipe",

	styles: ["/styles/password.css"],
	scripts: [],

	head: null,
	body: () => (
		<section id="password">
			<Password nodeUrl={nodeUrl()} />
		</section>
	),

	onpost: null,
	onrequest: async (req, res) => {
		if (await healthStatus(nodeUrl(), req.cookies.nodePassword) !== 401) {
			return res.redirect("/");
		}
	},
} satisfies Page;
