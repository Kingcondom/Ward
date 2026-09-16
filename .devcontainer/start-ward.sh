#!/usr/bin/env bash
# สตาร์ทเซิร์ฟเวอร์ Ward แบบเบื้องหลัง
#
# สคริปต์นี้ถูกเรียกจาก postStartCommand คือ "ทุกครั้งที่ codespace เริ่มทำงาน"
# รวมถึงตอนปลุกจากการหลับ — ไม่ต้องเปิดหน้า VS Code ค้างไว้ และไม่ต้องพิมพ์คำสั่งเอง
# ถ้าไม่ทำแบบนี้ ลิงก์เว็บที่เซฟไว้ที่หน้าจอหลักจะเปิดไม่ขึ้น (Safari จะขึ้นเป็นไฟล์ว่าง 0 KB)
set -u

cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-3000}"
LOG=/tmp/ward.log

alive() { curl -sf -m 2 "http://localhost:${PORT}/api/version" >/dev/null 2>&1; }

if alive; then
  echo "Ward รันอยู่แล้วที่พอร์ต ${PORT} — ไม่ต้องสตาร์ทซ้ำ"
  exit 0
fi

nohup node server.js >"$LOG" 2>&1 &

# รอให้เปิดพอร์ตจริงก่อน (สูงสุด ~20 วินาที) Codespaces จะได้ forward พอร์ตทัน
for _ in $(seq 1 40); do
  alive && break
  sleep 0.5
done

if alive; then
  if [ -n "${WARD_PASSCODE:-}" ]; then
    echo "✅ Ward พร้อมใช้งานแล้ว (ใช้รหัสผ่านจาก Codespaces secret WARD_PASSCODE)"
  else
    echo "✅ Ward พร้อมใช้งานแล้ว"
    echo "⚠  ยังไม่ได้ตั้ง WARD_PASSCODE จึงใช้รหัสเริ่มต้น \"ward1234\""
    echo "   ตั้งได้ที่ https://github.com/settings/codespaces (New secret) แล้ว restart codespace"
  fi
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    echo "   เปิดเว็บที่ https://${CODESPACE_NAME}-${PORT}.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  fi
else
  echo "❌ สตาร์ท Ward ไม่สำเร็จ — ดูสาเหตุได้ที่ ${LOG} หรือสั่ง npm start เองใน terminal"
  tail -n 20 "$LOG" 2>/dev/null
fi
