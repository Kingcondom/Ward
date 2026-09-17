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

## วิธีที่ 2 — Fly.io (เข้าได้จากทุกที่) ⭐

### ตั้งครั้งเดียวจบ

ติดตั้ง flyctl แล้ว login ก่อน (ทำที่เครื่องคอม ไม่ใช่ iPad)

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
```

จากนั้นในโฟลเดอร์ Ward

```bash
bash deploy/fly-setup.sh
```

สคริปต์จะสร้างแอป (region สิงคโปร์), สร้าง volume 1 GB สำหรับเก็บฐานข้อมูลถาวร,
ถามรหัสผ่านของหอผู้ป่วยแล้วเก็บเป็น secret และ deploy ให้ — จบแล้วได้ลิงก์ `https://<ชื่อแอป>.fly.dev`
พร้อม HTTPS เปิดจาก iPad ได้ทันที รันซ้ำได้ ถ้ามีอะไรตั้งไว้แล้วจะข้ามให้เอง

> อยากตั้งชื่อแอปเอง: `bash deploy/fly-setup.sh ward-<ชื่อวอร์ด>` (ชื่อต้องไม่ซ้ำกับใครทั้งโลก)

### สิ่งที่ตั้งไว้ให้แล้วใน `fly.toml`

| ตั้งค่า | ทำไม |
|---|---|
| `auto_stop_machines = false` + `min_machines_running = 1` | ห้ามเครื่องหลับ ถ้าหลับ real-time (SSE) จะหลุดและหน้าเว็บที่เปิดค้างจะค้าง |
| health check ที่ `/api/version` ทุก 30 วินาที | ถ้าเซิร์ฟเวอร์ไม่ตอบ Fly รีสตาร์ทให้เอง |
| `TZ = "Asia/Bangkok"` | เครื่องคลาวด์เป็น UTC ถ้าไม่ตั้ง เวรดึกบันทึก SOAP ตอนตี 1-7 โมงเช้าจะถูกนับเป็นเมื่อวาน |
| `WARD_AUTO_BACKUP = "03:00"` | Fly ไม่มี cron ให้ตั้ง เซิร์ฟเวอร์จึงสำรองฐานข้อมูลเองทุกวันตี 3 ลงใน volume |
| `[[mounts]] /data` | ฐานข้อมูลอยู่บน volume ข้อมูลไม่หายตอน deploy ใหม่ |

### คำสั่งที่ใช้บ่อย

```bash
fly status                 # เครื่องยังตื่นอยู่ไหม
fly logs                   # ดู log สด (รวมข้อความสำรองข้อมูลอัตโนมัติ)
fly deploy                 # อัปเดตโค้ดใหม่หลัง git pull
fly secrets set WARD_PASSCODE='รหัสใหม่'      # เปลี่ยนรหัสผ่านของหอผู้ป่วย
fly ssh console -C "node /app/backup.js"      # สั่งสำรองทันที
fly ssh sftp ls /data/backups                 # ดูไฟล์สำรองที่มี
fly ssh sftp get /data/backups/<ชื่อไฟล์>      # ดึงไฟล์สำรองลงเครื่อง
```

### กู้ข้อมูลกลับ

วิธีที่ง่ายที่สุดคือใช้ไฟล์สำรองจากหน้าเว็บ (ปุ่ม **💾 สำรอง / นำเข้า → ดาวน์โหลดข้อมูลทั้งหมด**)
แล้วนำกลับเข้าที่ช่องนำเข้าในหน้าเดียวกัน ใช้ได้แม้หอผู้ป่วยว่างเปล่า

ถ้าจะกู้จากไฟล์ `.db` ใน volume โดยตรง

```bash
fly ssh console
cd /data && cp backups/ward-<วันที่>.db ward.db && exit
fly apps restart <ชื่อแอป>
```

> ⚠️ ขึ้นคลาวด์ = ข้อมูลผู้ป่วยออกนอกโรงพยาบาล ก่อนใส่ข้อมูลจริงควรดูนโยบายเวชระเบียนและ PDPA
> ให้เรียบร้อย ตั้งรหัสผ่านที่เดายาก และเปลี่ยนทันทีเมื่อมีคนย้ายออกจากทีม

## สำรองข้อมูลอัตโนมัติ

ถ้าเว็บเปิดตลอด ข้อมูลก็สะสมตลอด — ควรมีสำเนาไว้เสมอ

```bash
npm run backup                 # สำรองทันที ไปที่ data/backups/
node backup.js /media/usb/ward # เลือกที่เก็บเอง เช่น แฟลชไดรฟ์
```

ใช้ SQLite online backup จึงสำรองได้**ขณะเซิร์ฟเวอร์ยังเปิดอยู่** ไม่ต้องหยุดระบบ
เก็บย้อนหลัง 14 ไฟล์ (เปลี่ยนด้วย `WARD_BACKUP_KEEP`) ไฟล์ที่ได้เป็นฐานข้อมูลเต็ม
กู้คืนโดยหยุดเซิร์ฟเวอร์แล้ววางทับ `data/ward.db`

ตั้งให้สำรองเองอัตโนมัติได้ 2 แบบ

- **บน Fly.io / คลาวด์** — ตั้ง `WARD_AUTO_BACKUP="03:00"` (ตั้งไว้ใน `fly.toml` ให้แล้ว)
  เซิร์ฟเวอร์จะสำรองเองทุกวันตี 3 ตามเวลาของเครื่อง ดูผลได้ที่ `fly logs`
- **บน Linux ที่มี systemd** — ตัวติดตั้งตั้ง timer ให้แล้ว
  ดูรอบถัดไปด้วย `systemctl list-timers ward-backup.timer`

> ไฟล์สำรองคือข้อมูลผู้ป่วยทั้งหอ `.gitignore` กัน `data/backups/` ไว้แล้ว **ห้าม commit ขึ้น GitHub**
> และถ้าก๊อปใส่แฟลชไดรฟ์ ให้เก็บแบบเดียวกับเวชระเบียน
