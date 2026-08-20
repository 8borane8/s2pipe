import { Router } from "@webtools/expressapi";
import { captureStatus } from "@/services/capture.ts";
import { clearPad, picoStatus, setPad } from "@/services/pico.ts";
import { addViewer, dropViewer, forEachViewer, padOf, playPad, playingCount, watchPad } from "@/services/sockets.ts";
import type { ClientMessage, ServerMessage } from "@s2pipe/shared/types/node";

function send(ws: WebSocket, message: ServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function currentStatus(): Promise<ServerMessage> {
	return {
		op: "status",
		data: {
			capture: await captureStatus(),
			pico: picoStatus(),
			playing: playingCount(),
		},
	};
}

async function pushStatus(): Promise<void> {
	const message = await currentStatus();
	forEachViewer((ws) => send(ws, message));
}

function bind(ws: WebSocket): void {
	addViewer(ws);

	const greet = () => {
		void currentStatus().then((status) => send(ws, status));
	};
	if (ws.readyState === WebSocket.OPEN) greet();
	else ws.addEventListener("open", greet, { once: true });

	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		try {
			const msg = JSON.parse(event.data) as ClientMessage;
			switch (msg.op) {
				case "play": {
					const existing = padOf(ws);
					const seat = playPad(ws);
					send(ws, { op: "play", data: { playing: seat !== undefined } });
					if (existing === undefined && seat !== undefined) {
						clearPad(seat);
						void pushStatus();
					}
					return;
				}
				case "watch": {
					const released = watchPad(ws);
					if (released === undefined) return;
					clearPad(released);
					void pushStatus();
					return;
				}
				case "pad": {
					const seat = padOf(ws);
					if (seat !== undefined) setPad(seat, msg.data);
				}
			}
		} catch {
			// ignore bad frames
		}
	});

	ws.addEventListener("close", () => {
		const released = dropViewer(ws);
		if (released === undefined) return;
		clearPad(released);
		void pushStatus();
	});
}

export default new Router()
	.get("/socket", (req, res) => {
		if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
			return res.status(426).json({
				success: false as const,
				error: "upgrade_required",
			});
		}

		const { socket, response } = Deno.upgradeWebSocket(req.raw, { idleTimeout: 0 });
		bind(socket);
		return response;
	});
