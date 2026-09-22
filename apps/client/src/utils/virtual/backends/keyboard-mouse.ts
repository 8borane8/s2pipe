import { clampAxis, PAD_CENTER, type PadState } from "@s2pipe/shared/types/pad";

import { isTyping } from "../../input.ts";
import type { Bindings, StickBinding } from "../bindings.ts";
import { PAD_BUTTON_BITS, PAD_BUTTON_NAMES } from "../targets.ts";
import type { VirtualBackend } from "./types.ts";

const DEADZONE = 0.12;

function axisToByte(value: number): number {
	if (!Number.isFinite(value) || Math.abs(value) < DEADZONE) return PAD_CENTER;
	return clampAxis((value + 1) * 127.5);
}

function clampStick(x: number, y: number): { x: number; y: number } {
	const mag = Math.hypot(x, y);
	if (mag <= 1) return { x, y };
	return { x: x / mag, y: y / mag };
}

function keysStick(binding: StickBinding, keys: Set<string>): { x: number; y: number } | null {
	if (binding.kind !== "keys") return null;
	const x = (keys.has(binding.right) ? 1 : 0) + (keys.has(binding.left) ? -1 : 0);
	const y = (keys.has(binding.down) ? 1 : 0) + (keys.has(binding.up) ? -1 : 0);
	return clampStick(x, y);
}

export function createKeyboardMouseBackend(): VirtualBackend & {
	hold(active: boolean): void;
	requestPointerLock(target: Element): void;
} {
	const keys = new Set<string>();
	const mouseButtons = new Set<number>();
	const boundCodes = new Set<string>();
	let mx = 0;
	let my = 0;
	let lastT = 0;
	let locked = false;
	let held = false;

	function resetMotion(): void {
		keys.clear();
		mouseButtons.clear();
		mx = 0;
		my = 0;
	}

	function onKeyDown(event: KeyboardEvent): void {
		if (held) {
			event.preventDefault();
			return;
		}
		if (event.repeat || event.code === "Escape" || isTyping(event.target)) return;
		keys.add(event.code);
		if (boundCodes.has(event.code)) event.preventDefault();
	}

	function onKeyUp(event: KeyboardEvent): void {
		keys.delete(event.code);
	}

	function onMouseDown(event: MouseEvent): void {
		if (held) {
			event.preventDefault();
			return;
		}
		if (isTyping(event.target)) return;
		if (!locked) {
			const target = event.target;
			if (target instanceof Element && target.closest("aside, button, a, input, select, label, ul")) return;
			const play = document.getElementById("play");
			if (play && (!(target instanceof Node) || !play.contains(target))) return;
		}
		mouseButtons.add(event.button);
	}

	function onMouseUp(event: MouseEvent): void {
		mouseButtons.delete(event.button);
	}

	function onMouseMove(event: MouseEvent): void {
		if (!locked) return;
		mx += event.movementX;
		my += event.movementY;
	}

	function onPointerLockChange(): void {
		locked = document.pointerLockElement != null;
		if (!locked) {
			mouseButtons.clear();
			mx = 0;
			my = 0;
		}
	}

	function onContextMenu(event: Event): void {
		if (held || locked) event.preventDefault();
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === "hidden") resetMotion();
	}

	return {
		attach() {
			lastT = performance.now();
			globalThis.addEventListener("keydown", onKeyDown, { capture: true });
			globalThis.addEventListener("keyup", onKeyUp);
			globalThis.addEventListener("mousedown", onMouseDown);
			globalThis.addEventListener("mouseup", onMouseUp);
			globalThis.addEventListener("mousemove", onMouseMove);
			globalThis.addEventListener("blur", resetMotion);
			document.addEventListener("pointerlockchange", onPointerLockChange);
			document.addEventListener("visibilitychange", onVisibilityChange);
			document.addEventListener("contextmenu", onContextMenu);
		},

		detach() {
			globalThis.removeEventListener("keydown", onKeyDown, { capture: true });
			globalThis.removeEventListener("keyup", onKeyUp);
			globalThis.removeEventListener("mousedown", onMouseDown);
			globalThis.removeEventListener("mouseup", onMouseUp);
			globalThis.removeEventListener("mousemove", onMouseMove);
			globalThis.removeEventListener("blur", resetMotion);
			document.removeEventListener("pointerlockchange", onPointerLockChange);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			document.removeEventListener("contextmenu", onContextMenu);
			if (document.pointerLockElement) document.exitPointerLock();
			resetMotion();
			locked = false;
		},

		hold(active: boolean) {
			held = active;
			if (active) resetMotion();
		},

		requestPointerLock(target: Element) {
			if (typeof target.requestPointerLock !== "function") return;
			void (target as HTMLElement).requestPointerLock();
		},

		sample(bindings: Bindings, mouseSensitivity: number): PadState {
			boundCodes.clear();
			for (const name of PAD_BUTTON_NAMES) {
				const input = bindings.buttons[name];
				if (input?.kind === "key") boundCodes.add(input.code);
			}
			for (const stick of [bindings.sticks.left, bindings.sticks.right]) {
				if (stick.kind === "keys") {
					for (const code of [stick.up, stick.down, stick.left, stick.right]) {
						if (code) boundCodes.add(code);
					}
				}
			}

			const now = performance.now();
			const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
			lastT = now;

			const decay = Math.exp(-10 * dt);
			mx *= decay;
			my *= decay;

			let buttons = 0;
			for (const name of PAD_BUTTON_NAMES) {
				const input = bindings.buttons[name];
				if (!input) continue;
				const down = input.kind === "key" ? keys.has(input.code) : mouseButtons.has(input.button);
				if (down) buttons |= PAD_BUTTON_BITS[name];
			}

			const scale = 0.018 * mouseSensitivity;
			const mouse = clampStick(mx * scale, my * scale);
			const leftKeys = keysStick(bindings.sticks.left, keys);
			const rightKeys = keysStick(bindings.sticks.right, keys);

			let lx = 0;
			let ly = 0;
			let rx = 0;
			let ry = 0;

			if (bindings.sticks.left.kind === "mouse") {
				lx = mouse.x;
				ly = mouse.y;
			} else if (leftKeys) {
				lx = leftKeys.x;
				ly = leftKeys.y;
			}

			if (bindings.sticks.right.kind === "mouse") {
				rx = mouse.x;
				ry = mouse.y;
			} else if (rightKeys) {
				rx = rightKeys.x;
				ry = rightKeys.y;
			}

			return {
				buttons,
				lx: axisToByte(lx),
				ly: axisToByte(ly),
				rx: axisToByte(rx),
				ry: axisToByte(ry),
			};
		},
	};
}
