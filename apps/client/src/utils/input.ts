import { clampAxis, neutralPad, PAD_CENTER, PadButton, type PadState } from "@s2pipe/shared/types/pad";

export type InputSource = { kind: "keyboard" } | { kind: "gamepad"; index: number };

export type GamepadOption = { index: number; id: string };

const FACE = [
	PadButton.B,
	PadButton.A,
	PadButton.Y,
	PadButton.X,
	PadButton.L,
	PadButton.R,
	PadButton.ZL,
	PadButton.ZR,
	PadButton.Minus,
	PadButton.Plus,
	PadButton.LStick,
	PadButton.RStick,
	PadButton.Up,
	PadButton.Down,
	PadButton.Left,
	PadButton.Right,
	PadButton.Home,
] as const;

const KEY_BUTTONS: Record<string, number> = {
	KeyK: PadButton.A,
	KeyJ: PadButton.B,
	KeyU: PadButton.Y,
	KeyI: PadButton.X,
	KeyQ: PadButton.L,
	KeyE: PadButton.R,
	KeyZ: PadButton.ZL,
	KeyX: PadButton.ZR,
	Minus: PadButton.Minus,
	Equal: PadButton.Plus,
	Enter: PadButton.Plus,
	KeyH: PadButton.Home,
	KeyG: PadButton.Capture,
	KeyF: PadButton.LStick,
	KeyV: PadButton.RStick,
	ArrowUp: PadButton.Up,
	ArrowDown: PadButton.Down,
	ArrowLeft: PadButton.Left,
	ArrowRight: PadButton.Right,
};

const DEADZONE = 0.12;
const LOOK_SENS = 0.0035;
const LOOK_DECAY = 0.88;

function axisToByte(value: number): number {
	if (!Number.isFinite(value) || Math.abs(value) < DEADZONE) return PAD_CENTER;
	return clampAxis((value + 1) * 127.5);
}

function fromAxes(lx: number, ly: number, rx: number, ry: number, buttons: number): PadState {
	return {
		buttons,
		lx: axisToByte(lx),
		ly: axisToByte(ly),
		rx: axisToByte(rx),
		ry: axisToByte(ry),
	};
}

function isTyping(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && Boolean(target.closest("input, select, textarea"));
}

export function listGamepads(): GamepadOption[] {
	if (typeof navigator === "undefined") return [];
	return [...navigator.getGamepads()].flatMap((pad, index) => pad ? [{ index, id: pad.id }] : []);
}

function sampleGamepad(index: number): PadState | null {
	const pad = navigator.getGamepads()[index];
	if (!pad) return null;

	let buttons = 0;
	for (let i = 0; i < FACE.length && i < pad.buttons.length; i++) {
		const btn = pad.buttons[i];
		if (btn.pressed || btn.value >= 0.5) buttons |= FACE[i];
	}

	return fromAxes(
		pad.axes[0] ?? 0,
		pad.axes[1] ?? 0,
		pad.axes[2] ?? 0,
		pad.axes[3] ?? 0,
		buttons,
	);
}

export function createInputTracker() {
	const keys = new Set<string>();
	let lookX = 0;
	let lookY = 0;

	function onKeyDown(event: KeyboardEvent): void {
		if (event.repeat || event.code === "Escape" || isTyping(event.target)) return;
		keys.add(event.code);
		if (
			event.code in KEY_BUTTONS || event.code === "KeyW" || event.code === "KeyA" ||
			event.code === "KeyS" || event.code === "KeyD"
		) {
			event.preventDefault();
		}
	}

	function onKeyUp(event: KeyboardEvent): void {
		keys.delete(event.code);
	}

	function onMouseMove(event: MouseEvent): void {
		if (document.pointerLockElement === null) return;
		lookX = Math.max(-1, Math.min(1, lookX + event.movementX * LOOK_SENS));
		lookY = Math.max(-1, Math.min(1, lookY + event.movementY * LOOK_SENS));
	}

	function sampleKeyboard(): PadState {
		lookX *= LOOK_DECAY;
		lookY *= LOOK_DECAY;
		if (Math.abs(lookX) < 0.02) lookX = 0;
		if (Math.abs(lookY) < 0.02) lookY = 0;

		let buttons = 0;
		for (const code of keys) {
			const bit = KEY_BUTTONS[code];
			if (bit) buttons |= bit;
		}

		let lx = 0;
		let ly = 0;
		if (keys.has("KeyA")) lx -= 1;
		if (keys.has("KeyD")) lx += 1;
		if (keys.has("KeyW")) ly -= 1;
		if (keys.has("KeyS")) ly += 1;

		return fromAxes(lx, ly, lookX, lookY, buttons);
	}

	return {
		attach() {
			globalThis.addEventListener("keydown", onKeyDown);
			globalThis.addEventListener("keyup", onKeyUp);
			globalThis.addEventListener("mousemove", onMouseMove);
		},
		detach() {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
			globalThis.removeEventListener("mousemove", onMouseMove);
			keys.clear();
			lookX = 0;
			lookY = 0;
		},
		sample(source: InputSource): PadState {
			if (source.kind === "gamepad") return sampleGamepad(source.index) ?? neutralPad();
			return sampleKeyboard();
		},
		resetLook() {
			lookX = 0;
			lookY = 0;
		},
	};
}

export const KEYBOARD_HELP = [
	["WASD", "Left stick"],
	["Mouse (locked)", "Right stick"],
	["Arrows", "D-pad"],
	["K / J / U / I", "A / B / Y / X"],
	["Q / E", "L / R"],
	["Z / X", "ZL / ZR"],
	["Enter / -", "Plus / Minus"],
	["H / G", "Home / Capture"],
	["F / V", "L-stick / R-stick click"],
	["Esc", "Settings"],
] as const;
