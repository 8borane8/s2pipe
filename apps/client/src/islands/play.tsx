import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Eye, Maximize, Minimize, Settings, Volume2, VolumeX, X } from "lucide-preact";

import type { CaptureStatus, ClientMessage, PicoStatus, ServerMessage, SocketStatus } from "@s2pipe/shared/types/node";
import { type SocketId, SOCKETS } from "@s2pipe/shared/types/pad";

import {
	createInputTracker,
	type GamepadOption,
	type InputSource,
	KEYBOARD_HELP,
	listGamepads,
} from "../utils/input.ts";
import { createClient } from "../client.ts";
import { readStreamStats, startWhep, type StreamStats, type WhepHandle } from "../utils/whep.ts";

type Props = {
	nodeUrl: string;
	nodeLocked: boolean;
};

type Toast = { id: number; text: string };

const emptySockets: SocketStatus[] = SOCKETS.map((socket) => ({ socket, occupied: false }));

function wsUrl(nodeUrl: string, socket: SocketId): string {
	const url = new URL(nodeUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/socket";
	url.search = `?socket=${socket}`;
	return url.href;
}

export default function Play({ nodeUrl, nodeLocked }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const stageRef = useRef<HTMLElement>(null);
	const whepRef = useRef<WhepHandle | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const inputRef = useRef<ReturnType<typeof createInputTracker> | null>(null);
	const statsPrev = useRef<{ bytes: number; at: number } | null>(null);
	const idleTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);
	const toastSeq = useRef(0);

	const claimed = useSignal<SocketId | null>(null);
	const sockets = useSignal<SocketStatus[]>(emptySockets);
	const capture = useSignal<CaptureStatus | null>(null);
	const pico = useSignal<PicoStatus | null>(null);
	const pingMs = useSignal<number | null>(null);
	const pads = useSignal<GamepadOption[]>([]);
	const source = useSignal<InputSource>({ kind: "keyboard" });
	const settings = useSignal(false);
	const muted = useSignal(false);
	const volume = useSignal(1);
	const fill = useSignal(false);
	const stats = useSignal<StreamStats | null>(null);
	const fullscreen = useSignal(false);
	const idle = useSignal(false);
	const live = useSignal(false);
	const toasts = useSignal<Toast[]>([]);
	const locked = useSignal(false);

	const claimedId = claimed.value;
	const padList = pads.value;
	const inputSource = source.value;

	function toast(text: string): void {
		const id = ++toastSeq.current;
		toasts.value = [...toasts.value, { id, text }];
		setTimeout(() => {
			toasts.value = toasts.value.filter((item) => item.id !== id);
		}, 4200);
	}

	function bumpHud(): void {
		idle.value = false;
		if (idleTimer.current) clearTimeout(idleTimer.current);
		idleTimer.current = setTimeout(() => {
			if (!settings.value) idle.value = true;
		}, 2500);
	}

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		let cancelled = false;
		let handle: WhepHandle | null = null;

		startWhep(nodeUrl, video, () => {
			toast("ICE failed. Set MEDIA_ICE_IP to this machine’s LAN address, not 127.0.0.1.");
		}).then((next) => {
			if (cancelled) {
				void next.close();
				return;
			}
			handle = next;
			whepRef.current = next;
		}).catch(() => {
			if (!cancelled) toast("Could not start the stream.");
		});

		return () => {
			cancelled = true;
			whepRef.current = null;
			void handle?.close();
		};
	}, [nodeUrl]);

	useEffect(() => {
		const api = createClient(nodeUrl);
		const tick = () => {
			api.get("/health").then((res) => {
				if (!res.success) return;
				capture.value = res.data.capture;
				pico.value = res.data.pico;
				if (claimed.value === null) sockets.value = res.data.sockets;
			}).catch(() => {});
		};
		tick();
		const timer = setInterval(tick, 1500);
		return () => clearInterval(timer);
	}, [nodeUrl]);

	useEffect(() => {
		if (claimedId === null) {
			wsRef.current?.close();
			wsRef.current = null;
			pingMs.value = null;
			return;
		}

		const socket = new WebSocket(wsUrl(nodeUrl, claimedId));
		wsRef.current = socket;
		let opened = false;
		let dropped = false;

		socket.addEventListener("open", () => {
			opened = true;
		});

		socket.addEventListener("message", (event) => {
			if (typeof event.data !== "string") return;
			try {
				const msg = JSON.parse(event.data) as ServerMessage;
				if (msg.type === "hello") claimed.value = msg.socket;
				else if (msg.type === "status") {
					capture.value = msg.capture;
					pico.value = msg.pico;
					sockets.value = msg.sockets;
				} else if (msg.type === "pong") pingMs.value = Math.max(0, Date.now() - msg.t);
			} catch {
				// ignore
			}
		});

		socket.addEventListener("close", () => {
			if (wsRef.current === socket) wsRef.current = null;
			if (dropped) return;
			if (!opened) toast("That pad is already taken.");
			if (claimed.value === claimedId) claimed.value = null;
			pingMs.value = null;
		});

		const ping = globalThis.setInterval(() => {
			if (socket.readyState !== WebSocket.OPEN) return;
			const msg: ClientMessage = { type: "ping", t: Date.now() };
			socket.send(JSON.stringify(msg));
		}, 1000);

		return () => {
			dropped = true;
			clearInterval(ping);
			if (wsRef.current === socket) wsRef.current = null;
			socket.close();
		};
	}, [claimedId, nodeUrl]);

	useEffect(() => {
		const tracker = createInputTracker();
		inputRef.current = tracker;
		tracker.attach();

		const onPads = () => {
			const next = listGamepads();
			pads.value = next;
			const current = source.value;
			if (current.kind === "gamepad" && !next.some((pad) => pad.index === current.index)) {
				source.value = next[0] ? { kind: "gamepad", index: next[0].index } : { kind: "keyboard" };
			}
		};
		onPads();
		globalThis.addEventListener("gamepadconnected", onPads);
		globalThis.addEventListener("gamepaddisconnected", onPads);

		return () => {
			tracker.detach();
			inputRef.current = null;
			globalThis.removeEventListener("gamepadconnected", onPads);
			globalThis.removeEventListener("gamepaddisconnected", onPads);
			if (idleTimer.current) clearTimeout(idleTimer.current);
		};
	}, []);

	useEffect(() => {
		if (claimedId === null) return;
		let frame = 0;
		const loop = () => {
			frame = requestAnimationFrame(loop);
			const tracker = inputRef.current;
			const ws = wsRef.current;
			if (!tracker || !ws || ws.readyState !== WebSocket.OPEN) return;
			const msg: ClientMessage = { type: "pad", state: tracker.sample(source.value) };
			ws.send(JSON.stringify(msg));
		};
		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	}, [claimedId]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.code !== "Escape" || event.repeat) return;
			if (document.pointerLockElement) return;
			settings.value = !settings.value;
			idle.value = false;
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		video.muted = muted.value;
		video.volume = volume.value;
	}, [muted.value, volume.value]);

	useEffect(() => {
		const timer = globalThis.setInterval(() => {
			const pc = whepRef.current?.pc;
			if (!pc) return;
			readStreamStats(pc, statsPrev.current).then((result) => {
				statsPrev.current = result.prev;
				stats.value = result.stats;
			}).catch(() => {});
		}, 1000);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const onFs = () => {
			fullscreen.value = document.fullscreenElement === stageRef.current;
		};
		const onLock = () => {
			locked.value = document.pointerLockElement === videoRef.current;
			if (!locked.value) inputRef.current?.resetLook();
		};
		document.addEventListener("fullscreenchange", onFs);
		document.addEventListener("pointerlockchange", onLock);
		return () => {
			document.removeEventListener("fullscreenchange", onFs);
			document.removeEventListener("pointerlockchange", onLock);
		};
	}, []);

	function claim(id: SocketId): void {
		const slot = sockets.value.find((item) => item.socket === id);
		if (slot?.occupied && claimed.value !== id) {
			toast("That pad is already taken.");
			return;
		}
		claimed.value = id;
		bumpHud();
	}

	function watch(): void {
		claimed.value = null;
		if (document.pointerLockElement) document.exitPointerLock();
		bumpHud();
	}

	function onStageClick(): void {
		bumpHud();
		void videoRef.current?.play();
		if (claimed.value === null || settings.value) return;
		videoRef.current?.requestPointerLock().catch(() => {});
	}

	function toggleFullscreen(): void {
		if (document.fullscreenElement) void document.exitFullscreen();
		else void stageRef.current?.requestFullscreen();
	}

	function onSourceChange(event: Event): void {
		const value = (event.target as HTMLSelectElement).value;
		source.value = value === "keyboard" ? { kind: "keyboard" } : { kind: "gamepad", index: Number(value) };
	}

	const hideHud = locked.value || (idle.value && live.value && !settings.value);

	return (
		<section
			id="play"
			ref={stageRef}
			data-fill={fill.value ? "true" : undefined}
			data-idle={hideHud ? "true" : undefined}
			data-locked={locked.value ? "true" : undefined}
			onMouseMove={bumpHud}
			onClick={onStageClick}
			onDblClick={(event) => {
				event.preventDefault();
				toggleFullscreen();
			}}
		>
			<video
				ref={videoRef}
				autoplay
				playsInline
				onPlaying={() => {
					live.value = true;
					bumpHud();
				}}
			/>

			<dl class="play-stats">
				<div>
					<dt>Bitrate</dt>
					<dd>{stats.value ? `${stats.value.bitrateKbps} kb/s` : "-"}</dd>
				</div>
				<div>
					<dt>FPS</dt>
					<dd>{stats.value ? Math.round(stats.value.fps) : "-"}</dd>
				</div>
				<div>
					<dt>Lost</dt>
					<dd>{stats.value ? stats.value.packetsLost : "-"}</dd>
				</div>
			</dl>

			<div class="play-hud" onClick={(event) => event.stopPropagation()}>
				<div class="play-top">
					<span class="play-brand">
						<span>s2</span>pipe
					</span>
					<div class="play-slots">
						{SOCKETS.map((id) => {
							const slot = sockets.value.find((item) => item.socket === id);
							const mine = claimedId === id;
							const taken = Boolean(slot?.occupied) && !mine;
							return (
								<button
									type="button"
									class="play-slot"
									data-state={mine ? "you" : taken ? "taken" : "free"}
									disabled={taken}
									onClick={() => claim(id)}
								>
									P{id}
								</button>
							);
						})}
						<button
							type="button"
							class="play-slot"
							data-state={claimedId === null ? "you" : "free"}
							onClick={watch}
						>
							<Eye size={14} aria-hidden="true" />
							Watch
						</button>
					</div>
					<div class="play-status">
						<span class="pill" data-ok={capture.value?.running ? "true" : "false"}>
							Capture {capture.value?.running ? "live" : "down"}
						</span>
						<span class="pill" data-ok={pico.value?.connected ? "true" : "false"}>
							Pico {pico.value?.connected ? "ready" : "off"}
						</span>
						<span class="pill">{pingMs.value === null ? "Watching" : `${pingMs.value} ms`}</span>
					</div>
				</div>

				<label class="play-controller">
					<select
						aria-label="Controller"
						value={inputSource.kind === "keyboard" ? "keyboard" : String(inputSource.index)}
						onChange={onSourceChange}
					>
						<option value="keyboard">Keyboard & mouse</option>
						{padList.map((pad) => <option value={String(pad.index)}>{pad.id}</option>)}
					</select>
				</label>

				<div class="play-tools">
					<button
						type="button"
						class="btn btn-icon"
						aria-label={muted.value ? "Unmute" : "Mute"}
						onClick={() => muted.value = !muted.value}
					>
						{muted.value ? <VolumeX size={16} /> : <Volume2 size={16} />}
					</button>
					<button
						type="button"
						class="btn btn-icon"
						aria-label={fullscreen.value ? "Exit fullscreen" : "Fullscreen"}
						onClick={toggleFullscreen}
					>
						{fullscreen.value ? <Minimize size={16} /> : <Maximize size={16} />}
					</button>
					<button
						type="button"
						class="btn btn-icon"
						aria-label="Settings"
						onClick={() => {
							settings.value = !settings.value;
							idle.value = false;
						}}
					>
						<Settings size={16} />
					</button>
				</div>
			</div>

			{settings.value && (
				<aside class="play-settings" onClick={(event) => event.stopPropagation()}>
					<header class="play-settings-head">
						<h2>Settings</h2>
						<button
							type="button"
							class="btn btn-icon"
							aria-label="Close settings"
							onClick={() => settings.value = false}
						>
							<X size={16} />
						</button>
					</header>

					<div class="field">
						<span>Node</span>
						<div class="play-node">
							<p>{nodeUrl}</p>
							{!nodeLocked && <a class="btn" href="/set-node">Modify</a>}
						</div>
					</div>

					<label class="field">
						<span>Volume</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={volume.value}
							onInput={(event) => {
								volume.value = Number((event.target as HTMLInputElement).value);
								if (volume.value > 0) muted.value = false;
							}}
						/>
					</label>

					<label class="play-check">
						<input
							type="checkbox"
							checked={fill.value}
							onChange={(event) => fill.value = (event.target as HTMLInputElement).checked}
						/>
						Fill (crop) instead of letterbox
					</label>

					<section class="play-help">
						<h3>Keyboard</h3>
						<dl>
							{KEYBOARD_HELP.map(([key, action]) => (
								<div>
									<dt>{key}</dt>
									<dd>{action}</dd>
								</div>
							))}
						</dl>
						<p>Click the video while on a pad to lock the pointer for the right stick.</p>
					</section>
				</aside>
			)}

			<ul class="play-toasts" aria-live="polite">
				{toasts.value.map((item) => <li key={item.id}>{item.text}</li>)}
			</ul>
		</section>
	);
}
