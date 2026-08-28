#include "tusb.h"

#include <string.h>

#ifndef TUD_HID_INOUT_DESC_LEN
#define TUD_HID_INOUT_DESC_LEN (9 + 9 + 7 + 7)
#endif

/* Four HORI Pokkén HIDs (VID 0x0F0D / PID 0x0092, same report as GP2040-CE). */

#define EPNUM_HID0_OUT 0x01
#define EPNUM_HID0_IN 0x81
#define EPNUM_HID1_OUT 0x02
#define EPNUM_HID1_IN 0x82
#define EPNUM_HID2_OUT 0x03
#define EPNUM_HID2_IN 0x83
#define EPNUM_HID3_OUT 0x04
#define EPNUM_HID3_IN 0x84

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

#define CONFIG_LEN (TUD_CONFIG_DESC_LEN + (4 * TUD_HID_INOUT_DESC_LEN))

static uint8_t const desc_configuration[] = {
	TUD_CONFIG_DESCRIPTOR(1, 4, 0, CONFIG_LEN, 0x80, 500),
	TUD_HID_INOUT_DESCRIPTOR(
		0, 0, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report),
		EPNUM_HID0_OUT, EPNUM_HID0_IN, CFG_TUD_HID_EP_BUFSIZE, 1
	),
	TUD_HID_INOUT_DESCRIPTOR(
		1, 0, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report),
		EPNUM_HID1_OUT, EPNUM_HID1_IN, CFG_TUD_HID_EP_BUFSIZE, 1
	),
	TUD_HID_INOUT_DESCRIPTOR(
		2, 0, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report),
		EPNUM_HID2_OUT, EPNUM_HID2_IN, CFG_TUD_HID_EP_BUFSIZE, 1
	),
	TUD_HID_INOUT_DESCRIPTOR(
		3, 0, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report),
		EPNUM_HID3_OUT, EPNUM_HID3_IN, CFG_TUD_HID_EP_BUFSIZE, 1
	),
};

_Static_assert(sizeof(desc_configuration) == 137, "four Pokken IN+OUT interfaces = 137-byte config");

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
