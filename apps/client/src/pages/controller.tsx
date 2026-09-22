import type { Page } from "@webtools/slick-server";

import Controller from "../islands/controller.tsx";

export default {
	url: "/controller",
	template: "app",

	title: "Controller mapping | s2pipe",

	styles: ["/styles/controller.css"],
	scripts: [],

	head: null,
	body: (
		<section id="controller">
			<Controller />
		</section>
	),

	onpost: null,
	onrequest: null,
} satisfies Page;
