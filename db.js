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

db.exec(`
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
`);

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

module.exports = {
  db, DB_PATH, nowISO,
  listPatients, getPatient, createPatient, updatePatient, dischargePatient, readmitPatient, deletePatient,
  listNotes, getNote, createNote, updateNote, deleteNote, notesForDate,
};
