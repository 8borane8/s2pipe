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

size="${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}"
fps="${CAPTURE_FPS}"

opus=(-c:a libopus -application lowdelay -b:a 64k -ar 48000 -ac 2)
rtsp_audio=(-f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch-audio)

# Video encoder configuration
video=(-c:v libx264 -preset ultrafast -tune zerolatency -profile:v baseline -bf 0 -g "$fps" -keyint_min "$fps" -pix_fmt yuv420p -b:v 6M -maxrate 6M -bufsize 2M)
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
    buf=$((8000000 / fps))
    video=(-c:v h264_nvenc -preset p1 -tune ull -rc cbr -b:v 8M -maxrate 8M -bufsize "$buf" -g "$fps" -bf 0 -delay 0 -pix_fmt yuv420p)
fi

# 3. Source definition (v4l2 direct or test)
if [ "$CAPTURE_SOURCE" = "v4l2" ]; then
    dev="${CAPTURE_DEVICE:-/dev/video0}"
    if [ ! -e "$dev" ]; then
        echo "Capture device ${dev} does not exist." >&2
        exit 1
    fi
    echo "Using capture device ${dev}" >&2
    fmt="${CAPTURE_FORMAT:-yuyv422}"
    input=(-use_wallclock_as_timestamps 1 -fflags +genpts -f v4l2 -input_format "$fmt" \
        -framerate "$fps" -video_size "$size" -i "$dev")
elif [ "$CAPTURE_SOURCE" = "test" ]; then
    input=(-re -f lavfi -i "testsrc2=size=${size}:rate=${fps}")
else
    echo "unsupported CAPTURE_SOURCE: ${CAPTURE_SOURCE}" >&2
    exit 1
fi

# 4. Background audio launch if needed
if [ "$CAPTURE_SOURCE" = "test" ]; then
    ffmpeg -hide_banner -loglevel error -re -f lavfi -i "sine=frequency=440:sample_rate=48000" "${opus[@]}" "${rtsp_audio[@]}" &
elif [ -n "${CAPTURE_AUDIO:-}" ]; then
    ffmpeg -hide_banner -loglevel error -use_wallclock_as_timestamps 1 -f alsa -i "$CAPTURE_AUDIO" "${opus[@]}" "${rtsp_audio[@]}" &
fi

# 5. Unique video FFmpeg launch (if it crashes, the script stops)
ffmpeg -hide_banner -nostats -loglevel info "${input[@]}" "${video[@]}" -an \
    -f rtsp -rtsp_transport udp rtsp://127.0.0.1:8554/switch