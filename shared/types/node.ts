import type { PadState } from "./pad.ts";

export type CaptureStatus = {
	running: boolean;
	source: string;
	error: string | null;
};

export type PicoStatus = {
	connected: boolean;
	path: string | null;
	error: string | null;
	wake: boolean;
};

export type StatusData = {
	capture: CaptureStatus;
	pico: PicoStatus;
	playing: number;
};

export type NodeStatus = {
	service: "s2pipe-node";
	uptimeSec: number;
} & StatusData;

export type ClientMessage =
	| { op: "play" }
	| { op: "watch" }
	| { op: "pad"; data: PadState }
	| { op: "pong" };

export type ServerMessage =
	| { op: "status"; data: StatusData }
	| { op: "play"; data: { playing: boolean } }
	| { op: "ping" };
