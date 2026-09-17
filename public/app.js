'use strict';

const $ = (sel) => document.querySelector(sel);
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD ตามเวลาเครื่อง

const state = {
  user: null,
  patients: [],
  openId: null,       // ผู้ป่วยที่เปิด drawer อยู่
  patient: null,      // ข้อมูลผู้ป่วยที่เปิดอยู่ (ใช้กับหน้าประวัติเต็มจอ)
  notes: [],
  editingNoteId: null,
  vitals: [],
  labs: [],
  timeline: [],
  problems: [],
  investigations: [],
  ranges: { vitals: {}, labs: {} },
  tab: 'info',
  parsed: null,
};

/* ---------------- utils ---------------- */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('กรุณาเข้าสู่ระบบอีกครั้ง'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) out[k] = typeof v === 'string' ? v.trim() : v;
  return out;
}

/* ---------------- auth ---------------- */
function showLogin() {
  state.user = null;
  $('#app').hidden = true;
  $('#drawer').hidden = true;
  $('#login').hidden = false;
}

function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#who').textContent = state.user;
}

// แสดงเวอร์ชันของโค้ดที่เครื่องนี้รันอยู่ ใช้ยืนยันว่าดึงของใหม่มาแล้วจริง
function showBuild(build) {
  if (!build?.commit) return;
  const text = `เวอร์ชัน ${build.commit}${build.date ? ` · ${build.date}` : ''}`;
  $('#build').textContent = text;
  $('#build-login').textContent = text;
}

(async () => {
  try { showBuild(await (await fetch('/api/version')).json()); } catch { /* ไม่สำคัญพอจะรบกวนผู้ใช้ */ }
})();

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    const { user } = await api('POST', '/api/login', formData(e.target));
    state.user = user;
    e.target.reset();
    showApp();
    state.ranges = await api('GET', '/api/ranges');
    await refresh();
    connectStream();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  if (stream) stream.close();
  showLogin();
});

/* ---------------- realtime (SSE) ---------------- */
let stream = null;

function setLive(status, text) {
  const el = $('#live');
  el.classList.toggle('on', status === 'on');
  el.classList.toggle('off', status === 'off');
  $('#live-text').textContent = text;
}

function connectStream() {
  if (stream) stream.close();
  stream = new EventSource('/api/stream');

  stream.addEventListener('hello', (e) => {
    setLive('on', `real-time • ${JSON.parse(e.data).viewers} เครื่อง`);
  });
  stream.addEventListener('viewers', (e) => {
    setLive('on', `real-time • ${JSON.parse(e.data).viewers} เครื่อง`);
  });
  stream.onerror = () => setLive('off', 'ขาดการเชื่อมต่อ — กำลังลองใหม่…');

  const touched = (by) => by && by !== state.user;

  stream.addEventListener('patient:created', (e) => {
    const { patient, by } = JSON.parse(e.data);
    upsertPatient(patient);
    render();
    if (touched(by)) toast(`${by} รับผู้ป่วยใหม่ เตียง ${patient.bed}`);
  });

  stream.addEventListener('patient:updated', (e) => {
    const { patient, by } = JSON.parse(e.data);
    upsertPatient(patient);
    render();
    if (state.openId === patient.id) {
      Object.assign(state.patient ?? {}, patient);
      fillPatientForm(patient);
      // หน้าเต็มจอที่เปิดค้างอยู่ต้องไม่ค้างข้อมูลเก่า (ยกเว้นกำลังพิมพ์แก้อยู่ จะไม่ทับของที่พิมพ์)
      if (!$('#modal-history').hidden && $('#hx-save').hidden) hxRead(state.patient);
    }
    if (touched(by)) toast(`${by} แก้ข้อมูลเตียง ${patient.bed}`);
  });

  // จำนวนปัญหา active และผลที่รออยู่ โชว์บนการ์ดเตียง จึงต้องรีเฟรชกระดานด้วย
  stream.addEventListener('patient:refresh', async () => { await refresh({ keepOpen: false }); });

  stream.addEventListener('patient:deleted', (e) => {
    const { id, by } = JSON.parse(e.data);
    state.patients = state.patients.filter((p) => p.id !== id);
    if (state.openId === id) closeDrawer();
    render();
    if (touched(by)) toast(`${by} ลบผู้ป่วย 1 ราย`);
  });

  stream.addEventListener('cases:imported', async (e) => {
    const { beds, by } = JSON.parse(e.data);
    await refresh();
    if (by && by !== state.user) toast(`${by} นำเข้าเคสใหม่ ${beds.length} เตียง`);
  });

  for (const ev of ['vitals:changed', 'labs:changed', 'timeline:changed', 'problems:changed', 'ix:changed']) {
    stream.addEventListener(ev, async (e) => {
      const { patient_id: pid, by } = JSON.parse(e.data);
      if (state.openId === pid) await loadClinical(pid);
      if (by && by !== state.user && state.openId === pid) toast(`${by} อัปเดตข้อมูลผู้ป่วยรายนี้`);
    });
  }

  for (const ev of ['note:created', 'note:updated', 'note:deleted']) {
    stream.addEventListener(ev, async (e) => {
      const data = JSON.parse(e.data);
      const pid = data.note?.patient_id || data.patient_id;
      await refresh({ keepOpen: true });
      if (touched(data.by)) {
        const p = state.patients.find((x) => x.id === pid);
        toast(`${data.by} ${ev === 'note:deleted' ? 'ลบ' : 'บันทึก'} SOAP${p ? ` เตียง ${p.bed}` : ''}`);
      }
    });
  }
}

function upsertPatient(patient) {
  const i = state.patients.findIndex((p) => p.id === patient.id);
  const prev = i >= 0 ? state.patients[i] : {};
  const merged = { soap_count: 0, last_soap_date: null, ...prev, ...patient };
  if (i >= 0) state.patients[i] = merged; else state.patients.push(merged);
}

/* ---------------- data ---------------- */
async function refresh({ keepOpen = false } = {}) {
  const all = $('#show-discharged').checked ? '?all=1' : '';
  state.patients = await api('GET', `/api/patients${all}`);
  render();
  if (keepOpen && state.openId) {
    const p = state.patients.find((x) => x.id === state.openId);
    if (p) await openPatient(state.openId, { silent: true });
  }
}

/* ---------------- dashboard ---------------- */
function visiblePatients() {
  const q = $('#search').value.trim().toLowerCase();
  const onlyPending = $('#only-pending').checked;
  const d = today();
  return state.patients.filter((p) => {
    if (onlyPending && (p.last_soap_date === d || p.status !== 'active')) return false;
    if (!q) return true;
    return [p.bed, p.initials, p.diagnosis, p.treatment].some((v) => String(v ?? '').toLowerCase().includes(q));
  });
}

