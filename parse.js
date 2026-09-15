'use strict';
/**
 * แปลงข้อความจากระบบโรงพยาบาล (คัดลอกมาวาง) ให้เป็นข้อมูล V/S และ Lab
 * รองรับรูปแบบที่พบบ่อย เช่น
 *   "V/S: BT 38.2 BP 100/60 PR 110 RR 24 O2sat 94%"
 *   "CBC: WBC 14,200 Hb 10.2 Hct 31 Plt 210,000"
 *   "Cr = 1.8 mg/dL, Na 138, K 4.0"
 * ตัวเลขที่อ่านไม่ออกจะถูกข้ามไป ไม่เดาแทนผู้ใช้ และผู้ใช้ต้องกดยืนยันก่อนบันทึกเสมอ
 */

/* ค่าอ้างอิงผู้ใหญ่ทั่วไป — ใช้เพื่อ "ไฮไลต์" เท่านั้น ไม่ใช่เกณฑ์วินิจฉัย
   แต่ละโรงพยาบาลมีช่วงอ้างอิงของตัวเอง แก้ค่าตรงนี้ได้ */
const VITAL_RANGES = {
  bt: { low: 36.0, high: 37.5, unit: '°C', label: 'BT' },
  sbp: { low: 90, high: 140, unit: 'mmHg', label: 'SBP' },
  dbp: { low: 60, high: 90, unit: 'mmHg', label: 'DBP' },
  pr: { low: 60, high: 100, unit: '/min', label: 'PR' },
  rr: { low: 12, high: 20, unit: '/min', label: 'RR' },
  o2sat: { low: 95, high: 100, unit: '%', label: 'O2sat' },
};

const LAB_RANGES = {
  WBC: { low: 4000, high: 10000, unit: '/µL' },
  Hb: { low: 12, high: 16, unit: 'g/dL' },
  Hct: { low: 36, high: 48, unit: '%' },
  Plt: { low: 150000, high: 400000, unit: '/µL' },
  Neut: { low: 40, high: 75, unit: '%' },
  Na: { low: 135, high: 145, unit: 'mmol/L' },
  K: { low: 3.5, high: 5.0, unit: 'mmol/L' },
  Cl: { low: 98, high: 107, unit: 'mmol/L' },
  HCO3: { low: 22, high: 29, unit: 'mmol/L' },
  BUN: { low: 7, high: 20, unit: 'mg/dL' },
  Cr: { low: 0.6, high: 1.2, unit: 'mg/dL' },
  eGFR: { low: 90, high: null, unit: 'mL/min' },
  Glucose: { low: 70, high: 110, unit: 'mg/dL' },
  HbA1c: { low: 4.0, high: 5.6, unit: '%' },
  AST: { low: 5, high: 40, unit: 'U/L' },
  ALT: { low: 5, high: 40, unit: 'U/L' },
  ALP: { low: 40, high: 129, unit: 'U/L' },
  TB: { low: 0.2, high: 1.2, unit: 'mg/dL' },
  DB: { low: 0, high: 0.3, unit: 'mg/dL' },
  Albumin: { low: 3.5, high: 5.0, unit: 'g/dL' },
  INR: { low: 0.8, high: 1.2, unit: '' },
  CRP: { low: 0, high: 5, unit: 'mg/L' },
  Lactate: { low: 0.5, high: 2.2, unit: 'mmol/L' },
  Ca: { low: 8.6, high: 10.2, unit: 'mg/dL' },
  Mg: { low: 1.7, high: 2.2, unit: 'mg/dL' },
  PO4: { low: 2.5, high: 4.5, unit: 'mg/dL' },
  Trop: { low: null, high: 14, unit: 'ng/L' },
  ESR: { low: 0, high: 20, unit: 'mm/hr' },
  ProBNP: { low: null, high: 125, unit: 'pg/mL' },
  Amylase: { low: 28, high: 100, unit: 'U/L' },
  Lipase: { low: 13, high: 60, unit: 'U/L' },
  LDH: { low: 120, high: 250, unit: 'U/L' },
  UricAcid: { low: 3.5, high: 7.2, unit: 'mg/dL' },
  AnionGap: { low: 8, high: 16, unit: 'mmol/L' },
  TotalProtein: { low: 6.4, high: 8.3, unit: 'g/dL' },
  Globulin: { low: 2.0, high: 3.5, unit: 'g/dL' },
  RBC: { low: 4.2, high: 5.9, unit: 'x10^6/µL' },
  MCV: { low: 80, high: 100, unit: 'fL' },
  Lymph: { low: 20, high: 45, unit: '%' },
  ANC: { low: 1.8, high: 7.0, unit: 'x10^3/µL' },
  PT: { low: 11, high: 13.5, unit: 'sec' },
  aPTT: { low: 25, high: 35, unit: 'sec' },
  Ketone: { low: 0, high: 0.6, unit: 'mmol/L' },
  pH: { low: 7.35, high: 7.45, unit: '' },
  pCO2: { low: 35, high: 45, unit: 'mmHg' },
  Cholesterol: { low: null, high: 200, unit: 'mg/dL' },
  Triglyceride: { low: null, high: 150, unit: 'mg/dL' },
  HDL: { low: 40, high: null, unit: 'mg/dL' },
  LDL: { low: null, high: 130, unit: 'mg/dL' },
};

