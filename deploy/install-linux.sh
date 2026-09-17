#!/usr/bin/env bash
# ติดตั้ง Ward ให้รันค้างตลอดบนคอมพิวเตอร์ Linux (เปิดเองทุกครั้งที่บูต และรีสตาร์ทเองถ้าแอปล้ม)
#
#   sudo bash deploy/install-linux.sh
#
# ถอนการติดตั้ง: sudo systemctl disable --now ward ward-backup.timer
set -euo pipefail

WARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node || true)"

if [ "$(id -u)" -ne 0 ]; then
  echo "ต้องรันด้วย sudo: sudo bash deploy/install-linux.sh" >&2
  exit 1
fi
if [ -z "$NODE" ]; then
  echo "ไม่พบ Node.js — ติดตั้ง Node 22.5 ขึ้นไปก่อน แล้วลองใหม่" >&2
  exit 1
fi

# Ward ต้องใช้ node:sqlite ที่มากับ Node 22.5+
read -r major minor <<<"$("$NODE" -p "process.versions.node.split('.').slice(0,2).join(' ')")"
if [ "$major" -lt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -lt 5 ]; }; then
  echo "Node ที่เครื่องนี้เป็นเวอร์ชัน $major.$minor — Ward ต้องใช้ 22.5 ขึ้นไป" >&2
  exit 1
fi

# รหัสผ่านของหอผู้ป่วย: ถามครั้งแรกครั้งเดียว แล้วเก็บไว้ใน /etc/ward.env
if [ ! -f /etc/ward.env ]; then
  read -rsp "ตั้งรหัสผ่านของหอผู้ป่วย (ใช้ตอน login): " passcode; echo
  if [ -z "$passcode" ]; then echo "รหัสผ่านว่างไม่ได้" >&2; exit 1; fi
  printf 'WARD_PASSCODE=%s\nPORT=3000\n' "$passcode" > /etc/ward.env
  chmod 600 /etc/ward.env
  echo "เก็บรหัสผ่านไว้ที่ /etc/ward.env (อ่านได้เฉพาะ root)"
else
  echo "มี /etc/ward.env อยู่แล้ว — ใช้รหัสผ่านเดิม"
fi

for unit in ward.service ward-backup.service ward-backup.timer; do
  sed -e "s|__WARD_DIR__|$WARD_DIR|g" -e "s|__NODE__|$NODE|g" \
    "$WARD_DIR/deploy/$unit" > "/etc/systemd/system/$unit"
done

systemctl daemon-reload
systemctl enable --now ward.service
systemctl enable --now ward-backup.timer

sleep 2
if systemctl is-active --quiet ward.service; then
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  echo
  echo "✅ Ward ทำงานแล้ว และจะเปิดเองทุกครั้งที่บูตเครื่อง"
  echo "   เปิดจาก iPad/มือถือในวง Wi-Fi เดียวกันที่:  http://${ip:-<ไอพีเครื่องนี้>}:3000"
  echo "   สำรองฐานข้อมูลอัตโนมัติทุกวันตี 3 ไปที่ $WARD_DIR/data/backups"
  echo
  echo "   ดูสถานะ: systemctl status ward"
  echo "   ดู log : journalctl -u ward -f"
else
  echo "❌ เริ่มเซิร์ฟเวอร์ไม่สำเร็จ — ดูสาเหตุด้วย: journalctl -u ward -n 50" >&2
  exit 1
fi
