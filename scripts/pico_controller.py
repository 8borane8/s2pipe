#!/usr/bin/env python3
"""One Xbox pad (BT/USB) -> Pico UART. Tab / 1-4 pick which Switch pad it drives.

  pip install pyserial
  python scripts/pico_controller.py --list
  python scripts/pico_controller.py COM3
  python scripts/pico_controller.py COM3 --pad 0
"""

from __future__ import annotations

import argparse
import ctypes
import struct
import sys
import time
from ctypes import wintypes

try:
	import serial
	from serial.tools import list_ports
except ImportError:
	sys.exit("pyserial missing:  pip install pyserial")

PACKET_SIZE = 64
PACKET_MAGIC = 0x5332
PACKET_VERSION = 1
PAD_COUNT = 4
PAD_CENTER = 128
PACKET_FLAGS = 0x0F
BAUD = 921600
FLUSH_S = 0.008
DEADZONE = 0.12

BTN_Y = 1 << 0
BTN_B = 1 << 1
BTN_A = 1 << 2
BTN_X = 1 << 3
BTN_L = 1 << 4
BTN_R = 1 << 5
BTN_ZL = 1 << 6
BTN_ZR = 1 << 7
BTN_MINUS = 1 << 8
BTN_PLUS = 1 << 9
BTN_L3 = 1 << 10
BTN_R3 = 1 << 11
BTN_HOME = 1 << 12
BTN_UP = 1 << 14
BTN_DOWN = 1 << 15
BTN_LEFT = 1 << 16
BTN_RIGHT = 1 << 17

XINPUT_DPAD_UP = 0x0001
XINPUT_DPAD_DOWN = 0x0002
XINPUT_DPAD_LEFT = 0x0004
XINPUT_DPAD_RIGHT = 0x0008
XINPUT_START = 0x0010
XINPUT_BACK = 0x0020
XINPUT_L3 = 0x0040
XINPUT_R3 = 0x0080
XINPUT_LB = 0x0100
XINPUT_RB = 0x0200
XINPUT_A = 0x1000
XINPUT_B = 0x2000
XINPUT_X = 0x4000
XINPUT_Y = 0x8000

ERROR_SUCCESS = 0
ERROR_DEVICE_NOT_CONNECTED = 1167

VK_TAB = 0x09
VK_H = 0x48
VK_1 = 0x31
VK_2 = 0x32
VK_3 = 0x33
VK_4 = 0x34
VK_NUMPAD1 = 0x61
VK_NUMPAD2 = 0x62
VK_NUMPAD3 = 0x63
VK_NUMPAD4 = 0x64

NEUTRAL = (0, PAD_CENTER, PAD_CENTER, PAD_CENTER, PAD_CENTER)
SEAT_KEYS = (
	(0, VK_1, VK_NUMPAD1),
	(1, VK_2, VK_NUMPAD2),
	(2, VK_3, VK_NUMPAD3),
	(3, VK_4, VK_NUMPAD4),
)


class XINPUT_GAMEPAD(ctypes.Structure):
	_fields_ = [
		("wButtons", wintypes.WORD),
		("bLeftTrigger", wintypes.BYTE),
		("bRightTrigger", wintypes.BYTE),
		("sThumbLX", wintypes.SHORT),
		("sThumbLY", wintypes.SHORT),
		("sThumbRX", wintypes.SHORT),
		("sThumbRY", wintypes.SHORT),
	]


class XINPUT_STATE(ctypes.Structure):
	_fields_ = [
		("dwPacketNumber", wintypes.DWORD),
		("Gamepad", XINPUT_GAMEPAD),
	]


def load_xinput():
	for name in ("xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"):
		try:
			dll = ctypes.WinDLL(name)
			fn = dll.XInputGetState
			fn.argtypes = [wintypes.DWORD, ctypes.POINTER(XINPUT_STATE)]
			fn.restype = wintypes.DWORD
			return fn
		except OSError:
			continue
	sys.exit("XInput DLL not found. Xbox pads on Windows need XInput.")


def crc16_ccitt(data: bytes) -> int:
	crc = 0xFFFF
	for byte in data:
		crc ^= byte << 8
		for _ in range(8):
			crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
	return crc


def encode(slots: list[tuple[int, int, int, int, int]]) -> bytes:
	packet = bytearray(PACKET_SIZE)
	struct.pack_into("<HBB", packet, 0, PACKET_MAGIC, PACKET_VERSION, PACKET_FLAGS)
	offset = 4
	for i in range(PAD_COUNT):
		buttons, lx, ly, rx, ry = slots[i]
		struct.pack_into("<IBBBB", packet, offset, buttons, lx, ly, rx, ry)
		offset += 8
	struct.pack_into("<H", packet, 36, crc16_ccitt(packet[:36]))
	return bytes(packet)


def key_down(vk: int) -> bool:
	return bool(ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000)


def axis_to_byte(value: float) -> int:
	if abs(value) < DEADZONE:
		return PAD_CENTER
	return max(0, min(255, round((value + 1.0) * 127.5)))


def stick(raw: int) -> float:
	if raw == -32768:
		return -1.0
	return raw / 32767.0


