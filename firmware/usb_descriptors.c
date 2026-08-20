#include "tusb.h"
#include "packet.h"
#include "usb.h"

#include <string.h>

enum {
	STR_LANG = 0,
	STR_MFG,
	STR_PRODUCT,
	STR_P1,
	STR_P2,
	STR_P3,
	STR_P4,
};

#define EPNUM_HID1 0x81
#define EPNUM_HID2 0x82
#define EPNUM_HID3 0x83
#define EPNUM_HID4 0x84

#define HID_ITF(n, str, ep) \
	TUD_HID_DESCRIPTOR(n, str, HID_ITF_PROTOCOL_NONE, sizeof(desc_hid_report), ep, CFG_TUD_HID_EP_BUFSIZE, 1)

tusb_desc_device_t const desc_device = {
	.bLength = sizeof(tusb_desc_device_t),
	.bDescriptorType = TUSB_DESC_DEVICE,
	.bcdUSB = 0x0200,
	.bDeviceClass = 0,
	.bDeviceSubClass = 0,
	.bDeviceProtocol = 0,
	.bMaxPacketSize0 = CFG_TUD_ENDPOINT0_SIZE,
	.idVendor = 0x0F0D,
	.idProduct = 0x0092,
	.bcdDevice = 0x0100,
	.iManufacturer = STR_MFG,
	.iProduct = STR_PRODUCT,
	.iSerialNumber = 0,
	.bNumConfigurations = 1,
};

uint8_t const desc_hid_report[] = {
	0x05, 0x01, 0x09, 0x05, 0xA1, 0x01, 0x15, 0x00, 0x25, 0x01, 0x35, 0x00, 0x45, 0x01, 0x75, 0x01,
	0x95, 0x10, 0x05, 0x09, 0x19, 0x01, 0x29, 0x10, 0x81, 0x02, 0x05, 0x01, 0x25, 0x07, 0x46, 0x3B,
	0x01, 0x75, 0x04, 0x95, 0x01, 0x65, 0x14, 0x09, 0x39, 0x81, 0x42, 0x65, 0x00, 0x95, 0x01, 0x81,
	0x01, 0x26, 0xFF, 0x00, 0x46, 0xFF, 0x00, 0x09, 0x30, 0x09, 0x31, 0x09, 0x32, 0x09, 0x35, 0x75,
	0x08, 0x95, 0x04, 0x81, 0x02, 0x06, 0x00, 0xFF, 0x09, 0x20, 0x95, 0x01, 0x81, 0x02, 0x0A, 0x21,
	0x26, 0x95, 0x08, 0x91, 0x02, 0xC0,
};

#define CFG0_LEN (TUD_CONFIG_DESC_LEN)
#define CFG1_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN)
#define CFG2_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN * 2)
#define CFG3_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN * 3)
#define CFG4_LEN (TUD_CONFIG_DESC_LEN + TUD_HID_DESC_LEN * 4)

static uint8_t const desc_cfg0[] = {
	TUD_CONFIG_DESCRIPTOR(1, 0, 0, CFG0_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 500),
};

static uint8_t const desc_cfg1[] = {
	TUD_CONFIG_DESCRIPTOR(1, 1, 0, CFG1_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 500),
	HID_ITF(0, STR_P1, EPNUM_HID1),
};

static uint8_t const desc_cfg2[] = {
	TUD_CONFIG_DESCRIPTOR(1, 2, 0, CFG2_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 500),
	HID_ITF(0, STR_P1, EPNUM_HID1),
	HID_ITF(1, STR_P2, EPNUM_HID2),
};

static uint8_t const desc_cfg3[] = {
	TUD_CONFIG_DESCRIPTOR(1, 3, 0, CFG3_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 500),
	HID_ITF(0, STR_P1, EPNUM_HID1),
	HID_ITF(1, STR_P2, EPNUM_HID2),
	HID_ITF(2, STR_P3, EPNUM_HID3),
};

static uint8_t const desc_cfg4[] = {
	TUD_CONFIG_DESCRIPTOR(1, 4, 0, CFG4_LEN, TUSB_DESC_CONFIG_ATT_REMOTE_WAKEUP, 500),
	HID_ITF(0, STR_P1, EPNUM_HID1),
	HID_ITF(1, STR_P2, EPNUM_HID2),
	HID_ITF(2, STR_P3, EPNUM_HID3),
	HID_ITF(3, STR_P4, EPNUM_HID4),
};

static uint8_t const *const desc_cfg[] = { desc_cfg0, desc_cfg1, desc_cfg2, desc_cfg3, desc_cfg4 };

static uint8_t hid_count;

void usb_set_hid_count(uint8_t n) {
	hid_count = n > PAD_COUNT ? PAD_COUNT : n;
}

uint8_t usb_hid_count(void) {
	return hid_count;
}

char const *string_desc_arr[] = {
	(const char[]){ 0x09, 0x04 },
	"HORI CO.,LTD.",
	"POKKEN CONTROLLER",
	"P1",
	"P2",
	"P3",
	"P4",
};

static uint16_t _desc_str[32];

uint8_t const *tud_descriptor_device_cb(void) {
	return (uint8_t const *)&desc_device;
}

uint8_t const *tud_descriptor_configuration_cb(uint8_t index) {
	(void)index;
	return desc_cfg[hid_count];
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
