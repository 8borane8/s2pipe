# s2pipe

Self-hosted cloud gaming for a Nintendo Switch 2 at home.

The console stays on the capture machine. Up to four people open a browser on the LAN, see the picture over WebRTC, and play with a gamepad or keyboard and mouse. Inputs go back to the node, then over UART to a Raspberry Pico that shows up on the Switch as USB controllers.

No cloud account, no subscription, no client install. **There is no authentication.** Run it on a trusted LAN only. Do not publish it to the Internet.

## How it works

```
Switch 2 --HDMI--> capture card --USB--> media (FFmpeg + MediaMTX)
                                              |-- ICE (UDP/TCP) --> browsers
Browsers --WHEP + WebSocket--> node --UART--> Pico --USB--> Switch 2
```

| Piece | Path | Role |
| ----- | ---- | ---- |
| **Media** | `docker/Dockerfile.media` | FFmpeg encodes the HDMI capture; MediaMTX serves WebRTC |
| **Node** | `apps/node` | HTTP, WebSocket, serial to the Pico, WHEP proxy |
| **Client** | `apps/client` | Browser UI (Slick + Preact) |
| **Firmware** | `firmware` | Pico: UART in, USB HID pads out |

Signalling (WHEP) goes through the node. The actual video/audio RTP goes to `MEDIA_ICE_IP:MEDIA_ICE_PORT`. Any number of browsers can **Watch**. Up to four can **Play**. The Switch assigns player numbers (P1–P4), not s2pipe. Local controllers use whatever USB slots are left.

## Requirements

**Hardware**

