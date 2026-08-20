import { Router } from "@webtools/expressapi";
import { captureStatus } from "@/services/capture.ts";
import { clearPad, picoStatus, setPad } from "@/services/pico.ts";
import { addViewer, claimPad, dropViewer, forEachViewer, padOf, socketStatus, watchPad } from "@/services/sockets.ts";
import { isSocketId } from "@s2pipe/shared/types/pad";
import type { ClientMessage, ServerMessage } from "@s2pipe/shared/types/node";

function send(ws: WebSocket, message: ServerMessage): void {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

async function currentStatus(): Promise<ServerMessage> {
	return {
		type: "status",
		capture: await captureStatus(),
		pico: picoStatus(),
		sockets: socketStatus(),
	};
}

async function pushStatus(): Promise<void> {
	const message = await currentStatus();
	forEachViewer((ws) => send(ws, message));
}

function bind(ws: WebSocket): void {
	addViewer(ws);

	const greet = () => {
		send(ws, { type: "hello", socket: padOf(ws) ?? null });
		void currentStatus().then((status) => send(ws, status));
	};
	if (ws.readyState === WebSocket.OPEN) greet();
	else ws.addEventListener("open", greet, { once: true });

	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		try {
			const msg = JSON.parse(event.data) as ClientMessage;
			if (msg.type === "ping") {
				send(ws, { type: "pong", t: msg.t });
				return;
			}
			if (msg.type === "claim") {
				if (!isSocketId(msg.socket)) return;
				const result = claimPad(ws, msg.socket);
				if (!result.ok) {
					send(ws, { type: "error", error: "socket_taken" });
					return;
				}
				if (result.released !== undefined) clearPad(result.released);
				send(ws, { type: "hello", socket: msg.socket });
				void pushStatus();
				return;
			}
			if (msg.type === "watch") {
				const released = watchPad(ws);
				if (released !== undefined) clearPad(released);
				send(ws, { type: "hello", socket: null });
				if (released !== undefined) void pushStatus();
				return;
			}
			if (msg.type === "pad") {
				const id = padOf(ws);
				if (id !== undefined) setPad(id, msg.state);
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

		const { socket, response } = Deno.upgradeWebSocket(req.raw);
		bind(socket);
		return response;
	});
