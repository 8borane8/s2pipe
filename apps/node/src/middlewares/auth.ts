import type { HttpRequest, HttpResponse } from "@webtools/expressapi";

import { config } from "@/config.ts";

const encoder = new TextEncoder();

async function sameSecret(left: string, right: string): Promise<boolean> {
	const [a, b] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(left)),
		crypto.subtle.digest("SHA-256", encoder.encode(right)),
	]);
	const x = new Uint8Array(a);
	const y = new Uint8Array(b);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}

export async function authorize(req: HttpRequest, res: HttpResponse): Promise<Response | undefined> {
	const expected = config.nodePassword;
	if (!expected || req.raw.method === "OPTIONS") return;

	const header = req.headers.get("authorization") ?? "";
	const url = new URL(req.raw.url);
	// Browsers cannot set Authorization on a WebSocket handshake.
	const presented = header || (url.pathname === "/socket" ? url.searchParams.get("authorization") ?? "" : "");
	if (await sameSecret(presented, expected)) return;

	return res.status(401).json({
		success: false as const,
		error: "unauthorized",
	});
}
