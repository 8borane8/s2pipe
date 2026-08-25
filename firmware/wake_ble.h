#ifndef WAKE_BLE_H
#define WAKE_BLE_H

#include <stdint.h>

void wake_ble_init(void);
void wake_ble_request(uint8_t const switch_mac[6], uint8_t const pad_mac[6], uint16_t pid);
void wake_ble_poll(void);

#endif
