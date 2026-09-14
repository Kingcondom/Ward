'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_PATH = process.env.WARD_DB || path.join(__dirname, 'data', 'ward.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/* ---------- migrations ----------
   ทุก migration จะรันอัตโนมัติตอนเปิดเซิร์ฟเวอร์ ตามเลข PRAGMA user_version
   เพิ่มฟีเจอร์ใหม่ = เพิ่ม migration ต่อท้าย ผู้ใช้ไม่ต้องตั้งค่าใหม่ ข้อมูลเดิมไม่หาย */

const MIGRATIONS = [
  // 1 — สคีมาตั้งต้น: ผู้ป่วย + SOAP
  `
  CREATE TABLE IF NOT EXISTS patients (
    id           TEXT PRIMARY KEY,
    bed          TEXT NOT NULL,
    initials     TEXT NOT NULL,
    hn           TEXT,
    age          TEXT,
    sex          TEXT,
    diagnosis    TEXT,
    treatment    TEXT,
    allergy      TEXT,
    status       TEXT NOT NULL DEFAULT 'active',
    admitted_at  TEXT,
    discharged_at TEXT,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    updated_by   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);

  CREATE TABLE IF NOT EXISTS soap_notes (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    note_date   TEXT NOT NULL,
    round       TEXT,
    subjective  TEXT,
    objective   TEXT,
    assessment  TEXT,
    plan        TEXT,
    author      TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_soap_patient_date ON soap_notes(patient_id, note_date DESC);
  `,

  // 2 — V/S, Lab และ Timeline เหตุการณ์
  `
  CREATE TABLE IF NOT EXISTS vitals (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    measured_at TEXT NOT NULL,          -- YYYY-MM-DDTHH:MM
    bt REAL, sbp REAL, dbp REAL, pr REAL, rr REAL, o2sat REAL,
    note        TEXT,
    author      TEXT,
    source      TEXT,                   -- manual | import
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_vitals_patient ON vitals(patient_id, measured_at DESC);

  CREATE TABLE IF NOT EXISTS labs (
    id           TEXT PRIMARY KEY,
    patient_id   TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    collected_at TEXT NOT NULL,         -- YYYY-MM-DD หรือ YYYY-MM-DDTHH:MM
    name         TEXT NOT NULL,
    value        REAL,
    unit         TEXT,
    raw          TEXT,
    author       TEXT,
    source       TEXT,
    created_at   TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_labs_patient ON labs(patient_id, collected_at DESC);
  CREATE INDEX IF NOT EXISTS idx_labs_name ON labs(patient_id, name, collected_at);

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    patient_id  TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL,          -- YYYY-MM-DD หรือ YYYY-MM-DDTHH:MM
    kind        TEXT NOT NULL,          -- admit | diagnosis | procedure | consult | complication | transfer | discharge | import | note
    title       TEXT NOT NULL,
    detail      TEXT,
    author      TEXT,
    auto        INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_patient ON events(patient_id, occurred_at DESC);
  `,
];

function migrate() {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current >= MIGRATIONS.length) return;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
      console.log(`ฐานข้อมูล: อัปเกรดเป็นเวอร์ชัน ${v + 1}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${v + 1} ล้มเหลว: ${err.message}`);
    }
  }
}

migrate();

const nowISO = () => new Date().toISOString();
const newId = () => crypto.randomUUID();

/* ---------- patients ---------- */

const PATIENT_FIELDS = ['bed', 'initials', 'hn', 'age', 'sex', 'diagnosis', 'treatment', 'allergy', 'status', 'admitted_at', 'discharged_at'];

function listPatients({ includeDischarged = false } = {}) {
  const sql = includeDischarged
    ? 'SELECT * FROM patients ORDER BY status, bed'
    : "SELECT * FROM patients WHERE status = 'active' ORDER BY bed";
  const rows = db.prepare(sql).all();
  const counts = db.prepare('SELECT patient_id, COUNT(*) n, MAX(note_date) last_date FROM soap_notes GROUP BY patient_id').all();
  const byId = new Map(counts.map((c) => [c.patient_id, c]));
  return rows.map((r) => ({
    ...r,
    soap_count: byId.get(r.id)?.n ?? 0,
    last_soap_date: byId.get(r.id)?.last_date ?? null,
  }));
}

