#!/bin/bash
# Starts the virtual screen, the VNC server that shares it, and the browser service. If any of the
# three stops, the container stops, so it is restarted clean and never half working.
set -eu
export DISPLAY=:99

# A restarted container keeps these files from its last run, and Xvfb refuses to start while they exist.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
for _ in $(seq 1 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# No VNC password: the port is never published. Only the API can reach it, over the private network.
x11vnc -display "$DISPLAY" -forever -shared -nopw -rfbport 5900 -noxdamage -quiet &

node --import tsx services/browser/src/main.ts &

trap 'kill $(jobs -p) 2>/dev/null || true; wait' TERM INT
wait -n
exit 1
