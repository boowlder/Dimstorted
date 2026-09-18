#!/bin/sh
#
# Arrête Dimstorted proprement.
#
set -e
cd "$(dirname "$0")"

PORT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port||1985)}catch(e){console.log(1985)}")

PID=""
[ -f dimstorted.pid ] && PID=$(cat dimstorted.pid)

# Le fichier pid peut être périmé : on retombe sur le port
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  PID=$(ss -lntp 2>/dev/null | grep ":$PORT " | grep -oP 'pid=\K[0-9]+' | head -1)
fi

if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null && echo "Dimstorted arrêté (pid $PID)"
  rm -f dimstorted.pid
else
  echo "Dimstorted ne tourne pas."
fi