// เวชระเบียนมักบันทึกว่า "ไม่แพ้" ด้วยคำหลายแบบ ต้องไม่เอาไปขึ้นป้ายแดงว่าแพ้ยานั้น
const NO_ALLERGY = /^(nka|nkda|none|negative|neg|deny|denied|ปฏิเสธ(การแพ้ยา)?|ไม่มี|ไม่แพ้|-|–|—)$/i;

function allergyBadge(value) {
  const v = String(value ?? '').trim();
  if (!v) return '';
  if (NO_ALLERGY.test(v)) return '<span class="badge ok">ไม่มีประวัติแพ้ยา</span>';
  return `<span class="badge allergy">⚠ แพ้ ${esc(v)}</span>`;
}

function bedSort(a, b) {
  if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
  const na = parseInt(a.bed, 10); const nb = parseInt(b.bed, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return String(a.bed).localeCompare(String(b.bed), 'th');
}

function render() {
  const list = visiblePatients().slice().sort(bedSort);
  const d = today();

  const active = state.patients.filter((p) => p.status === 'active');
  $('#stat-active').textContent = active.length;
  $('#stat-today').textContent = active.filter((p) => p.last_soap_date === d).length;
  $('#stat-pending').textContent = active.filter((p) => p.last_soap_date !== d).length;

  $('#board').innerHTML = list.map((p) => {
    const dc = p.status !== 'active';
    const done = p.last_soap_date === d;
    return `<article class="bed ${dc ? 'dc' : done ? '' : 'pending'}" data-id="${p.id}" tabindex="0">
      <div class="bed-top">
        <span class="bed-chip">เตียง ${esc(p.bed)}</span>
        <span class="bed-name">${esc(p.initials)}</span>
        <span class="bed-meta">${esc([p.age, p.sex].filter(Boolean).join(' · '))}</span>
      </div>
      <div class="field"><span>Diagnosis</span>${esc(p.diagnosis) || '<i class="muted">—</i>'}</div>
      <div class="field"><span>การรักษา</span>${esc(p.treatment) || '<i class="muted">—</i>'}</div>
      <div class="badges">
        ${dc ? `<span class="badge">D/C ${esc(p.discharged_at ?? '')}</span>`
              : done ? '<span class="badge ok">✓ SOAP วันนี้</span>' : '<span class="badge warn">ยังไม่มี SOAP วันนี้</span>'}
        ${allergyBadge(p.allergy)}
        ${p.active_problems ? `<span class="badge">${p.active_problems} ปัญหา</span>` : ''}
        ${p.pending_ix ? `<span class="badge warn">⏳ รอผล ${p.pending_ix}</span>` : ''}
        <span class="badge">SOAP ${p.soap_count} ครั้ง</span>
      </div>
    </article>`;
  }).join('');

  $('#empty').hidden = list.length > 0;
  if (list.length === 0 && state.patients.length > 0) $('#empty').textContent = 'ไม่พบผู้ป่วยตามเงื่อนไขที่กรอง';
  else $('#empty').textContent = 'ยังไม่มีผู้ป่วยในหอ — กด “รับผู้ป่วยใหม่” เพื่อเริ่ม';
}

$('#board').addEventListener('click', (e) => {
  const card = e.target.closest('.bed');
  if (card) openPatient(card.dataset.id);
});
$('#board').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('bed')) openPatient(e.target.dataset.id);
});
$('#search').addEventListener('input', render);
$('#only-pending').addEventListener('change', render);
$('#show-discharged').addEventListener('change', () => refresh({ keepOpen: true }));

/* ---------------- patient drawer ---------------- */
function fillPatientForm(p) {
  const f = $('#patient-form');
  for (const k of ['bed', 'initials', 'age', 'sex', 'diagnosis', 'treatment', 'allergy', 'admitted_at',
    'underlying', 'chief_complaint', 'present_illness', 'past_history', 'physical_exam']) {
    if (f.elements[k]) f.elements[k].value = p[k] ?? '';
  }
  $('#d-bed').textContent = `เตียง ${p.bed}`;
  $('#d-title').textContent = p.initials;
  $('#d-sub').textContent = [p.age, p.sex, p.admitted_at && `admit ${p.admitted_at}`,
    p.status !== 'active' && `D/C ${p.discharged_at ?? ''}`].filter(Boolean).join(' · ');
  $('#btn-discharge').hidden = p.status !== 'active';
  $('#btn-readmit').hidden = p.status === 'active';
}

async function openPatient(id, { silent = false } = {}) {
  const data = await api('GET', `/api/patients/${id}`);
  state.openId = id;
  state.patient = data;
  state.notes = data.notes;
  fillPatientForm(data);
  renderNotes();
  $('#drawer').hidden = false;
  if (!silent) {
    $('#note-form').hidden = true;
    showTab('info');
  }
  await loadClinical(id);
}

async function loadClinical(id) {
  const [vitals, labs, timeline, problems, investigations] = await Promise.all([
    api('GET', `/api/patients/${id}/vitals`),
    api('GET', `/api/patients/${id}/labs`),
    api('GET', `/api/patients/${id}/timeline`),
    api('GET', `/api/patients/${id}/problems`),
    api('GET', `/api/patients/${id}/investigations`),
  ]);
  if (state.openId !== id) return;      // ผู้ใช้เปลี่ยนผู้ป่วยระหว่างโหลด
  state.vitals = vitals;
  state.labs = labs;
  state.timeline = timeline;
  state.problems = problems;
  state.investigations = investigations;
  renderVitals();
  renderLabs();
  renderTimeline();
  renderProblems();
  renderInvestigations();
}

/* ---------------- tabs ---------------- */
function showTab(name) {
  state.tab = name;
  for (const btn of document.querySelectorAll('#tabs .tab')) btn.classList.toggle('active', btn.dataset.tab === name);
  for (const panel of document.querySelectorAll('.panel')) panel.hidden = panel.dataset.panel !== name;
}

$('#tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) showTab(btn.dataset.tab);
});

function closeDrawer() {
  $('#drawer').hidden = true;
  state.openId = null;
  state.editingNoteId = null;
  state.vitals = [];
  state.labs = [];
  state.timeline = [];
  state.problems = [];
  state.investigations = [];
  $('#note-form').hidden = true;
}

