# Pico firmware

UART toward the node, USB HID toward the Switch. Full stack: [root README](../README.md).

The Pico has one native USB. It cannot be a COM port on the PC and pads on the console at the same time. Flash from the
PC, then move USB to the dock.

```
Node --UART 921600--> Pico GP5 RX / GP4 TX
Switch dock USB  --> Pico USB
```

Do not flash a [switch-pico](https://github.com/jyapayne/switch-pico) `.uf2`. Same pins (UART1, GPIO4/5, 921600, 3.3 V);
their frames start with `0xAA` and carry **one** Pro Controller. Four players there means four Picos. This firmware is
one Pico, four pad slots in one 64-byte frame.

## Wire

| Pico     | Goes to                                      |
| -------- | -------------------------------------------- |
| USB      | Switch 2 dock (USB-A) or a USB-C OTG adapter |
| GP4 (TX) | USB–UART adapter RX                          |
| GP5 (RX) | USB–UART adapter TX                          |
| GND      | USB–UART GND                                 |

Power from the Switch USB. Leave the adapter VCC unconnected unless it is 3.3 V and you intend to power from it. Logic
must stay 3.3 V.

## Build and flash

[Pico SDK](https://github.com/raspberrypi/pico-sdk) with submodules, and an ARM GCC toolchain.

```sh
export PICO_SDK_PATH=/path/to/pico-sdk
cmake -S firmware -B firmware/build -DPICO_BOARD=pico
cmake --build firmware/build
```

`PICO_BOARD` can be `pico`, `pico_w`, or `pico2`. Hold BOOTSEL, plug into the PC, copy `firmware/build/s2pipe_pico.uf2`
onto the mass-storage volume. Unplug, USB to the Switch, UART to the node.

Set `PICO_SERIAL` on the node. Compose: `/dev/ttyUSB0` (Windows: attach the adapter with `usb.ps1` first). Host process:
`COM3` or `/dev/ttyUSB0`. The node sets **921600 8N1**. If the adapter cannot do 921600, use 500000 and change
`UART_BAUD` in `main.c`.

The onboard LED toggles on each valid packet. Silence for 250 ms → all pads go neutral.

## Packet

Same layout as `apps/node/src/utils/packet.ts` (`firmware/packet.h`). One 64-byte frame, four 8-byte pad slots. Byte 3
(`flags`) is occupied seats (`bit0` = slot 0). The firmware enumerates that many HID interfaces. Zero occupied pads: USB
detach, so a local controller can take a Switch slot.

Joining or leaving Play re-enumerates USB (short drop of every Pico pad). Player order is set on the console.

USB identity is the HORI Pokkén HID layout (VID `0x0F0D`, PID `0x0092`), not Nintendo’s Pro Controller handshake. Enable
**Pro Controller Wired Communication**. The Nintendo handshake (`0x057E` / `0x2009`) is a later step if the Switch 2
rejects HORI.
