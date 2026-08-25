import { config } from "@/config.ts";
import type { CaptureStatus } from "@s2pipe/shared/types/node";

const TTL_MS = 2000;
let cached: { at: number; status: CaptureStatus } | null = null;

export async function captureStatus(): Promise<CaptureStatus> {
	const now = Date.now();
	if (cached && now - cached.at < TTL_MS) return cached.status;

	const source = config.captureSource;
	try {
		const response = await fetch(
			`http://${config.mediaHost}:${config.mediaApiPort}/v3/paths/get/switch`,
			{ signal: AbortSignal.timeout(1500) },
		);
		if (!response.ok) {
			cached = { at: now, status: { running: false, source, error: "not_publishing" } };
			return cached.status;
		}
		const path = await response.json() as { ready?: boolean };
		const ready = Boolean(path.ready);
		cached = {
			at: now,
			status: { running: ready, source, error: ready ? null : "not_publishing" },
		};
	} catch {
		cached = { at: now, status: { running: false, source, error: "media_unavailable" } };
	}
	return cached.status;
}
