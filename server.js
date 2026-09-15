'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./db');
const { execFileSync } = require('node:child_process');
const { parseClinicalText, VITAL_RANGES, LAB_RANGES } = require('./parse');

const PORT = Number(process.env.PORT || 3000);
const PASSCODE = process.env.WARD_PASSCODE || 'ward1234';
const PUBLIC_DIR = path.join(__dirname, 'public');

/* เวอร์ชันของโค้ดที่กำลังรันอยู่ — ใช้ตรวจว่าเครื่องนี้ดึงโค้ดล่าสุดมาแล้วหรือยัง
   อ่านจาก git ตอนเริ่มทำงานครั้งเดียว ถ้าอ่านไม่ได้ก็ไม่เป็นไร */
const BUILD = (() => {
  const git = (args) => execFileSync('git', args, { cwd: __dirname, encoding: 'utf8' }).trim();
  try {
    return { commit: git(['rev-parse', '--short', 'HEAD']), date: git(['log', '-1', '--format=%cs']) };
  } catch {
    return { commit: null, date: null };
  }
})();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 ชม.

/* ---------------- sessions (in-memory) ---------------- */
const sessions = new Map(); // token -> { user, expires }

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { user, expires: Date.now() + SESSION_TTL_MS });
  return token;
}

function readSession(req) {
  const cookie = req.headers.cookie || '';
  const m = /(?:^|;\s*)ward_session=([a-f0-9]+)/.exec(cookie);
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(m[1]); return null; }
  return { token: m[1], user: s.user };
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) if (s.expires < now) sessions.delete(t);
}, 10 * 60 * 1000).unref();

/* ---------------- realtime: Server-Sent Events ---------------- */
const clients = new Set();

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(frame); } catch { clients.delete(res); }
  }
}

setInterval(() => {
  for (const res of clients) {
    try { res.write(': ping\n\n'); } catch { clients.delete(res); }
  }
}, 25000).unref();

