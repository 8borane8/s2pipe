import { PadButton } from "@s2pipe/shared/types/pad";

export const PAD_BUTTON_NAMES = [
	"Y",
	"B",
	"A",
	"X",
	"L",
	"R",
	"ZL",
	"ZR",
	"Minus",
	"Plus",
	"LStick",
	"RStick",
	"Home",
	"Capture",
	"Up",
	"Down",
	"Left",
	"Right",
] as const;

export type PadButtonName = typeof PAD_BUTTON_NAMES[number];

export type StickId = "left" | "right";

export type StickDir = "up" | "down" | "left" | "right";

export type StickListen = { id: StickId; dir: StickDir };

export const PAD_BUTTON_BITS: Record<PadButtonName, number> = {
	Y: PadButton.Y,
	B: PadButton.B,
	A: PadButton.A,
	X: PadButton.X,
	L: PadButton.L,
	R: PadButton.R,
	ZL: PadButton.ZL,
	ZR: PadButton.ZR,
	Minus: PadButton.Minus,
	Plus: PadButton.Plus,
	LStick: PadButton.LStick,
	RStick: PadButton.RStick,
	Home: PadButton.Home,
	Capture: PadButton.Capture,
	Up: PadButton.Up,
	Down: PadButton.Down,
	Left: PadButton.Left,
	Right: PadButton.Right,
};

export const PAD_BUTTON_LABELS: Record<PadButtonName, string> = {
	Y: "Y",
	B: "B",
	A: "A",
	X: "X",
	L: "L",
	R: "R",
	ZL: "ZL",
	ZR: "ZR",
	Minus: "Minus",
	Plus: "Plus",
	LStick: "L stick click",
	RStick: "R stick click",
	Home: "Home",
	Capture: "Capture",
	Up: "D-pad up",
	Down: "D-pad down",
	Left: "D-pad left",
	Right: "D-pad right",
};

export const STICK_LABELS: Record<StickId, string> = {
	left: "Left stick",
	right: "Right stick",
};