function renderNotes() {
  const byDate = new Map();
  for (const n of state.notes) {
    if (!byDate.has(n.note_date)) byDate.set(n.note_date, []);
    byDate.get(n.note_date).push(n);
  }
  if (!state.notes.length) {
    $('#note-list').innerHTML = '<p class="muted">ยังไม่มีบันทึก SOAP</p>';
    return;
  }
  const part = (label, text) => (text ? `<div><b>${label}</b><p>${esc(text)}</p></div>` : '');
  $('#note-list').innerHTML = [...byDate.entries()].map(([date, notes]) => notes.map((n) => `
    <div class="note" data-id="${n.id}">
      <div class="note-head">
        <b>${esc(date)}</b>
        ${n.round ? `<span>· ${esc(n.round)}</span>` : ''}
        ${n.author ? `<span>· ${esc(n.author)}</span>` : ''}
        <span class="spacer"></span>
        <button class="ghost mini" data-edit="${n.id}">แก้ไข</button>
        <button class="danger mini" data-del="${n.id}">ลบ</button>
      </div>
      <div class="soap">
        ${part('S', n.subjective)}${part('O', n.objective)}${part('A', n.assessment)}${part('P', n.plan)}
      </div>
    </div>`).join('')).join('');
}

$('#patient-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('PATCH', `/api/patients/${state.openId}`, formData(e.target));
    toast('บันทึกข้อมูลผู้ป่วยแล้ว');
  } catch (ex) { toast(ex.message); }
});

$('#btn-discharge').addEventListener('click', async () => {
  if (!confirm('ยืนยัน D/C ผู้ป่วยรายนี้?')) return;
  await api('POST', `/api/patients/${state.openId}/discharge`);
  toast('D/C แล้ว');
  await refresh({ keepOpen: true });
});

$('#btn-readmit').addEventListener('click', async () => {
  await api('POST', `/api/patients/${state.openId}/readmit`);
  toast('กลับเข้ารักษาแล้ว');
  await refresh({ keepOpen: true });
});

$('#btn-delete').addEventListener('click', async () => {
  if (!confirm('ลบผู้ป่วยรายนี้และบันทึก SOAP ทั้งหมด? การลบไม่สามารถย้อนกลับได้')) return;
  const id = state.openId;
  closeDrawer();
  await api('DELETE', `/api/patients/${id}`);
  toast('ลบแล้ว');
});

/* ---------------- SOAP form ---------------- */
$('#btn-new-note').addEventListener('click', () => {
  const f = $('#note-form');
  f.reset();
  state.editingNoteId = null;
  f.elements.note_date.value = today();
  f.hidden = false;
  f.elements.subjective.focus();
});

$('#btn-cancel-note').addEventListener('click', () => {
  $('#note-form').hidden = true;
  state.editingNoteId = null;
});

$('#note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  try {
    if (state.editingNoteId) await api('PATCH', `/api/notes/${state.editingNoteId}`, body);
    else await api('POST', `/api/patients/${state.openId}/notes`, body);
    state.editingNoteId = null;
    e.target.hidden = true;
    toast('บันทึก SOAP แล้ว');
  } catch (ex) { toast(ex.message); }
});

$('#note-list').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    const n = state.notes.find((x) => x.id === editId);
    const f = $('#note-form');
    for (const k of ['note_date', 'round', 'subjective', 'objective', 'assessment', 'plan']) f.elements[k].value = n[k] ?? '';
    state.editingNoteId = editId;
    f.hidden = false;
    f.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  if (delId) {
    if (!confirm('ลบบันทึก SOAP นี้?')) return;
    await api('DELETE', `/api/notes/${delId}`);
    toast('ลบบันทึกแล้ว');
  }
});


/* ================= V/S & Lab : กราฟแนวโน้ม =================
   ใช้กราฟเล็กแยกหนึ่งค่าต่อหนึ่งกราฟ (small multiples) ไม่ใช้กราฟสองแกน
   เพราะ BT 37 กับ BP 120 คนละสเกล ถ้าซ้อนแกนเดียวกันจะอ่านผิด          */

const VS_SERIES = [
  { key: 'bt', label: 'BT', unit: '°C' },
  { key: 'sbp', label: 'BP ตัวบน (SBP)', unit: 'mmHg' },
  { key: 'dbp', label: 'BP ตัวล่าง (DBP)', unit: 'mmHg' },
  { key: 'pr', label: 'PR', unit: '/min' },
  { key: 'rr', label: 'RR', unit: '/min' },
  { key: 'o2sat', label: 'O2sat', unit: '%' },
];

function flagOf(range, value) {
  if (!range || value === null || value === undefined || Number.isNaN(value)) return null;
  if (range.low !== null && range.low !== undefined && value < range.low) return 'low';
  if (range.high !== null && range.high !== undefined && value > range.high) return 'high';
  return 'normal';
}

const FLAG_TEXT = { low: 'ต่ำ', high: 'สูง', normal: '' };
const FLAG_MARK = { low: '▼', high: '▲', normal: '' };

