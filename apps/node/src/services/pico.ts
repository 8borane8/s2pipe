import { config } from "@/config.ts";
import { encodePacket } from "@/utils/packet.ts";
import { neutralPad, type PadState, samePad, sanitizePad, type SocketId, SOCKETS } from "@s2pipe/shared/types/pad";
import type { PicoStatus } from "@s2pipe/shared/types/node";

const pads = new Map<SocketId, PadState>(SOCKETS.map((id) => [id, neutralPad()]));

let file: Deno.FsFile | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let picoError: string | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function setPad(id: SocketId, state: PadState): void {
	const next = sanitizePad(state);
	const prev = pads.get(id);
	if (prev && samePad(prev, next)) return;
	pads.set(id, next);
	dirty = true;
}

export function clearPad(id: SocketId): void {
	pads.set(id, neutralPad());
	dirty = true;
}

export function picoStatus(): PicoStatus {
	return {
		connected: file !== null,
		path: config.picoSerial || null,
		error: picoError,
	};
}

async function flush(): Promise<void> {
	if (!writer || !dirty) return;
	dirty = false;
	try {
		await writer.write(encodePacket(pads));
		picoError = null;
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		await closePico();
	}
}

async function closePico(): Promise<void> {
	try {
		await writer?.close();
	} catch {
		// ignore
	}
	try {
		file?.close();
	} catch {
		// ignore
	}
	writer = null;
	file = null;
}

function stopTimers(): void {
	if (flushTimer !== null) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
	if (keepAliveTimer !== null) {
		clearInterval(keepAliveTimer);
		keepAliveTimer = null;
	}
}

function startTimers(): void {
	if (flushTimer === null) {
		flushTimer = setInterval(() => {
			flush().catch(() => {});
		}, 8);
	}
	if (keepAliveTimer === null) {
		keepAliveTimer = setInterval(() => {
			dirty = true;
		}, 100);
	}
}

async function openPico(): Promise<void> {
	if (!config.picoSerial || file) return;

	try {
		file = await Deno.open(config.picoSerial, { read: true, write: true });
		writer = file.writable.getWriter();
		picoError = null;
		dirty = true;
		startTimers();
		await flush();
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		file = null;
		writer = null;
		stopTimers();
	}
}

export async function startPico(): Promise<void> {
	if (!config.picoSerial) {
		picoError = null;
		return;
	}

	await openPico();
	if (retryTimer === null) {
		retryTimer = setInterval(() => {
			if (!file) openPico().catch(() => {});
		}, 5000);
	}
}
