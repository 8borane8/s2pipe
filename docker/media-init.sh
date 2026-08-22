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
webrtcLocalTCPAddress: :${MEDIA_ICE_PORT}
webrtcIPsFromInterfaces: no
webrtcAdditionalHosts: ["${MEDIA_ICE_IP}"]
webrtcTrackGatherTimeout: 100ms
rtmp: false
srt: false
playback: false
api: false
metrics: false

paths:
  switch:
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
opus=(-c:a libopus -application lowdelay -b:a 96k -ar 48000 -ac 2)

input=()
video=()
audio=()
extra=()

if [ -n "$FFMPEG_EXTRA" ]; then
	# shellcheck disable=SC2206
	extra=( $FFMPEG_EXTRA )
fi

if [ "$FFMPEG_ENCODER" = "h264_nvenc" ]; then
	nvenc=""
	for f in /usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1 \
		/usr/lib/wsl/lib/libnvidia-encode.so.1 \
		/usr/local/nvidia/lib64/libnvidia-encode.so.1; do
		if [ -e "$f" ]; then
			nvenc=$f
			export LD_LIBRARY_PATH="$(dirname "$f")${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
			break
		fi
	done
	if [ -z "$nvenc" ]; then
		echo "h264_nvenc requested but libnvidia-encode.so.1 is missing." >&2
		exit 1
	fi
	# llhq already low-latency; without bufsize FFmpeg sets 2× bitrate (~2s at 8M).
	video=(-c:v h264_nvenc -preset llhq -tune ll -rc cbr -b:v 8M -maxrate 8M -bufsize 2M -g "$fps" -bf 0 -delay 0 -pix_fmt yuv420p)
else
	video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" \
		-pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
fi

case "$CAPTURE_SOURCE" in
	test)
		input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}" -f lavfi -i "sine=frequency=440:sample_rate=48000")
		audio=( "${opus[@]}" )
		;;
	v4l2)
		if [ ! -e "$CAPTURE_DEVICE" ]; then
			echo "No capture device at ${CAPTURE_DEVICE}." >&2
			ls -l /dev/video* 2>/dev/null || echo "(no /dev/video*)" >&2
			exit 1
		fi
		# Uncompressed YUY2 1080p60 is ~2 Gb/s; USB (and usbipd) drops frames.
		# UVC HDMI dongles speak MJPEG. Override with CAPTURE_FORMAT=yuyv if needed.
		fmt="${CAPTURE_FORMAT:-mjpeg}"
		input=(-f v4l2 -input_format "$fmt" -framerate "$fps" -video_size "$size" -i "$CAPTURE_DEVICE")
		if [ -n "$CAPTURE_AUDIO" ]; then
			input+=(-f alsa -i "$CAPTURE_AUDIO")
			audio=( "${opus[@]}" )
		else
			audio=(-an)
		fi
		;;
	*)
		echo "unsupported CAPTURE_SOURCE: ${CAPTURE_SOURCE}" >&2
		exit 1
		;;
esac

exec ffmpeg "${input[@]}" "${video[@]}" "${audio[@]}" "${extra[@]}" -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/switch
