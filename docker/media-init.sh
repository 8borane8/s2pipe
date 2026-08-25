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
api: true
apiAddress: :9997
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

# Duree minimale (secondes) d'image noire / figee avant de forcer un restart.
# A augmenter si des ecrans de chargement noirs legitimes declenchent des faux positifs.
black_secs="${CAPTURE_BLACK_SECS:-8}"
freeze_secs="${CAPTURE_FREEZE_SECS:-8}"

opus=(-c:a libopus -application lowdelay -b:a 64k -ar 48000 -ac 2)
rtsp_audio=(-f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch-audio)

video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" -pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
if [ "${FFMPEG_ENCODER:-}" = "h264_nvenc" ]; then
	# Toolkit should inject encode with NVIDIA_DRIVER_CAPABILITIES=video. If it
	# only mounts a versioned .so, point the soname at it from the host bind-mount.
	if [ ! -e /usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1 ] \
		&& [ ! -e /usr/lib64/libnvidia-encode.so.1 ] \
		&& [ ! -e /usr/lib/aarch64-linux-gnu/libnvidia-encode.so.1 ]; then
		real=$(find /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib/aarch64-linux-gnu \
			/host-usr-lib/x86_64-linux-gnu /host-usr-lib64 /host-usr-lib/aarch64-linux-gnu \
			-name 'libnvidia-encode.so.*' -type f -print -quit 2>/dev/null || true)
		if [ -z "$real" ]; then
			echo "h264_nvenc requested but libnvidia-encode.so.1 is not in the container." >&2
			echo "Install NVIDIA Container Toolkit, then uncomment COMPOSE_FILE in .env." >&2
			exit 1
		fi
		mkdir -p /tmp/s2pipe-nvenc
		ln -sfn "$real" /tmp/s2pipe-nvenc/libnvidia-encode.so.1
		export LD_LIBRARY_PATH="/tmp/s2pipe-nvenc${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
	fi
	# Bookworm FFmpeg 5.1 has no -zerolatency. -delay 0 is the async queue (same job).
	buf=$((8000000 / fps))
	video=(-c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v 8M -maxrate 8M -bufsize "$buf" -g "$fps" -bf 0 -delay 0 -pix_fmt yuv420p)
fi

stopping=0
ffpid=""
apid=""
wpid=""
bpid=""
errfile=/tmp/s2pipe-ffmpeg.log

stop_child() {
	local child="${1:-}"
	if [ -z "$child" ] || ! kill -0 "$child" 2>/dev/null; then
		return 0
	fi
	kill -INT "$child" 2>/dev/null || true
	sleep 0.3
	kill -KILL "$child" 2>/dev/null || true
	wait "$child" 2>/dev/null || true
}

cleanup() {
	stopping=1
	trap - INT TERM
	stop_child "$wpid"
	wpid=""
	stop_child "$bpid"
	bpid=""
	stop_child "$ffpid"
	ffpid=""
	stop_child "$apid"
	apid=""
	if kill -0 "$pid" 2>/dev/null; then
		kill "$pid" 2>/dev/null || true
		wait "$pid" 2>/dev/null || true
	fi
}
trap cleanup INT TERM

usb_device() {
	local sys
	sys=$(readlink -f "/sys/class/video4linux/$(basename "$1")/device" 2>/dev/null || true)
	while [ -n "$sys" ] && [ "$sys" != "/" ]; do
		if [ -f "$sys/idVendor" ] && [ -f "$sys/authorized" ]; then
			printf '%s\n' "$sys"
			return 0
		fi
		sys=$(readlink -f "$sys/..")
	done
	return 1
}

reset_usb() {
	local sys
	sys=$(usb_device "$1") || return 0
	echo "USB reset ${sys} (${1})" >&2
	echo 0 > "$sys/authorized" || true
	sleep 1
	echo 1 > "$sys/authorized" || true
}

is_capture_node() {
	v4l2-ctl -d "$1" --info 2>/dev/null | grep -q "Video Capture"
}

find_capture() {
	if [ -e "$CAPTURE_DEVICE" ] && is_capture_node "$CAPTURE_DEVICE"; then
		printf '%s\n' "$CAPTURE_DEVICE"
		return 0
	fi
	local n
	for n in /dev/video*; do
		[ -e "$n" ] || continue
		if is_capture_node "$n"; then
			printf '%s\n' "$n"
			return 0
		fi
	done
	return 1
}

wait_capture() {
	local n=0
	local dev
	while [ "$n" -lt 40 ]; do
		if dev=$(find_capture); then
			printf '%s\n' "$dev"
			return 0
		fi
		sleep 0.25
		n=$((n + 1))
	done
	echo "No capture device at ${CAPTURE_DEVICE}." >&2
	ls -l /dev/video* 2>/dev/null || echo "(no /dev/video*)" >&2
	v4l2-ctl --list-devices >&2 || true
	return 1
}

