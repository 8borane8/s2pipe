import { config } from "@/config.ts";
import { encodePacket, type WakeAddrs } from "@/utils/packet.ts";
import { neutralPad, PAD_COUNT, type PadState, samePad, sanitizePad } from "@s2pipe/shared/types/pad";
import type { PicoStatus } from "@s2pipe/shared/types/node";

const SERIAL_BAUD = 921600;
const FLUSH_MS = 8;
const KEEPALIVE_TICKS = 12;
const WRITE_TIMEOUT_MS = 250;
const WAKE_MS = 10_000;

const pads: PadState[] = Array.from({ length: PAD_COUNT }, () => neutralPad());

let file: Deno.FsFile | null = null;
let picoError: string | null = null;
let dirty = false;
let flushing = false;
let wakeOnce: WakeAddrs | null = null;
let wakeHold = false;
let lastWakeMs = 0;
let ticks = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;

export function setPad(index: number, state: PadState): void {
	const next = sanitizePad(state);
	if (samePad(pads[index]!, next)) return;
	pads[index] = next;
	dirty = true;
	void flush();
}

export function clearPad(index: number): void {
	pads[index] = neutralPad();
	dirty = true;
	void flush();
}

export function picoStatus(): PicoStatus {
	return {
		connected: file !== null,
		path: config.picoSerial || null,
		error: picoError,
		wake: Boolean(config.switchBtMac && config.controllerBtMac),
	};
}

function queueWake(): void {
	if (!file || !config.switchBtMac || !config.controllerBtMac) return;
	wakeOnce = {
		switchMac: config.switchBtMac,
		padMac: config.controllerBtMac,
		pid: config.controllerBtPid,
	};
	lastWakeMs = Date.now();
	dirty = true;
}

export function setWakeHold(on: boolean): void {
	if (on === wakeHold) return;
	wakeHold = on;
	if (!on) {
		wakeOnce = null;
		lastWakeMs = 0;
		return;
	}
	queueWake();
	void flush();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function writeAll(handle: Deno.FsFile, data: Uint8Array): Promise<void> {
	let offset = 0;
	while (offset < data.length) {
		const n = await handle.write(data.subarray(offset));
		if (n === 0) throw new Error("serial write stalled");
		offset += n;
	}
}

async function flush(): Promise<void> {
	if (!file || !dirty || flushing) return;
	flushing = true;
	try {
		while (file && dirty) {
			dirty = false;
			const wake = wakeOnce;
			wakeOnce = null;
			try {
				await withTimeout(
					writeAll(file, encodePacket(pads, wake)),
					WRITE_TIMEOUT_MS,
					"serial write timeout",
				);
			} catch (error) {
				if (wake) wakeOnce = wake;
				throw error;
			}
			picoError = null;
		}
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		closePico();
	} finally {
		flushing = false;
	}
}

function closePico(): void {
	stopFlush();
	try {
		file?.close();
	} catch {
		// ignore
	}
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
		if (wakeHold && Date.now() - lastWakeMs >= WAKE_MS) queueWake();
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
			args: [`${com}:`, `BAUD=${SERIAL_BAUD}`, "PARITY=N", "DATA=8", "STOP=1", "XON=OFF", "OCTS=OFF", "RTS=OFF"],
			stdout: "piped",
			stderr: "piped",
		});
	} else {
		command = new Deno.Command("stty", {
			args: [
				"-F",
				path,
				String(SERIAL_BAUD),
				"raw",
				"-echo",
				"cs8",
				"-parenb",
				"-cstopb",
				"-crtscts",
				"-ixon",
				"-ixoff",
				"clocal",
			],
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
		await setSerialBaud(config.picoSerial);
		file = await Deno.open(config.picoSerial, { write: true });
		await setSerialBaud(config.picoSerial);
		picoError = null;
		dirty = true;
		startFlush();
		if (wakeHold) queueWake();
		await flush();
	} catch (error) {
		picoError = error instanceof Error ? error.message : String(error);
		closePico();
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