/** กราฟเส้นหนึ่งค่า: จุด >=8px, เส้น 2px, แถบช่วงอ้างอิงเป็นสีเทาถอยหลัง, hover มีรายละเอียด */
function lineChart({ points, range, unit, label }) {
  const W = 260; const H = 84;
  const PAD = { t: 10, r: 10, b: 16, l: 34 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  const values = points.map((p) => p.value);
  const lo = Math.min(...values, range?.low ?? Infinity);
  const hi = Math.max(...values, range?.high ?? -Infinity);
  const pad = (hi - lo) * 0.15 || Math.max(Math.abs(hi) * 0.05, 1);
  const min = lo - pad;
  const max = hi + pad;
  const x = (i) => PAD.l + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD.t + plotH - ((v - min) / (max - min || 1)) * plotH;

  let band = '';
  if (range && (range.low != null || range.high != null)) {
    const top = y(range.high ?? max);
    const bottom = y(range.low ?? min);
    band = `<rect class="band" x="${PAD.l}" y="${Math.min(top, bottom)}" width="${plotW}"
      height="${Math.max(Math.abs(bottom - top), 1)}"></rect>`;
  }

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const dots = points.map((p, i) => {
    const f = flagOf(range, p.value);
    return `<circle class="dot ${f || ''}" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="4"
      tabindex="0"><title>${esc(p.at)} — ${p.value}${unit ? ' ' + unit : ''}${
      f && f !== 'normal' ? ` (${FLAG_TEXT[f]}กว่าค่าอ้างอิง)` : ''}</title></circle>`;
  }).join('');

  const last = points[points.length - 1];
  const lastFlag = flagOf(range, last.value);
  return `<figure class="chart">
    <figcaption>
      <span class="chart-label">${esc(label)}</span>
      <span class="chart-last ${lastFlag || ''}">${last.value}<small>${unit ? ' ' + unit : ''}</small>${
        lastFlag && lastFlag !== 'normal' ? ` <b>${FLAG_MARK[lastFlag]} ${FLAG_TEXT[lastFlag]}</b>` : ''}</span>
    </figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="แนวโน้ม ${esc(label)}" preserveAspectRatio="none">
      ${band}
      <line class="axis" x1="${PAD.l}" y1="${PAD.t + plotH}" x2="${W - PAD.r}" y2="${PAD.t + plotH}"></line>
      <text class="tick" x="${PAD.l - 4}" y="${PAD.t + 4}">${Number(max.toFixed(1))}</text>
      <text class="tick" x="${PAD.l - 4}" y="${PAD.t + plotH}">${Number(min.toFixed(1))}</text>
      ${points.length > 1 ? `<path class="line" d="${path}"></path>` : ''}
      ${dots}
    </svg>
    <figcaption class="chart-range muted">${
      range ? `ค่าอ้างอิง ${range.low ?? '–'}–${range.high ?? '–'}${unit ? ' ' + unit : ''}` : ''
    } · ${points.length} ครั้ง</figcaption>
  </figure>`;
}

function renderVitals() {
  const rows = state.vitals;
  const box = $('#vs-charts');
  if (!rows.length) {
    box.innerHTML = '<p class="muted">ยังไม่มีข้อมูล V/S</p>';
    $('#vs-table').innerHTML = '';
    return;
  }
  box.innerHTML = VS_SERIES.map(({ key, label, unit }) => {
    const points = rows.filter((r) => r[key] !== null && r[key] !== undefined)
      .map((r) => ({ at: String(r.measured_at).replace('T', ' '), value: r[key] }));
    if (!points.length) return '';
    return lineChart({ points, range: state.ranges.vitals?.[key], unit, label });
  }).join('') || '<p class="muted">ยังไม่มีค่าที่บันทึกไว้</p>';

  $('#vs-table').innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>วันเวลา</th>${VS_SERIES.map((s) => `<th>${s.label}</th>`).join('')}<th></th></tr></thead>
    <tbody>${rows.slice().reverse().map((r) => `<tr>
      <td>${esc(String(r.measured_at).replace('T', ' '))}</td>
      ${VS_SERIES.map((s) => {
        const f = flagOf(state.ranges.vitals?.[s.key], r[s.key]);
        return `<td class="${f || ''}">${r[s.key] ?? '–'}${f && f !== 'normal' ? ` ${FLAG_MARK[f]}` : ''}</td>`;
      }).join('')}
      <td><button class="danger mini" data-del-vitals="${r.id}">ลบ</button></td>
    </tr>`).join('')}</tbody></table></div>`;
}

function renderLabs() {
  const rows = state.labs;
  const box = $('#lab-charts');
  if (!rows.length) {
    box.innerHTML = '<p class="muted">ยังไม่มีผล Lab</p>';
    $('#lab-table').innerHTML = '';
    return;
  }
  const byName = new Map();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name).push(r);
  }
  box.innerHTML = [...byName.entries()].map(([name, list]) => {
    const points = list.filter((r) => r.value !== null).map((r) => ({ at: r.collected_at, value: r.value }));
    if (!points.length) return '';
    return lineChart({ points, range: state.ranges.labs?.[name], unit: list[0].unit, label: name });
  }).join('');

  const dates = [...new Set(rows.map((r) => String(r.collected_at).slice(0, 10)))].sort().reverse();
  const names = [...byName.keys()];
  $('#lab-table').innerHTML = `<div class="table-scroll"><table>
    <thead><tr><th>Lab</th>${dates.map((d) => `<th>${esc(d)}</th>`).join('')}</tr></thead>
    <tbody>${names.map((n) => `<tr><td><b>${esc(n)}</b></td>${dates.map((d) => {
      const hit = rows.find((r) => r.name === n && String(r.collected_at).slice(0, 10) === d);
      if (!hit) return '<td>–</td>';
      const f = flagOf(state.ranges.labs?.[n], hit.value);
      return `<td class="${f || ''}">${hit.value}${f && f !== 'normal' ? ` ${FLAG_MARK[f]}` : ''}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/* ================= Timeline ================= */

const KIND_LABEL = {
  admit: { icon: '🏥', text: 'Admit' },
  diagnosis: { icon: '🩺', text: 'Diagnosis' },
  procedure: { icon: '🔧', text: 'หัตถการ' },
  consult: { icon: '📞', text: 'Consult' },
  complication: { icon: '⚠️', text: 'ภาวะแทรกซ้อน' },
  transfer: { icon: '🚚', text: 'ย้ายหอผู้ป่วย' },
  discharge: { icon: '🏠', text: 'D/C' },
  import: { icon: '📥', text: 'นำเข้าข้อมูล' },
  soap: { icon: '📝', text: 'SOAP' },
  note: { icon: '•', text: 'บันทึก' },
};

function renderTimeline() {
  const items = state.timeline;
  if (!items.length) {
    $('#timeline').innerHTML = '<p class="muted">ยังไม่มีเหตุการณ์</p>';
    return;
  }
  $('#timeline').innerHTML = items.map((it) => {
    const k = KIND_LABEL[it.kind] ?? KIND_LABEL.note;
    return `<div class="tl-item kind-${esc(it.kind)}">
      <div class="tl-marker" aria-hidden="true">${k.icon}</div>
      <div class="tl-body">
        <div class="tl-head">
          <b>${esc(it.title)}</b>
          <span class="badge">${k.text}</span>
          <span class="spacer"></span>
          <span class="muted">${esc(it.at)}${it.author ? ` · ${esc(it.author)}` : ''}</span>
          ${it.type === 'event' && !it.auto ? `<button class="danger mini" data-del-event="${it.id}">ลบ</button>` : ''}
        </div>
        ${it.detail ? `<p class="tl-detail">${esc(it.detail)}</p>` : ''}
      </div>
    </div>`;
  }).join('');
}

/* ---------------- add patient ---------------- */
$('#btn-add').addEventListener('click', () => {
  const f = $('#add-form');
  f.reset();
  f.elements.admitted_at.value = today();
  $('#add-error').hidden = true;
  $('#modal-add').hidden = false;
  f.elements.bed.focus();
});

$('#add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const p = await api('POST', '/api/patients', formData(e.target));
    $('#modal-add').hidden = true;
    toast(`รับผู้ป่วยเตียง ${p.bed} แล้ว`);
    openPatient(p.id);
  } catch (ex) {
    $('#add-error').textContent = ex.message;
    $('#add-error').hidden = false;
  }
});


/* ---------------- V/S, Lab, เหตุการณ์ ---------------- */
function nowLocalDateTime() {
  const d = new Date();
  return `${today()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function openSubForm(formSel, presets = {}) {
  const f = $(formSel);
  f.reset();
  for (const [k, v] of Object.entries(presets)) if (f.elements[k]) f.elements[k].value = v;
  f.hidden = false;
  return f;
}

$('#btn-new-vitals').addEventListener('click', () => openSubForm('#vitals-form', { measured_at: nowLocalDateTime() }));
$('#btn-new-lab').addEventListener('click', () => openSubForm('#lab-form', { collected_at: today() }));
$('#btn-new-event').addEventListener('click', () => openSubForm('#event-form', { occurred_at: today() }));

document.addEventListener('click', (e) => {
  const cancel = e.target.dataset?.cancel;
  if (cancel) $(`#${cancel}`).hidden = true;
});

$('#vitals-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  if (!VS_SERIES.some(({ key }) => body[key] !== '')) return toast('กรอกอย่างน้อย 1 ค่า');
  try {
    await api('POST', `/api/patients/${state.openId}/vitals`, body);
    e.target.hidden = true;
    toast('บันทึก V/S แล้ว');
  } catch (ex) { toast(ex.message); }
});

