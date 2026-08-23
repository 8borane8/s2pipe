import { config } from "@/config.ts";
import { padMask } from "@/services/sockets.ts";
import { encodePacket } from "@/utils/packet.ts";
import { neutralPad, PAD_COUNT, type PadState, samePad, sanitizePad } from "@s2pipe/shared/types/pad";
import type { PicoStatus } from "@s2pipe/shared/types/node";

const SERIAL_BAUD = 921600;
const FLUSH_MS = 8;
const KEEPALIVE_TICKS = 12;

const pads: PadState[] = Array.from({ length: PAD_COUNT }, () => neutralPad());

let file: Deno.FsFile | null = null;
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
let picoError: string | null = null;
let dirty = false;
let flushing = false;
let ticks = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function setPad(index: number, state: PadState): void {
	const next = sanitizePad(state);
	if (samePad(pads[index]!, next)) return;
	pads[index] = next;
	dirty = true;
}

export function clearPad(index: number): void {
	pads[index] = neutralPad();
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
	if (!writer || !dirty || flushing) return;
	flushing = true;
	dirty = false;
	try {
		await writer.write(encodePacket(pads, padMask()));
		picoError = null;
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		await closePico();
	} finally {
		flushing = false;
	}
}

async function closePico(): Promise<void> {
	stopFlush();
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

function stopFlush(): void {
	if (flushTimer === null) return;
	clearInterval(flushTimer);
	flushTimer = null;
}

function startFlush(): void {
	if (flushTimer !== null) return;
	ticks = 0;
	flushTimer = setInterval(() => {
		ticks++;
		if (ticks >= KEEPALIVE_TICKS) {
			ticks = 0;
			dirty = true;
		}
		void flush();
	}, FLUSH_MS);
}

function windowsComPort(path: string): string | null {
	const match = path.match(/(?:\\\\\.\\)?(COM\d+)$/i);
	return match ? match[1].toUpperCase() : null;
}

async function setSerialBaud(path: string): Promise<void> {
	let command: Deno.Command;
	if (Deno.build.os === "windows") {
		const com = windowsComPort(path);
		if (!com) throw new Error(`invalid COM port: ${path}`);
		command = new Deno.Command("mode", {
			args: [`${com}:`, `BAUD=${SERIAL_BAUD}`, "PARITY=N", "DATA=8", "STOP=1"],
			stdout: "piped",
			stderr: "piped",
		});
	} else {
		command = new Deno.Command("stty", {
			args: ["-F", path, String(SERIAL_BAUD), "raw", "-echo", "cs8", "-parenb", "-cstopb"],
			stdout: "piped",
			stderr: "piped",
		});
	}

	const result = await command.output();
	if (result.success) return;
	const detail = new TextDecoder().decode(result.stderr).trim() ||
		new TextDecoder().decode(result.stdout).trim() ||
		`exit ${result.code}`;
	throw new Error(`serial baud ${SERIAL_BAUD} failed: ${detail}`);
}

async function openPico(): Promise<void> {
	if (!config.picoSerial || file) return;

	try {
		file = await Deno.open(config.picoSerial, { read: true, write: true });
		await setSerialBaud(config.picoSerial);
		writer = file.writable.getWriter();
		picoError = null;
		dirty = true;
		startFlush();
		await flush();
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		await closePico();
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
			if (!file) void openPico();
		}, 5000);
	}
}
