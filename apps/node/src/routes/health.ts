import { Router } from "@webtools/expressapi";

import { captureStatus } from "@/services/capture.ts";
import { playingCount } from "@/services/sockets.ts";
import { picoStatus } from "@/services/pico.ts";
import type { NodeStatus } from "@s2pipe/shared/types/node";

const startedAt = Date.now();

export default new Router()
	.get("/health", async (_req, res) =>
		res.json({
			success: true as const,
			data: {
				service: "s2pipe-node" as const,
				uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
				capture: await captureStatus(),
				pico: picoStatus(),
				playing: playingCount(),
			} satisfies NodeStatus,
		}));
