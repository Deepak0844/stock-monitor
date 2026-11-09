#!/bin/bash
# Starts the virtual screen, the VNC server that shares it, and the browser service. If any of the
# three stops, the container stops, so it is restarted clean and never half working.
set -eu
export DISPLAY=:99

# A restarted container keeps these files from its last run, and Xvfb refuses to start while they exist.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
for _ in $(seq 1 50); do [ -S /tmp/.X11-unix/X99 ] && break; sleep 0.1; done

# A second, private screen for the spike's headed checks (VERIFY_MODE=profile). Nothing shows it, so a check never appears in a login window.
export CHECK_DISPLAY=:98
rm -f /tmp/.X98-lock /tmp/.X11-unix/X98
Xvfb "$CHECK_DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
for _ in $(seq 1 50); do [ -S /tmp/.X11-unix/X98 ] && break; sleep 0.1; done

# A new random VNC password every time the container starts. VNC only uses the first 8 characters, so it is exactly 8.
# x11vnc reads it from a file and deletes the file ("rm:"), so it is never on a command line or left on disk. The
# service gets it from the environment and gives it to the API when a window opens. The port is never published, so this
# is a second lock behind the private network, not the only one.
VNC_PASSWORD=""
while [ "${#VNC_PASSWORD}" -lt 8 ]; do VNC_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 8); done
export VNC_PASSWORD
( umask 077; printf '%s\n' "$VNC_PASSWORD" > /tmp/vnc.pass )
x11vnc -display "$DISPLAY" -forever -shared -passwdfile rm:/tmp/vnc.pass -rfbport 5900 -noxdamage -quiet &

node --import tsx services/browser/src/main.ts &

trap 'kill $(jobs -p) 2>/dev/null || true; wait' TERM INT
wait -n
exit 1
