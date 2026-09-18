#!/bin/sh
#
# Démarre Dimstorted et ouvre l'interface.
#
# Si le serveur tourne déjà, on ne le relance pas : on ouvre simplement la page.
#
set -e
cd "$(dirname "$0")"

PORT=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('config.json','utf8')).port||1985)}catch(e){console.log(1985)}")
URL="http://127.0.0.1:$PORT"

if command -v ss >/dev/null 2>&1 && ss -lnt 2>/dev/null | grep -q ":$PORT "; then
  echo "Dimstorted tourne déjà sur $URL"
else
  echo "Démarrage de Dimstorted..."
  nohup node server/index.js > dimstorted.log 2>&1 &
  echo $! > dimstorted.pid
  sleep 2
  if ! ss -lnt 2>/dev/null | grep -q ":$PORT "; then
    echo "Le serveur n'a pas démarré. Dernières lignes du journal :"
    tail -15 dimstorted.log
    exit 1
  fi
  echo "Démarré (pid $(cat dimstorted.pid))"
fi

echo "Interface : $URL"

# Sous WSL, on ouvre le navigateur Windows ; sinon celui du système
if grep -qi microsoft /proc/version 2>/dev/null; then
  /mnt/c/Windows/System32/cmd.exe /c start "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi
