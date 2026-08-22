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
	video=(-c:v h264_nvenc -preset llhq -tune ll -rc cbr -b:v 8M -maxrate 8M -g "$fps" -bf 0 -pix_fmt yuv420p)
else
	video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" -pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
fi

case "$CAPTURE_SOURCE" in
	test)
		input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}" -f lavfi -i "sine=frequency=440:sample_rate=48000")
		audio=( "${opus[@]}" )
		;;
	v4l2)
		input=(-f v4l2 -framerate "$fps" -video_size "$size" -i "$CAPTURE_DEVICE")
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
