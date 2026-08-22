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
	video=(-c:v h264_nvenc -preset llhq -tune ll -rc cbr -b:v 8M -maxrate 8M -g "$fps" -bf 0 -delay 0 -pix_fmt yuv420p)
else
	video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" -pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
fi

case "$CAPTURE_SOURCE" in
	test)
		input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}" -f lavfi -i "sine=frequency=440:sample_rate=48000")
		audio=( "${opus[@]}" )
		;;
	v4l2)
		modprobe uvcvideo 2>/dev/null || true
		i=0
		while [ ! -e "$CAPTURE_DEVICE" ]; do
			i=$((i + 1))
			if [ "$i" -gt 20 ]; then
				found=""
				for p in /dev/video0 /dev/video1 /dev/video2 /dev/video3 \
					/run/desktop/dev/video0 /run/desktop/dev/video1 /run/desktop/dev/video2; do
					if [ -e "$p" ]; then
						found=$p
						break
					fi
				done
				if [ -n "$found" ]; then
					echo "CAPTURE_DEVICE=${CAPTURE_DEVICE} missing, using ${found}" >&2
					CAPTURE_DEVICE=$found
					break
				fi
				echo "No capture device at ${CAPTURE_DEVICE}." >&2
				echo "video nodes:" >&2
				ls -l /dev/video* /run/desktop/dev/video* 2>/dev/null || echo "(none)" >&2
				echo "On Windows: bind is not enough — run  .\\scripts\\usb.ps1 -BusId …  (Ubuntu, not docker-desktop) and check Attached." >&2
				echo "If lsusb sees the card but there is no /dev/video*, WSL has no UVC driver." >&2
				exit 1
			fi
			echo "waiting for ${CAPTURE_DEVICE} (${i}/20)" >&2
			modprobe uvcvideo 2>/dev/null || true
			sleep 1
		done
		echo "capture device: ${CAPTURE_DEVICE}"
		input=(-f v4l2 -thread_queue_size 512 -framerate "$fps" -video_size "$size")
		if [ -n "${CAPTURE_FORMAT:-}" ]; then
			input+=(-input_format "$CAPTURE_FORMAT")
		fi
		input+=(-i "$CAPTURE_DEVICE")
		if [ -n "$CAPTURE_AUDIO" ]; then
			input+=(-f alsa -thread_queue_size 512 -i "$CAPTURE_AUDIO")
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

exec ffmpeg "${input[@]}" "${video[@]}" "${audio[@]}" "${extra[@]}" \
	-fflags flush_packets -f rtsp -rtsp_transport tcp -muxdelay 0 -muxpreload 0 \
	rtsp://127.0.0.1:8554/switch