def sample(get_state, index: int) -> tuple[int, int, int, int, int] | None:
	state = XINPUT_STATE()
	status = get_state(index, ctypes.byref(state))
	if status == ERROR_DEVICE_NOT_CONNECTED:
		return None
	if status != ERROR_SUCCESS:
		return None

	pad = state.Gamepad
	buttons = 0
	if pad.wButtons & XINPUT_A:
		buttons |= BTN_B
	if pad.wButtons & XINPUT_B:
		buttons |= BTN_A
	if pad.wButtons & XINPUT_X:
		buttons |= BTN_Y
	if pad.wButtons & XINPUT_Y:
		buttons |= BTN_X
	if pad.wButtons & XINPUT_LB:
		buttons |= BTN_L
	if pad.wButtons & XINPUT_RB:
		buttons |= BTN_R
	if pad.bLeftTrigger >= 30:
		buttons |= BTN_ZL
	if pad.bRightTrigger >= 30:
		buttons |= BTN_ZR
	if pad.wButtons & XINPUT_BACK:
		buttons |= BTN_MINUS
	if pad.wButtons & XINPUT_START:
		buttons |= BTN_PLUS
	if pad.wButtons & XINPUT_L3:
		buttons |= BTN_L3
	if pad.wButtons & XINPUT_R3:
		buttons |= BTN_R3
	if pad.wButtons & XINPUT_DPAD_UP:
		buttons |= BTN_UP
	if pad.wButtons & XINPUT_DPAD_DOWN:
		buttons |= BTN_DOWN
	if pad.wButtons & XINPUT_DPAD_LEFT:
		buttons |= BTN_LEFT
	if pad.wButtons & XINPUT_DPAD_RIGHT:
		buttons |= BTN_RIGHT

	lx = axis_to_byte(stick(pad.sThumbLX))
	ly = axis_to_byte(-stick(pad.sThumbLY))
	rx = axis_to_byte(stick(pad.sThumbRX))
	ry = axis_to_byte(-stick(pad.sThumbRY))
	return buttons, lx, ly, rx, ry


def list_serial_ports() -> None:
	ports = list(list_ports.comports())
	if not ports:
		print("No serial ports.")
		return
	print("Serial ports (USB-UART adapter, not the Pico USB):")
	for port in ports:
		print(f"  {port.device:12}  {port.description}")


def list_pads(get_state) -> list[int]:
	found: list[int] = []
	for index in range(4):
		if sample(get_state, index) is not None:
			found.append(index)
	return found


_prev_tab = False


def pick_seat(seat: int) -> int:
	global _prev_tab
	tab = key_down(VK_TAB)
	if tab and not _prev_tab:
		seat = (seat + 1) % PAD_COUNT
		print(f"  driving P{seat + 1}")
	_prev_tab = tab
	for index, vk, numpad in SEAT_KEYS:
		if key_down(vk) or key_down(numpad):
			if seat != index:
				seat = index
				print(f"  driving P{seat + 1}")
			break
	return seat


def run(port: str, pad_index: int | None) -> None:
	if sys.platform != "win32":
		sys.exit("This script uses XInput (Windows). Pair the Xbox pad in Windows Bluetooth settings.")

	get_state = load_xinput()
	print("Xbox pads (XInput, Bluetooth or USB):")
	found = list_pads(get_state)
	if not found:
		print("  none — pair the Xbox, press a button, retry")
		sys.exit(1)
	for index in found:
		print(f"  index {index}")

	if pad_index is None:
		pad_index = found[0]
	if pad_index not in found:
		sys.exit(f"XInput pad {pad_index} is not connected")

	ser = serial.Serial(port, BAUD, timeout=0)
	print(f"{port} @ {BAUD} 8N1  ->  Xbox XInput {pad_index}")
	print("Tab cycle · 1-4 = P1-P4. H = Home. Other Pico pads stay neutral. Ctrl+C to stop.")

	last_status = time.monotonic()
	missing = 0
	seat = 0
	try:
		while True:
			seat = pick_seat(seat)

			state = sample(get_state, pad_index)
			if state is None:
				missing += 1
				if missing == 1:
					print("  xbox gone — all pads neutral")
				live = NEUTRAL
			else:
				if missing:
					print("  xbox back")
					missing = 0
				live = state
			if key_down(VK_H):
				buttons, lx, ly, rx, ry = live
				live = (buttons | BTN_HOME, lx, ly, rx, ry)

			slots = [NEUTRAL] * PAD_COUNT
			slots[seat] = live
			ser.write(encode(slots))

			now = time.monotonic()
			if now - last_status >= 1.0:
				print(f"  seat=P{seat + 1}")
				last_status = now
			time.sleep(FLUSH_S)
	except KeyboardInterrupt:
		print("\nStopped.")
		neutral = [NEUTRAL] * PAD_COUNT
		for _ in range(8):
			ser.write(encode(neutral))
			time.sleep(FLUSH_S)
	finally:
		ser.close()


def main() -> None:
	parser = argparse.ArgumentParser(description="Xbox pad (BT/USB) -> Pico UART")
	parser.add_argument("port", nargs="?", help="COM3 or /dev/ttyUSB0")
	parser.add_argument("--list", action="store_true", help="list serial ports and XInput pads")
	parser.add_argument("--pad", type=int, default=None, help="XInput index 0-3 (default: first)")
	args = parser.parse_args()

	if args.list or not args.port:
		list_serial_ports()
		if sys.platform == "win32":
			get_state = load_xinput()
			found = list_pads(get_state)
			print("Xbox pads (XInput):")
			if not found:
				print("  none")
			for index in found:
				print(f"  index {index}")
		if not args.port:
			if not args.list:
				parser.error("serial port required")
			return

	run(args.port, args.pad)


if __name__ == "__main__":
	main()
