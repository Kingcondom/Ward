'use strict';
/**
 * สำรองฐานข้อมูลขณะเซิร์ฟเวอร์ยังเปิดอยู่ได้อย่างปลอดภัย (SQLite online backup)
 *
 *   node backup.js                 เก็บไว้ที่ data/backups/
 *   node backup.js /media/usb/ward เลือกที่เก็บเอง
 *
 * เก็บย้อนหลัง 14 ไฟล์ (เปลี่ยนได้ด้วย WARD_BACKUP_KEEP) ไฟล์เก่ากว่านั้นจะถูกลบ
 * ไฟล์ที่ได้คือฐานข้อมูล SQLite เต็ม ๆ นำกลับมาใช้ได้ด้วยการวางทับ data/ward.db
 */
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = process.env.WARD_DB || path.join(__dirname, 'data', 'ward.db');
const OUT_DIR = process.argv[2] || process.env.WARD_BACKUP_DIR
  || path.join(path.dirname(DB_PATH), 'backups');
const KEEP = Number(process.env.WARD_BACKUP_KEEP || 14);

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`ไม่พบฐานข้อมูลที่ ${DB_PATH} — ตั้ง WARD_DB ให้ตรงกับที่เซิร์ฟเวอร์ใช้`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ชื่อไฟล์เรียงตามเวลาได้เอง: ward-2026-09-17-03-00-00.db
  const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
  const target = path.join(OUT_DIR, `ward-${stamp}.db`);

  const db = new DatabaseSync(DB_PATH);
  try {
    await backup(db, target);
  } finally {
    db.close();
  }

  const size = (fs.statSync(target).size / 1024).toFixed(0);
  console.log(`สำรองแล้ว: ${target} (${size} KB)`);

  // ลบไฟล์เก่าที่เกินจำนวนที่เก็บไว้
  const old = fs.readdirSync(OUT_DIR)
    .filter((f) => /^ward-.*\.db$/.test(f))
    .sort()
    .slice(0, -KEEP);
  for (const f of old) {
    fs.rmSync(path.join(OUT_DIR, f));
    console.log(`ลบไฟล์เก่า: ${f}`);
  }
}

main().catch((err) => {
  console.error('สำรองข้อมูลไม่สำเร็จ:', err.message);
  process.exit(1);
});
