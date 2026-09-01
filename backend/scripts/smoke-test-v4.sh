#!/usr/bin/env bash
# ursGAL v4 — төлбөр/авлага/буцаалт, тариф, түгжилт, SSE, импортын smoke.
# Урьдчилсан нөхцөл: backend localhost:3000, seed хийгдсэн.
# Ажиллуулах: bash scripts/smoke-test-v4.sh
# Ул мөр: 1 захиалга (төлбөр+буцаалттай), 1 цуцлагдсан ОН захиалга,
# 1 идэвхгүй smoke хэрэглэгч, 1 идэвхгүй импорт бараа үлдэнэ.

set -euo pipefail
API=http://localhost:3000/api
H='Content-Type: application/json'
STAMP=$(date +%s)

json() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "── 1. Нэвтрэлт ──"
for U in admin manager operator; do
  TK=$(curl -sf -X POST $API/auth/login -H "$H" \
    -d "{\"email\":\"$U@ursgal.mn\",\"password\":\"${U}123\"}" | json "['accessToken']")
  declare "TOK_$U=$TK"
done
echo "OK: 3 эрх нэвтэрлээ"

echo "── 2. Тарифын лавлагаа + шинэ захиалгад хөлс 0 ──"
# Тарифын хүснэгт лавлагаа болж үлдсэн — унших боломжтой
curl -sf $API/settings/tariffs -H "Authorization: Bearer $TOK_operator" | python3 -c "
import json,sys
assert len(json.load(sys.stdin)) >= 2" || { echo "FAIL: тарифын лавлагаа"; exit 1; }
PID=$(curl -sf "$API/products?limit=50" -H "Authorization: Bearer $TOK_manager" | python3 -c "
import json,sys
print(next(p['id'] for p in json.load(sys.stdin)['items'] if p['stockQty']>=3))")
PHONE=$(echo "9$STAMP" | cut -c1-8)
ON_ORD=$(curl -sf -X POST $API/orders -H "Authorization: Bearer $TOK_operator" -H "$H" -d "{
  \"customerName\":\"Смоук v4 ОН\",\"customerPhone\":\"$PHONE\",
  \"region\":\"ORON_NUTAG\",\"province\":\"Хөвсгөл\",\"soum\":\"Мөрөн\",
  \"transport\":\"Смоук транс\",\"items\":[{\"productId\":\"$PID\",\"qty\":1}]}")
ON_ID=$(echo "$ON_ORD" | json "['id']")
GOT_FEE=$(echo "$ON_ORD" | json "['deliveryFee']" | python3 -c "import sys;print(int(float(sys.stdin.read())))")
[ "$GOT_FEE" = "0" ] || { echo "FAIL: шинэ захиалгад хөлс $GOT_FEE != 0"; exit 1; }
curl -sf -X PATCH $API/orders/$ON_ID/status -H "Authorization: Bearer $TOK_operator" -H "$H" \
  -d '{"status":"CANCELLED"}' >/dev/null
echo "OK: шинэ захиалгад хөлс 0 (автоматаар нэмэгдэхгүй), цуцлагдаж үлдэгдэл буцлаа"

echo "── 3. Төлбөр → авлага → буцаалт ──"
ORD=$(curl -sf -X POST $API/orders -H "Authorization: Bearer $TOK_manager" -H "$H" -d "{
  \"customerName\":\"Смоук v4 төлбөр\",\"customerPhone\":\"$PHONE\",
  \"region\":\"ULAANBAATAR\",\"district\":\"СБД\",\"khoroo\":\"1\",
  \"building\":\"Смоук байр\",\"entrance\":\"1\",\"floor\":\"1\",\"door\":\"1\",
  \"deliveryFee\":\"0\",\"items\":[{\"productId\":\"$PID\",\"qty\":2}]}")
OID=$(echo "$ORD" | json "['id']")
TOTAL=$(echo "$ORD" | json "['totalAmount']")
ITEM_ID=$(echo "$ORD" | json "['items'][0]['id']")
UNIT=$(echo "$ORD" | json "['items'][0]['priceAtOrder']")
for S in CONFIRMED PREPARING READY COMPLETED; do
  curl -sf -X PATCH $API/orders/$OID/status -H "Authorization: Bearer $TOK_manager" -H "$H" \
    -d "{\"status\":\"$S\"}" >/dev/null
done
IN_RECV=$(curl -sf $API/finance/receivables -H "Authorization: Bearer $TOK_manager" | python3 -c "
import json,sys
print(any(i['id']=='$OID' for i in json.load(sys.stdin)['items']))")
[ "$IN_RECV" = "True" ] || { echo "FAIL: авлагад алга"; exit 1; }
HALF=$(python3 -c "print(f'{float('$TOTAL')/2:.2f}')")
ST1=$(curl -sf -X POST $API/orders/$OID/payments -H "Authorization: Bearer $TOK_manager" -H "$H" \
  -d "{\"amount\":\"$HALF\",\"method\":\"CASH\"}" | json "['order']['paymentStatus']")
[ "$ST1" = "PARTIAL" ] || { echo "FAIL: PARTIAL биш ($ST1)"; exit 1; }
ST2=$(curl -sf -X POST $API/orders/$OID/payments -H "Authorization: Bearer $TOK_manager" -H "$H" \
  -d "{\"amount\":\"$HALF\",\"method\":\"TRANSFER\"}" | json "['order']['paymentStatus']")
[ "$ST2" = "PAID" ] || { echo "FAIL: PAID биш ($ST2)"; exit 1; }
OUT_RECV=$(curl -sf $API/finance/receivables -H "Authorization: Bearer $TOK_manager" | python3 -c "
import json,sys
print(any(i['id']=='$OID' for i in json.load(sys.stdin)['items']))")
[ "$OUT_RECV" = "False" ] || { echo "FAIL: төлсөн ч авлагад байна"; exit 1; }
RET=$(curl -sf -X POST $API/orders/$OID/return -H "Authorization: Bearer $TOK_manager" -H "$H" -d "{
  \"items\":[{\"orderItemId\":\"$ITEM_ID\",\"qty\":1}],
  \"reason\":\"Смоук буцаалт\",\"restock\":true,\"refundPayment\":true}")
RST=$(echo "$RET" | json "['order']['paymentStatus']")
RSTATE=$(echo "$RET" | json "['order']['returnState']")
[ "$RST" = "PARTIAL" ] && [ "$RSTATE" = "PARTIAL" ] || { echo "FAIL: буцаалт ($RST/$RSTATE)"; exit 1; }
echo "OK: UNPAID→PARTIAL→PAID→(буцаалт)→PARTIAL, авлага зөв хөдөлсөн"

echo "── 4. Түгжилт: 5 буруу → 423, тайлбал нэвтэрнэ ──"
# Login-ий IP rate limit 5/мин тул цонх шинэчлэгдэхийг хүлээнэ (V4-07)
echo "   (rate limit-ийн 60с цонх хүлээж байна…)"
sleep 61
SEMAIL="smoke-lock-$STAMP@ursgal.mn"
SUID=$(curl -sf -X POST $API/users -H "Authorization: Bearer $TOK_admin" -H "$H" \
  -d "{\"name\":\"Смоук Түгжээ\",\"email\":\"$SEMAIL\",\"password\":\"smokepass1\",\"role\":\"OPERATOR\"}" | json "['id']")
for i in 1 2 3 4; do
  [ "$(code -X POST $API/auth/login -H "$H" -d "{\"email\":\"$SEMAIL\",\"password\":\"wrong$i\"}")" = "401" ]
done
[ "$(code -X POST $API/auth/login -H "$H" -d "{\"email\":\"$SEMAIL\",\"password\":\"wrong5\"}")" = "423" ]
echo "   (дараагийн 60с цонх…)"
sleep 61
[ "$(code -X POST $API/auth/login -H "$H" -d "{\"email\":\"$SEMAIL\",\"password\":\"smokepass1\"}")" = "423" ]
curl -sf -X PATCH $API/users/$SUID/unlock -H "Authorization: Bearer $TOK_admin" >/dev/null
[ "$(code -X POST $API/auth/login -H "$H" -d "{\"email\":\"$SEMAIL\",\"password\":\"smokepass1\"}")" = "200" ]
curl -sf -X PATCH $API/users/$SUID -H "Authorization: Bearer $TOK_admin" -H "$H" \
  -d '{"isActive":false}' >/dev/null
echo "OK: түгжилт + тайлалт зөв (хэрэглэгч идэвхгүй болгов)"

echo "── 5. SSE stream ──"
SSE=$(curl -s --max-time 2 -D - -o /dev/null "$API/notifications/stream?token=$TOK_admin" || true)
echo "$SSE" | grep -q "text/event-stream" || { echo "FAIL: SSE content-type"; exit 1; }
echo "$SSE" | grep -q "200" || { echo "FAIL: SSE статус"; exit 1; }
echo "OK: SSE stream нээгдэж байна"

echo "── 6. CSV импорт + barcode ──"
curl -sf "$API/products/import-template.csv" -H "Authorization: Bearer $TOK_manager" | grep -q "SKU" \
  || { echo "FAIL: загвар"; exit 1; }
CSV="SKU,Нэр,Ангилал,Үнэ,Өртөг,Barcode,Доод хязгаар,Эхний үлдэгдэл
SMK4-$STAMP,Смоук v4 бараа,,3000,2000,SMKBC$STAMP,3,5"
IMP=$(curl -sf -X POST $API/products/import -H "Authorization: Bearer $TOK_manager" \
  -F "file=@-;filename=smoke.csv;type=text/csv" <<<"$CSV")
[ "$(echo "$IMP" | json "['created']")" = "1" ] || { echo "FAIL: импорт $IMP"; exit 1; }
FOUND=$(curl -sf "$API/products?search=SMKBC$STAMP" -H "Authorization: Bearer $TOK_manager" | json "['total']")
[ "$FOUND" = "1" ] || { echo "FAIL: barcode хайлт"; exit 1; }
NEWPID=$(curl -sf "$API/products?search=SMKBC$STAMP" -H "Authorization: Bearer $TOK_manager" | json "['items'][0]['id']")
curl -sf -X DELETE $API/products/$NEWPID -H "Authorization: Bearer $TOK_manager" >/dev/null
echo "OK: импорт created=1, barcode-оор олдож, идэвхгүй болгов"

echo ""
echo "✅ smoke v4 — БҮГД OK"
