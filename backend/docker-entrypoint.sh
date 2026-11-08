#!/bin/sh
# Docker эхлүүлэлт (V4-15): миграци → (зөвхөн эхний удаа) seed → сервер
set -e

echo "▸ prisma migrate deploy"
npx prisma migrate deploy

# Эхний ажиллуулалтыг User хүснэгт хоосон эсэхээр таньж seed хийнэ —
# дараагийн restart-уудад бодит өгөгдлийг (хөлс, нууц үг) дарж бичихгүй.
# count_users [username] — хэрэглэгчийн тоо (username өгвөл зөвхөн тэр нэрээр)
count_users() {
  COUNT_USERNAME="$1" node -e "
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('./dist/generated/prisma/client');
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const u = process.env.COUNT_USERNAME;
p.user.count(u ? { where: { username: u } } : undefined).then((c) => { console.log(c); return p.\$disconnect(); });
"
}

if [ "$DEMO_MODE" = "1" ]; then
  # Нээлттэй демо: демо хэрэглэгч (DEMO_READONLY_USERS-ийн эхнийх) байхгүй бол
  # «Демо дэлгүүр» өгөгдлийг шинээр ачаална — демо имэйл солигдоход ч ажиллана.
  DEMO_USERNAME=$(echo "${DEMO_READONLY_USERS:-}" | cut -d, -f1 | tr -d ' ')
  if [ -z "$DEMO_USERNAME" ] || [ "$(count_users "$DEMO_USERNAME")" = "0" ]; then
    echo "▸ Демо seed (демо хэрэглэгч олдсонгүй)"
    npx tsx prisma/seed-demo.ts
  else
    echo "▸ Демо seed алгасав ($DEMO_USERNAME байна)"
  fi
else
  # Эхний ажиллуулалтыг User хүснэгт хоосон эсэхээр таньж seed хийнэ —
  # дараагийн restart-уудад бодит өгөгдлийг (хөлс, нууц үг) дарж бичихгүй.
  USERS=$(count_users)
  if [ "$USERS" = "0" ]; then
    echo "▸ Эхний ажиллуулалт — prisma db seed"
    npx prisma db seed
  else
    echo "▸ Seed алгасав (хэрэглэгч: $USERS)"
  fi
fi

echo "▸ node dist/main"
exec node dist/main
