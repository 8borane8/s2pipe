# Pico firmware

4 HORI Pokkén HID pads (VID `0x0F0D` / PID `0x0092`). UART 64-byte frames -> USB.

## Flash

Download `s2pipe_pico.uf2` from [Releases](https://github.com/8borane8/s2pipe/releases). Hold **BOOTSEL**, plug the Pico
in, drop the `.uf2`, unplug.

Local build (optional):

```sh
export PICO_SDK_PATH=/path/to/pico-sdk
cmake -S firmware -B firmware/build -DPICO_BOARD=pico2_w
cmake --build firmware/build
```

`PICO_BOARD`: `pico`, `pico_w`, `pico2`, `pico2_w`. Sleep wake needs a **W** board.

## Pins

| Pico     | Goes to                      |
| -------- | ---------------------------- |
| USB      | Switch dock (USB-A or USB-C) |
| GP4 (TX) | UART adapter RX              |
| GP5 (RX) | UART adapter TX              |
| GND      | Adapter GND                  |

No VCC. UART1, **921600 8N1**. Adapter RX/TX LEDs show traffic.

One native USB: flash from the PC, then plug the Pico into the dock. Not a COM port and pads at the same time.

Sleep wake (Pico 2 W / Pico W): [README §6](../README.md#6-sleep-wake). `python3 scripts/wake-scan.py` fills `.env`.
On-board LED lights while the wake advert is on air. Non-W boards compile; wake is a no-op. Full power-off still needs
the console button. Switch 1 pads cannot wake a Switch 2.
