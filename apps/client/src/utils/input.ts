import { clampAxis, neutralPad, PAD_CENTER, PadButton, type PadState } from "@s2pipe/shared/types/pad";

export type InputSource = {
	kind: "gamepad";
	index: number;
};

export type GamepadOption = {
	index: number;
	id: string;
};

const DEADZONE = 0.12;

/**
 * Physical layout used internally by the application:
 *
 *              X
 *
 *          Y       A
 *
 *              B
 *
 * W3C button indices (standard gamepad mapping):
 *   0  = bottom (B)
 *   1  = right (A)
 *   2  = left (Y)
 *   3  = top (X)
 *   4  = L
 *   5  = R
 *   6  = ZL
 *   7  = ZR
 *   8  = Minus / Select
 *   9  = Plus / Start
 *   10 = LStick
 *   11 = RStick
 *   12 = D-pad Up
 *   13 = D-pad Down
 *   14 = D-pad Left
 *   15 = D-pad Right
 *
 * No standardizer library is used: we rely on the browser's own
 * "standard" gamepad mapping. Controllers the browser does not
 * recognize as standard will fall back to this same index order,
 * which is a reasonable best-effort default but may be off for
 * exotic hardware.
 */
const STANDARD_BUTTONS: readonly number[] = [
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
];

const KEY_BUTTONS: Record<string, number> = {
	KeyH: PadButton.Home,
	KeyG: PadButton.Capture,
};

function axisToByte(value: number): number {
	if (!Number.isFinite(value) || Math.abs(value) < DEADZONE) {
		return PAD_CENTER;
	}

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
	return (
		target instanceof HTMLElement &&
		Boolean(target.closest("input, select, textarea"))
	);
}

function buttonDown(button: GamepadButton | undefined): boolean {
	return Boolean(button?.pressed || (button?.value ?? 0) >= 0.5);
}

function sampleGamepad(index: number): PadState | null {
	const pad = navigator.getGamepads()[index];
	if (!pad) return null;

	let buttons = 0;

	for (let i = 0; i < STANDARD_BUTTONS.length && i < pad.buttons.length; i++) {
		if (buttonDown(pad.buttons[i])) {
			buttons |= STANDARD_BUTTONS[i];
		}
	}

	/*
	 * Home / Guide and Capture / Share are optional in the Gamepad API.
	 * When the browser exposes them, these are the common indices.
	 */
	if (buttonDown(pad.buttons[16])) {
		buttons |= PadButton.Home;
	}

	if (buttonDown(pad.buttons[17])) {
		buttons |= PadButton.Capture;
	}

	/*
	 * Fallback for Switch controllers: Minus + Plus together acts as Home.
	 */
	if (
		(buttons & PadButton.Minus) !== 0 &&
		(buttons & PadButton.Plus) !== 0
	) {
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

export function listGamepads(): GamepadOption[] {
	return [...navigator.getGamepads()].flatMap((pad, index) => pad ? [{ index, id: pad.id }] : []);
}

export function createInputTracker() {
	const keys = new Set<string>();

	function onKeyDown(event: KeyboardEvent): void {
		if (
			event.repeat ||
			event.code === "Escape" ||
			isTyping(event.target)
		) {
			return;
		}

		const button = KEY_BUTTONS[event.code];
		if (button === undefined) return;

		keys.add(event.code);
		event.preventDefault();
	}

	function onKeyUp(event: KeyboardEvent): void {
		keys.delete(event.code);
	}

	function clearKeys(): void {
		keys.clear();
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === "hidden") {
			clearKeys();
		}
	}

	return {
		attach() {
			globalThis.addEventListener("keydown", onKeyDown);
			globalThis.addEventListener("keyup", onKeyUp);
			globalThis.addEventListener("blur", clearKeys);
			document.addEventListener("visibilitychange", onVisibilityChange);
		},

		detach() {
			globalThis.removeEventListener("keydown", onKeyDown);
			globalThis.removeEventListener("keyup", onKeyUp);
			globalThis.removeEventListener("blur", clearKeys);
			document.removeEventListener("visibilitychange", onVisibilityChange);

			clearKeys();
		},

		sample(source: InputSource): PadState {
			const pad = sampleGamepad(source.index) ?? neutralPad();

			let extraButtons = 0;

			for (const code of keys) {
				extraButtons |= KEY_BUTTONS[code] ?? 0;
			}

			if (!extraButtons) {
				return pad;
			}

			return {
				...pad,
				buttons: pad.buttons | extraButtons,
			};
		},
	};
}

export const KEYBOARD_HELP = [
	["H / G", "Home / Capture"],
	["Home / PS / Guide", "Home"],
	["+ and -", "Home"],
	["Esc", "Settings"],
] as const;