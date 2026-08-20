import { config } from "@/config.ts";
import type { CaptureStatus } from "@s2pipe/shared/types/node";

export async function captureStatus(): Promise<CaptureStatus> {
	try {
		const conn = await Deno.connect({ hostname: config.mediaHost, port: config.mediaPort });
		conn.close();
		return { running: true, source: config.captureSource, error: null };
	} catch {
		return { running: false, source: config.captureSource, error: "media_unavailable" };
	}
}
