import { type SocketId, SOCKETS } from "@s2pipe/shared/types/pad";
import type { SocketStatus } from "@s2pipe/shared/types/node";

const owners = new Map<SocketId, WebSocket>();
const viewers = new Set<WebSocket>();

export function socketStatus(): SocketStatus[] {
	return SOCKETS.map((socket) => ({
		socket,
		occupied: owners.has(socket),
	}));
}

export function addViewer(ws: WebSocket): void {
	viewers.add(ws);
}

export function padOf(ws: WebSocket): SocketId | undefined {
	for (const [id, owner] of owners) {
		if (owner === ws) return id;
	}
}

export function claimPad(
	ws: WebSocket,
	id: SocketId,
): { ok: true; released: SocketId | undefined } | { ok: false } {
	const owner = owners.get(id);
	if (owner !== undefined && owner !== ws) return { ok: false };

	const current = padOf(ws);
	if (current !== undefined && current !== id) owners.delete(current);
	owners.set(id, ws);
	return { ok: true, released: current !== id ? current : undefined };
}

export function watchPad(ws: WebSocket): SocketId | undefined {
	const id = padOf(ws);
	if (id !== undefined) owners.delete(id);
	return id;
}

export function dropViewer(ws: WebSocket): SocketId | undefined {
	viewers.delete(ws);
	return watchPad(ws);
}

export function forEachViewer(fn: (ws: WebSocket) => void): void {
	for (const viewer of viewers) {
		if (viewer.readyState === WebSocket.OPEN) fn(viewer);
	}
}
