#!/bin/bash

set -euo pipefail

yaml=/tmp/s2pipe-mediamtx.yml
cat > "$yaml" <<EOF
logLevel: warn
rtsp: true
rtspAddress: 127.0.0.1:8554
hls: false
webrtc: true
webrtcAddress: :8889
webrtcEncryption: no
webrtcAllowOrigin: '*'
webrtcLocalUDPAddress: :${MEDIA_ICE_PORT}
webrtcIPsFromInterfaces: no
webrtcAdditionalHosts: ["${MEDIA_ICE_IP}"]
rtmp: false
srt: false
playback: false
api: false
metrics: false

paths:
  switch:
    source: publisher
  switch-audio:
    source: publisher
EOF

mediamtx "$yaml" &
pid=$!

i=0
until (echo >/dev/tcp/127.0.0.1/8554) >/dev/null 2>&1; do
	i=$((i + 1))
	if [ "$i" -gt 60 ]; then
		echo "mediamtx did not start" >&2
		exit 1
	fi
	if ! kill -0 "$pid" 2>/dev/null; then
		echo "mediamtx exited" >&2
		exit 1
	fi
	sleep 1
done

size="${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}"
fps="${CAPTURE_FPS}"
opus=(-c:a libopus -application lowdelay -b:a 64k -ar 48000 -ac 2)
rtsp_audio=(-f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch-audio)

apid=""

video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" -pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
if [ "${FFMPEG_ENCODER:-}" = "h264_nvenc" ]; then
	# Toolkit should inject encode with NVIDIA_DRIVER_CAPABILITIES=video. If it
	# only mounts a versioned .so, point the soname at it from the host bind-mount.
	if [ ! -e /usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1 ] \
		&& [ ! -e /usr/lib64/libnvidia-encode.so.1 ] \
		&& [ ! -e /usr/lib/aarch64-linux-gnu/libnvidia-encode.so.1 ]; then
		real=$(find /usr/lib /usr/lib64 /host-usr-lib -name 'libnvidia-encode.so.*' -type f -print -quit 2>/dev/null || true)
		if [ -z "$real" ]; then
			echo "h264_nvenc requested but libnvidia-encode.so.1 is not in the container." >&2
			echo "Install NVIDIA Container Toolkit, then uncomment COMPOSE_FILE in .env." >&2
			exit 1
		fi
		mkdir -p /tmp/s2pipe-nvenc
		ln -sfn "$real" /tmp/s2pipe-nvenc/libnvidia-encode.so.1
		export LD_LIBRARY_PATH="/tmp/s2pipe-nvenc${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
	fi
	# NVIDIA ULL: 1-frame VBV. FFmpeg -delay 0 drains the default NVENC async queue (~4 frames).
	buf=$((8000000 / fps))
	video=(-c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v 8M -maxrate 8M -bufsize "$buf" -g "$fps" -bf 0 -delay 0 -zerolatency 1 -pix_fmt yuv420p)
fi

case "$CAPTURE_SOURCE" in
	test)
		input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}")
		ffmpeg -re -f lavfi -i "sine=frequency=440:sample_rate=48000" "${opus[@]}" "${rtsp_audio[@]}" &
		apid=$!
		;;
	v4l2)
		if [ ! -e "$CAPTURE_DEVICE" ]; then
			echo "No capture device at ${CAPTURE_DEVICE}." >&2
			ls -l /dev/video* 2>/dev/null || echo "(no /dev/video*)" >&2
			exit 1
		fi
		# Uncompressed YUY2 1080p60 is ~2 Gb/s; USB drops frames. Use mjpeg if it chokes.
		fmt="${CAPTURE_FORMAT:-yuyv422}"
		input=(-f v4l2 -input_format "$fmt" -framerate "$fps" -video_size "$size" -i "$CAPTURE_DEVICE")
		if [ -n "$CAPTURE_AUDIO" ]; then
			ffmpeg -use_wallclock_as_timestamps 1 -f alsa -i "$CAPTURE_AUDIO" "${opus[@]}" "${rtsp_audio[@]}" &
			apid=$!
		fi
		;;
	*)
		echo "unsupported CAPTURE_SOURCE: ${CAPTURE_SOURCE}" >&2
		exit 1
		;;
esac

ffpid=""
cleanup() {
	trap - INT TERM
	if [ -n "$ffpid" ] && kill -0 "$ffpid" 2>/dev/null; then
		kill -INT "$ffpid" 2>/dev/null || true
		wait "$ffpid" 2>/dev/null || true
	fi
	if [ -n "$apid" ] && kill -0 "$apid" 2>/dev/null; then
		kill -INT "$apid" 2>/dev/null || true
		wait "$apid" 2>/dev/null || true
	fi
	if kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null || true
		wait "$pid" 2>/dev/null || true
	fi
}
trap cleanup INT TERM

ffmpeg "${input[@]}" "${video[@]}" -an \
	-f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch &
ffpid=$!
wait "$ffpid" || true
cleanup
