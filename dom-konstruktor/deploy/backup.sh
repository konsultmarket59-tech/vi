#!/bin/sh
# Ежедневная копия данных: архив папки данных, хранение 14 дней локально и (если настроен rclone) — в облачном хранилище в РФ.
# cron: 30 3 * * * /opt/svoydom/dom-konstruktor/deploy/backup.sh
set -e
DATA=${DATA_DIR:-/var/lib/svoydom}
DEST=${BACKUP_DIR:-/var/backups/svoydom}
mkdir -p "$DEST"
F="$DEST/svoydom-$(date +%Y%m%d-%H%M).tar.gz"
tar -czf "$F" -C "$DATA" .
find "$DEST" -name 'svoydom-*.tar.gz' -mtime +14 -delete
# копия в объектное хранилище (Yandex Object Storage, Selectel, VK Cloud): rclone config → remote «s3»
if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -q '^s3:'; then rclone copy "$F" s3:svoydom-backup/; fi
echo "backup: $F"
