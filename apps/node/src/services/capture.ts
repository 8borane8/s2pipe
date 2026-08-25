import { config } from "@/config.ts";
import type { CaptureStatus } from "@s2pipe/shared/types/node";

const TTL_MS = 2000;
let cached: { at: number; status: CaptureStatus } | null = null;

export async function captureStatus(): Promise<CaptureStatus> {
	const now = Date.now();
	if (cached && now - cached.at < TTL_MS) return cached.status;

	try {
		const conn = await Deno.connect({ hostname: config.mediaHost, port: config.mediaPort });
		conn.close();
		cached = { at: now, status: { running: true, source: config.captureSource, error: null } };
	} catch {
		cached = { at: now, status: { running: false, source: config.captureSource, error: "media_unavailable" } };
	}
	return cached.status;
}