// ชื่อมาตรฐาน -> ชื่อพ้องที่เจอในใบ lab (เรียงยาวไปสั้น กันการจับซ้อน)
const LAB_SYNONYMS = {
  WBC: ['wbc', 'white blood cell', 'เม็ดเลือดขาว'],
  Hb: ['hgb', 'hb', 'hemoglobin', 'ฮีโมโกลบิน'],
  Hct: ['hct', 'hematocrit'],
  Plt: ['platelet count', 'platelets', 'platelet', 'plt'],
  Neut: ['neutrophil', 'neut', 'pmn'],
  Na: ['sodium', 'na+', 'na'],
  K: ['potassium', 'k+', 'k'],
  Cl: ['chloride', 'cl-', 'cl'],
  HCO3: ['hco3-', 'hco3', 'bicarbonate', 'tco2', 'co2'],
  BUN: ['bun', 'urea nitrogen'],
  Cr: ['creatinine', 'cr', 'scr'],   // ระวัง: 'creatinine in urine' ถูกกันออกด้านล่าง
  eGFR: ['egfr', 'gfr'],
  Glucose: ['fbs', 'dtx', 'glucose', 'plasma glucose', 'น้ำตาล'],
  HbA1c: ['hba1c', 'a1c'],
  AST: ['sgot', 'ast'],
  ALT: ['sgpt', 'alt'],
  ALP: ['alkaline phosphatase', 'alp'],
  TB: ['total bilirubin', 'tbil', 'tb'],
  DB: ['direct bilirubin', 'dbil', 'db'],
  Albumin: ['albumin', 'alb'],
  INR: ['inr'],
  CRP: ['hsc-reactive protein', 'hs-crp', 'c-reactive protein', 'crp'],
  Lactate: ['lactate', 'lac'],
  Ca: ['calcium', 'ca'],
  Mg: ['magnesium', 'mg'],
  PO4: ['phosphorus', 'phosphate', 'po4', 'phos'],
  Trop: ['hs-tnt', 'troponin-t', 'troponin t', 'troponin i', 'troponin', 'trop-t', 'tropt', 'trop'],
  ESR: ['esr'],
  ProBNP: ['nt-pro bnp', 'nt-probnp', 'nt pro bnp', 'probnp', 'bnp'],
  Amylase: ['amylase'],
  Lipase: ['lipase'],
  LDH: ['ldh'],
  UricAcid: ['uric acid'],
  AnionGap: ['anion gap'],
  TotalProtein: ['total protein'],
  Globulin: ['globulin'],
  RBC: ['rbc'],
  MCV: ['mcv'],
  Lymph: ['lymphocyte', 'lymph'],
  ANC: ['absolute neutrophil count', 'anc'],
  PT: ['prothrombin time'],
  aPTT: ['partial thromboplastin time', 'aptt'],
  Ketone: ['ketone'],
  pH: ['ph'],
  pCO2: ['pco2'],
  Cholesterol: ['cholesterol'],
  Triglyceride: ['triglyceride'],
  HDL: ['hdl cholesterol', 'hdl'],
  LDL: ['ldl cholesterol', 'ldl'],
};

