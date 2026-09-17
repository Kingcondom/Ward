#!/usr/bin/env bash
# ตั้ง Ward บน Fly.io ให้เปิดค้างตลอด 24 ชม. — สั่งครั้งเดียวจบ
#
#   bash deploy/fly-setup.sh [ชื่อแอป]
#
# ต้องมี flyctl ก่อน: curl -L https://fly.io/install.sh | sh   (แล้ว fly auth login)
# รันซ้ำได้ ถ้ามีอะไรตั้งไว้แล้วจะข้ามให้เอง
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="${1:-}"
REGION="sin"          # สิงคโปร์ ใกล้ไทยที่สุด
VOLUME="ward_data"

command -v fly >/dev/null || { echo "ไม่พบคำสั่ง fly — ติดตั้งจาก https://fly.io/install.sh ก่อน" >&2; exit 1; }
fly auth whoami >/dev/null 2>&1 || { echo "ยังไม่ได้ login — สั่ง fly auth login ก่อน" >&2; exit 1; }

# ชื่อแอปต้องไม่ซ้ำกับใครทั้งโลก ถ้าไม่ได้ระบุมาก็สุ่มต่อท้ายให้
if [ -z "$APP" ]; then
  APP="ward-$(head -c 3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi
echo "ชื่อแอป: $APP  ·  region: $REGION"

if ! fly status --app "$APP" >/dev/null 2>&1; then
  fly launch --no-deploy --copy-config --name "$APP" --region "$REGION" --yes
else
  echo "มีแอป $APP อยู่แล้ว — ข้ามขั้น launch"
fi

# volume เก็บฐานข้อมูลถาวร (ถ้าไม่มี volume ข้อมูลจะหายทุกครั้งที่ deploy)
if ! fly volumes list --app "$APP" 2>/dev/null | grep -q "$VOLUME"; then
  fly volumes create "$VOLUME" --app "$APP" --region "$REGION" --size 1 --yes
else
  echo "มี volume $VOLUME อยู่แล้ว — ข้าม"
fi

# รหัสผ่านของหอผู้ป่วย เก็บเป็น secret ไม่อยู่ในโค้ด
if ! fly secrets list --app "$APP" 2>/dev/null | grep -q WARD_PASSCODE; then
  read -rsp "ตั้งรหัสผ่านของหอผู้ป่วย (ใช้ตอน login): " passcode; echo
  [ -n "$passcode" ] || { echo "รหัสผ่านว่างไม่ได้" >&2; exit 1; }
  fly secrets set WARD_PASSCODE="$passcode" --app "$APP" --stage
else
  echo "ตั้ง WARD_PASSCODE ไว้แล้ว — ข้าม (เปลี่ยนได้ด้วย fly secrets set WARD_PASSCODE='...')"
fi

fly deploy --app "$APP" --ha=false

echo
echo "✅ เปิดเว็บที่  https://$APP.fly.dev"
echo "   เครื่องตั้งไว้ไม่ให้หลับ (min_machines_running = 1) และสำรองข้อมูลเองทุกวันตี 3 ลงใน volume"
echo
echo "   ดูสถานะ     : fly status --app $APP"
echo "   ดู log สด    : fly logs --app $APP"
echo "   สำรองทันที   : fly ssh console --app $APP -C 'node /app/backup.js'"
echo "   ดึงไฟล์สำรอง : fly ssh sftp get /data/backups/<ชื่อไฟล์> --app $APP"
