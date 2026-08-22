# s2pipe

Self-hosted cloud gaming for a Nintendo Switch 2 at home.

The console stays on the capture PC. Up to four people open a browser, see the picture over WebRTC, and play with a
gamepad or keyboard and mouse. Inputs go to a Raspberry Pico that shows up on the Switch as USB controllers.

No cloud, no subscription, no client install. **No authentication**. Trusted LAN only. Do not put this on the Internet.

## How it works

```
Switch 2 --HDMI--> capture card --USB--> media (FFmpeg + MediaMTX)
                                              |-- ICE (UDP/TCP) --> browsers
Browsers --WHEP + WebSocket--> node --UART--> Pico --USB--> Switch 2
```

| Piece        | Path                      | Role                                     |
| ------------ | ------------------------- | ---------------------------------------- |
| **Media**    | `docker/Dockerfile.media` | Encodes HDMI, serves WebRTC              |
| **Node**     | `apps/node`               | HTTP, WebSocket, Pico serial, WHEP proxy |
| **Client**   | `apps/client`             | Browser UI                               |
| **Firmware** | `firmware`                | Pico: UART in, USB pads out              |

Anyone can **Watch**. Up to four can **Play**. Player numbers (P1–P4) are assigned on the Switch, not by s2pipe.

## Requirements

