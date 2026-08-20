# Pico firmware

USB toward the Switch, UART toward the node. One native USB: the Pico cannot be a COM port on the PC and four pads on the console at the same time.

```
Node --UART 921600--> Pico GP5 RX / GP4 TX
Switch dock USB  --> Pico USB
```

The s2pipe packet (`apps/node/src/utils/packet.ts`) is one 64-byte frame with **all four pads**. The node writes that frame on a single serial port. This firmware parses it and exposes **four HID gamepads** on that one Pico.

Do not flash [switch-pico](https://github.com/jyapayne/switch-pico) `.uf2` here. Their UART frames start with `0xAA` and carry **one** Pro Controller (plus optional IMU). Four players there means four `--map` serial ports, four Picos. Wiring is the same (UART1, GPIO4/5, 921600, 3.3 V); the packet is not.

USB identity is the HORI Pokken HID layout (VID `0x0F0D`, PID `0x0092`), four IN interrupt endpoints, same composite pattern as PicoSwitch-WirelessGamepadAdapter. Enable **Pro Controller Wired Communication** on the console. switch-pico’s Nintendo handshake (`0x057E` / `0x2009`) is a later firmware step if the Switch 2 rejects HORI.

## Wire

| Pico     | Goes to                                      |
| -------- | -------------------------------------------- |
| USB      | Switch 2 dock (USB-A) or a USB-C OTG adapter |
| GP4 (TX) | USB-UART adapter RX                          |
| GP5 (RX) | USB-UART adapter TX                          |
| GND      | USB-UART GND                                 |

Power the Pico from the Switch USB. Leave the adapter VCC unconnected unless it is 3.3 V and you know you want it. Logic must stay 3.3 V.

Set `PICO_SERIAL` to the adapter (`COM3`, `/dev/ttyUSB0`, …). The node sets **921600 8N1** when it opens the port. If the adapter cannot do 921600, 500000 is the usual fallback (then change `UART_BAUD` in `main.c` to match).

The onboard LED toggles on each valid packet. If nothing arrives for 250 ms, all pads go neutral.

## Build and flash

Need the [Pico SDK](https://github.com/raspberrypi/pico-sdk) with submodules, and an ARM GCC toolchain.

```sh
export PICO_SDK_PATH=/path/to/pico-sdk
cmake -S firmware -B firmware/build -DPICO_BOARD=pico
cmake --build firmware/build
```

Hold BOOTSEL, plug the Pico into the PC, copy `firmware/build/s2pipe_pico.uf2` onto the mass-storage volume, then unplug and wire USB to the Switch.

`PICO_BOARD` can be `pico`, `pico_w`, or `pico2`.
