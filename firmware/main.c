#include "hardware/gpio.h"
#include "hardware/irq.h"
#include "hardware/uart.h"
#include "pico/stdlib.h"
#include "tusb.h"

#if __has_include("bsp/board_api.h")
#include "bsp/board_api.h"
#else
#include "bsp/board.h"
#endif

#include "packet.h"
#include "usb.h"

#define UART_ID uart1
#define UART_IRQ UART1_IRQ
#define UART_TX_PIN 4
#define UART_RX_PIN 5
#define UART_BAUD 921600
#define STALE_MS 250

#define BTN_UP (1u << 14)
#define BTN_DOWN (1u << 15)
#define BTN_LEFT (1u << 16)
#define BTN_RIGHT (1u << 17)

typedef struct TU_ATTR_PACKED {
	uint16_t buttons;
	uint8_t hat;
	uint8_t lx;
	uint8_t ly;
	uint8_t rx;
	uint8_t ry;
	uint8_t vendor;
} hid_report_t;

static pad_state_t pads[PAD_COUNT];
static uint32_t last_packet_ms;
static uint8_t live_count;

static uint8_t rx_buf[256];
static volatile uint8_t rx_head;
static volatile uint8_t rx_tail;

static uint8_t hat_from(uint32_t buttons) {
	int up = (buttons & BTN_UP) != 0;
	int down = (buttons & BTN_DOWN) != 0;
	int left = (buttons & BTN_LEFT) != 0;
	int right = (buttons & BTN_RIGHT) != 0;
	if (up && right) return 1;
	if (right && down) return 3;
	if (down && left) return 5;
	if (left && up) return 7;
	if (up) return 0;
	if (right) return 2;
	if (down) return 4;
	if (left) return 6;
	return 8;
}

static void fill_report(pad_state_t const *pad, hid_report_t *report) {
	report->buttons = (uint16_t)(pad->buttons & 0x3fff);
	report->hat = hat_from(pad->buttons);
	report->lx = pad->lx;
	report->ly = pad->ly;
	report->rx = pad->rx;
	report->ry = pad->ry;
	report->vendor = 0;
}

static void on_uart_rx(void) {
	while (uart_is_readable(UART_ID)) {
		uint8_t next = (uint8_t)(rx_head + 1);
		uint8_t byte = (uint8_t)uart_getc(UART_ID);
		if (next == rx_tail) continue;
		rx_buf[rx_head] = byte;
		rx_head = next;
	}
}

static uint8_t popcount4(uint8_t value) {
	value &= 0x0f;
	return (uint8_t)((value & 1) + ((value >> 1) & 1) + ((value >> 2) & 1) + ((value >> 3) & 1));
}

static uint8_t slot_of_hid(uint8_t hid) {
	uint8_t n = 0;
	uint8_t flags = packet_flags();
	for (uint8_t slot = 0; slot < PAD_COUNT; slot++) {
		if (!(flags & (1u << slot))) continue;
		if (n == hid) return slot;
		n++;
	}
	return 0xff;
}

static void apply_pad_count(uint8_t flags) {
	uint8_t n = popcount4(flags);
	if (n == live_count) return;
	live_count = n;
	usb_set_hid_count(n);
	tud_disconnect();
	sleep_ms(80);
	if (n) tud_connect();
}

static void uart_drain(void) {
	while (rx_tail != rx_head) {
		uint8_t byte = rx_buf[rx_tail];
		rx_tail = (uint8_t)(rx_tail + 1);
		if (!packet_push(byte, pads)) continue;
		last_packet_ms = to_ms_since_boot(get_absolute_time());
		apply_pad_count(packet_flags());
#ifdef PICO_DEFAULT_LED_PIN
		gpio_xor_mask(1u << PICO_DEFAULT_LED_PIN);
#endif
	}

	if (to_ms_since_boot(get_absolute_time()) - last_packet_ms >= STALE_MS) {
		packet_neutral(pads);
		last_packet_ms = to_ms_since_boot(get_absolute_time());
	}
}

static void hid_push(void) {
	if (!tud_mounted()) return;
	uint8_t n = usb_hid_count();
	for (uint8_t i = 0; i < n; i++) {
		if (!tud_hid_n_ready(i)) continue;
		uint8_t slot = slot_of_hid(i);
		if (slot >= PAD_COUNT) continue;
		hid_report_t report;
		fill_report(&pads[slot], &report);
		tud_hid_n_report(i, 0, &report, sizeof(report));
	}
}

uint16_t tud_hid_get_report_cb(
	uint8_t instance,
	uint8_t report_id,
	hid_report_type_t report_type,
	uint8_t *buffer,
	uint16_t reqlen
) {
	(void)report_id;
	(void)report_type;
	if (instance >= usb_hid_count() || reqlen < sizeof(hid_report_t)) return 0;
	uint8_t slot = slot_of_hid(instance);
	if (slot >= PAD_COUNT) return 0;
	hid_report_t report;
	fill_report(&pads[slot], &report);
	memcpy(buffer, &report, sizeof(report));
	return sizeof(report);
}

void tud_hid_set_report_cb(
	uint8_t instance,
	uint8_t report_id,
	hid_report_type_t report_type,
	uint8_t const *buffer,
	uint16_t bufsize
) {
	(void)instance;
	(void)report_id;
	(void)report_type;
	(void)buffer;
	(void)bufsize;
}

int main(void) {
	board_init();
	packet_init(pads);
	last_packet_ms = to_ms_since_boot(get_absolute_time());

#ifdef PICO_DEFAULT_LED_PIN
	gpio_init(PICO_DEFAULT_LED_PIN);
	gpio_set_dir(PICO_DEFAULT_LED_PIN, GPIO_OUT);
#endif

	uart_init(UART_ID, UART_BAUD);
	gpio_set_function(UART_TX_PIN, GPIO_FUNC_UART);
	gpio_set_function(UART_RX_PIN, GPIO_FUNC_UART);
	uart_set_hw_flow(UART_ID, false, false);
	uart_set_format(UART_ID, 8, 1, UART_PARITY_NONE);
	uart_set_fifo_enabled(UART_ID, true);
	irq_set_exclusive_handler(UART_IRQ, on_uart_rx);
	irq_set_enabled(UART_IRQ, true);
	uart_set_irq_enables(UART_ID, true, false);

	tusb_init();
	usb_set_hid_count(0);
	tud_disconnect();

	while (1) {
		tud_task();
		uart_drain();
		hid_push();
	}
}