- Switch 2, HDMI capture card that looks like a **webcam (UVC)**, a PC
- [Raspberry Pico](https://www.raspberrypi.com/products/raspberry-pi-pico/) (or Pico W / Pico 2) + USB–UART adapter
  (**3.3 V** TX/RX/GND only)
- [Docker](https://docs.docker.com/get-docker/) Compose
- On the Switch: **Pro Controller Wired Communication**
- Optional: NVIDIA GPU, [Deno 2](https://deno.com/) to hack the apps,
  [Pico SDK](https://github.com/raspberrypi/pico-sdk) to build firmware

## Run

### 1. Env

```sh
cp .env.example .env
```

Edit `.env`. Compose reads this file.

**This PC only:** leave the defaults (`localhost`).

**Other machines on the LAN:** use the capture PC’s IP, never `127.0.0.1` and never the Docker name `node`:

```
NODE_BASE_URL=http://192.168.1.20:5050
MEDIA_ICE_IP=192.168.1.20
```

The browser must reach both `NODE_BASE_URL` and `MEDIA_ICE_IP:MEDIA_ICE_PORT` (UDP and TCP).

**Video**

|                                    | `.env`                                                 |
| ---------------------------------- | ------------------------------------------------------ |
| Color bars (no card, check the UI) | `CAPTURE_SOURCE=test`                                  |
| Real HDMI                          | `CAPTURE_SOURCE=v4l2` and `CAPTURE_DEVICE=/dev/video0` |

The card must appear as a webcam. Some Game Capture boxes with Windows-only drivers never show up as `/dev/video0`.

- **Linux:** plug the card in. Compose already maps the host `/dev` into media and node (`privileged`). If it is not
  `video0`, set `CAPTURE_DEVICE` to `/dev/videoN`.
- **Windows:** Docker Desktop cannot see USB by itself. `bind` only shares the device; you still need **attach**. Attach
  must use a **real WSL distro** (Ubuntu). `docker-desktop` has no usbip client. Do not pass
  `--distribution docker-desktop`.

```powershell
wsl --update
wsl --install -d Ubuntu
winget install --interactive --exact dorssel.usbipd-win
.\scripts\usb.ps1 -List
.\scripts\usb.ps1 -BusId 2-4
```

`usbipd list` must show **Attached**, not only Shared. Serial adapters usually become `/dev/ttyUSB0`. HDMI cards often
do **not** get `/dev/video0`: the stock WSL kernel has no UVC driver. Same Compose file works on Linux. While attached,
Windows cannot use that USB port.

**Audio** (HDMI sound from the capture card)

Video is `/dev/video0`. HDMI audio is a **separate ALSA device**, not inside the webcam node. Leave `CAPTURE_AUDIO`
empty for silence. To send sound to the browser (Opus on the CPU over WebRTC; NVENC is video only):

```sh
docker compose --profile node exec media cat /proc/asound/cards
```

Set `CAPTURE_AUDIO` to that card, for example `hw:1,0` (card number from the list, device 0). Restart media. Click the
video once if the browser blocks autoplay with sound.

**Pico** (optional: without it, video works, Play does nothing on the Switch)

`PICO_SERIAL=/dev/ttyUSB0` in Compose (Linux **and** Windows). On Windows attach the UART adapter with
`.\scripts\usb.ps1` too, not `COM3`, the node is Linux. Wiring and flash: [Pico](#pico).

### 2. Start

CPU:

```sh
docker compose --profile all up --build
```

NVIDIA (`h264_nvenc`), Windows or Linux. Needs an NVIDIA GPU and Docker GPU access (Linux:
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/index.html);
Windows: Docker Desktop WSL2 + current Game Ready / Studio driver). The driver stays on the host; Compose injects
NVENC into the container.

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile all up --build
```

Node + media only (no client container): `--profile node` instead of `--profile all`.

### 3. Play

Open [http://localhost:5000](http://localhost:5000). With `--profile all`, the client uses `NODE_BASE_URL` and skips the
connect page.

You start in **Watch**. **Play** takes a Pico seat (max 4). **Watch** releases it. Pick keyboard/mouse or a gamepad at
the bottom. Click the video while playing to lock the pointer (right stick). Esc = settings.

Pills: capture, Pico, WebSocket. `n/4 playing` is remote Pico seats, not Switch player numbers.

## Pico

One native USB: flash from the PC, then plug USB into the dock. It cannot be a COM port and pads on the Switch at the
same time.

```
Node --UART 921600--> Pico GP5 RX / GP4 TX
Switch dock USB  --> Pico USB
```

| Pico     | Goes to                            |
| -------- | ---------------------------------- |
| USB      | Switch 2 dock (USB-A) or USB-C OTG |
| GP4 (TX) | UART adapter **RX**                |
| GP5 (RX) | UART adapter **TX**                |
| GND      | UART GND                           |

Power from the Switch USB. Leave adapter **VCC unconnected** (5 V on a GPIO kills the Pico).

```sh
export PICO_SDK_PATH=/path/to/pico-sdk   # clone with submodules
cmake -S firmware -B firmware/build -DPICO_BOARD=pico
cmake --build firmware/build
```

`PICO_BOARD`: `pico`, `pico_w`, or `pico2`. Hold **BOOTSEL**, copy `firmware/build/s2pipe_pico.uf2` onto the Pico drive,
unplug, USB to the Switch, UART to the node.

Do **not** flash a [switch-pico](https://github.com/jyapayne/switch-pico) `.uf2`. Same pins, different packet.

The node opens **921600 8N1**. LED toggles on each valid packet. 250 ms silence → pads go neutral. Packet and HID:
[firmware/README.md](firmware/README.md).

## Environment

| Variable                           | Default                 | Role                                               |
| ---------------------------------- | ----------------------- | -------------------------------------------------- |
| `NODE_PORT`                        | `5050`                  | Node HTTP                                          |
| `NODE_BASE_URL`                    | `http://localhost:5050` | URL the **browser** uses for the node              |
| `MEDIA_ICE_IP` / `MEDIA_ICE_PORT`  | `127.0.0.1` / `8189`    | ICE address (UDP + TCP)                            |
| `CAPTURE_SOURCE`                   | `test`                  | `test` or `v4l2`                                   |
| `CAPTURE_DEVICE` / `CAPTURE_AUDIO` | `/dev/video0` / empty   | V4L2 video; ALSA HDMI audio (`hw:1,0`) or silence |
| `CAPTURE_WIDTH` / `HEIGHT` / `FPS` | `1920` / `1080` / `60`  | Encode size                                        |
| `FFMPEG_ENCODER`                   | `libx264`               | Video only: `libx264` or `h264_nvenc` (GPU overlay). Audio is always Opus on CPU |
| `FFMPEG_EXTRA`                     | empty                   | Extra FFmpeg args                                  |
| `PICO_SERIAL`                      | empty                   | `/dev/ttyUSB0` in Compose                          |
| `CLIENT_PORT`                      | `5000`                  | Web UI                                             |

| Port         | What                                |
| ------------ | ----------------------------------- |
| 5000         | Client                              |
| 5050         | Node: health, WebSocket, WHEP proxy |
| 8189 UDP+TCP | WebRTC ICE / RTP                    |

## Development

Deno workspace: `apps/node`, `apps/client`, `shared`. Firmware is CMake.

```
s2pipe/
├── apps/node/
├── apps/client/
├── firmware/
├── shared/
├── docker/
└── scripts/          # Windows: usb.ps1 (usbipd → Docker)
```

```sh
deno fmt
deno check apps/node/src/index.ts
deno check apps/client/src/index.ts
```

**Media:** keep Compose. WHEP (`8889`) is not published. A host node needs `8889:8889` on media, or MediaMTX on the
machine (`MEDIA_HOST`, default `127.0.0.1`).

**Node:** `cd apps/node && cp .env.example .env && deno task dev` (port 5050). `PICO_SERIAL`: `COM3` on Windows host,
`/dev/ttyUSB0` on Linux host.

**Client:** `cd apps/client && cp .env.example .env && deno task dev` (port 5000). No `NODE_BASE_URL` → connect page.
Set it to lock the node URL.

**Firmware:** [firmware/README.md](firmware/README.md). Keep `apps/node/src/utils/packet.ts` in sync with
`firmware/packet.h`.

## Node API

| Route               | What                                                   |
| ------------------- | ------------------------------------------------------ |
| `GET /health`       | Capture, Pico, `playing` count                         |
| `GET /socket`       | WebSocket                                              |
| `POST /switch/whep` | WHEP offer; `PATCH` / `DELETE` `/switch/whep/:session` |

- Client: `{ op: "play" }` · `{ op: "watch" }` · `{ op: "pad", data: PadState }`
- Server: `{ op: "status", data: { capture, pico, playing } }` on join and when seats change
- Server: `{ op: "play", data: { playing: boolean } }` after Play (`false` if all four seats are taken)

Join is Watch. Play takes a seat; Watch or closing the socket releases it.

## Notes

- Early software. Join/leave Play re-enumerates USB (short drop of every Pico pad).
- Pads pretend to be HORI Pokkén HID, not a Nintendo Pro Controller.
- Zero occupied Pico pads: USB detach, so a local controller can take a Switch slot.

## License

[MIT](LICENCE) Copyright (c) 2026-present, Borane
