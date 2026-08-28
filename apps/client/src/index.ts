import { Slick } from "@webtools/slick-server";

const app = new Slick(import.meta.dirname!, {
	port: Number(Deno.env.get("CLIENT_PORT") || 5000),
	lang: "en",
	client: true,
	hotReload: Deno.args.includes("--dev"),
	sharedLibs: ["lucide-preact", "@webtools/expressapi"],
});

await app.start();