/* ---------------- helpers ---------------- */
function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (err, data) => {
    if (err) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

/* ---------------- API ---------------- */
async function handleApi(req, res, url, session) {
  const p = url.pathname;
  const method = req.method;

  // --- auth (ไม่ต้อง login) ---
  if (p === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const pass = String(body.passcode ?? '');
    const user = String(body.user ?? '').trim().slice(0, 60);
    const ok = pass.length === PASSCODE.length &&
      crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(PASSCODE));
    if (!ok || !user) return json(res, 401, { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    const token = createSession(user);
    res.setHeader('set-cookie', `ward_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`);
    return json(res, 200, { user });
  }

  if (p === '/api/version') return json(res, 200, BUILD);

  if (p === '/api/me') {
    return session ? json(res, 200, { user: session.user, build: BUILD }) : json(res, 401, { error: 'unauthenticated' });
  }

  if (p === '/api/logout' && method === 'POST') {
    if (session) sessions.delete(session.token);
    res.setHeader('set-cookie', 'ward_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return json(res, 200, { ok: true });
  }

  // --- ต้อง login ---
  if (!session) return json(res, 401, { error: 'unauthenticated' });
  const user = session.user;

  // realtime stream
  if (p === '/api/stream' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: hello\ndata: ${JSON.stringify({ user, viewers: clients.size + 1 })}\n\n`);
    clients.add(res);
    broadcast('viewers', { viewers: clients.size });
    req.on('close', () => { clients.delete(res); broadcast('viewers', { viewers: clients.size }); });
    return undefined;
  }

  // patients
  if (p === '/api/patients' && method === 'GET') {
    return json(res, 200, store.listPatients({ includeDischarged: url.searchParams.get('all') === '1' }));
  }

  if (p === '/api/patients' && method === 'POST') {
    const body = await readBody(req);
    if (!String(body.bed ?? '').trim() || !String(body.initials ?? '').trim()) {
      return json(res, 400, { error: 'ต้องระบุเตียงและชื่อย่อ' });
    }
    const patient = store.createPatient(body, user);
    store.createEvent(patient.id, {
      occurred_at: patient.admitted_at,
      kind: 'admit',
      title: 'Admit เข้าหอผู้ป่วย',
      detail: patient.diagnosis || null,
    }, user, 1);
    broadcast('patient:created', { patient, by: user });
    return json(res, 201, patient);
  }

  let m = /^\/api\/patients\/([\w-]+)$/.exec(p);
  if (m) {
    const id = m[1];
    if (method === 'GET') {
      const patient = store.getPatient(id);
      if (!patient) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      return json(res, 200, { ...patient, notes: store.listNotes(id) });
    }
    if (method === 'PATCH') {
      const before = store.getPatient(id);
      const patient = store.updatePatient(id, await readBody(req), user);
      if (!patient) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      if (before && before.diagnosis !== patient.diagnosis && patient.diagnosis) {
        store.createEvent(id, {
          kind: 'diagnosis',
          title: 'แก้ไข Diagnosis',
          detail: patient.diagnosis,
        }, user, 1);
        broadcast('timeline:changed', { patient_id: id, by: user });
      }
      broadcast('patient:updated', { patient, by: user });
      return json(res, 200, patient);
    }
    if (method === 'DELETE') {
      if (!store.getPatient(id)) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      store.deletePatient(id);
      broadcast('patient:deleted', { id, by: user });
      return json(res, 200, { ok: true });
    }
  }

  m = /^\/api\/patients\/([\w-]+)\/(discharge|readmit)$/.exec(p);
  if (m && method === 'POST') {
    if (!store.getPatient(m[1])) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
    const patient = m[2] === 'discharge' ? store.dischargePatient(m[1], user) : store.readmitPatient(m[1], user);
    store.createEvent(m[1], {
      kind: m[2] === 'discharge' ? 'discharge' : 'admit',
      title: m[2] === 'discharge' ? 'D/C จำหน่ายผู้ป่วย' : 'รับกลับเข้ารักษา',
    }, user, 1);
    broadcast('timeline:changed', { patient_id: m[1], by: user });
    broadcast('patient:updated', { patient, by: user });
    return json(res, 200, patient);
  }

  // SOAP notes
  m = /^\/api\/patients\/([\w-]+)\/notes$/.exec(p);
  if (m) {
    if (method === 'GET') return json(res, 200, store.listNotes(m[1]));
    if (method === 'POST') {
      const note = store.createNote(m[1], await readBody(req), user);
      if (!note) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      broadcast('note:created', { note, by: user });
      return json(res, 201, note);
    }
  }

  m = /^\/api\/notes\/([\w-]+)$/.exec(p);
  if (m) {
    if (method === 'PATCH') {
      const note = store.updateNote(m[1], await readBody(req), user);
      if (!note) return json(res, 404, { error: 'ไม่พบบันทึก' });
      broadcast('note:updated', { note, by: user });
      return json(res, 200, note);
    }
    if (method === 'DELETE') {
      const note = store.deleteNote(m[1]);
      if (!note) return json(res, 404, { error: 'ไม่พบบันทึก' });
      broadcast('note:deleted', { id: note.id, patient_id: note.patient_id, by: user });
      return json(res, 200, { ok: true });
    }
  }

  // รายงาน SOAP ของวันนั้น (ทุกเตียง)
  if (p === '/api/rounds' && method === 'GET') {
    const date = url.searchParams.get('date') || store.nowISO().slice(0, 10);
    return json(res, 200, { date, notes: store.notesForDate(date) });
  }


  // V/S
  m = /^\/api\/patients\/([\w-]+)\/vitals$/.exec(p);
  if (m) {
    if (method === 'GET') return json(res, 200, store.listVitals(m[1]));
    if (method === 'POST') {
      const row = store.createVitals(m[1], await readBody(req), user);
      if (!row) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      broadcast('vitals:changed', { patient_id: m[1], by: user });
      return json(res, 201, row);
    }
  }
  m = /^\/api\/vitals\/([\w-]+)$/.exec(p);
  if (m && method === 'DELETE') {
    const row = store.deleteVitals(m[1]);
    if (!row) return json(res, 404, { error: 'ไม่พบข้อมูล' });
    broadcast('vitals:changed', { patient_id: row.patient_id, by: user });
    return json(res, 200, { ok: true });
  }

  // Lab
  m = /^\/api\/patients\/([\w-]+)\/labs$/.exec(p);
  if (m) {
    if (method === 'GET') return json(res, 200, store.listLabs(m[1]));
    if (method === 'POST') {
      const body = await readBody(req);
      if (!String(body.name ?? '').trim()) return json(res, 400, { error: 'ต้องระบุชื่อ lab' });
      const row = store.createLab(m[1], body, user);
      if (!row) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      broadcast('labs:changed', { patient_id: m[1], by: user });
      return json(res, 201, row);
    }
  }
  m = /^\/api\/labs\/([\w-]+)$/.exec(p);
  if (m && method === 'DELETE') {
    const row = store.deleteLab(m[1]);
    if (!row) return json(res, 404, { error: 'ไม่พบข้อมูล' });
    broadcast('labs:changed', { patient_id: row.patient_id, by: user });
    return json(res, 200, { ok: true });
  }

  // Timeline / เหตุการณ์
  m = /^\/api\/patients\/([\w-]+)\/timeline$/.exec(p);
  if (m && method === 'GET') return json(res, 200, store.timeline(m[1]));

  m = /^\/api\/patients\/([\w-]+)\/events$/.exec(p);
  if (m && method === 'POST') {
    const row = store.createEvent(m[1], await readBody(req), user);
    if (!row) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
    broadcast('timeline:changed', { patient_id: m[1], by: user });
    return json(res, 201, row);
  }
  m = /^\/api\/events\/([\w-]+)$/.exec(p);
  if (m && method === 'DELETE') {
    const row = store.deleteEvent(m[1]);
    if (!row) return json(res, 404, { error: 'ไม่พบข้อมูล' });
    broadcast('timeline:changed', { patient_id: row.patient_id, by: user });
    return json(res, 200, { ok: true });
  }

  // Problem list
  m = /^\/api\/patients\/([\w-]+)\/problems$/.exec(p);
  if (m) {
    if (method === 'GET') return json(res, 200, store.listProblems(m[1]));
    if (method === 'POST') {
      const body = await readBody(req);
      if (!String(body.title ?? '').trim()) return json(res, 400, { error: 'ต้องระบุชื่อปัญหา' });
      const row = store.createProblem(m[1], body, user);
      if (!row) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      broadcast('problems:changed', { patient_id: m[1], by: user });
      broadcast('patient:refresh', { patient_id: m[1], by: user });
      return json(res, 201, row);
    }
  }
  m = /^\/api\/problems\/([\w-]+)$/.exec(p);
  if (m) {
    if (method === 'PATCH') {
      const row = store.updateProblem(m[1], await readBody(req), user);
      if (!row) return json(res, 404, { error: 'ไม่พบปัญหานี้' });
      broadcast('problems:changed', { patient_id: row.patient_id, by: user });
      broadcast('patient:refresh', { patient_id: row.patient_id, by: user });
      return json(res, 200, row);
    }
    if (method === 'DELETE') {
      const row = store.deleteProblem(m[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบปัญหานี้' });
      broadcast('problems:changed', { patient_id: row.patient_id, by: user });
      broadcast('patient:refresh', { patient_id: row.patient_id, by: user });
      return json(res, 200, { ok: true });
    }
  }

  // Investigation: imaging / patho / culture
  m = /^\/api\/patients\/([\w-]+)\/investigations$/.exec(p);
  if (m) {
    if (method === 'GET') return json(res, 200, store.listInvestigations(m[1]));
    if (method === 'POST') {
      const body = await readBody(req);
      if (!String(body.name ?? '').trim()) return json(res, 400, { error: 'ต้องระบุชื่อการตรวจ' });
      const row = store.createInvestigation(m[1], body, user);
      if (!row) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
      broadcast('ix:changed', { patient_id: m[1], by: user });
      broadcast('patient:refresh', { patient_id: m[1], by: user });
      return json(res, 201, row);
    }
  }
  m = /^\/api\/investigations\/([\w-]+)$/.exec(p);
  if (m) {
    if (method === 'PATCH') {
      const row = store.updateInvestigation(m[1], await readBody(req), user);
      if (!row) return json(res, 404, { error: 'ไม่พบผลตรวจนี้' });
      broadcast('ix:changed', { patient_id: row.patient_id, by: user });
      broadcast('patient:refresh', { patient_id: row.patient_id, by: user });
      return json(res, 200, row);
    }
    if (method === 'DELETE') {
      const row = store.deleteInvestigation(m[1]);
      if (!row) return json(res, 404, { error: 'ไม่พบผลตรวจนี้' });
      broadcast('ix:changed', { patient_id: row.patient_id, by: user });
      broadcast('patient:refresh', { patient_id: row.patient_id, by: user });
      return json(res, 200, { ok: true });
    }
  }

  // สำรองข้อมูลทั้งหมดเป็นไฟล์เดียว — รูปแบบเดียวกับที่ตัวนำเข้ารับ จึงกู้คืนได้ทันที
  if (p === '/api/cases/export' && method === 'GET') {
    const patients = store.listPatients({ includeDischarged: true });
    const cases = patients.map((pt) => ({
      bed: pt.bed, initials: pt.initials, age: pt.age, sex: pt.sex, allergy: pt.allergy,
      admitted_at: pt.admitted_at, discharged_at: pt.discharged_at, status: pt.status,
      diagnosis: pt.diagnosis, treatment: pt.treatment,
      underlying: pt.underlying, chief_complaint: pt.chief_complaint,
      present_illness: pt.present_illness, past_history: pt.past_history,
      physical_exam: pt.physical_exam,
      vitals: store.listVitals(pt.id).map(({ id, patient_id, created_at, ...v }) => v),
      labs: store.listLabs(pt.id).map(({ id, patient_id, created_at, ...l }) => l),
      problems: store.listProblems(pt.id).map(({ id, patient_id, created_at, updated_at, position, ...pb }) => pb),
      investigations: store.listInvestigations(pt.id)
        .map(({ id, patient_id, created_at, updated_at, ...ix }) => ix),
      events: store.listEvents(pt.id)
        .filter((e) => !e.auto)
        .map(({ id, patient_id, created_at, auto, ...ev }) => ev),
      notes: store.listNotes(pt.id).map(({ id, patient_id, created_at, updated_at, ...n }) => n),
    }));
    const bundle = {
      note: 'ไฟล์สำรองข้อมูล Ward — นำกลับเข้าระบบได้ที่แท็บนำเข้า',
      exported_at: store.nowISO(),
      exported_by: user,
      cases,
    };
    const data = JSON.stringify(bundle, null, 2);
    const stamp = store.nowISO().slice(0, 10);
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="ward-backup-${stamp}.json"`,
      'content-length': Buffer.byteLength(data),
      'cache-control': 'no-store',
    });
    return res.end(data);
  }

  // นำเข้าเคสทั้งชุดจากไฟล์ JSON (ผู้ใช้เลือกไฟล์ในหน้าเว็บ)
  if (p === '/api/cases/import' && method === 'POST') {
    const body = await readBody(req, 4 * 1024 * 1024);
    const cases = Array.isArray(body.cases) ? body.cases : null;
    if (!cases || !cases.length) return json(res, 400, { error: 'ไฟล์ไม่มีรายการเคส (ต้องมีคีย์ "cases")' });

    const result = { added: [], skipped: [], failed: [] };
    for (const c of cases) {
      const bed = String(c.bed ?? '').trim();
      if (!bed || !String(c.initials ?? '').trim()) {
        result.failed.push({ bed: bed || '(ไม่ระบุ)', reason: 'ต้องมีเตียงและชื่อย่อ' });
        continue;
      }
      const existing = store.listPatients({ includeDischarged: true }).filter((x) => x.bed === bed);
      if (existing.length && !body.replace) {
        result.skipped.push(bed);
        continue;
      }
      try {
        for (const old of existing) store.deletePatient(old.id);
        const patient = store.createPatient({
          bed, initials: c.initials, age: c.age, sex: c.sex,
          diagnosis: c.diagnosis, treatment: c.treatment, allergy: c.allergy,
          admitted_at: c.admitted_at,
        }, user);
        store.updatePatient(patient.id, {
          underlying: c.underlying, chief_complaint: c.chief_complaint,
          present_illness: c.present_illness, past_history: c.past_history,
          physical_exam: c.physical_exam,
          // ไฟล์สำรองพาสถานะ D/C กลับมาด้วย
          ...(c.status ? { status: c.status, discharged_at: c.discharged_at ?? null } : {}),
        }, user);
        store.createEvent(patient.id, {
          occurred_at: patient.admitted_at, kind: 'admit',
          title: 'Admit เข้าหอผู้ป่วย', detail: c.chief_complaint ?? null,
        }, user, 1);

        for (const v of c.vitals ?? []) store.createVitals(patient.id, v, user, 'import');
        for (const l of c.labs ?? []) store.createLab(patient.id, l, user, 'import');
        for (const pb of c.problems ?? []) store.createProblem(patient.id, pb, user);
        for (const ix of c.investigations ?? []) store.createInvestigation(patient.id, ix, user);
        for (const ev of c.events ?? []) store.createEvent(patient.id, ev, user, 0);
        for (const n of c.notes ?? []) store.createNote(patient.id, n, user);

        result.added.push(bed);
      } catch (err) {
        result.failed.push({ bed, reason: err.message });
      }
    }
    if (result.added.length) {
      broadcast('cases:imported', { beds: result.added, by: user });
      broadcast('patient:refresh', { by: user });
    }
    return json(res, 201, result);
  }

  // ค่าอ้างอิงสำหรับไฮไลต์ค่าผิดปกติ
  if (p === '/api/ranges' && method === 'GET') {
    return json(res, 200, { vitals: VITAL_RANGES, labs: LAB_RANGES });
  }

  // อ่านข้อความจากระบบโรงพยาบาล -> แสดงให้ผู้ใช้ตรวจก่อน (ยังไม่บันทึก)
  if (p === '/api/parse' && method === 'POST') {
    const body = await readBody(req, 1024 * 1024);
    return json(res, 200, parseClinicalText(body.text));
  }

  // บันทึกรายการที่ผู้ใช้ตรวจและยืนยันแล้ว
  m = /^\/api\/patients\/([\w-]+)\/import$/.exec(p);
  if (m && method === 'POST') {
    const patientId = m[1];
    if (!store.getPatient(patientId)) return json(res, 404, { error: 'ไม่พบผู้ป่วย' });
    const body = await readBody(req, 1024 * 1024);
    let vitalsSaved = 0;
    let labsSaved = 0;
    if (body.vitals && Object.keys(body.vitals).length) {
      store.createVitals(patientId, { ...body.vitals, measured_at: body.measured_at }, user, 'import');
      vitalsSaved = 1;
    }
    for (const lab of Array.isArray(body.labs) ? body.labs : []) {
      if (!lab || !String(lab.name ?? '').trim()) continue;
      store.createLab(patientId, { ...lab, collected_at: body.collected_at }, user, 'import');
      labsSaved++;
    }
    if (vitalsSaved || labsSaved) {
      store.createEvent(patientId, {
        occurred_at: (body.collected_at || body.measured_at || store.nowISO()).slice(0, 10),
        kind: 'import',
        title: 'นำเข้าข้อมูลจากข้อความโรงพยาบาล',
        detail: `V/S ${vitalsSaved} ชุด, Lab ${labsSaved} ค่า`,
      }, user, 1);
      broadcast('vitals:changed', { patient_id: patientId, by: user });
      broadcast('labs:changed', { patient_id: patientId, by: user });
      broadcast('timeline:changed', { patient_id: patientId, by: user });
    }
    return json(res, 201, { vitals: vitalsSaved, labs: labsSaved });
  }

  return json(res, 404, { error: 'not found' });
}

/* ---------------- server ---------------- */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const session = readSession(req);

  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url, session).catch((err) => {
      if (!res.headersSent) json(res, 400, { error: err.message || 'bad request' });
    });
    return;
  }
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  // ใน Codespaces ลิงก์ที่ใช้เปิดจริงไม่ใช่ localhost จึงพิมพ์ให้เห็นชัด ๆ
  const cs = process.env.CODESPACE_NAME;
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (cs && domain) {
    const url = `https://${cs}-${PORT}.${domain}`;
    console.log('\n' + '='.repeat(60));
    console.log('  เปิดเว็บ Ward ที่ลิงก์นี้ (เซฟไว้ที่หน้าจอหลักได้เลย)');
    console.log(`  ${url}`);
    console.log('='.repeat(60) + '\n');
  }
  console.log(`Ward  →  http://localhost:${PORT}`);
  console.log(`เวอร์ชันโค้ด: ${BUILD.commit ?? 'ไม่ทราบ'}${BUILD.date ? ` (${BUILD.date})` : ''}`);
  console.log(`ฐานข้อมูล: ${store.DB_PATH}`);
  if (!process.env.WARD_PASSCODE) console.log('⚠  ใช้รหัสผ่านเริ่มต้น "ward1234" — ตั้ง WARD_PASSCODE ก่อนใช้งานจริง');
});

module.exports = server;
