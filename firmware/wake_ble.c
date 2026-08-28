#include "wake_ble.h"

#include <stdbool.h>
#include <string.h>

#if defined(CYW43_ENABLE_BLUETOOTH) && CYW43_ENABLE_BLUETOOTH

#include "btstack.h"
#include "hci_cmd.h"
#include "pico/cyw43_arch.h"
#include "pico/stdlib.h"

#define ADV_MS 2500
#define ADDR_TIMEOUT_MS 800
#define PID_DEFAULT 0x2069

static const hci_cmd_t hci_bcm_write_bd_addr = { 0xfc01, "B" };

static uint8_t const adv_tpl[31] = {
	0x02, 0x01, 0x06,
	0x1b, 0xff, 0x53, 0x05,
	0x01, 0x00, 0x03,
	0x7e, 0x05,
	0x69, 0x20,
	0x00, 0x01, 0x81,
	0, 0, 0, 0, 0, 0,
	0x0f, 0, 0, 0, 0, 0, 0, 0,
};

static uint8_t switch_mac[6];
static uint16_t pad_pid = PID_DEFAULT;
static uint8_t adv[31];
static bd_addr_t pad_addr;
static bd_addr_t none_addr;
static btstack_packet_callback_registration_t hci_cb;

static bool stack_ok;
static bool have_request;
static bool addr_set;
static bool writing_addr;
static bool advertising;
static uint32_t adv_until_ms;
static uint32_t write_until_ms;

static void led(bool on) {
	cyw43_arch_gpio_put(CYW43_WL_GPIO_LED_PIN, on);
}

static void reverse_mac(uint8_t const in[6], uint8_t out[6]) {
	for (int i = 0; i < 6; i++) out[i] = in[5 - i];
}

static void start_adv(void) {
	memcpy(adv, adv_tpl, sizeof(adv));
	adv[12] = (uint8_t)pad_pid;
	adv[13] = (uint8_t)(pad_pid >> 8);
	reverse_mac(switch_mac, &adv[17]);

	/* Public BD_ADDR of the bonded pad. Switch 2 ignores random-address beacons. */
	gap_random_address_set_mode(GAP_RANDOM_ADDRESS_TYPE_OFF);
	gap_advertisements_set_data(sizeof(adv), adv);
	/* ADV_IND (0x00): same PDU as a real Joy-Con 2 / Pro 2 wake. */
	gap_advertisements_set_params(0x20, 0x40, 0x00, 0, none_addr, 0x07, 0x00);
	gap_advertisements_enable(1);
	advertising = true;
	adv_until_ms = to_ms_since_boot(get_absolute_time()) + ADV_MS;
	led(true);
}

static void on_hci(uint8_t type, uint16_t channel, uint8_t *packet, uint16_t size) {
	(void)channel;
	(void)size;
	if (type != HCI_EVENT_PACKET) return;

	uint8_t event = hci_event_packet_get_type(packet);
	if (event == BTSTACK_EVENT_STATE) {
		if (btstack_event_state_get_state(packet) == HCI_STATE_WORKING) stack_ok = true;
		return;
	}
	if (event != HCI_EVENT_COMMAND_COMPLETE) return;
	if (hci_event_command_complete_get_command_opcode(packet) != 0xfc01) return;
	writing_addr = false;
	if (hci_event_command_complete_get_return_parameters(packet)[0] != 0) {
		have_request = true;
		return;
	}
	addr_set = true;
	start_adv();
}

void wake_ble_init(void) {
	if (cyw43_arch_init()) return;
	l2cap_init();
	hci_cb.callback = &on_hci;
	hci_add_event_handler(&hci_cb);
	hci_power_control(HCI_POWER_ON);
}

void wake_ble_request(uint8_t const sw[6], uint8_t const pad[6], uint16_t pid) {
	memcpy(switch_mac, sw, 6);
	pad_pid = pid ? pid : PID_DEFAULT;

	/* BTstack bd_addr_t is display order. Command format "B" reverses for HCI. */
	if (!addr_set || memcmp(pad_addr, pad, 6) != 0) {
		memcpy(pad_addr, pad, 6);
		addr_set = false;
		writing_addr = false;
		hci_set_bd_addr(pad_addr);
	}
	have_request = true;
}

void wake_ble_poll(void) {
	uint32_t now;

	cyw43_arch_poll();
	now = to_ms_since_boot(get_absolute_time());

	if (have_request && stack_ok && !writing_addr) {
		if (addr_set) {
			have_request = false;
			start_adv();
		} else if (hci_can_send_command_packet_now()) {
			have_request = false;
			writing_addr = true;
			write_until_ms = now + ADDR_TIMEOUT_MS;
			hci_send_cmd(&hci_bcm_write_bd_addr, pad_addr);
		}
	}

	if (writing_addr && now >= write_until_ms) {
		/* Don't advertise with a random address: Switch 2 only wakes a bonded public MAC. */
		writing_addr = false;
		have_request = true;
	}

	if (advertising && now >= adv_until_ms) {
		gap_advertisements_enable(0);
		advertising = false;
		led(false);
	}
}

#else

void wake_ble_init(void) {}

void wake_ble_request(uint8_t const switch_mac[6], uint8_t const pad_mac[6], uint16_t pid) {
	(void)switch_mac;
	(void)pad_mac;
	(void)pid;
}

void wake_ble_poll(void) {}

#endif
