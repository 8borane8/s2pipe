#ifndef USB_H
#define USB_H

#include <stdint.h>

void usb_set_hid_count(uint8_t n);
uint8_t usb_hid_count(void);

#endif
