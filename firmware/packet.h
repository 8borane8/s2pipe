#ifndef PACKET_H
#define PACKET_H

#include <stdbool.h>
#include <stdint.h>

#define PAD_COUNT 4
#define PACKET_SIZE 64
#define PACKET_MAGIC 0x5332
#define PACKET_VERSION 1
#define PAD_CENTER 128

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

#endif
