#include "packet.h"
#include "tusb.h"

#include <string.h>

#ifndef TUD_HID_INOUT_DESC_LEN
#define TUD_HID_INOUT_DESC_LEN (9 + 9 + 7 + 7)
#endif

/* Eight HORI Pokkén HIDs (VID 0x0F0D / PID 0x0092, same report as GP2040-CE).
   IN+OUT like the real pad and the 4-pad firmware that the Switch accepted. */

#define HID_PAD(_n, _epout, _epin) \
	TUD_HID_INOUT_DESCRIPTOR( \
		_n, 0, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report), \
		_epout, _epin, CFG_TUD_HID_EP_BUFSIZE, 1 \
	)

static uint8_t const desc_device[] = {
	0x12, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x40,
	0x0D, 0x0F, 0x92, 0x00, 0x00, 0x01, 0x01, 0x02,
	0x00, 0x01,
};

uint8_t const desc_hid_report[] = {
	0x05, 0x01, 0x09, 0x05, 0xA1, 0x01, 0x15, 0x00, 0x25, 0x01, 0x35, 0x00, 0x45, 0x01, 0x75, 0x01,
	0x95, 0x10, 0x05, 0x09, 0x19, 0x01, 0x29, 0x10, 0x81, 0x02, 0x05, 0x01, 0x25, 0x07, 0x46, 0x3B,
	0x01, 0x75, 0x04, 0x95, 0x01, 0x65, 0x14, 0x09, 0x39, 0x81, 0x42, 0x65, 0x00, 0x95, 0x01, 0x81,
	0x01, 0x26, 0xFF, 0x00, 0x46, 0xFF, 0x00, 0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, 0x75,
	0x08, 0x95, 0x04, 0x81, 0x02, 0x06, 0x00, 0xFF, 0x09, 0x20, 0x95, 0x01, 0x81, 0x02, 0x0A, 0x21,
	0x26, 0x95, 0x08, 0x91, 0x02, 0xC0,
};

_Static_assert(sizeof(desc_hid_report) == 86, "GP2040 / LUFA Pokken report descriptor is 86 bytes");

#define CONFIG_LEN (TUD_CONFIG_DESC_LEN + (PAD_COUNT * TUD_HID_INOUT_DESC_LEN))

static uint8_t const desc_configuration[] = {
	TUD_CONFIG_DESCRIPTOR(1, PAD_COUNT, 0, CONFIG_LEN, 0x80, 500),
	HID_PAD(0, 0x01, 0x81),
	HID_PAD(1, 0x02, 0x82),
	HID_PAD(2, 0x03, 0x83),
	HID_PAD(3, 0x04, 0x84),
	HID_PAD(4, 0x05, 0x85),
	HID_PAD(5, 0x06, 0x86),
	HID_PAD(6, 0x07, 0x87),
	HID_PAD(7, 0x08, 0x88),
};

_Static_assert(sizeof(desc_configuration) == 265, "eight Pokken IN+OUT interfaces = 265-byte config");
_Static_assert(PAD_COUNT == 8, "usb_descriptors lists eight HID pads");

/* All 16 endpoints poll at 1 ms, so the host must fit them in a single full-speed frame: 12000 bit
   times, of which only 90% is reservable for periodic transfers. One transaction costs 13 bytes of
   protocol overhead plus the payload, inflated by worst-case bit stuffing, plus turnaround. Ask for
   more and the host refuses the configuration outright instead of enumerating the device. */
#define EP_BIT_TIMES(_bytes) (((((_bytes) + 13) * 8 * 7) / 6) + 100)

_Static_assert(
	(PAD_COUNT * 2) * EP_BIT_TIMES(CFG_TUD_HID_EP_BUFSIZE) <= 10800,
	"1 ms endpoints exceed the full-speed periodic bandwidth budget"
);

char const *string_desc_arr[] = {
	(const char[]){ 0x09, 0x04 },
	"HORI CO.,LTD.",
	"POKKEN CONTROLLER",
};

static uint16_t _desc_str[32];

uint8_t const *tud_descriptor_device_cb(void) {
	return desc_device;
}

uint8_t const *tud_descriptor_configuration_cb(uint8_t index) {
	(void)index;
	return desc_configuration;
}

uint8_t const *tud_hid_descriptor_report_cb(uint8_t instance) {
	(void)instance;
	return desc_hid_report;
}

uint16_t const *tud_descriptor_string_cb(uint8_t index, uint16_t langid) {
	(void)langid;
	uint8_t chr_count;

	if (index == 0) {
		memcpy(&_desc_str[1], string_desc_arr[0], 2);
		chr_count = 1;
	} else {
		if (index >= sizeof(string_desc_arr) / sizeof(string_desc_arr[0])) return NULL;
		char const *str = string_desc_arr[index];
		chr_count = (uint8_t)strlen(str);
		if (chr_count > 31) chr_count = 31;
		for (uint8_t i = 0; i < chr_count; i++) {
			_desc_str[1 + i] = str[i];
		}
	}

	_desc_str[0] = (uint16_t)((TUSB_DESC_STRING << 8) | (2 * chr_count + 2));
	return _desc_str;
}