$('#lab-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', `/api/patients/${state.openId}/labs`, formData(e.target));
    e.target.hidden = true;
    toast('บันทึก Lab แล้ว');
  } catch (ex) { toast(ex.message); }
});

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', `/api/patients/${state.openId}/events`, formData(e.target));
    e.target.hidden = true;
    toast('เพิ่มเหตุการณ์แล้ว');
  } catch (ex) { toast(ex.message); }
});

document.addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset?.delVitals) {
      if (confirm('ลบค่า V/S ชุดนี้?')) await api('DELETE', `/api/vitals/${t.dataset.delVitals}`);
    } else if (t.dataset?.delEvent) {
      if (confirm('ลบเหตุการณ์นี้?')) await api('DELETE', `/api/events/${t.dataset.delEvent}`);
    }
  } catch (ex) { toast(ex.message); }
});


/* ================= Problem list ================= */

const PROBLEM_STATUS = {
  active: { text: 'กำลังรักษา', cls: 'active' },
  monitoring: { text: 'เฝ้าติดตาม', cls: 'monitoring' },
  resolved: { text: 'แก้ไขแล้ว', cls: 'resolved' },
};

function renderProblems() {
  const box = $('#problem-list');
  if (!state.problems.length) {
    box.innerHTML = '<p class="muted">ยังไม่มี problem list</p>';
    return;
  }
  box.innerHTML = state.problems.map((pb, i) => {
    const st = PROBLEM_STATUS[pb.status] ?? PROBLEM_STATUS.active;
    return `<div class="problem st-${st.cls}">
      <div class="problem-head">
        <span class="problem-no">${i + 1}</span>
        <b>${esc(pb.title)}</b>
        <span class="badge ${st.cls}">${st.text}</span>
        <span class="spacer"></span>
        <button class="ghost mini" data-edit-problem="${pb.id}">แก้ไข</button>
        <button class="danger mini" data-del-problem="${pb.id}">ลบ</button>
      </div>
      <div class="muted problem-date">${pb.started_at ? `เริ่ม ${esc(pb.started_at)}` : ''}${
        pb.resolved_at ? ` · ปิด ${esc(pb.resolved_at)}` : ''}${pb.author ? ` · ${esc(pb.author)}` : ''}</div>
      ${pb.detail ? `<p class="problem-body">${esc(pb.detail)}</p>` : ''}
      ${pb.plan ? `<p class="problem-body plan"><b>Mx:</b> ${esc(pb.plan)}</p>` : ''}
    </div>`;
  }).join('');
}

$('#btn-new-problem').addEventListener('click', () => {
  const f = openSubForm('#problem-form', { started_at: today(), status: 'active' });
  f.elements.id.value = '';
  f.elements.title.focus();
});

$('#problem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const id = body.id;
  delete body.id;
  try {
    if (id) await api('PATCH', `/api/problems/${id}`, body);
    else await api('POST', `/api/patients/${state.openId}/problems`, body);
    e.target.hidden = true;
    toast('บันทึกปัญหาแล้ว');
  } catch (ex) { toast(ex.message); }
});

/* ================= Investigation ================= */

const IX_CATEGORY = {
  imaging: { icon: '🩻', text: 'Imaging' },
  culture: { icon: '🧫', text: 'Culture' },
  patho: { icon: '🔬', text: 'ผลชิ้นเนื้อ' },
  other: { icon: '📄', text: 'อื่น ๆ' },
};

function renderInvestigations() {
  const box = $('#ix-list');
  if (!state.investigations.length) {
    box.innerHTML = '<p class="muted">ยังไม่มีผล imaging / patho / culture</p>';
    return;
  }
  const pending = state.investigations.filter((i) => i.status === 'pending');
  const head = pending.length
    ? `<p class="pending-note">⏳ รอผลอยู่ ${pending.length} รายการ — ${
        esc(pending.map((i) => i.name).join(', '))}</p>`
    : '';
  box.innerHTML = head + state.investigations.map((ix) => {
    const cat = IX_CATEGORY[ix.category] ?? IX_CATEGORY.other;
    return `<div class="ix ${ix.status === 'pending' ? 'pending' : ''}">
      <div class="ix-head">
        <span aria-hidden="true">${cat.icon}</span>
        <b>${esc(ix.name)}</b>
        <span class="badge">${cat.text}</span>
        ${ix.status === 'pending' ? '<span class="badge warn">⏳ รอผล</span>' : ''}
        <span class="spacer"></span>
        <span class="muted">${esc(ix.performed_at)}</span>
        <button class="ghost mini" data-edit-ix="${ix.id}">แก้ไข</button>
        <button class="danger mini" data-del-ix="${ix.id}">ลบ</button>
      </div>
      ${ix.result ? `<p class="ix-result">${esc(ix.result)}</p>` : ''}
      ${ix.organism ? `<p class="ix-result"><b>เชื้อ:</b> ${esc(ix.organism)}</p>` : ''}
      ${ix.sensitivity ? `<p class="ix-result"><b>ไวต่อ:</b> ${esc(ix.sensitivity)}</p>` : ''}
    </div>`;
  }).join('');
}

