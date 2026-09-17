# Ward — ไม่มี dependency ภายนอก จึงไม่ต้อง npm install
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
# ต้องครบทุกไฟล์ที่ server.js เรียกใช้ ไม่งั้น container จะตายตั้งแต่สตาร์ท
COPY server.js db.js parse.js seed.js backup.js ./
COPY public ./public

# เก็บฐานข้อมูลไว้นอก image เพื่อให้ข้อมูลอยู่รอดตอน redeploy
ENV WARD_DB=/data/ward.db
ENV PORT=3000
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "server.js"]