- Switch 2, HDMI capture card, a PC for the node (Linux preferred)
- [Raspberry Pico](https://www.raspberrypi.com/products/raspberry-pi-pico/) (or Pico W / Pico 2)
- USB–UART adapter, **3.3 V logic** (TX/RX/GND only)
- Optional NVIDIA GPU for `h264_nvenc`

**Software**

- [Docker](https://docs.docker.com/get-docker/) and Compose for the full stack
- [Deno 2](https://deno.com/) to hack on the node or client
- [Pico SDK](https://github.com/raspberrypi/pico-sdk) + ARM GCC to build firmware

On the Switch, enable **Pro Controller Wired Communication** (Controllers and accessories).

## Quick start

```sh
cp .env.example .env
docker compose --profile all up --build
```

Open [http://localhost:5000](http://localhost:5000). With `--profile all`, the client uses `NODE_BASE_URL` from `.env` and skips the connect page.

Default `CAPTURE_SOURCE=test` is a color bars + tone pattern. You do not need a Switch or Pico to confirm that video and the UI work.

| You want | Command |
| -------- | ------- |
| Full stack | `docker compose --profile all up --build` |
| Node + media only | `docker compose --profile node up --build` |
| NVIDIA encode | `docker compose -f docker-compose.yml -f docker-compose.gpu.yml --profile all up --build` |

On Linux, uncomment `devices` in `docker-compose.yml`: `/dev/video0` for the capture card, `/dev/ttyUSB0` (or your adapter) for the Pico UART.

**LAN.** Set both to the host’s LAN address, not `127.0.0.1` and never the Docker hostname `node`:

```
NODE_BASE_URL=http://192.168.1.20:5050
MEDIA_ICE_IP=192.168.1.20
```

The browser must reach `NODE_BASE_URL` and `MEDIA_ICE_IP:MEDIA_ICE_PORT` (UDP and TCP). MediaMTX WHEP (`8889`) and RTSP (`8554`) stay inside the media container.

## Pico

The Pico has one native USB. It cannot be a COM port on the PC **and** USB pads on the Switch at the same time. Flash it from the PC, then move USB to the dock.

```
Node --UART 921600--> Pico GP5 RX / GP4 TX
Switch dock USB  --> Pico USB
```

### Wire

| Pico | Goes to |
| ---- | ------- |
| USB | Switch 2 dock (USB-A) or a USB-C OTG adapter |
| GP4 (TX) | USB–UART adapter **RX** |
| GP5 (RX) | USB–UART adapter **TX** |
| GND | USB–UART GND |

Power the Pico from the Switch USB. Leave the adapter **VCC unconnected** unless it is 3.3 V and you know you want it. 5 V on a GPIO will kill the Pico.

### Flash

```sh
export PICO_SDK_PATH=/path/to/pico-sdk   # clone with submodules
cmake -S firmware -B firmware/build -DPICO_BOARD=pico
cmake --build firmware/build
```

`PICO_BOARD` can be `pico`, `pico_w`, or `pico2`. Hold **BOOTSEL**, plug the Pico into the PC, copy `firmware/build/s2pipe_pico.uf2` onto the mass-storage volume. Unplug, then USB to the Switch and UART to the node.

Do **not** flash a [switch-pico](https://github.com/jyapayne/switch-pico) `.uf2`. Same UART pins, different packet.

### Node serial

Set `PICO_SERIAL` to the adapter (`/dev/ttyUSB0`, `COM3`, …). Empty means no Pico: video still works, inputs do not reach the Switch.

The node opens the port at **921600 8N1**. The onboard LED toggles on each valid packet. If nothing arrives for 250 ms, pads go neutral.

If the adapter cannot do 921600, 500000 is the usual fallback — change `UART_BAUD` in `firmware/main.c` to match.

Packet layout, HID identity, and USB re-enumeration: [firmware/README.md](firmware/README.md).

## Play

1. Open the client. If `NODE_BASE_URL` is unset, enter the node URL (connect page).
2. You start in **Watch**. The feed is the capture; you send no pad.
3. **Play** takes the first free Pico seat (max 4). **Watch** releases it.
4. Pick a device at the bottom: keyboard & mouse, or a connected gamepad.
5. Click the video while playing to lock the pointer (right stick). Esc opens settings.

HUD pills: capture live/down, Pico ready/off, WebSocket connected. `n/4 playing` is how many remote pads are taken, not Switch player numbers.

## Configuration

Copy `.env.example` to `.env`. Compose reads the root file.

| Variable | Default | Role |
| -------- | ------- | ---- |
| `NODE_PORT` | `5050` | Node HTTP listen port |
| `NODE_BASE_URL` | `http://localhost:5050` | URL the **browser** uses for the node |
| `MEDIA_ICE_IP` / `MEDIA_ICE_PORT` | `127.0.0.1` / `8189` | Public ICE address (UDP + TCP) |
| `CAPTURE_SOURCE` | `test` | `test`, `v4l2`, or `custom` |
| `CAPTURE_DEVICE` / `CAPTURE_AUDIO` | `/dev/video0` / empty | V4L2 (and optional ALSA) |
| `CAPTURE_WIDTH` / `HEIGHT` / `FPS` | `1920` / `1080` / `60` | Encode size |
| `FFMPEG_ENCODER` | `libx264` | `libx264` or `h264_nvenc` (GPU overlay forces nvenc) |
| `FFMPEG_EXTRA` | empty | Extra FFmpeg args (`custom` uses this as the input) |
| `PICO_SERIAL` | empty | UART adapter path |
| `CLIENT_PORT` | `5000` | Client listen port |

| Port | Service |
| ---- | ------- |
| `CLIENT_PORT` (5000) | Web UI |
| `NODE_PORT` (5050) | Health, WebSocket, WHEP proxy |
| `MEDIA_ICE_PORT` (8189) UDP+TCP | WebRTC ICE / RTP |

## Development

Repo is a Deno workspace (`deno.json`): `apps/node`, `apps/client`, `shared`. Firmware is CMake + Pico SDK, not Deno.

```
s2pipe/
├── apps/node/       # Deno HTTP, WebSocket, Pico UART, WHEP proxy
├── apps/client/     # Slick + Preact
├── firmware/        # Pico
├── shared/          # Pad + node types (`@s2pipe/shared`)
└── docker/          # Images
```

```sh
deno fmt
deno check apps/node/src/index.ts
deno check apps/client/src/index.ts
```

### Media

Stay on Compose even when hacking the TypeScript apps. WHEP (`8889`) is not published on the host.

```sh
docker compose --profile node up --build media
```

To point a **host** node at that MediaMTX, publish `8889:8889` on the media service (temporary), or run FFmpeg + MediaMTX on the machine. The node talks to `MEDIA_HOST:8889` (default `127.0.0.1`).

`CAPTURE_SOURCE=test` does not need a capture card.

### Node

```sh
cd apps/node
cp .env.example .env   # NODE_PORT, CAPTURE_SOURCE, PICO_SERIAL
deno task dev          # watch + load .env
```

Defaults: listen `5050`, MediaMTX `127.0.0.1:8889`. Set `PICO_SERIAL` on the machine that has the UART adapter. On Windows the node runs `mode` to set 921600; Docker serial passthrough on Windows is painful — run the node natively there.

Health: `GET http://localhost:5050/health`.

### Client

```sh
cd apps/client
cp .env.example .env
deno task dev          # http://localhost:5000 , hot reload
```

Leave `NODE_BASE_URL` commented to get the connect page (URL stored in a cookie). Set it to lock the client to one node, same as Compose `--profile all`.

HTTP client types come from `@s2pipe/node`. Pad and WebSocket types live in `shared/`.

### Firmware

See [firmware/README.md](firmware/README.md). After a firmware change, rebuild the `.uf2`, flash over BOOTSEL, then plug USB back into the Switch. UART wiring stays on the adapter.

Packet encoder on the node: `apps/node/src/utils/packet.ts` (keep in sync with `firmware/packet.h`).

### Shared

`shared/types/pad.ts` — buttons, axes, `PAD_COUNT`.  
`shared/types/node.ts` — health + WebSocket `{ op, data }` frames.

## Node API

| Route | What |
| ----- | ---- |
| `GET /health` | Capture, Pico, `playing` count |
| `GET /socket` | WebSocket |
| `POST /switch/whep` | WHEP offer; `PATCH` / `DELETE` `/switch/whep/:session` |

WebSocket (everyone on the play page stays connected):

- Client: `{ op: "play" }` · `{ op: "watch" }` · `{ op: "pad", data: PadState }`
- Server: `{ op: "status", data: { capture, pico, playing } }` on join and when seats change
- Server: `{ op: "play", data: { playing: boolean } }` only as a Play reply (`false` if all four seats are taken)

Video is unauthenticated. Join is Watch. Play takes a Pico seat; Watch or closing the socket releases it.

## Notes

- Early software. Expect USB re-enumeration (a short drop of every Pico pad) when someone joins or leaves Play.
- Pads pretend to be a HORI Pokkén HID device, not a Nintendo Pro Controller. If the Switch 2 rejects that, a Nintendo USB handshake is future firmware work.
- Empty Pico (`flags = 0`) detaches USB so a local controller can take a Switch slot.

## License

[MIT](LICENCE) Copyright (c) 2026-present, Borane
