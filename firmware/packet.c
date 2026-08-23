#include "packet.h"

#include <string.h>

static uint8_t buf[PACKET_SIZE];
static uint8_t len;

static uint16_t crc16_ccitt(uint8_t const *data, uint8_t n) {
	uint16_t crc = 0xffff;
	for (uint8_t i = 0; i < n; i++) {
		crc ^= (uint16_t)data[i] << 8;
		for (uint8_t bit = 0; bit < 8; bit++) {
			crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
		}
	}
	return crc;
}

static void neutral(pad_state_t *pad) {
	pad->buttons = 0;
	pad->lx = PAD_CENTER;
	pad->ly = PAD_CENTER;
	pad->rx = PAD_CENTER;
	pad->ry = PAD_CENTER;
}

void packet_neutral(pad_state_t pads[PAD_COUNT]) {
	for (uint8_t i = 0; i < PAD_COUNT; i++) {
		neutral(&pads[i]);
	}
}

void packet_init(pad_state_t pads[PAD_COUNT]) {
	len = 0;
	packet_neutral(pads);
}

static bool parse_frame(uint8_t const *frame, pad_state_t pads[PAD_COUNT]) {
	if (frame[2] != PACKET_VERSION) return false;

	uint16_t got = (uint16_t)frame[36] | ((uint16_t)frame[37] << 8);
	if (got != crc16_ccitt(frame, 36)) return false;

	uint8_t const *p = frame + 4;
	for (uint8_t i = 0; i < PAD_COUNT; i++) {
		pads[i].buttons = (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
		pads[i].lx = p[4];
		pads[i].ly = p[5];
		pads[i].rx = p[6];
		pads[i].ry = p[7];
		p += 8;
	}
	return true;
}

bool packet_push(uint8_t byte, pad_state_t pads[PAD_COUNT]) {
	buf[len++] = byte;
	if (len < PACKET_SIZE) return false;

	uint8_t mag = 0;
	while (
		mag + 1 < PACKET_SIZE &&
		!(buf[mag] == (PACKET_MAGIC & 0xff) && buf[mag + 1] == (PACKET_MAGIC >> 8))
	) {
		mag++;
	}
	if (mag) {
		len = (uint8_t)(PACKET_SIZE - mag);
		memmove(buf, buf + mag, len);
		return false;
	}
	if (parse_frame(buf, pads)) {
		len = 0;
		return true;
	}
	memmove(buf, buf + 1, PACKET_SIZE - 1);
	len = PACKET_SIZE - 1;
	return false;
}
