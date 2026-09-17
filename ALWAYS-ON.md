# 🔌 ทำให้เว็บเปิดอยู่ตลอด 24 ชั่วโมง

Codespaces **ทำแบบนี้ไม่ได้** — ไม่ใช้งาน 30 นาทีก็หยุดเอง (ยืดได้สูงสุด 240 นาที) และถ้าไม่ได้ใช้
เกิน 30 วันจะถูกลบทิ้งพร้อมข้อมูล เหมาะกับลองใช้เท่านั้น ถ้าจะใช้จริงต้องเลือกวิธีใดวิธีหนึ่งด้านล่าง

| | คอมในวอร์ด (แนะนำสำหรับข้อมูลจริง) | Fly.io |
|---|---|---|
| เปิดตลอด 24 ชม. | ✅ ตราบที่คอมเปิดอยู่ | ✅ จริง ๆ |
| เข้าจากนอกโรงพยาบาล | ❌ เฉพาะใน Wi-Fi เดียวกัน | ✅ ทุกที่ที่มีเน็ต |
| ข้อมูลออกนอกโรงพยาบาล | ❌ ไม่ออกเลย | ⚠️ ออก (มีผลทาง PDPA) |
| ค่าใช้จ่าย | ไม่มี (ถ้ามีคอมอยู่แล้ว) | ประมาณ 2-3 USD/เดือน |
| ต้องดูแลอะไร | คอมต้องเปิดค้าง ไม่ดับ ไม่หลับ | แทบไม่ต้อง |

---

## วิธีที่ 1 — คอมพิวเตอร์ในวอร์ด (Linux)

สั่งครั้งเดียว เซิร์ฟเวอร์จะเปิดเองทุกครั้งที่บูตเครื่อง รีสตาร์ทเองถ้าแอปล้ม และสำรองข้อมูลให้ทุกคืน

```bash
git clone https://github.com/Kingcondom/Ward.git
cd Ward
sudo bash deploy/install-linux.sh     # ถามรหัสผ่านของหอผู้ป่วยครั้งเดียว
```

จบแล้วเปิดจาก iPad/มือถือในวง Wi-Fi เดียวกันที่ `http://<ไอพีของคอม>:3000`

```bash
systemctl status ward        # ดูว่ายังทำงานอยู่ไหม
journalctl -u ward -f        # ดู log สด
sudo systemctl restart ward  # รีสตาร์ท (เช่น หลัง git pull)
```

**ตั้งค่าคอมไม่ให้หลับ** (สำคัญที่สุด — คอมหลับ = เว็บดับ)

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
```

> ควรตั้งไอพีของคอมเป็นแบบคงที่ (static IP / DHCP reservation ที่ router) ไม่งั้นไอพีเปลี่ยน
> ลิงก์ที่เซฟไว้ที่หน้าจอหลักจะเปิดไม่ขึ้น

### macOS

แก้ `deploy/com.ward.server.plist` (ที่อยู่โฟลเดอร์, ที่อยู่ node, รหัสผ่าน) แล้ว

```bash
cp deploy/com.ward.server.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.ward.server.plist
sudo pmset -a sleep 0 disablesleep 1      # ไม่ให้เครื่องหลับ
```

### Windows

1. แก้รหัสผ่านในไฟล์ `deploy\ward-windows.cmd`
2. เปิด PowerShell แบบ Run as administrator แล้วสั่ง

```powershell
schtasks /create /tn "Ward" /tr "%CD%\deploy\ward-windows.cmd" /sc onstart /ru SYSTEM /rl HIGHEST
schtasks /run /tn "Ward"
powercfg /change standby-timeout-ac 0     # ไม่ให้เครื่องหลับตอนเสียบปลั๊ก
```

3. อนุญาต Node ผ่าน Windows Defender Firewall (เครือข่ายส่วนตัว) เพื่อให้ iPad เข้าได้

---

## วิธีที่ 2 — Fly.io (เข้าได้จากทุกที่)

`fly.toml` ในโปรเจกต์ตั้งค่าไว้แล้วว่า **ห้ามเครื่องหลับ** (`auto_stop_machines = false`,
`min_machines_running = 1`) และมี health check ที่ `/api/version` ถ้าเซิร์ฟเวอร์ไม่ตอบ Fly จะรีสตาร์ทให้เอง

```bash
fly launch --no-deploy                    # ตั้งชื่อแอป เลือก region sin (สิงคโปร์)
fly volumes create ward_data --size 1     # ดิสก์เก็บข้อมูลถาวร
fly secrets set WARD_PASSCODE='รหัสที่ตั้งเอง'
fly deploy
```

ได้ลิงก์ `https://<ชื่อแอป>.fly.dev` พร้อม HTTPS เปิดจาก iPad ได้เลย

```bash
fly status      # ดูว่าเครื่องยังตื่นอยู่
fly logs        # ดู log สด
fly ssh console -C "node /app/backup.js /data/backups"   # สำรองข้อมูลทันที
```

> ⚠️ ขึ้นคลาวด์ = ข้อมูลออกนอกโรงพยาบาล ถ้าเป็นข้อมูลผู้ป่วยจริงต้องดูนโยบายเวชระเบียนและ PDPA ก่อน

---

## สำรองข้อมูลอัตโนมัติ

ถ้าเว็บเปิดตลอด ข้อมูลก็สะสมตลอด — ควรมีสำเนาไว้เสมอ

```bash
npm run backup                 # สำรองทันที ไปที่ data/backups/
node backup.js /media/usb/ward # เลือกที่เก็บเอง เช่น แฟลชไดรฟ์
```

ใช้ SQLite online backup จึงสำรองได้**ขณะเซิร์ฟเวอร์ยังเปิดอยู่** ไม่ต้องหยุดระบบ
เก็บย้อนหลัง 14 ไฟล์ (เปลี่ยนด้วย `WARD_BACKUP_KEEP`) ไฟล์ที่ได้เป็นฐานข้อมูลเต็ม
กู้คืนโดยหยุดเซิร์ฟเวอร์แล้ววางทับ `data/ward.db`

บน Linux ตัวติดตั้งตั้ง timer ให้แล้ว — สำรองทุกวันตี 3 อัตโนมัติ

```bash
systemctl list-timers ward-backup.timer   # ดูว่าจะสำรองรอบต่อไปเมื่อไร
```

> ไฟล์สำรองคือข้อมูลผู้ป่วยทั้งหอ `.gitignore` กัน `data/backups/` ไว้แล้ว **ห้าม commit ขึ้น GitHub**
> และถ้าก๊อปใส่แฟลชไดรฟ์ ให้เก็บแบบเดียวกับเวชระเบียน
