# s2pipe

Self-hosted Switch 2 cloud play. The console stays on the capture PC. Up to four browsers see the picture over WebRTC
and play with a gamepad or keyboard. Inputs go to a Raspberry Pico that shows up on the Switch as 4 USB pads.

No cloud, no subscription, no client to install. **No auth.** Trusted LAN only. Do not expose this on the Internet.

```
Switch 2 --HDMI--> capture --USB--> media (FFmpeg + MediaMTX)
                                         |-- ICE --> browsers
Browsers --WHEP + WebSocket--> node --UART--> Pico --USB--> Switch 2
```

| Piece        | Path                      | Role                                     |
| ------------ | ------------------------- | ---------------------------------------- |
| **Media**    | `docker/Dockerfile.media` | Encodes HDMI, serves WebRTC              |
| **Node**     | `apps/node`               | HTTP, WebSocket, Pico serial, WHEP proxy |
| **Client**   | `apps/client`             | Browser UI                               |
| **Firmware** | `firmware`                | Pico: UART in, 4 USB pads out            |

Anyone can **Watch**. Four **Play** seats. P1–P4 numbers are set on the Switch, not by s2pipe.

## 1. Tested hardware

Equivalents are fine.

- [Raspberry Pico 2 W](https://amzn.eu/d/09YZSwVw) — board `pico2_w`
- [CP2102 UART adapter HW-598](https://amzn.eu/d/0catDsov) — jumper **3.3 V**, **no VCC** on the Pico (TX / RX / GND
  only)
- [XIIXMASK HDMI USB 3.0 capture](https://amzn.eu/d/09Xc9GcE) — UVC webcam (MJPEG), HDMI in + loop
- Switch 2 + dock, PC, [Docker](https://docs.docker.com/get-docker/) Compose

## 2. UART driver (Windows)

Chip is **Silicon Labs CP2102**. If you have no `COMx`:
[CP210x VCP](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers).

Linux: `cp210x` is already in the kernel -> `/dev/ttyUSB0`.

## 3. Flash the Pico

1. Download `s2pipe_pico.uf2` from [Releases](https://github.com/8borane8/s2pipe/releases) (no SDK needed).
2. Hold **BOOTSEL**, plug the Pico into the PC, drop the `.uf2`.
3. Unplug. Pico USB -> Switch dock. UART -> PC.

Local build: [firmware/README.md](firmware/README.md).

## 4. Wiring

One native USB: flash from the PC, then plug into the dock. Not a COM port and pads at the same time.

```
Node --UART 921600--> Pico GP5 RX / GP4 TX
Switch dock USB  --> Pico USB
```

| Pico     | Goes to                            |
| -------- | ---------------------------------- |
| USB      | Switch 2 dock (USB-A or USB-C OTG) |
| GP4 (TX) | UART adapter **RX**                |
| GP5 (RX) | UART adapter **TX**                |
| GND      | GND                                |

Power from Switch USB. **Leave adapter VCC disconnected** (5 V on a GPIO kills the Pico). CP2102 jumper on **3.3 V**.

Local test without the node (Windows, one Xbox):

```sh
pip install pyserial
python scripts/pico_controller.py COM3
```

**Tab** cycles P1->P4. **1–4** (numpad too) pick the seat. **H** is Home. Other pads stay neutral. CP2102 RX/TX LEDs
should blink.

## 5. Compose

```sh
cp .env.example .env
```

**This PC only:** leave `localhost`.

**Other machines on the LAN:** capture PC IP, never `127.0.0.1`, never the Docker name `node`:

```
NODE_BASE_URL=http://192.168.1.20:5050
MEDIA_ICE_IP=192.168.1.20
```

The browser must reach both `NODE_BASE_URL` and `MEDIA_ICE_IP:MEDIA_ICE_PORT` (UDP).

**Video**

|                      | `.env`                                                 |
| -------------------- | ------------------------------------------------------ |
| Color bars (no card) | `CAPTURE_SOURCE=test`                                  |
| Real HDMI            | `CAPTURE_SOURCE=v4l2` and `CAPTURE_DEVICE=/dev/video0` |

The card must show up as a webcam. Some Windows-only “Game Capture” boxes never get `/dev/video0`.

- **Linux:** plug the card in. Compose maps `/dev` (privileged). If it is not `video0`, set
  `CAPTURE_DEVICE=/dev/videoN`.
- **Windows:** Docker Desktop cannot see USB by itself. You must **attach** through a real WSL distro (Ubuntu). Do not
  use `--distribution docker-desktop`.

```powershell
wsl --update
wsl --install -d Ubuntu
winget install --interactive --exact dorssel.usbipd-win
.\scripts\usb.ps1 -List
.\scripts\usb.ps1 -BusId 2-4
```

`usbipd list` must show **Attached**, not only Shared. The serial adapter usually becomes `/dev/ttyUSB0`. The HDMI card
often has **no** `/dev/video0`: the stock WSL kernel has no UVC. While attached, Windows cannot use that port.

**Audio** (HDMI sound from the card)

Video is `/dev/video0`. HDMI audio is a **separate ALSA device**. Empty `CAPTURE_AUDIO` = silence. To send sound to the
browser:

```sh
docker compose --profile node exec media cat /proc/asound/cards
```

Set `CAPTURE_AUDIO` (e.g. `hw:0,0`). Restart media. Click the video once if the browser blocks autoplay.

**Pico** (without it, video works, Play does nothing on the Switch)

`PICO_SERIAL=/dev/ttyUSB0` in Compose (Linux **and** Windows). On Windows attach the UART adapter with
`.\scripts\usb.ps1` too, not `COM3`: the node is Linux.

CPU:

```sh
docker compose --profile all up --build
```

NVIDIA (`h264_nvenc`):

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile all up --build
```

Needs an NVIDIA GPU and Docker GPU access
([NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/index.html) on
Linux; Docker Desktop WSL2 + driver on Windows).

Node + media only: `--profile node`.

**Stop (Windows):** do not only close the terminal. FFmpeg can keep `/dev/video0` and freeze usbipd.

```powershell
.\scripts\stop.ps1
```

Still stuck: `.\scripts\stop.ps1 -WslShutdown` (restarts WSL, not the PC). Then re-attach USB.

## 6. Play

Open [http://localhost:5000](http://localhost:5000). With `--profile all`, the client uses `NODE_BASE_URL` and skips the
connect page.

Start in **Watch**. **Play** takes a Pico seat (max 4). **Watch** releases it. Keyboard/mouse or a gamepad at the
bottom. Click the video while playing to lock the pointer (right stick). Esc = settings.

Pills: capture, Pico, WebSocket. `n/4 playing` is remote Pico seats, not Switch player numbers.

## Environment

| Variable                           | Default                 | Role                                          |
| ---------------------------------- | ----------------------- | --------------------------------------------- |
| `NODE_PORT`                        | `5050`                  | Node HTTP                                     |
| `NODE_BASE_URL`                    | `http://localhost:5050` | URL the **browser** uses for the node         |
| `MEDIA_ICE_IP` / `MEDIA_ICE_PORT`  | `127.0.0.1` / `8189`    | ICE (UDP)                                     |
| `CAPTURE_SOURCE`                   | `test`                  | `test` or `v4l2`                              |
| `CAPTURE_DEVICE` / `CAPTURE_AUDIO` | `/dev/video0` / empty   | V4L2; ALSA HDMI (`hw:0,0`) or silence         |
| `CAPTURE_FORMAT`                   | `mjpeg`                 | V4L2 format (`yuyv` if the card has no MJPEG) |
| `CAPTURE_WIDTH` / `HEIGHT` / `FPS` | `1920` / `1080` / `60`  | Encode size                                   |
| `FFMPEG_ENCODER`                   | `libx264`               | `libx264` or `h264_nvenc` (GPU overlay)       |
| `FFMPEG_EXTRA`                     | empty                   | Extra FFmpeg args                             |
| `PICO_SERIAL`                      | empty                   | `/dev/ttyUSB0` in Compose                     |
| `CLIENT_PORT`                      | `5000`                  | UI                                            |

| Port     | What                                |
| -------- | ----------------------------------- |
| 5000     | Client                              |
| 5050     | Node: health, WebSocket, WHEP proxy |
| 8189 UDP | WebRTC ICE / RTP                    |

The node opens **921600 8N1**. If the adapter cannot do 921600, use 500000 in both `UART_BAUD` (`firmware/main.c`)
**and** `SERIAL_BAUD` (`apps/node/src/services/pico.ts`). 250 ms UART silence -> pads go neutral.

## Development

Deno workspace: `apps/node`, `apps/client`, `shared`. Firmware is CMake.

```sh
deno fmt
deno check apps/node/src/index.ts
deno check apps/client/src/index.ts
```

**Media:** keep Compose. WHEP (`8889`) is not published. A host node needs `8889:8889` on media, or MediaMTX on the
machine (`MEDIA_HOST`, default `127.0.0.1`).

**Node:** `cd apps/node && cp .env.example .env && deno task dev` (5050). `PICO_SERIAL`: `COM3` on a Windows host,
`/dev/ttyUSB0` on Linux.

**Client:** `cd apps/client && cp .env.example .env && deno task dev` (5000). No `NODE_BASE_URL` -> connect page.

Firmware and packet: keep `apps/node/src/utils/packet.ts` in sync with `firmware/packet.h`.

## Node API

| Route                     | What                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `GET /health`             | Capture, Pico, `playing` count                               |
| `GET /socket`             | WebSocket                                                    |
| `POST /switch/whep`       | Video WHEP; `PATCH` / `DELETE` `/switch/whep/:session`       |
| `POST /switch-audio/whep` | Audio WHEP; `PATCH` / `DELETE` `/switch-audio/whep/:session` |

- Client: `{ op: "play" }` · `{ op: "watch" }` · `{ op: "pad", data: PadState }`
- Server: `{ op: "status", data: { capture, pico, playing } }` on join and when seats change
- Server: `{ op: "play", data: { playing: boolean } }` after Play (`false` if all four seats are taken)

Join is Watch. Play takes a seat; Watch or closing the socket releases it.

## License

[MIT](LICENCE) Copyright (c) 2026-present, Borane
