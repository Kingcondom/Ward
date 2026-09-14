'use strict';

const $ = (sel) => document.querySelector(sel);
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD ตามเวลาเครื่อง

const state = {
  user: null,
  patients: [],
  openId: null,       // ผู้ป่วยที่เปิด drawer อยู่
  notes: [],
  editingNoteId: null,
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

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    const { user } = await api('POST', '/api/login', formData(e.target));
    state.user = user;
    e.target.reset();
    showApp();
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
    if (state.openId === patient.id) fillPatientForm(patient);
    if (touched(by)) toast(`${by} แก้ข้อมูลเตียง ${patient.bed}`);
  });

  stream.addEventListener('patient:deleted', (e) => {
    const { id, by } = JSON.parse(e.data);
    state.patients = state.patients.filter((p) => p.id !== id);
    if (state.openId === id) closeDrawer();
    render();
    if (touched(by)) toast(`${by} ลบผู้ป่วย 1 ราย`);
  });

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
    return [p.bed, p.initials, p.hn, p.diagnosis, p.treatment].some((v) => String(v ?? '').toLowerCase().includes(q));
  });
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
        <span class="bed-meta">${esc([p.age, p.sex].filter(Boolean).join(' · '))}${p.hn ? `<br>HN ${esc(p.hn)}` : ''}</span>
      </div>
      <div class="field"><span>Diagnosis</span>${esc(p.diagnosis) || '<i class="muted">—</i>'}</div>
      <div class="field"><span>การรักษา</span>${esc(p.treatment) || '<i class="muted">—</i>'}</div>
      <div class="badges">
        ${dc ? `<span class="badge">D/C ${esc(p.discharged_at ?? '')}</span>`
              : done ? '<span class="badge ok">✓ SOAP วันนี้</span>' : '<span class="badge warn">ยังไม่มี SOAP วันนี้</span>'}
        ${p.allergy ? `<span class="badge allergy">แพ้ ${esc(p.allergy)}</span>` : ''}
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
  for (const k of ['bed', 'initials', 'hn', 'age', 'sex', 'diagnosis', 'treatment', 'allergy', 'admitted_at']) {
    if (f.elements[k]) f.elements[k].value = p[k] ?? '';
  }
  $('#d-bed').textContent = `เตียง ${p.bed}`;
  $('#d-title').textContent = p.initials;
  $('#d-sub').textContent = [p.hn && `HN ${p.hn}`, p.age, p.sex, p.admitted_at && `admit ${p.admitted_at}`,
    p.status !== 'active' && `D/C ${p.discharged_at ?? ''}`].filter(Boolean).join(' · ');
  $('#btn-discharge').hidden = p.status !== 'active';
  $('#btn-readmit').hidden = p.status === 'active';
}

async function openPatient(id, { silent = false } = {}) {
  const data = await api('GET', `/api/patients/${id}`);
  state.openId = id;
  state.notes = data.notes;
  fillPatientForm(data);
  renderNotes();
  $('#drawer').hidden = false;
  if (!silent) $('#note-form').hidden = true;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  state.openId = null;
  state.editingNoteId = null;
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
  if (!$('#modal-rounds').hidden) $('#modal-rounds').hidden = true;
  else if (!$('#modal-add').hidden) $('#modal-add').hidden = true;
  else if (!$('#drawer').hidden) closeDrawer();
});

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    const me = await fetch('/api/me');
    if (!me.ok) return showLogin();
    state.user = (await me.json()).user;
    showApp();
    await refresh();
    connectStream();
  } catch { showLogin(); }
})();
