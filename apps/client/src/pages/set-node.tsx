import type { Page } from "@webtools/slick-server";

import SetNode from "../islands/set-node.tsx";
import { nodeUrlLocked } from "../client.ts";

export default {
	url: "/set-node",
	template: "app",

	title: "Connect the node | s2pipe",

	styles: ["/styles/set-node.css"],
	scripts: [],

	head: null,
	body: (
		<section id="set-node">
			<SetNode />
		</section>
	),

	onpost: null,
	onrequest: (_req, res) => {
		if (nodeUrlLocked()) return res.redirect("/");
	},
} satisfies Page;
