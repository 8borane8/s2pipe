import { clampAxis, neutralPad, PAD_CENTER, PadButton, type PadState } from "@s2pipe/shared/types/pad";

export type InputSource = { kind: "gamepad"; index: number };

export type GamepadOption = { index: number; id: string };

// Standard Gamepad (W3C): 0–15. Home/PS/Guide is 16; Capture/Share/touchpad is 17.
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
] as const;

const KEY_BUTTONS: Record<string, number> = {
	KeyH: PadButton.Home,
	KeyG: PadButton.Capture,
};

const DEADZONE = 0.12;

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

function buttonDown(button: GamepadButton | undefined): boolean {
	return Boolean(button && (button.pressed || button.value >= 0.5));
}

function sampleGamepad(index: number): PadState | null {
	const pad = navigator.getGamepads()[index];
	if (!pad) return null;

	let buttons = 0;
	for (let i = 0; i < FACE.length && i < pad.buttons.length; i++) {
		if (buttonDown(pad.buttons[i])) buttons |= FACE[i];
	}

	if (buttonDown(pad.buttons[16])) buttons |= PadButton.Home;
	if (buttonDown(pad.buttons[17])) buttons |= PadButton.Capture;
	if ((buttons & PadButton.Minus) !== 0 && (buttons & PadButton.Plus) !== 0) {
		buttons |= PadButton.Home;
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

	function onKeyDown(event: KeyboardEvent): void {
		if (event.repeat || event.code === "Escape" || isTyping(event.target)) return;
		if (!(event.code in KEY_BUTTONS)) return;
		keys.add(event.code);
		event.preventDefault();
	}

	function onKeyUp(event: KeyboardEvent): void {
		keys.delete(event.code);
	}

	function onLostFocus(): void {
		keys.clear();
	}

	function onVisibility(): void {
		if (document.visibilityState === "hidden") onLostFocus();
	}

	return {
		attach() {
			globalThis.addEventListener("keydown", onKeyDown);
			globalThis.addEventListener("keyup", onKeyUp);
			globalThis.addEventListener("blur", onLostFocus);
			document.addEventListener("visibilitychange", onVisibility);
		},
		detach() {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
			globalThis.removeEventListener("blur", onLostFocus);
			document.removeEventListener("visibilitychange", onVisibility);
			keys.clear();
		},
		sample(source: InputSource): PadState {
			const pad = sampleGamepad(source.index) ?? neutralPad();
			let extra = 0;
			for (const code of keys) extra |= KEY_BUTTONS[code] ?? 0;
			if (!extra) return pad;
			return { ...pad, buttons: pad.buttons | extra };
		},
	};
}

export const KEYBOARD_HELP = [
	["H / G", "Home / Capture"],
	["Home · PS · Guide", "Home"],
	["View + Menu", "Home if Guide is hidden (Xbox)"],
	["Esc", "Settings"],
] as const;
