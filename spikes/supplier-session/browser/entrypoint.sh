#!/bin/sh
set -e
export DISPLAY=:99
Xvfb :99 -screen 0 1280x800x24 -nolisten tcp &
sleep 1
# No password: this port is only reachable from the proxy over the private network.
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 -noxdamage -quiet &
exec node control.mjs
