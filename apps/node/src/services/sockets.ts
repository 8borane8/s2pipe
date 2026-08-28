import { PAD_COUNT } from "@s2pipe/shared/types/pad";

const seats: (WebSocket | null)[] = Array.from({ length: PAD_COUNT }, () => null);
const viewers = new Set<WebSocket>();

export function playingCount(): number {
	let n = 0;
	for (const seat of seats) if (seat !== null) n++;
	return n;
}

export function viewerCount(): number {
	return viewers.size;
}

export function addViewer(ws: WebSocket): void {
	viewers.add(ws);
}

export function padOf(ws: WebSocket): number | undefined {
	const i = seats.indexOf(ws);
	return i < 0 ? undefined : i;
}

export function playPad(ws: WebSocket): number | undefined {
	const current = padOf(ws);
	if (current !== undefined) return current;
	const i = seats.indexOf(null);
	if (i < 0) return undefined;
	seats[i] = ws;
	return i;
}

export function watchPad(ws: WebSocket): number | undefined {
	const i = padOf(ws);
	if (i === undefined) return undefined;
	seats[i] = null;
	return i;
}

export function dropViewer(ws: WebSocket): number | undefined {
	viewers.delete(ws);
	return watchPad(ws);
}

export function forEachViewer(fn: (ws: WebSocket) => void): void {
	for (const viewer of viewers) {
		if (viewer.readyState === WebSocket.OPEN) fn(viewer);
	}
}
