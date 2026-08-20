import type { PadState, SocketId } from "./pad.ts";

export type CaptureStatus = {
	running: boolean;
	source: string;
	error: string | null;
};

export type PicoStatus = {
	connected: boolean;
	path: string | null;
	error: string | null;
};

export type SocketStatus = {
	socket: SocketId;
	occupied: boolean;
};

export type NodeStatus = {
	service: "s2pipe-node";
	uptimeSec: number;
	capture: CaptureStatus;
	pico: PicoStatus;
	sockets: SocketStatus[];
};

export type ClientMessage =
	| { type: "pad"; seq: number; state: PadState }
	| { type: "ping"; t: number };

export type ServerMessage =
	| { type: "hello"; socket: SocketId }
	| { type: "pong"; t: number }
	| { type: "status"; capture: CaptureStatus; pico: PicoStatus; sockets: SocketStatus[] };
