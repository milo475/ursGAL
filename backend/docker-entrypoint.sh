#!/bin/sh
# Docker эхлүүлэлт (V4-15): миграци → (зөвхөн эхний удаа) seed → сервер
set -e

echo "▸ prisma migrate deploy"
npx prisma migrate deploy

# Эхний ажиллуулалтыг User хүснэгт хоосон эсэхээр таньж seed хийнэ —
# дараагийн restart-уудад бодит өгөгдлийг (хөлс, нууц үг) дарж бичихгүй.
USERS=$(node -e "
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('./dist/generated/prisma/client');
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
p.user.count().then((c) => { console.log(c); return p.\$disconnect(); });
")
if [ "$USERS" = "0" ]; then
  if [ "$DEMO_MODE" = "1" ]; then
    # Нээлттэй демо: «Демо дэлгүүр» өгөгдөл (seed-demo.ts)
    echo "▸ Эхний ажиллуулалт — демо seed"
    npx tsx prisma/seed-demo.ts
  else
    echo "▸ Эхний ажиллуулалт — prisma db seed"
    npx prisma db seed
  fi
else
  echo "▸ Seed алгасав (хэрэглэгч: $USERS)"
fi

echo "▸ node dist/main"
exec node dist/main
