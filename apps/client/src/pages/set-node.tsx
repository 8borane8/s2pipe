import type { Page } from "@webtools/slick-server";

import SetNode from "../islands/set-node.tsx";
import { nodeUrl, nodeUrlLocked } from "../client.ts";

export default {
	url: "/set-node",
	template: "app",

	title: "Connect the node | s2pipe",

	styles: ["/styles/set-node.css"],
	scripts: [],

	head: null,
	body: (req) => (
		<section id="set-node">
			<SetNode
				locked={nodeUrlLocked()}
				initialUrl={nodeUrl(req.cookies.nodeUrl) || "http://localhost:5050"}
				initialPassword={req.cookies.nodePassword?.trim() || ""}
			/>
		</section>
	),

	onpost: null,
	onrequest: null,
} satisfies Page;
