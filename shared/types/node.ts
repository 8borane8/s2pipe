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
	occupied: number[];
};

export type NodeStatus = {
	service: "s2pipe-node";
	uptimeSec: number;
} & StatusData;

export type ClientMessage =
	| { op: "play"; data: { count: number } }
	| { op: "watch" }
	| { op: "pad"; data: PadState; seat: number }
	| { op: "pong" };

export type ServerMessage =
	| { op: "status"; data: StatusData }
	| { op: "play"; data: { seats: number[] } }
	| { op: "ping" };
