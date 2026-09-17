@echo off
REM Windows: ใช้ไฟล์นี้เป็น "โปรแกรมที่สั่งให้ทำงาน" ใน Task Scheduler
REM ตั้งรหัสผ่านของหอผู้ป่วยตรงบรรทัดล่างนี้ก่อนใช้งาน
set WARD_PASSCODE=ตั้งรหัสผ่านตรงนี้
set PORT=3000
cd /d "%~dp0.."
:loop
node server.js
REM ถ้าเซิร์ฟเวอร์หลุด ให้รอ 3 วินาทีแล้วเปิดใหม่เอง
timeout /t 3 /nobreak >nul
goto loop
