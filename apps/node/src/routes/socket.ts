import { Router } from "@webtools/expressapi";
import { captureStatus } from "@/services/capture.ts";
import { clearPad, picoStatus, setPad, setWakeHold } from "@/services/pico.ts";
import {
	addViewer,
	dropViewer,
	forEachViewer,
	occupiedSeats,
	ownsSeat,
	padsOf,
	playPads,
	viewerCount,
	watchPads,
} from "@/services/sockets.ts";
import type { ClientMessage, ServerMessage } from "@s2pipe/shared/types/node";

const HEARTBEAT_INTERVAL = 30_000;

let lastCapture = "";

function send(ws: WebSocket, message: ServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function currentStatus(): Promise<ServerMessage> {
	const capture = await captureStatus();
	lastCapture = `${capture.running}:${capture.error ?? ""}`;
	return {
		op: "status",
		data: {
			capture,
			pico: picoStatus(),
			occupied: occupiedSeats(),
		},
	};
}

async function pushStatus(): Promise<void> {
	const message = await currentStatus();
	forEachViewer((ws) => send(ws, message));
}

setInterval(() => {
	void captureStatus().then((status) => {
		const key = `${status.running}:${status.error ?? ""}`;
		if (key === lastCapture) return;
		void pushStatus();
	});
}, 2000);

function resetSeats(indices: number[]): void {
	if (!indices.length) return;
	for (const seat of indices) clearPad(seat);
	void pushStatus();
}

function bind(ws: WebSocket): void {
	addViewer(ws);
	setWakeHold(viewerCount() > 0);

	const heartbeat = setInterval(() => {
		send(ws, { op: "ping" });
	}, HEARTBEAT_INTERVAL);

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
					const previous = padsOf(ws);
					const raw = msg.data?.count;
					const count = typeof raw === "number" && Number.isFinite(raw) ? raw : 1;
					const assigned = playPads(ws, count);
					send(ws, { op: "play", data: { seats: assigned } });
					resetSeats([
						...previous.filter((seat) => !assigned.includes(seat)),
						...assigned.filter((seat) => !previous.includes(seat)),
					]);
					return;
				}
				case "watch": {
					resetSeats(watchPads(ws));
					return;
				}
				case "pad": {
					if (ownsSeat(ws, msg.seat)) setPad(msg.seat, msg.data);
					return;
				}
			}
		} catch {
			// ignore bad frames
		}
	});

	ws.addEventListener("close", () => {
		clearInterval(heartbeat);
		const released = dropViewer(ws);
		setWakeHold(viewerCount() > 0);
		resetSeats(released);
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

		const { socket, response } = Deno.upgradeWebSocket(req.raw);
		bind(socket);

		return response;
	});
