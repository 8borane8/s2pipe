#!/bin/bash

set -euo pipefail

# 1. Generate MediaMTX config
yaml=/tmp/s2pipe-mediamtx.yml
cat > "$yaml" <<EOF
logLevel: warn
rtsp: true
rtspAddress: 127.0.0.1:8554
hls: false
webrtc: true
webrtcAddress: :8889
webrtcEncryption: no
webrtcAllowOrigins: ['*']
webrtcLocalUDPAddress: :${MEDIA_ICE_PORT}
webrtcIPsFromInterfaces: no
webrtcAdditionalHosts: ["${MEDIA_ICE_IP}"]
rtmp: false
srt: false
playback: false
api: false
metrics: false

writeQueueSize: 8192
writeTimeout: 10s
readTimeout: 10s

paths:
  switch:
    source: publisher
  switch-audio:
    source: publisher
EOF

# 2. Start MediaMTX
mediamtx "$yaml" &
pid=$!

# Wait for MediaMTX to start
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

# Audio encoder configuration
audio_encoder=(-c:a libopus -application lowdelay -b:a 64k -ar 48000 -ac 2)

# Video encoder configuration
size="${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}"
fps="${CAPTURE_FPS}"

video_encoder=(
    -c:v libx264 
    -preset ultrafast
    -tune zerolatency
    -profile:v high
    -fps_mode cfr
    -r "$fps"
    -bf 0
    -g "$fps" 
    -keyint_min "$fps" 
    -sc_threshold 0
    -pix_fmt yuv420p 
    -b:v 6M 
    -maxrate 6M 
    -bufsize 6M
)

if [ "${FFMPEG_ENCODER:-}" = "h264_nvenc" ]; then
    if [ ! -e /usr/lib/x86_64-linux-gnu/libnvidia-encode.so.1 ] \
        && [ ! -e /usr/lib64/libnvidia-encode.so.1 ] \
        && [ ! -e /usr/lib/aarch64-linux-gnu/libnvidia-encode.so.1 ]; then
        real=$(find /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib/aarch64-linux-gnu \
            /host-usr-lib/x86_64-linux-gnu /host-usr-lib64 /host-usr-lib/aarch64-linux-gnu \
            -name 'libnvidia-encode.so.*' -type f -print -quit 2>/dev/null || true)
        if [ -z "$real" ]; then
            echo "h264_nvenc requested but libnvidia-encode.so.1 is not in the container." >&2
            exit 1
        fi
        mkdir -p /tmp/s2pipe-nvenc
        ln -sfn "$real" /tmp/s2pipe-nvenc/libnvidia-encode.so.1
        export LD_LIBRARY_PATH="/tmp/s2pipe-nvenc${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    fi

    video_encoder=(
        -c:v h264_nvenc
        -preset p1
        -tune ull
        -profile:v high
        -rc cbr
        -b:v 8M
        -maxrate 8M
        -bufsize 8M
        -g "$fps"
        -keyint_min "$fps"
        -force_key_frames "expr:gte(t,n_forced*1)"
        -fps_mode cfr -r "$fps"
        -bf 0
        -delay 0
        -pix_fmt yuv420p
        -no-scenecut 1
        -forced-idr 1
        -strict_gop 1
    )
fi

# Input source configuration
case "$CAPTURE_SOURCE" in
v4l2)
    dev="${CAPTURE_DEVICE:-/dev/video0}"
    if [ ! -e "$dev" ]; then
        echo "Capture device ${dev} does not exist." >&2
        exit 1
    fi
    echo "Using capture device ${dev}" >&2
    fmt="${CAPTURE_FORMAT:-yuyv422}"
    video=(-thread_queue_size 2048 -fflags +genpts+igndts+discardcorrupt -f v4l2 -input_format "$fmt" \
        -framerate "$fps" -video_size "$size" -i "$dev")
    if [ -n "${CAPTURE_AUDIO:-}" ]; then
        audio=(-use_wallclock_as_timestamps 1 -thread_queue_size 512 -f s16le -ac 2 -ar 48000 -i pipe:0)
    fi
    ;;
test)
    video=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}")
    audio=(-re -f lavfi -i "sine=frequency=440:sample_rate=48000")
    ;;
*)
    echo "unsupported CAPTURE_SOURCE: ${CAPTURE_SOURCE}" >&2
    exit 1
    ;;
esac

# RTSP output options
rtsp_out_opts=(-f rtsp -rtsp_transport tcp)

# ---------------------------------------------------------------------------
# Watchdog: some freezes (v4l2 device hanging, signal loss, USB driver
# bug...) leave ffmpeg alive but stuck in a blocking read()/write(). In that
# case the classic retry loop (based on the process exiting) never triggers,
# which is exactly the symptom described: a manual `killall -9 ffmpeg` is
# needed to get things going again.
#
# We read FFmpeg's status (-progress) from a pipe. If no status line arrives
# for STALL_TIMEOUT seconds, we kill -9 the process ourselves: the existing
# retry loop then takes over automatically, in near real time.
# ---------------------------------------------------------------------------
run_ffmpeg_with_watchdog() {
    local stall_timeout=10
    local fifo="/tmp/ffmpeg_watchdog_$$"
    
    mkfifo "$fifo"
    exec 3<>"$fifo"
    rm -f "$fifo"

    ffmpeg \
        -hide_banner \
        -nostats \
        -progress /dev/fd/3 \
        "$@" 2>&2 &
    local ffmpeg_pid=$!

    local line
    local status=0

    while kill -0 "$ffmpeg_pid" 2>/dev/null; do
        if read -r -t "$stall_timeout" line <&3; then
            continue
        else
            echo "[!] WATCHDOG: Freeze détecté (PID: $ffmpeg_pid) !" >&2
            kill -9 "$ffmpeg_pid" 2>/dev/null
            status=1
            break
        fi
    done

    exec 3<&-
    exec 3>&-
    wait "$ffmpeg_pid" 2>/dev/null || true
    return $status
}

# Background audio launch if needed
if ((${#audio[@]})); then
    while :; do
        echo "Starting audio publisher on ${CAPTURE_AUDIO:-test source}." >&2
        if [ "$CAPTURE_SOURCE" = "v4l2" ]; then
            arecord -D "$CAPTURE_AUDIO" -f S16_LE -c 2 -r 48000 -t raw |
                ffmpeg -hide_banner -nostats -loglevel error "${audio[@]}" "${audio_encoder[@]}" \
                    "${rtsp_out_opts[@]}" rtsp://127.0.0.1:8554/switch-audio || true
        else
            ffmpeg -hide_banner -nostats -loglevel error "${audio[@]}" "${audio_encoder[@]}" \
                "${rtsp_out_opts[@]}" rtsp://127.0.0.1:8554/switch-audio || true
        fi

        echo "Audio publisher stopped; retrying in 1 second." >&2
        sleep 1
    done &
fi

# FFmpeg video stream launch (avec watchdog anti-blocage)
while :; do
    echo "Starting video publisher on ${CAPTURE_DEVICE:-test source}." >&2
    run_ffmpeg_with_watchdog \
        -loglevel debug "${video[@]}" "${video_encoder[@]}" -an \
        "${rtsp_out_opts[@]}" rtsp://127.0.0.1:8554/switch || true

    echo "Video publisher stopped; retrying in 1 second." >&2
    sleep 1
done &

# Keep the container entrypoint alive while both publishers run.
wait
