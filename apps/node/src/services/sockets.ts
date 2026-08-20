import { type SocketId, SOCKETS } from "@s2pipe/shared/types/pad";
import type { SocketStatus } from "@s2pipe/shared/types/node";

const pending = Symbol("pending");
const owners = new Map<SocketId, WebSocket | typeof pending>();

export function socketStatus(): SocketStatus[] {
	return SOCKETS.map((socket) => ({
		socket,
		occupied: owners.has(socket),
	}));
}

export function claimSocket(
	requested?: SocketId,
): { id: SocketId } | { error: "socket_taken" | "socket_full"; status: 409 } {
	if (requested !== undefined) {
		if (owners.has(requested)) return { error: "socket_taken", status: 409 };
		owners.set(requested, pending);
		return { id: requested };
	}

	const free = SOCKETS.find((socket) => !owners.has(socket));
	if (!free) return { error: "socket_full", status: 409 };
	owners.set(free, pending);
	return { id: free };
}

export function occupySocket(id: SocketId, ws: WebSocket): void {
	owners.set(id, ws);
}

export function releaseSocket(id: SocketId): void {
	owners.delete(id);
}

export function forEachOpenSocket(fn: (ws: WebSocket) => void): void {
	for (const owner of owners.values()) {
		if (owner === pending) continue;
		if (owner.readyState === WebSocket.OPEN) fn(owner);
	}
}
