import { PAD_COUNT } from "@s2pipe/shared/types/pad";

const seats: (WebSocket | null)[] = Array.from({ length: PAD_COUNT }, () => null);
const viewers = new Set<WebSocket>();

export function occupiedSeats(): number[] {
	const out: number[] = [];
	for (let i = 0; i < seats.length; i++) {
		if (seats[i] !== null) out.push(i);
	}
	return out;
}

export function viewerCount(): number {
	return viewers.size;
}

export function addViewer(ws: WebSocket): void {
	viewers.add(ws);
}

export function padsOf(ws: WebSocket): number[] {
	const out: number[] = [];
	for (let i = 0; i < seats.length; i++) {
		if (seats[i] === ws) out.push(i);
	}
	return out;
}

export function ownsSeat(ws: WebSocket, seat: number): boolean {
	return Number.isInteger(seat) && seat >= 0 && seat < seats.length && seats[seat] === ws;
}

export function playPads(ws: WebSocket, count: number): number[] {
	const want = Math.max(0, Math.min(PAD_COUNT, Math.floor(count)));
	const have = padsOf(ws);

	while (have.length > want) {
		seats[have.pop()!] = null;
	}

	for (let i = 0; i < PAD_COUNT && have.length < want; i++) {
		if (seats[i] === null) {
			seats[i] = ws;
			have.push(i);
		}
	}

	return have;
}

export function watchPads(ws: WebSocket): number[] {
	const released = padsOf(ws);
	for (const i of released) seats[i] = null;
	return released;
}

export function dropViewer(ws: WebSocket): number[] {
	viewers.delete(ws);
	return watchPads(ws);
}

export function forEachViewer(fn: (ws: WebSocket) => void): void {
	for (const viewer of viewers) {
		if (viewer.readyState === WebSocket.OPEN) fn(viewer);
	}
}
