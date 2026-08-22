export type WhepHandle = {
	pc: RTCPeerConnection;
	close: () => Promise<void>;
};

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
	if (pc.iceGatheringState === "complete") return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			pc.removeEventListener("icegatheringstatechange", onChange);
			resolve();
		};
		const onChange = () => {
			if (pc.iceGatheringState === "complete") done();
		};
		const timer = setTimeout(done, 2000);
		pc.addEventListener("icegatheringstatechange", onChange);
	});
}

export async function startWhep(
	nodeUrl: string,
	video: HTMLVideoElement,
	onIceFailed: () => void,
): Promise<WhepHandle> {
	const pc = new RTCPeerConnection({ iceServers: [] });

	pc.addTransceiver("video", { direction: "recvonly" });
	pc.addTransceiver("audio", { direction: "recvonly" });

	pc.addEventListener("track", (event) => {
		if (event.streams[0]) {
			video.srcObject = event.streams[0];
			return;
		}
		const stream = video.srcObject instanceof MediaStream ? video.srcObject : new MediaStream();
		stream.addTrack(event.track);
		video.srcObject = stream;
	});

	pc.addEventListener("connectionstatechange", () => {
		if (pc.connectionState === "failed") onIceFailed();
	});

	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	await waitIceGathering(pc);

	const response = await fetch(`${nodeUrl}/switch/whep`, {
		method: "POST",
		headers: { "content-type": "application/sdp" },
		body: pc.localDescription?.sdp ?? offer.sdp,
	});

	if (!response.ok) {
		pc.close();
		throw new Error("whep");
	}

	const answer = await response.text();
	const location = response.headers.get("location");
	await pc.setRemoteDescription({ type: "answer", sdp: answer });

	return {
		pc,
		close: async () => {
			pc.close();
			video.srcObject = null;
			if (!location) return;
			const resource = new URL(location, `${nodeUrl}/`).href;
			await fetch(resource, { method: "DELETE" }).catch(() => {});
		},
	};
}

export type StreamStats = {
	bitrateKbps: number;
	fps: number;
	packetsLost: number;
};

export async function readStreamStats(
	pc: RTCPeerConnection,
	prev: { bytes: number; at: number } | null,
): Promise<{ stats: StreamStats; prev: { bytes: number; at: number } }> {
	const report = await pc.getStats();
	let bytes = 0;
	let fps = 0;
	let packetsLost = 0;
	let at = performance.now();

	for (const item of report.values()) {
		if (item.type !== "inbound-rtp" || item.kind !== "video") continue;
		bytes = item.bytesReceived ?? 0;
		fps = item.framesPerSecond ?? 0;
		packetsLost = item.packetsLost ?? 0;
		at = item.timestamp ?? at;
	}

	const elapsed = prev ? Math.max(1, at - prev.at) : 1000;
	const delta = prev ? Math.max(0, bytes - prev.bytes) : 0;
	const bitrateKbps = Math.round((delta * 8) / elapsed);

	return { stats: { bitrateKbps, fps, packetsLost }, prev: { bytes, at } };
}
