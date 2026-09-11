#ifndef PACKET_H
#define PACKET_H

#include <stdbool.h>
#include <stdint.h>

#define PAD_COUNT 8
#define PACKET_MAGIC 0x5332
#define PACKET_VERSION 1
#define PACKET_FLAG_WAKE 0x10
#define PAD_CENTER 128
#define PACKET_PID_DEFAULT 0x2069

#define PACKET_PADS_OFF 4
#define PACKET_PAD_SIZE 8
#define PACKET_CRC_OFF (PACKET_PADS_OFF + (PAD_COUNT * PACKET_PAD_SIZE))
#define PACKET_WAKE_SWITCH_OFF (PACKET_CRC_OFF + 2)
#define PACKET_WAKE_PAD_OFF (PACKET_WAKE_SWITCH_OFF + 6)
#define PACKET_WAKE_PID_OFF (PACKET_WAKE_PAD_OFF + 6)
#define PACKET_SIZE (PACKET_WAKE_PID_OFF + 2)

_Static_assert(PACKET_CRC_OFF == 68, "8 pads start at 4, CRC at 68");
_Static_assert(PACKET_SIZE == 84, "header + pads + crc + wake");

typedef struct {
	uint32_t buttons;
	uint8_t lx;
	uint8_t ly;
	uint8_t rx;
	uint8_t ry;
} pad_state_t;

void packet_init(pad_state_t pads[PAD_COUNT]);
void packet_neutral(pad_state_t pads[PAD_COUNT]);
bool packet_push(uint8_t byte, pad_state_t pads[PAD_COUNT]);
bool packet_take_wake(uint8_t switch_mac[6], uint8_t pad_mac[6], uint16_t *pid);

#endif
