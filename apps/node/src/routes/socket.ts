import { Router } from "@webtools/expressapi";
import { captureStatus } from "@/services/capture.ts";
import { clearPad, picoStatus, setPad } from "@/services/pico.ts";
import { claimSocket, forEachOpenSocket, occupySocket, releaseSocket, socketStatus } from "@/services/sockets.ts";
import { parseSocketId, type SocketId } from "@s2pipe/shared/types/pad";
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
	forEachOpenSocket((ws) => send(ws, message));
}

function bind(ws: WebSocket, id: SocketId): void {
	occupySocket(id, ws);
	void pushStatus();

	const greet = () => {
		send(ws, { type: "hello", socket: id });
		void currentStatus().then((status) => send(ws, status));
	};
	if (ws.readyState === WebSocket.OPEN) greet();
	else ws.addEventListener("open", greet, { once: true });

	ws.addEventListener("message", (event) => {
		if (typeof event.data !== "string") return;
		try {
			const msg = JSON.parse(event.data) as ClientMessage;
			if (msg.type === "ping") send(ws, { type: "pong", t: msg.t });
			else if (msg.type === "pad") setPad(id, msg.state);
		} catch {
			// ignore bad frames
		}
	});

	ws.addEventListener("close", () => {
		clearPad(id);
		releaseSocket(id);
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

		const requested = parseSocketId(req.query.socket);
		if (req.query.socket && requested === undefined) {
			return res.status(400).json({
				success: false as const,
				error: "socket_invalid",
			});
		}

		const claimed = claimSocket(requested);
		if ("error" in claimed) {
			return res.status(claimed.status).json({
				success: false as const,
				error: claimed.error,
			});
		}

		try {
			const { socket, response } = Deno.upgradeWebSocket(req.raw);
			bind(socket, claimed.id);
			return response;
		} catch (error) {
			releaseSocket(claimed.id);
			void pushStatus();
			throw error;
		}
	});