function getPatient(id) {
  return db.prepare('SELECT * FROM patients WHERE id = ?').get(id) ?? null;
}

function createPatient(input, user) {
  const ts = nowISO();
  const id = newId();
  db.prepare(`INSERT INTO patients
    (id, bed, initials, hn, age, sex, diagnosis, treatment, allergy, status, admitted_at, created_at, updated_at, updated_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    String(input.bed ?? '').trim(),
    String(input.initials ?? '').trim(),
    input.hn ?? null,
    input.age ?? null,
    input.sex ?? null,
    input.diagnosis ?? null,
    input.treatment ?? null,
    input.allergy ?? null,
    'active',
    input.admitted_at || ts.slice(0, 10),
    ts, ts, user ?? null,
  );
  return getPatient(id);
}

function updatePatient(id, input, user) {
  const current = getPatient(id);
  if (!current) return null;
  const sets = [];
  const values = [];
  for (const f of PATIENT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      sets.push(`${f} = ?`);
      values.push(input[f] === '' ? null : input[f]);
    }
  }
  if (!sets.length) return current;
  sets.push('updated_at = ?', 'updated_by = ?');
  values.push(nowISO(), user ?? null, id);
  db.prepare(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getPatient(id);
}

function dischargePatient(id, user) {
  const ts = nowISO();
  db.prepare("UPDATE patients SET status='discharged', discharged_at=?, updated_at=?, updated_by=? WHERE id=?")
    .run(ts.slice(0, 10), ts, user ?? null, id);
  return getPatient(id);
}

function readmitPatient(id, user) {
  const ts = nowISO();
  db.prepare("UPDATE patients SET status='active', discharged_at=NULL, updated_at=?, updated_by=? WHERE id=?")
    .run(ts, user ?? null, id);
  return getPatient(id);
}

function deletePatient(id) {
  db.prepare('DELETE FROM patients WHERE id = ?').run(id);
}

/* ---------- SOAP ---------- */

function listNotes(patientId) {
  return db.prepare('SELECT * FROM soap_notes WHERE patient_id = ? ORDER BY note_date DESC, created_at DESC').all(patientId);
}

function getNote(id) {
  return db.prepare('SELECT * FROM soap_notes WHERE id = ?').get(id) ?? null;
}

function createNote(patientId, input, user) {
  if (!getPatient(patientId)) return null;
  const ts = nowISO();
  const id = newId();
  db.prepare(`INSERT INTO soap_notes
    (id, patient_id, note_date, round, subjective, objective, assessment, plan, author, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, patientId,
    input.note_date || ts.slice(0, 10),
    input.round ?? null,
    input.subjective ?? null,
    input.objective ?? null,
    input.assessment ?? null,
    input.plan ?? null,
    input.author || user || null,
    ts, ts,
  );
  return getNote(id);
}

function updateNote(id, input, user) {
  const current = getNote(id);
  if (!current) return null;
  const sets = [];
  const values = [];
  for (const f of ['note_date', 'round', 'subjective', 'objective', 'assessment', 'plan']) {
    if (Object.prototype.hasOwnProperty.call(input, f)) {
      sets.push(`${f} = ?`);
      values.push(input[f] === '' ? null : input[f]);
    }
  }
  sets.push('author = ?', 'updated_at = ?');
  values.push(input.author || current.author || user || null, nowISO(), id);
  db.prepare(`UPDATE soap_notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return getNote(id);
}

function deleteNote(id) {
  const note = getNote(id);
  db.prepare('DELETE FROM soap_notes WHERE id = ?').run(id);
  return note;
}

function notesForDate(date) {
  return db.prepare(`
    SELECT n.*, p.bed, p.initials
    FROM soap_notes n JOIN patients p ON p.id = n.patient_id
    WHERE n.note_date = ? ORDER BY p.bed`).all(date);
}


/* ---------- vitals ---------- */

const VITAL_FIELDS = ['bt', 'sbp', 'dbp', 'pr', 'rr', 'o2sat'];

function listVitals(patientId) {
  return db.prepare('SELECT * FROM vitals WHERE patient_id = ? ORDER BY measured_at, created_at').all(patientId);
}

function createVitals(patientId, input, user, source = 'manual') {
  if (!getPatient(patientId)) return null;
  const ts = nowISO();
  const id = newId();
  const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  db.prepare(`INSERT INTO vitals (id, patient_id, measured_at, bt, sbp, dbp, pr, rr, o2sat, note, author, source, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, patientId, input.measured_at || ts.slice(0, 16),
    ...VITAL_FIELDS.map((f) => num(input[f])),
    input.note ?? null, input.author || user || null, source, ts,
  );
  return db.prepare('SELECT * FROM vitals WHERE id = ?').get(id);
}

function deleteVitals(id) {
  const row = db.prepare('SELECT * FROM vitals WHERE id = ?').get(id);
  db.prepare('DELETE FROM vitals WHERE id = ?').run(id);
  return row ?? null;
}

/* ---------- labs ---------- */

function listLabs(patientId) {
  return db.prepare('SELECT * FROM labs WHERE patient_id = ? ORDER BY collected_at, created_at, name').all(patientId);
}

function createLab(patientId, input, user, source = 'manual') {
  if (!getPatient(patientId)) return null;
  const ts = nowISO();
  const id = newId();
  db.prepare(`INSERT INTO labs (id, patient_id, collected_at, name, value, unit, raw, author, source, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    id, patientId, input.collected_at || ts.slice(0, 10),
    String(input.name ?? '').trim(),
    input.value === '' || input.value === null || input.value === undefined ? null : Number(input.value),
    input.unit ?? null, input.raw ?? null, input.author || user || null, source, ts,
  );
  return db.prepare('SELECT * FROM labs WHERE id = ?').get(id);
}

function deleteLab(id) {
  const row = db.prepare('SELECT * FROM labs WHERE id = ?').get(id);
  db.prepare('DELETE FROM labs WHERE id = ?').run(id);
  return row ?? null;
}

/* ---------- events / timeline ---------- */

function listEvents(patientId) {
  return db.prepare('SELECT * FROM events WHERE patient_id = ? ORDER BY occurred_at DESC, created_at DESC').all(patientId);
}

function createEvent(patientId, input, user, auto = 0) {
  if (!getPatient(patientId)) return null;
  const ts = nowISO();
  const id = newId();
  db.prepare(`INSERT INTO events (id, patient_id, occurred_at, kind, title, detail, author, auto, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, patientId, input.occurred_at || ts.slice(0, 10),
    input.kind || 'note', String(input.title ?? '').trim() || 'บันทึกเหตุการณ์',
    input.detail ?? null, input.author || user || null, auto, ts,
  );
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id);
}

function deleteEvent(id) {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id);
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
  return row ?? null;
}

// รวมเหตุการณ์ + SOAP เป็นเส้นเวลาเดียว เรียงใหม่ไปเก่า
function timeline(patientId) {
  const events = listEvents(patientId).map((e) => ({
    at: e.occurred_at, kind: e.kind, title: e.title, detail: e.detail,
    author: e.author, auto: e.auto, id: e.id, type: 'event',
  }));
  const notes = listNotes(patientId).map((n) => ({
    at: n.note_date, kind: 'soap', title: `SOAP${n.round ? ` (${n.round})` : ''}`,
    detail: [n.subjective && `S: ${n.subjective}`, n.objective && `O: ${n.objective}`,
      n.assessment && `A: ${n.assessment}`, n.plan && `P: ${n.plan}`].filter(Boolean).join('\n'),
    author: n.author, auto: 0, id: n.id, type: 'soap',
  }));
  return [...events, ...notes].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

module.exports = {
  db, DB_PATH, nowISO,
  listPatients, getPatient, createPatient, updatePatient, dischargePatient, readmitPatient, deletePatient,
  listNotes, getNote, createNote, updateNote, deleteNote, notesForDate,
  listVitals, createVitals, deleteVitals,
  listLabs, createLab, deleteLab,
  listEvents, createEvent, deleteEvent, timeline,
};
