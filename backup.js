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

// เซิร์ฟเวอร์เรียกฟังก์ชันนี้เองได้ (ใช้ตอน deploy บนคลาวด์ที่ไม่มี cron ให้ตั้ง)
async function runBackup({ dbPath = DB_PATH, outDir = OUT_DIR, keep = KEEP, log = console.log } = {}) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`ไม่พบฐานข้อมูลที่ ${dbPath} — ตั้ง WARD_DB ให้ตรงกับที่เซิร์ฟเวอร์ใช้`);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // ชื่อไฟล์เรียงตามเวลาได้เอง: ward-2026-09-17-03-00-00.db
  const stamp = new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-');
  const target = path.join(outDir, `ward-${stamp}.db`);

  const db = new DatabaseSync(dbPath);
  try {
    await backup(db, target);
  } finally {
    db.close();
  }

  const size = (fs.statSync(target).size / 1024).toFixed(0);
  log(`สำรองแล้ว: ${target} (${size} KB)`);

  // ลบไฟล์เก่าที่เกินจำนวนที่เก็บไว้
  const old = fs.readdirSync(outDir)
    .filter((f) => /^ward-.*\.db$/.test(f))
    .sort()
    .slice(0, -keep);
  for (const f of old) {
    fs.rmSync(path.join(outDir, f));
    log(`ลบไฟล์เก่า: ${f}`);
  }
  return target;
}

module.exports = { runBackup };

if (require.main === module) {
  runBackup().catch((err) => {
    console.error('สำรองข้อมูลไม่สำเร็จ:', err.message);
    process.exit(1);
  });
}
