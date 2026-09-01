#!/usr/bin/env bash
# Өнөөдрийн серверийн алдааны тоог хэвлэнэ (V4-14).
# Cron жишээ (өглөө бүр 09:00-д шалгаад алдаатай бол мэйл/лог):
#   0 9 * * * bash /path/to/ursGAL/backend/scripts/check-errors.sh
# Exit code: 0 = алдаагүй, 1 = алдаа байна (cron-ий alert-д ашиглана).
set -u

LOGS_DIR="${LOGS_DIR:-$(cd "$(dirname "$0")/.." && pwd)/logs}"
TODAY=$(date +%F)
FILE="$LOGS_DIR/error-$TODAY.log"

if [ -f "$FILE" ]; then
  COUNT=$(grep -c . "$FILE")
else
  COUNT=0
fi

echo "ursGAL [$TODAY]: серверийн алдаа $COUNT"
if [ "$COUNT" -gt 0 ]; then
  echo "Дэлгэрэнгүй: $FILE (эсвэл /activity-log → Системийн алдаа таб)"
  exit 1
fi
exit 0
