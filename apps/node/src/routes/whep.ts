import { type HttpRequest, type HttpResponse, Router } from "@webtools/expressapi";
import { config } from "@/config.ts";

async function forward(req: HttpRequest, res: HttpResponse): Promise<Response> {
	const url = new URL(req.raw.url);
	url.protocol = "http:";
	url.host = `${config.mediaHost}:${config.mediaPort}`;

	const headers = new Headers(req.raw.headers);
	headers.delete("host");

	try {
		const upstream = await fetch(url, {
			method: req.raw.method,
			headers,
			body: await req.raw.arrayBuffer(),
			redirect: "manual",
		});

		for (const [name, value] of upstream.headers) {
			if (name.toLowerCase().startsWith("access-control-")) continue;
			res.setHeader(name, value);
		}

		const location = upstream.headers.get("location");
		if (location) {
			const loc = new URL(location, url);
			res.setHeader("Location", loc.pathname + loc.search);
		}

		res.setHeader("Access-Control-Expose-Headers", "location, link");
		return res.status(upstream.status).send(upstream.body);
	} catch {
		return res.status(502).send("whep_unavailable");
	}
}

export default new Router()
	.post("/switch/whep", forward)
	.patch("/switch/whep/:session", forward)
	.delete("/switch/whep/:session", forward)
	.post("/switch-audio/whep", forward)
	.patch("/switch-audio/whep/:session", forward)
	.delete("/switch-audio/whep/:session", forward);
