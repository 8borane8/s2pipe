import { type PadState, PAD_COUNT } from "@s2pipe/shared/types/pad";

// Keep in sync with firmware/packet.h
const PACKET_SIZE = 64;
const PACKET_MAGIC = 0x5332;
const PACKET_VERSION = 1;

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

export function encodePacket(pads: readonly PadState[], flags: number): Uint8Array {
	const packet = new Uint8Array(PACKET_SIZE);
	const view = new DataView(packet.buffer);

	view.setUint16(0, PACKET_MAGIC, true);
	view.setUint8(2, PACKET_VERSION);
	view.setUint8(3, flags & 0x0f);

	let offset = 4;
	for (let i = 0; i < PAD_COUNT; i++) {
		const pad = pads[i]!;
		view.setUint32(offset, pad.buttons, true);
		view.setUint8(offset + 4, pad.lx);
		view.setUint8(offset + 5, pad.ly);
		view.setUint8(offset + 6, pad.rx);
		view.setUint8(offset + 7, pad.ry);
		offset += 8;
	}

	view.setUint16(36, crc16ccitt(packet.subarray(0, 36)), true);
	return packet;
}
