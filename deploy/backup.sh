#!/usr/bin/env bash
# Backup diário do banco — cron: 0 3 * * * /opt/rmm/deploy/backup.sh
set -euo pipefail
# No Docker, o banco fica no volume app_data do compose:
#   docker volume inspect rmm_app_data  (campo Mountpoint) -> .../_data/app.db
SRC="${RMM_DB:-/var/lib/docker/volumes/rmm_app_data/_data/app.db}"
DEST_DIR="${RMM_BACKUP_DIR:-/opt/rmm/backups}"
mkdir -p "$DEST_DIR"
STAMP=$(date +%F-%H%M)
cp "$SRC" "$DEST_DIR/app-$STAMP.db"
find "$DEST_DIR" -name 'app-*.db' -mtime +14 -delete
echo "Backup: $DEST_DIR/app-$STAMP.db"
