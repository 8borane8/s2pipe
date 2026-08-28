export const PAD_COUNT = 4;

export const PAD_CENTER = 128;

export const PadButton = {
	Y: 1 << 0,
	B: 1 << 1,
	A: 1 << 2,
	X: 1 << 3,
	L: 1 << 4,
	R: 1 << 5,
	ZL: 1 << 6,
	ZR: 1 << 7,
	Minus: 1 << 8,
	Plus: 1 << 9,
	LStick: 1 << 10,
	RStick: 1 << 11,
	Home: 1 << 12,
	Capture: 1 << 13,
	Up: 1 << 14,
	Down: 1 << 15,
	Left: 1 << 16,
	Right: 1 << 17,
} as const;

export type PadState = {
	buttons: number;
	lx: number;
	ly: number;
	rx: number;
	ry: number;
};

export function neutralPad(): PadState {
	return {
		buttons: 0,
		lx: PAD_CENTER,
		ly: PAD_CENTER,
		rx: PAD_CENTER,
		ry: PAD_CENTER,
	};
}

export function clampAxis(value: number): number {
	if (!Number.isFinite(value)) return PAD_CENTER;
	return Math.min(255, Math.max(0, Math.round(value)));
}

export function sanitizePad(state: PadState): PadState {
	return {
		buttons: state.buttons >>> 0,
		lx: clampAxis(state.lx),
		ly: clampAxis(state.ly),
		rx: clampAxis(state.rx),
		ry: clampAxis(state.ry),
	};
}

export function samePad(a: PadState, b: PadState): boolean {
	return a.buttons === b.buttons && a.lx === b.lx && a.ly === b.ly && a.rx === b.rx && a.ry === b.ry;
}