# Redemarre ffmpeg si MediaMTX ne recoit plus d'octets sur /switch (flux
# totalement coupe: crash silencieux, deconnexion, etc).
watch_publisher() {
	local idle=0
	local last=""
	sleep 5
	while [ "$stopping" = 0 ] && [ -n "$ffpid" ] && kill -0 "$ffpid" 2>/dev/null; do
		sleep 3
		local json bytes
		json=$(curl -sf --max-time 1 http://127.0.0.1:9997/v3/paths/get/switch || true)
		bytes=$(printf '%s' "$json" | grep -o '"bytesReceived":[0-9]*' | head -1 | cut -d: -f2 || true)
		if printf '%s' "$json" | grep -q '"ready":true' && [ -n "$bytes" ] && [ "$bytes" != "$last" ]; then
			idle=0
			last=$bytes
		else
			idle=$((idle + 1))
		fi
		if [ "$idle" -ge 4 ]; then
			echo "MediaMTX /switch stalled, restarting ffmpeg" >&2
			kill -INT "$ffpid" 2>/dev/null || true
			return 0
		fi
	done
}

# Redemarre ffmpeg si l'IMAGE elle-meme reste noire ou figee alors que le
# flux continue d'etre recu (carte de capture bloquee sans crasher, signal
# HDMI mal renegocie apres un restart docker, etc). S'appuie sur les filtres
# blackdetect/freezedetect dont les evenements sont parses dans errfile.
watch_video() {
	tail -n0 -F "$errfile" 2>/dev/null | while IFS= read -r line; do
		case "$line" in
		*black_start* | *freeze_start*)
			echo "video black/frozen detected, restarting ffmpeg" >&2
			kill -INT "$ffpid" 2>/dev/null || true
			break
			;;
		esac
	done
}

start_audio() {
	ffmpeg -hide_banner -loglevel error "$@" "${opus[@]}" "${rtsp_audio[@]}" &
	apid=$!
}

case "$CAPTURE_SOURCE" in
	test | v4l2) ;;
	*)
		echo "unsupported CAPTURE_SOURCE: ${CAPTURE_SOURCE}" >&2
		exit 1
		;;
esac

while [ "$stopping" = 0 ]; do
	dev=""
	vf=()
	if [ "$CAPTURE_SOURCE" = "v4l2" ]; then
		# Reset systematique du port USB avant chaque tentative: une carte de
		# capture bloquee (typiquement apres un restart docker brutal de la
		# session precedente) ne repart souvent pas juste en relancant ffmpeg,
		# il lui faut le cycle authorized=0/1 pour renegocier le signal HDMI.
		prev=$(find_capture 2>/dev/null || printf '%s\n' "$CAPTURE_DEVICE")
		if [ -e "$prev" ]; then
			fuser -k "$prev" >/dev/null 2>&1 || true
			reset_usb "$prev"
		fi
		dev=$(wait_capture) || {
			echo "waiting for capture card..." >&2
			sleep 3
			continue
		}
		echo "capture device ${dev}" >&2
		fmt="${CAPTURE_FORMAT:-yuyv422}"
		input=(-use_wallclock_as_timestamps 1 -fflags +genpts -f v4l2 -input_format "$fmt" \
			-framerate "$fps" -video_size "$size" -i "$dev")
		vf=(-vf "blackdetect=d=${black_secs}:pix_th=0.10,freezedetect=n=0.001:d=${freeze_secs}")
	else
		input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}")
	fi

	apid=""
	if [ "$CAPTURE_SOURCE" = "test" ]; then
		start_audio -re -f lavfi -i "sine=frequency=440:sample_rate=48000"
	elif [ -n "${CAPTURE_AUDIO:-}" ]; then
		start_audio -use_wallclock_as_timestamps 1 -f alsa -i "$CAPTURE_AUDIO"
	fi

	: > "$errfile"
	ffmpeg -hide_banner -nostats -loglevel info "${input[@]}" "${vf[@]}" "${video[@]}" -an \
		-f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch \
		2> >(tee -a "$errfile" >&2) &
	ffpid=$!
	watch_publisher &
	wpid=$!
	watch_video &
	bpid=$!
	wait "$ffpid" || true
	ffpid=""
	stop_child "$wpid"
	wpid=""
	stop_child "$bpid"
	bpid=""
	stop_child "$apid"
	apid=""

	if [ "$stopping" = 1 ]; then
		break
	fi
	echo "ffmpeg exited, retrying capture" >&2
	sleep 2
done

wait "$pid" 2>/dev/null || true