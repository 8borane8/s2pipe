#!/usr/bin/env python3
"""Print SWITCH_BT_MAC / CONTROLLER_BT_MAC / CONTROLLER_BT_PID for .env.

The Switch 2 hides its Bluetooth MAC. A paired Joy-Con 2 / Pro 2 broadcasts it.

Phone (no BT on this PC):
  1. Pair the pad with the Switch 2 once.
  2. Sleep the console. Detach the Joy-Con (or press a button on a Pro 2).
  3. nRF Connect → Scan → tap the pad. Copy Address + Manufacturer data.
  4. python3 scripts/wake-scan.py --decode 'PASTE_HEX' --pad AA:BB:CC:DD:EE:FF

This PC has Bluetooth:
  pip install bleak
  python3 scripts/wake-scan.py
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys

# Nintendo manufacturer payload starts here (company ID 0x0553 is already stripped by some scanners).
NINTENDO = bytes([0x01, 0x00, 0x03, 0x7E, 0x05])
PIDS = {
	0x2066: "Joy-Con 2 R",
	0x2067: "Joy-Con 2 L",
	0x2069: "Pro Controller 2",
	0x2073: "NSO GameCube",
}


def mac_str(raw: bytes) -> str:
	return ":".join(f"{b:02X}" for b in raw)


def parse_hex(text: str) -> bytes:
	hexes = re.findall(r"[0-9a-fA-F]{2}", text)
	if len(hexes) < 16:
		raise SystemExit("Need the advertising / manufacturer hex from nRF Connect (at least 16 bytes).")
	return bytes(int(h, 16) for h in hexes)


def parse_nintendo(data: bytes) -> tuple[bytes | None, int, int] | None:
	i = data.find(NINTENDO)
	if i < 0 or i + 16 > len(data):
		return None
	pid = data[i + 5] | (data[i + 6] << 8)
	flag = data[i + 9]
	rev = data[i + 10 : i + 16]
	switch_mac = None if all(b == 0 for b in rev) else bytes(reversed(rev))
	return switch_mac, pid, flag


def from_advert(mfg: bytes) -> tuple[bytes | None, int, int] | None:
	return parse_nintendo(mfg) or parse_nintendo(NINTENDO + mfg)


def print_env(switch_mac: bytes | None, pad_mac: str | None, pid: int, flag: int) -> None:
	print(f"# {PIDS.get(pid, f'PID 0x{pid:04X}')}  flag=0x{flag:02X}")
	print(f"CONTROLLER_BT_MAC={pad_mac or ''}")
	print(f"CONTROLLER_BT_PID=0x{pid:04X}")
	print(f"SWITCH_BT_MAC={mac_str(switch_mac) if switch_mac else ''}")
	if not pad_mac:
		print("# Set CONTROLLER_BT_MAC to the Address shown in nRF Connect for that pad.")
	if not switch_mac:
		print("# SWITCH_BT_MAC missing: Sleep the Switch, detach the pad, capture again.")
	elif flag != 0x81:
		print("# Flag is not 0x81. Prefer a capture while the Switch is in Sleep.")


def decode(hex_text: str, pad: str | None) -> None:
	parsed = parse_nintendo(parse_hex(hex_text))
	if not parsed:
		raise SystemExit("No Switch 2 controller advert in that hex (manufacturer 0x0553).")
	switch_mac, pid, flag = parsed
	print_env(switch_mac, pad.upper() if pad else None, pid, flag)


async def scan_live(seconds: float) -> None:
	try:
		from bleak import BleakScanner
	except ImportError:
		raise SystemExit(
			"Live scan needs Bluetooth on this PC:\n"
			"  pip install bleak && python3 scripts/wake-scan.py\n\n"
			"Otherwise use a phone:\n"
			"  python3 scripts/wake-scan.py --decode 'HEX' --pad AA:BB:CC:DD:EE:FF"
		)

	print(f"Scanning {seconds:.0f}s. Sleep the Switch, then detach a paired Joy-Con 2 / Pro 2.", file=sys.stderr)
	best: tuple[int, bytes | None, str, int, int] | None = None

	def on_adv(device, adv) -> None:
		nonlocal best
		mfg = adv.manufacturer_data.get(0x0553)
		if not mfg:
			return
		parsed = from_advert(bytes(mfg))
		if not parsed:
			return
		switch_mac, pid, flag = parsed
		score = (2 if flag == 0x81 else 0) + (1 if switch_mac else 0)
		if best is not None and score < best[0]:
			return
		best = (score, switch_mac, device.address, pid, flag)
		print("---")
		print_env(switch_mac, device.address, pid, flag)

	async with BleakScanner(detection_callback=on_adv):
		await asyncio.sleep(seconds)

	if best is None:
		raise SystemExit("No Nintendo pad seen. Sleep the Switch, detach the Joy-Con, stand closer, retry.")


def main() -> None:
	parser = argparse.ArgumentParser(description="Find Switch 2 sleep-wake MACs for s2pipe .env")
	parser.add_argument("--decode", metavar="HEX", help="Advertising or manufacturer hex from nRF Connect")
	parser.add_argument("--pad", metavar="MAC", help="Pad Address from nRF Connect (with --decode)")
	parser.add_argument("--seconds", type=float, default=25, help="Live scan duration")
	args = parser.parse_args()
	if args.decode:
		decode(args.decode, args.pad)
		return
	asyncio.run(scan_live(args.seconds))


if __name__ == "__main__":
	main()