const VITAL_SYNONYMS = {
  bt: ['bt', 'body temp', 'temperature', 'temp', 't'],
  pr: ['pulse rate', 'pulse', 'pr', 'hr', 'p'],
  rr: ['respiratory rate', 'rr', 'r'],
  o2sat: ['o2 sat', 'o2sat', 'spo2', 'sao2', 'osat', 'sat'],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const NUM = '(-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?)';
// คั่นระหว่างชื่อกับค่า: จุด/ทวิภาค/เท่ากับ และวงเล็บขยายความ เช่น "AST(SGOT)", "Sodium (Na)", "Lactate (Blood)"
// รองรับชื่อที่อยู่ในวงเล็บเอง เช่น "... rate (eGFR)   17" จึงยอมให้มี ")" ปิดท้ายชื่อได้
const SEP = '\\s*\\)?\\s*\\.?\\s*(?:\\([^)]{0,30}\\))?\\s*[:=]?\\s*';
// หน่วยที่พบในใบ lab — จับเฉพาะที่รู้จัก เพื่อไม่ให้ไปกินชื่อ lab ตัวถัดไป
const UNIT = '%|mg/dL|g/dL|mmol/L|mEq/L|U/L|IU/L|ng/L|ng/mL|pg/mL|mL/min|mm/hr|mmHg|sec|fL|pg|/µL|/uL|cells/µL|x10\\^[39]/[µu]L';
const toNum = (s) => Number(String(s).replace(/,/g, ''));

/** หาวันที่ในข้อความ คืนค่า YYYY-MM-DD หรือ null */
function parseDate(text) {
  let m = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /\b(\d{1,2})[/](\d{1,2})[/](\d{2,4})\b/.exec(text);
  if (m) {
    let year = Number(m[3]);
    // ในเวชระเบียนไทยนิยมเขียน พ.ศ. ย่อ 2 หลัก เช่น 6/9/69 = 6 ก.ย. 2569 = 2026
    if (year < 100) year += 2500;
    if (year > 2400) year -= 543;               // พ.ศ. -> ค.ศ.
    if (year < 2000) year = Number(m[3]) + 2000; // เผื่อเขียน ค.ศ. ย่อ
    const month = m[2].padStart(2, '0');
    const day = m[1].padStart(2, '0');
    if (Number(month) < 1 || Number(month) > 12 || Number(day) > 31) return null;
    return `${year}-${month}-${day}`;
  }
  return null;
}

/** หาเวลาในข้อความ คืนค่า HH:MM หรือ null */
function parseTime(text) {
  // "08.30" / "16.20" ต้องเป็นชั่วโมงสองหลัก ส่วนรูปแบบมีทวิภาคยอมรับหลักเดียวได้
  const m = /\b(?:([01]\d|2[0-3])\.([0-5]\d)|([01]?\d|2[0-3]):([0-5]\d))\s*(?:น\.?|hr|hrs)?\b/.exec(text);
  if (!m) return null;
  const hh = m[1] ?? m[3];
  const mm = m[2] ?? m[4];
  return `${hh.padStart(2, '0')}:${mm}`;
}

function parseVitals(text) {
  const found = {};

  const bp = new RegExp(`\\b(?:bp|blood pressure|ความดัน)${SEP}(\\d{2,3})\\s*/\\s*(\\d{2,3})`, 'i').exec(text);
  if (bp) { found.sbp = toNum(bp[1]); found.dbp = toNum(bp[2]); }

  for (const [key, names] of Object.entries(VITAL_SYNONYMS)) {
    for (const name of names) {
      const re = new RegExp(`(?:^|[^a-z])${esc(name)}${SEP}${NUM}`, 'i');
      const m = re.exec(text);
      if (!m) continue;
      const value = toNum(m[1]);
      // กรองค่าที่เป็นไปไม่ได้ทางสรีรวิทยาออก กัน false positive จากตัวเลขอื่นในข้อความ
      const sane = { bt: [30, 45], pr: [20, 250], rr: [4, 70], o2sat: [40, 100] }[key];
      if (value < sane[0] || value > sane[1]) continue;
      found[key] = value;
      break;
    }
  }
  return Object.keys(found).length ? found : null;
}

function parseLabs(text) {
  const out = [];
  const seen = new Set();
  for (const [name, syns] of Object.entries(LAB_SYNONYMS)) {
    for (const syn of syns) {
      const re = new RegExp(
        `(?:^|[^a-z0-9])${esc(syn)}${SEP}${NUM}((?:\\s*>+\\s*${NUM})*)[ \\t]*(${UNIT})?`, 'i');
      const m = re.exec(text);
      if (!m) continue;
      if (seen.has(name)) break;
      // ค่าที่เขียนเป็นชุดคั่นด้วย ">" หมายถึงแนวโน้ม — ค่าล่าสุดคือตัวขวาสุด
      const chain = m[2] ? m[2].match(new RegExp(NUM, 'g')) : null;
      let value = toNum(chain && chain.length ? chain[chain.length - 1] : m[1]);
      // ใบ lab บางที่รายงาน WBC/Plt เป็นหน่วยพัน — ปรับให้เทียบกันได้
      if (name === 'WBC' && value > 0 && value < 100) value *= 1000;
      if (name === 'Plt' && value > 0 && value < 2000) value *= 1000;
      seen.add(name);
      out.push({
        name,
        value,
        unit: LAB_RANGES[name]?.unit ?? (m[4] || null),
        raw: m[0].trim(),
      });
      break;
    }
  }
  return out;
}

/** จุดเข้าใช้งานหลัก: ข้อความ -> ข้อมูลที่พร้อมให้ผู้ใช้ตรวจสอบก่อนบันทึก */
function parseClinicalText(text) {
  const src = String(text ?? '');
  const date = parseDate(src);
  const time = parseTime(src);
  const vitals = parseVitals(src);
  const labs = parseLabs(src);
  return {
    date, time, vitals, labs,
    found: (vitals ? Object.keys(vitals).length : 0) + labs.length,
  };
}

/** สถานะของค่าเทียบช่วงอ้างอิง: 'low' | 'high' | 'normal' | null */
function flagFor(range, value) {
  if (!range || value === null || value === undefined || Number.isNaN(value)) return null;
  if (range.low !== null && range.low !== undefined && value < range.low) return 'low';
  if (range.high !== null && range.high !== undefined && value > range.high) return 'high';
  return 'normal';
}

module.exports = { parseClinicalText, parseVitals, parseLabs, parseDate, parseTime, flagFor, VITAL_RANGES, LAB_RANGES };
