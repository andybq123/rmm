#!/bin/sh
# Sobe um X virtual (o Wine/Inno Setup precisam de DISPLAY mesmo sem tela)
# e inicia o serviço builder.
set -e
Xvfb :99 -screen 0 1024x768x16 >/dev/null 2>&1 &
export DISPLAY=:99
sleep 1
exec python3 /srv/builder.py