// ช่องเชื้อ/ความไวต่อยา โผล่เฉพาะตอนเลือก culture
function syncCultureFields() {
  const f = $('#ix-form');
  f.querySelector('.culture-only').hidden = f.elements.category.value !== 'culture';
}

$('#ix-form').elements.category.addEventListener('change', syncCultureFields);

$('#btn-new-ix').addEventListener('click', () => {
  const f = openSubForm('#ix-form', { performed_at: today(), category: 'imaging', status: 'final' });
  f.elements.id.value = '';
  syncCultureFields();
  f.elements.name.focus();
});

$('#ix-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const id = body.id;
  delete body.id;
  try {
    if (id) await api('PATCH', `/api/investigations/${id}`, body);
    else await api('POST', `/api/patients/${state.openId}/investigations`, body);
    e.target.hidden = true;
    toast('บันทึกผลตรวจแล้ว');
  } catch (ex) { toast(ex.message); }
});

// แก้ไข / ลบ ของทั้งสองรายการ
document.addEventListener('click', async (e) => {
  const t = e.target;
  try {
    if (t.dataset?.editProblem) {
      const pb = state.problems.find((x) => x.id === t.dataset.editProblem);
      const f = openSubForm('#problem-form');
      for (const k of ['id', 'title', 'status', 'detail', 'plan', 'started_at']) f.elements[k].value = pb[k] ?? '';
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.dataset?.delProblem) {
      if (confirm('ลบปัญหานี้?')) await api('DELETE', `/api/problems/${t.dataset.delProblem}`);
    } else if (t.dataset?.editIx) {
      const ix = state.investigations.find((x) => x.id === t.dataset.editIx);
      const f = openSubForm('#ix-form');
      for (const k of ['id', 'performed_at', 'category', 'name', 'status', 'result', 'organism', 'sensitivity']) {
        f.elements[k].value = ix[k] ?? '';
      }
      syncCultureFields();
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (t.dataset?.delIx) {
      if (confirm('ลบผลตรวจนี้?')) await api('DELETE', `/api/investigations/${t.dataset.delIx}`);
    }
  } catch (ex) { toast(ex.message); }
});

/* ---------------- นำเข้าจากข้อความโรงพยาบาล ---------------- */
$('#btn-clear-import').addEventListener('click', () => {
  $('#import-text').value = '';
  $('#import-preview').innerHTML = '';
  state.parsed = null;
});

$('#btn-parse').addEventListener('click', async () => {
  const text = $('#import-text').value.trim();
  if (!text) return toast('วางข้อความก่อน');
  const parsed = await api('POST', '/api/parse', { text });
  state.parsed = parsed;
  renderImportPreview(parsed);
});

function renderImportPreview(parsed) {
  const box = $('#import-preview');
  if (!parsed.found) {
    box.innerHTML = `<p class="error">ไม่พบตัวเลข V/S หรือ Lab ที่อ่านได้ในข้อความนี้
      — ลองวางเฉพาะส่วนที่เป็นค่าตรวจ หรือกรอกเองในแท็บ V/S &amp; Lab</p>`;
    return;
  }
  const v = parsed.vitals ?? {};
  const vsRows = VS_SERIES.filter(({ key }) => v[key] !== undefined).map(({ key, label, unit }) => {
    const f = flagOf(state.ranges.vitals?.[key], v[key]);
    return `<label class="check imp-row"><input type="checkbox" data-vs="${key}" checked>
      <span>${label} <b>${v[key]}</b> <small>${unit}</small>${
        f && f !== 'normal' ? ` <em class="${f}">${FLAG_MARK[f]} ${FLAG_TEXT[f]}</em>` : ''}</span></label>`;
  }).join('');

  const labRows = parsed.labs.map((l, i) => {
    const f = flagOf(state.ranges.labs?.[l.name], l.value);
    return `<label class="check imp-row"><input type="checkbox" data-lab="${i}" checked>
      <span>${esc(l.name)} <b>${l.value}</b> <small>${esc(l.unit ?? '')}</small>${
        f && f !== 'normal' ? ` <em class="${f}">${FLAG_MARK[f]} ${FLAG_TEXT[f]}</em>` : ''}
      <small class="muted">จาก “${esc(l.raw)}”</small></span></label>`;
  }).join('');

  box.innerHTML = `
    <div class="import-box">
      <div class="row">
        <label>วันที่ของค่าเหล่านี้<input type="date" id="import-date" value="${parsed.date || today()}"></label>
        <label>เวลา (ถ้ามี)<input type="time" id="import-time" value="${parsed.time || ''}"></label>
      </div>
      ${vsRows ? `<h4>Vital signs</h4>${vsRows}` : ''}
      ${labRows ? `<h4>Lab (${parsed.labs.length} ค่า)</h4>${labRows}` : ''}
      <div class="row">
        <button class="primary" id="btn-import-save">บันทึกรายการที่เลือก</button>
        <span class="muted">ตรวจให้ตรงกับต้นฉบับก่อนกดบันทึก</span>
      </div>
    </div>`;

  $('#btn-import-save').addEventListener('click', async () => {
    const date = $('#import-date').value || today();
    const time = $('#import-time').value;
    const vitals = {};
    for (const cb of document.querySelectorAll('[data-vs]:checked')) vitals[cb.dataset.vs] = v[cb.dataset.vs];
    const labs = [...document.querySelectorAll('[data-lab]:checked')].map((cb) => parsed.labs[Number(cb.dataset.lab)]);
    if (!Object.keys(vitals).length && !labs.length) return toast('ยังไม่ได้เลือกรายการ');
    const result = await api('POST', `/api/patients/${state.openId}/import`, {
      vitals: Object.keys(vitals).length ? vitals : null,
      labs,
      measured_at: `${date}T${time || '08:00'}`,
      collected_at: date,
    });
    toast(`บันทึกแล้ว — V/S ${result.vitals} ชุด, Lab ${result.labs} ค่า`);
    $('#import-text').value = '';
    $('#import-preview').innerHTML = '';
    state.parsed = null;
    await loadClinical(state.openId);   // ไม่รอ event จาก SSE เพื่อให้เห็นผลทันที
    showTab('trend');
  });
}


/* ---------------- ประวัติแรกรับแบบเต็มจอ ----------------
   ช่องกรอกในฟอร์มเตี้ยเกินกว่าจะอ่าน PI ยาว ๆ ตอน round ได้ หน้านี้จึงแสดงข้อความเต็ม
   ตัวใหญ่ บรรทัดห่าง และแก้ไขได้ในที่เดียวกันโดยไม่ต้องกลับไปที่ฟอร์ม */
// ทั้งกล่อง "ข้อมูลผู้ป่วย" ไม่ใช่แค่ประวัติ — Diagnosis กับแผนการรักษาก็ยาวจนอ่านในช่องเล็กไม่ไหว
const HX_IDENT = [
  ['bed', 'เตียง', 'text'],
  ['initials', 'ชื่อย่อ', 'text'],
  ['age', 'อายุ', 'text'],
  ['sex', 'เพศ', 'sex'],
  ['admitted_at', 'วันที่ Admit', 'date'],
  ['allergy', 'แพ้ยา / Allergy', 'text'],
];

const HX_FIELDS = [
  ['diagnosis', 'Diagnosis'],
  ['treatment', 'การรักษา / Treatment'],
  ['underlying', 'โรคประจำตัว / Underlying disease'],
  ['chief_complaint', 'อาการสำคัญ / Chief complaint'],
  ['present_illness', 'ประวัติปัจจุบัน / Present illness'],
  ['past_history', 'ประวัติอดีต / Past history'],
  ['physical_exam', 'ตรวจร่างกายแรกรับ / Physical exam'],
];

function hxSetSize(rem) {
  const size = Math.min(1.6, Math.max(0.9, rem));
  document.documentElement.style.setProperty('--hx-size', `${size}rem`);
  try { localStorage.setItem('ward-hx-size', String(size)); } catch { /* โหมดส่วนตัวก็ไม่เป็นไร */ }
  return size;
}

function hxRead(p) {
  const ident = [
    p.age, p.sex,
    p.admitted_at && `admit ${p.admitted_at}`,
    p.status !== 'active' && `D/C ${p.discharged_at ?? ''}`,
  ].filter(Boolean).join(' · ');

  $('#hx-body').innerHTML = `<section class="hx-ident">
      <h4>ข้อมูลผู้ป่วย</h4>
      <p>${esc(`เตียง ${p.bed} · ${p.initials}${ident ? ` · ${ident}` : ''}`)}</p>
    </section>` + HX_FIELDS.map(([key, label]) => {
    const value = String(p[key] ?? '').trim();
    return `<section>
      <h4>${esc(label)}</h4>
      ${value ? `<p>${esc(value)}</p>` : '<p class="empty">ยังไม่ได้บันทึก</p>'}
    </section>`;
  }).join('');
}

function hxEdit(p) {
  const identInputs = HX_IDENT.map(([key, label, type]) => {
    const value = esc(p[key] ?? '');
    if (type === 'sex') {
      const opt = (v, text) => `<option value="${v}"${(p.sex ?? '') === v ? ' selected' : ''}>${text}</option>`;
      return `<label>${esc(label)}<select id="hxf-${key}" name="${key}">${opt('', '–')}${opt('ชาย', 'ชาย')}${opt('หญิง', 'หญิง')}</select></label>`;
    }
    return `<label>${esc(label)}<input id="hxf-${key}" name="${key}" type="${type}" value="${value}"></label>`;
  }).join('');

  $('#hx-body').innerHTML = `<section class="hx-ident">
      <h4>ข้อมูลผู้ป่วย</h4>
      <div class="grid">${identInputs}</div>
    </section>` + HX_FIELDS.map(([key, label]) => `<section>
      <h4><label for="hxf-${key}">${esc(label)}</label></h4>
      <textarea id="hxf-${key}" name="${key}" rows="2">${esc(p[key] ?? '')}</textarea>
    </section>`).join('');
  // ขยายช่องให้พอดีกับข้อความที่มีอยู่ จะได้ไม่ต้องเลื่อนในช่องเล็ก ๆ อีก
  // หัวข้อสั้น ๆ อย่าง CC ก็ไม่กินพื้นที่เกินจำเป็น
  const fit = (ta) => {
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 72)}px`;
  };
  for (const ta of $('#hx-body').querySelectorAll('textarea')) {
    fit(ta);
    ta.addEventListener('input', () => fit(ta));
  }
}

function hxMode(editing) {
  $('#hx-edit').hidden = editing;
  $('#hx-save').hidden = !editing;
  $('#hx-cancel').hidden = !editing;
}

function openHistory() {
  const p = state.patient;
  if (!p) return;
  $('#hx-bed').textContent = `เตียง ${p.bed}`;
  $('#hx-title').textContent = p.initials;
  $('#hx-sub').textContent = [p.age, p.sex, p.admitted_at && `admit ${p.admitted_at}`,
    p.status !== 'active' && `D/C ${p.discharged_at ?? ''}`].filter(Boolean).join(' · ');

  const allergy = String(p.allergy ?? '').trim();
  const noAllergy = /^(nka|nkda|ปฏิเสธ|ไม่มี|-|—)/i.test(allergy);
  $('#hx-allergy').hidden = !allergy || noAllergy;
  $('#hx-allergy').textContent = allergy ? `⚠️ แพ้ยา: ${allergy}` : '';

  hxRead(p);
  hxMode(false);
  $('#modal-history').hidden = false;
}

$('#btn-history').addEventListener('click', openHistory);
$('#hx-edit').addEventListener('click', () => { hxEdit(state.patient); hxMode(true); });
$('#hx-cancel').addEventListener('click', () => { hxRead(state.patient); hxMode(false); });
$('#hx-bigger').addEventListener('click', () => hxSetSize(hxCurrentSize() + 0.1));
$('#hx-smaller').addEventListener('click', () => hxSetSize(hxCurrentSize() - 0.1));

function hxCurrentSize() {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hx-size'));
  return Number.isFinite(v) ? v : 1.08;
}

$('#hx-save').addEventListener('click', async (e) => {
  const btn = e.target;
  const body = {};
  for (const [key] of [...HX_IDENT, ...HX_FIELDS]) body[key] = $(`#hxf-${key}`).value.trim();
  if (!body.bed || !body.initials) {
    toast('ต้องมีเตียงและชื่อย่อ');
    return;
  }
  btn.disabled = true;
  try {
    await api('PATCH', `/api/patients/${state.openId}`, body);
    Object.assign(state.patient, body);
    fillPatientForm(state.patient);   // ให้ช่องในฟอร์มตรงกัน
    hxRead(state.patient);
    hxMode(false);
    toast('บันทึกข้อมูลผู้ป่วยแล้ว');
  } catch (ex) {
    toast(ex.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------------- สำรอง / นำเข้า ระดับหอผู้ป่วย ---------------- */
// อยู่นอก drawer ของผู้ป่วย เพื่อให้กู้ข้อมูลกลับได้ตอนหอผู้ป่วยยังว่างเปล่า
$('#btn-data').addEventListener('click', () => {
  $('#case-preview').innerHTML = '';
  $('#case-file').value = '';
  $('#backup-note').textContent = '';
  $('#modal-data').hidden = false;
});

/* ---------------- สำรองข้อมูลทั้งหมด ---------------- */
$('#btn-backup').addEventListener('click', async () => {
  const note = $('#backup-note');
  note.textContent = 'กำลังเตรียมไฟล์…';
  try {
    const res = await fetch('/api/cases/export');
    if (!res.ok) throw new Error('สำรองข้อมูลไม่สำเร็จ');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ward-backup-${today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    note.textContent = 'ดาวน์โหลดแล้ว — เก็บไฟล์ไว้ในที่ปลอดภัย';
  } catch (ex) {
    note.textContent = '';
    toast(ex.message);
  }
});

/* ---------------- นำเข้าเคสทั้งชุดจากไฟล์ JSON ---------------- */
$('#case-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  const box = $('#case-preview');
  if (!file) { box.innerHTML = ''; return; }
  let bundle;
  try {
    bundle = JSON.parse(await file.text());
  } catch {
    box.innerHTML = '<p class="error">อ่านไฟล์ไม่ได้ — ไฟล์นี้ไม่ใช่ JSON ที่ถูกต้อง</p>';
    return;
  }
  const cases = Array.isArray(bundle.cases) ? bundle.cases : null;
  if (!cases?.length) {
    box.innerHTML = '<p class="error">ไฟล์นี้ไม่มีรายการเคส (ต้องมีคีย์ “cases”)</p>';
    return;
  }
  const rows = cases.map((c) => `<li><b>เตียง ${esc(c.bed)}</b> ${esc(c.initials ?? '')}
    <span class="muted">${esc(String(c.diagnosis ?? '').split('\n')[0].slice(0, 70))}</span>
    <small class="muted">· ปัญหา ${(c.problems ?? []).length} · ผลตรวจ ${(c.investigations ?? []).length}
    · lab ${(c.labs ?? []).length} ค่า</small></li>`).join('');
  box.innerHTML = `<div class="import-box">
    <p>พบ <b>${cases.length} เคส</b> ในไฟล์นี้</p>
    <ul class="case-list">${rows}</ul>
    <label class="check"><input type="checkbox" id="case-replace"> เขียนทับถ้าเตียงนั้นมีผู้ป่วยอยู่แล้ว</label>
    <div class="row">
      <button class="primary" id="btn-case-save">นำเข้าทั้งหมด</button>
      <button class="ghost" id="btn-case-cancel">ยกเลิก</button>
    </div>
  </div>`;

  $('#btn-case-cancel').addEventListener('click', () => {
    box.innerHTML = '';
    $('#case-file').value = '';
  });

  $('#btn-case-save').addEventListener('click', async (ev) => {
    const btn = ev.target;
    btn.disabled = true;
    btn.textContent = 'กำลังนำเข้า…';
    try {
      const r = await api('POST', '/api/cases/import', { cases, replace: $('#case-replace').checked });
      const parts = [];
      if (r.added.length) parts.push(`เพิ่ม ${r.added.length} เตียง (${r.added.join(', ')})`);
      if (r.skipped.length) parts.push(`ข้าม ${r.skipped.length} เตียงที่มีคนอยู่แล้ว (${r.skipped.join(', ')})`);
      if (r.failed.length) parts.push(`ไม่สำเร็จ ${r.failed.length} เตียง`);
      box.innerHTML = `<div class="import-box">
        <p>${r.added.length ? '✅' : 'ℹ️'} ${esc(parts.join(' · '))}</p>
        ${r.skipped.length ? '<p class="muted">ถ้าต้องการเขียนทับ ให้ติ๊กช่องเขียนทับแล้วเลือกไฟล์ใหม่อีกครั้ง</p>' : ''}
        ${r.failed.map((f) => `<p class="error">เตียง ${esc(f.bed)}: ${esc(f.reason)}</p>`).join('')}
      </div>`;
      $('#case-file').value = '';
      await refresh();
    } catch (ex) {
      btn.disabled = false;
      btn.textContent = 'นำเข้าทั้งหมด';
      toast(ex.message);
    }
  });
});

/* ---------------- rounds ---------------- */
$('#btn-rounds').addEventListener('click', () => {
  $('#rounds-date').value = today();
  $('#modal-rounds').hidden = false;
  loadRounds();
});
$('#rounds-date').addEventListener('change', loadRounds);

async function loadRounds() {
  const date = $('#rounds-date').value || today();
  const { notes } = await api('GET', `/api/rounds?date=${encodeURIComponent(date)}`);
  const part = (l, t) => (t ? `<div><b>${l}</b><p>${esc(t)}</p></div>` : '');
  $('#rounds-body').innerHTML = notes.length
    ? notes.map((n) => `<div class="round-row">
        <div class="note-head"><span class="bed-chip">เตียง ${esc(n.bed)}</span> <b>${esc(n.initials)}</b>
        ${n.round ? `<span>· ${esc(n.round)}</span>` : ''}${n.author ? `<span>· ${esc(n.author)}</span>` : ''}</div>
        <div class="soap">${part('S', n.subjective)}${part('O', n.objective)}${part('A', n.assessment)}${part('P', n.plan)}</div>
      </div>`).join('')
    : '<p class="muted">ยังไม่มีบันทึก SOAP ของวันนี้</p>';
}

/* ---------------- misc ---------------- */
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) {
    const host = e.target.closest('.drawer');
    if (host?.id === 'drawer') closeDrawer(); else host.hidden = true;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#modal-history').hidden) $('#modal-history').hidden = true;
  else if (!$('#modal-data').hidden) $('#modal-data').hidden = true;
  else if (!$('#modal-rounds').hidden) $('#modal-rounds').hidden = true;
  else if (!$('#modal-add').hidden) $('#modal-add').hidden = true;
  else if (!$('#drawer').hidden) closeDrawer();
});

/* ---------------- boot ---------------- */
(function restoreHxSize() {
  try {
    const saved = parseFloat(localStorage.getItem('ward-hx-size'));
    if (Number.isFinite(saved)) hxSetSize(saved);
  } catch { /* อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }
})();

(async function boot() {
  try {
    const me = await fetch('/api/me');
    if (!me.ok) return showLogin();
    const meData = await me.json();
    state.user = meData.user;
    showBuild(meData.build);
    showApp();
    state.ranges = await api('GET', '/api/ranges');
    await refresh();
    connectStream();
  } catch { showLogin(); }
})();
