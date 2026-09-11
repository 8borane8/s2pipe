import { PAD_COUNT, type PadState } from "@s2pipe/shared/types/pad";

// Keep in sync with firmware/packet.h
const PACKET_MAGIC = 0x5332;
const PACKET_VERSION = 1;
const PACKET_FLAG_WAKE = 0x10;
const PACKET_PADS_OFF = 4;
const PACKET_PAD_SIZE = 8;
const PACKET_CRC_OFF = PACKET_PADS_OFF + PAD_COUNT * PACKET_PAD_SIZE;
const PACKET_WAKE_SWITCH_OFF = PACKET_CRC_OFF + 2;
const PACKET_WAKE_PAD_OFF = PACKET_WAKE_SWITCH_OFF + 6;
const PACKET_WAKE_PID_OFF = PACKET_WAKE_PAD_OFF + 6;
const PACKET_SIZE = PACKET_WAKE_PID_OFF + 2;

export type WakeAddrs = {
	switchMac: Uint8Array;
	padMac: Uint8Array;
	pid: number;
};

function crc16ccitt(data: Uint8Array): number {
	let crc = 0xffff;
	for (const byte of data) {
		crc ^= byte << 8;
		for (let bit = 0; bit < 8; bit++) {
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
		}
	}
	return crc;
}

export function encodePacket(pads: readonly PadState[], wake?: WakeAddrs | null): Uint8Array {
	const packet = new Uint8Array(PACKET_SIZE);
	const view = new DataView(packet.buffer);

	view.setUint16(0, PACKET_MAGIC, true);
	view.setUint8(2, PACKET_VERSION);
	view.setUint8(3, wake ? PACKET_FLAG_WAKE : 0);

	let offset = PACKET_PADS_OFF;
	for (let i = 0; i < PAD_COUNT; i++) {
		const pad = pads[i]!;
		view.setUint32(offset, pad.buttons, true);
		packet[offset + 4] = pad.lx;
		packet[offset + 5] = pad.ly;
		packet[offset + 6] = pad.rx;
		packet[offset + 7] = pad.ry;
		offset += PACKET_PAD_SIZE;
	}

	view.setUint16(PACKET_CRC_OFF, crc16ccitt(packet.subarray(0, PACKET_CRC_OFF)), true);
	if (wake) {
		packet.set(wake.switchMac, PACKET_WAKE_SWITCH_OFF);
		packet.set(wake.padMac, PACKET_WAKE_PAD_OFF);
		view.setUint16(PACKET_WAKE_PID_OFF, wake.pid, true);
	}
	return packet;
}
