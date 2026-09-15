'use strict';
/**
 * ใส่ข้อมูลตัวอย่างสำหรับทดลองใช้งาน
 *   node seed.js          เพิ่มข้อมูลตัวอย่าง
 *   node seed.js --reset  ล้างข้อมูลเดิมทั้งหมดก่อน แล้วค่อยใส่ใหม่
 *   node seed.js --clear  ล้างข้อมูลทั้งหมด ไม่ใส่ข้อมูลตัวอย่าง (ใช้ก่อนนำเข้าเคสจริง)
 *
 * ผู้ป่วยทุกรายเป็นเคสสมมติ ชื่อย่อไม่ใช่ของจริง
 */
const store = require('./db');

const DAY = 86400000;
const d = (back = 0) => new Date(Date.now() - back * DAY).toLocaleDateString('sv-SE');
const t = (back, hhmm) => `${d(back)}T${hhmm}`;
const BY = 'ข้อมูลตัวอย่าง';

const CASES = [
  {
    bed: '1', initials: 'ก.จ.', age: '70 ปี', sex: 'ชาย', allergy: null,
    diagnosis: 'Acute pancreatitis (recurrent) with AKI, transaminitis R/O DILI',
    treatment: 'NPO, IV hydration, งด HCTZ/enalapril/simvastatin, Tazocin 4.5g IV q8h',
    admit: 5,
    underlying: '# HT\n# DLP\n# NAFLD\n# Colonic diverticulosis\n# BPH',
    cc: 'ปวดท้องใต้ลิ้นปี่ 13 ชั่วโมงก่อนมา รพ.',
    pi: 'ปวดท้องใต้ลิ้นปี่และใต้ชายโครงซ้าย ร้าวไปกลางหลัง ปวดทันที PS 10/10 ปวดตลอดเวลา นอนตะแคงแล้วปวดมากขึ้น\nคลื่นไส้อาเจียนหลายรอบเป็นน้ำสีเหลือง ไม่ถ่ายเหลว ไม่เจ็บแน่นหน้าอก ไม่มีไข้',
    ph: 'ไม่ดื่มสุรา หยุดสูบบุหรี่มา 30 ปี ไม่มีประวัติแพ้ยา',
    pe: 'GA: รู้สึกตัวดี ไม่ซีด ไม่เหลือง\nHEENT: anicteric sclera\nHeart: normal S1S2 no murmur\nLung: clear ทั้งสองข้าง\nAbd: ท้องอืดเล็กน้อย กดเจ็บ epigastrium และ LUQ ไม่มี guarding\nExt: no pitting edema\nNeuro: E4V5M6 pupil 3 mm RTLBE motor grade V',
    problems: [
      ['Acute pancreatitis (recurrent), BISAP 1', 'active', 5, 'สงสัยจากยา HCTZ/enalapril/simvastatin ddx autoimmune', 'NPO, IV hydration, งดยาที่สงสัย, consult GI นัด EUS แบบ OPD'],
      ['AKI ddx pre-renal, septic ATN', 'active', 3, 'Cr ขึ้นจาก baseline 0.98 เป็น 3.25', 'IV hydration, ติดตาม Cr และปริมาณปัสสาวะทุกวัน, เลี่ยงยาที่มีพิษต่อไต'],
      ['Transaminitis R/O DILI', 'monitoring', 3, 'AST/ALT ขึ้นตั้งแต่วันที่ 3 ยังไม่พบ culprit drug ชัดเจน', 'หยุด augmentin, เลี่ยงยาที่มีพิษต่อตับ, F/U LFT'],
      ['Complicated UTI', 'active', 2, 'ปัสสาวะในสายสวนขุ่น UA WBC 50-100', 'เปลี่ยนสายสวน, Tazocin 4.5g IV q8h (ปรับตาม CrCl 22), consult Uro Sx'],
      ['Liver mass segment VI with pancreatic cystic tumor', 'monitoring', 4, 'พบจาก CT whole abdomen', 'MDT conference แนะนำ liver biopsy, ออกใบนัดแล้ว'],
    ],
    ix: [
      [4, 'imaging', 'CT whole abdomen', 'final', 'Liver mass ที่ segment VI ขนาด 5.1 x 3.8 x 2.5 ซม. ร่วมกับ pancreatic cystic tumor ที่ distal pancreas ไม่มี IHD dilatation'],
      [5, 'imaging', 'U/S bedside', 'final', 'Well-defined round heterogenous mass ที่ left lobe ของตับ ไม่มี IHD dilatation ไต 2 ข้างและม้ามปกติ'],
      [2, 'culture', 'Urine culture', 'final', 'ขึ้นเชื้อ 1 ชนิด', 'Citrobacter koseri', 'ceftriaxone, tazocin'],
      [0, 'culture', 'Urine culture (ซ้ำหลังเปลี่ยนสายสวน)', 'pending', null],
      [0, 'culture', 'Hemoculture x 2', 'pending', null],
    ],
    events: [
      [5, 'diagnosis', 'Acute pancreatitis, BISAP 1', 'สงสัยจากยา HCTZ/enalapril/simvastatin'],
      [4, 'procedure', 'CT whole abdomen', 'พบ liver mass segment VI และ pancreatic cystic tumor'],
      [3, 'consult', 'Consult GI', 'แนะนำ EUS แบบ OPD case, นัด liver biopsy'],
      [2, 'complication', 'New onset fever — complicated UTI', 'UA WBC 50-100, UC ขึ้น Citrobacter koseri'],
      [1, 'note', 'เปลี่ยน ATB เป็น Tazocin', 'หยุด augmentin เพราะสงสัย transaminitis'],
    ],
    vitals: [
      [5, '08:00', { bt: 36.5, sbp: 171, dbp: 71, pr: 62, rr: 16, o2sat: 100 }],
      [4, '08:00', { bt: 37.2, sbp: 150, dbp: 80, pr: 78, rr: 18, o2sat: 97 }],
      [3, '08:00', { bt: 38.4, sbp: 132, dbp: 74, pr: 104, rr: 22, o2sat: 94 }],
      [2, '08:00', { bt: 38.8, sbp: 124, dbp: 70, pr: 112, rr: 24, o2sat: 92 }],
      [1, '08:00', { bt: 37.4, sbp: 128, dbp: 72, pr: 92, rr: 20, o2sat: 95 }],
      [0, '08:00', { bt: 36.9, sbp: 130, dbp: 74, pr: 84, rr: 18, o2sat: 97 }],
    ],
    labs: [
      [5, { Cr: 0.98, BUN: 22, Na: 140, K: 3.61, AST: 30, ALT: 39, WBC: 16650, Hb: 17.3, Plt: 170000, Lipase: 776, Amylase: 951 }],
      [3, { Cr: 2.98, BUN: 26, Na: 135, K: 4.1, AST: 131, ALT: 247, WBC: 18200 }],
      [2, { Cr: 3.25, BUN: 28, Na: 131, K: 4.36, AST: 164, ALT: 402, WBC: 15400 }],
      [0, { Cr: 2.10, BUN: 21, Na: 134, K: 4.0, AST: 84, ALT: 296, WBC: 11200 }],
    ],
    soap: [
      [1, 'เช้า', 'ปวดท้องลดลง PS 3/10 ทานน้ำได้', 'BT 37.4 BP 128/72 abdomen soft, tender epigastrium เล็กน้อย',
        'Pancreatitis ดีขึ้น แต่ AKI ยังไม่ฟื้นเต็มที่ และ transaminitis ยังสูง', 'IV hydration ต่อ, F/U LFT/Cr พรุ่งนี้, งดยา hepatotoxic'],
      [0, 'เช้า', 'ไม่ปวดท้องแล้ว เริ่มทานอาหารอ่อนได้', 'BT 36.9 BP 130/74 PR 84 abdomen soft ไม่กดเจ็บ',
        'ดีขึ้นชัดเจน Cr ลดลง 3.25 → 2.10', 'เริ่ม diet ได้, F/U Cr พรุ่งนี้, ประเมิน D/C หลัง wean off O2'],
    ],
  },
  {
    bed: '3', initials: 'ส.ท.', age: '82 ปี', sex: 'ชาย', allergy: null,
    diagnosis: 'Congestive heart failure with R/O chronic coronary syndrome, AKI on CKD',
    treatment: 'Lasix 40 mg IV OD, ASA, จำกัดน้ำ 1200 ml/day, on O2 cannula 3 LPM',
    admit: 3,
    underlying: '# HT\n# DLP\n# Old CVA\n# CKD stage 3',
    cc: 'หายใจไม่อิ่ม 3 ชั่วโมงก่อนมา รพ.',
    pi: '2 สัปดาห์ก่อนมา เหนื่อยมากขึ้นเป็นบางครั้ง ขาบวม นอนหนุนหมอนสูงขึ้น\n3 ชั่วโมงก่อนมา ขณะเข้าห้องน้ำมีเวียนศีรษะ หายใจไม่อิ่ม แน่นท้อง วัด SpO2 ปลายนิ้วได้ 80-90%',
    ph: 'ไม่สูบบุหรี่ ไม่ดื่มสุรา',
    pe: 'GA: รู้สึกตัวดี\nHEENT: not pale conjunctiva\nHeart: normal S1S2 no murmur\nLung: crepitation both lower lungs\nAbd: distension ไม่กดเจ็บ\nExt: pitting edema 2+ ทั้งสองข้าง',
    problems: [
      ['Acute decompensated heart failure', 'active', 3, 'CXR พบ cardiomegaly with pulmonary congestion', 'Lasix IV, จำกัดน้ำ 1200 ml/day, ชั่งน้ำหนักทุกเช้า'],
      ['R/O chronic coronary syndrome', 'monitoring', 3, 'EKG พบ STD ที่ I, II, V4-V6 ไม่มี dynamic change, troponin ขึ้นเล็กน้อยแบบไม่มีแนวโน้มเพิ่ม', 'ASA ต่อ, consult cardio, รอ echocardiography'],
      ['AKI on CKD', 'monitoring', 3, 'Cr 1.32 จาก baseline ประมาณ 1.1', 'ติดตาม Cr ระหว่างให้ diuretic'],
    ],
    ix: [
      [3, 'imaging', 'CXR', 'final', 'Cardiomegaly with pulmonary congestion ไม่พบ infiltration ชัดเจน'],
      [3, 'imaging', 'EKG 12 leads', 'final', 'Sinus rhythm rate 100 bpm, ST depression ที่ I, II, V4-V6 ไม่มี ST elevation และไม่มี dynamic change เทียบกับที่จุดเกิดเหตุ'],
      [1, 'imaging', 'Echocardiography', 'pending', null],
    ],
    events: [
      [3, 'diagnosis', 'Acute decompensated heart failure', 'CXR cardiomegaly with pulmonary congestion'],
      [3, 'procedure', 'EKG 12 leads', 'STD ที่ I, II, V4-V6 ไม่มี dynamic change'],
      [2, 'consult', 'Consult cardio', 'นัด echocardiography'],
    ],
    vitals: [
      [3, '08:00', { bt: 36.0, sbp: 172, dbp: 76, pr: 102, rr: 20, o2sat: 96 }],
      [2, '08:00', { bt: 36.4, sbp: 158, dbp: 80, pr: 96, rr: 22, o2sat: 94 }],
      [1, '08:00', { bt: 36.6, sbp: 142, dbp: 78, pr: 88, rr: 20, o2sat: 96 }],
      [0, '08:00', { bt: 36.5, sbp: 134, dbp: 76, pr: 82, rr: 18, o2sat: 97 }],
    ],
    labs: [
      [3, { Trop: 183.7, Cr: 1.32, BUN: 17, Na: 136, K: 4.33, WBC: 14680, Hb: 15.0, Plt: 148000, ProBNP: 4256 }],
      [1, { Trop: 189.0, Cr: 1.28, Na: 138, K: 4.1 }],
      [0, { Cr: 1.15, Na: 139, K: 4.0, ProBNP: 2100 }],
    ],
    soap: [
      [0, 'เช้า', 'เหนื่อยลดลง นอนราบได้ ปัสสาวะออกดี', 'BP 134/76 PR 82 O2sat 97% RA, crepitation ลดลง, ขาบวมลดลง',
        'CHF ตอบสนองต่อ diuretic ดี', 'Lasix ต่อ, ชั่งน้ำหนักทุกเช้า, รอ echo'],
    ],
  },
  {
    bed: '5', initials: 'ว.พ.', age: '59 ปี', sex: 'ชาย', allergy: 'ปฏิเสธ',
    diagnosis: 'NSCLC T3N3M1 (adenocarcinoma, EGFR L858R+) with bone metastasis, right pleural effusion',
    treatment: 'Erlotinib ต่อเนื่อง, thoracocentesis, ceftriaxone + clindamycin, on HFNC, fentanyl patch',
    admit: 2,
    underlying: '# NSCLC T3N3M1 adenocarcinoma EGFR L858R+ with bone metastasis\n# HT\n# T2DM\n# DLP\n# Hx pulmonary embolism on enoxaparin',
    cc: 'เหนื่อยมากขึ้น 1 สัปดาห์ก่อนมา รพ.',
    pi: 'เหนื่อยมากขึ้น 1 สัปดาห์ ไม่มีไข้ ไม่ไอเป็นเลือด เสมหะใสพอ ๆ เดิม นอนราบแล้วเหนื่อยต้องนอนหัวสูง ขาไม่บวม\n1 วันก่อนมา ปวดสะบักหลังขวามากจนนอนไม่ได้ ยังขยับแขนขวาได้ปกติ',
    ph: 'Ex-smoker ปฏิเสธแพ้ยา ปกติมี home oxygen ใส่เวลาเหนื่อย เดือนนี้ยังไม่ได้ใส่',
    pe: 'GA: รู้สึกตัวดี\nHEENT: not pale conjunctiva, anicteric sclera\nLung: rhonchi และ end expiratory wheezing ทั้งสองข้าง ไม่มี retraction\nHeart: normal S1S2 no murmur\nAbd: soft ไม่กดเจ็บ\nNeuro: E4V5M6 motor grade V ทุกแขนขา',
    problems: [
      ['Right pleural effusion ddx malignant vs infection', 'active', 2, 'เจาะได้ fluid 120 ml ส่งตรวจครบชุด', 'Thoracocentesis, รอผล cytology และ ADA, ATB ceftriaxone + clindamycin'],
      ['NSCLC progression', 'monitoring', 2, 'CT chest + WA ล่าสุดเข้าได้กับ progressive disease', 'อธิบายโรคและการพยากรณ์กับผู้ป่วยและญาติ, ประสาน chest med เรื่องแผนต่อ'],
      ['Cancer pain', 'active', 2, 'ปวดสะบักหลังขวาจาก bone metastasis', 'Fentanyl patch 25 mcg 2 แผ่น q72h ประเมิน pain score ทุกเวร'],
    ],
    ix: [
      [2, 'imaging', 'U/S bedside', 'final', 'Good LVEF, ไม่มี RV dilatation, B-line ทั้งสองข้าง, pleural effusion ทั้งสองข้าง, IVC max 1.05 min 0.56'],
      [2, 'patho', 'Pleural fluid cytology', 'pending', null],
      [2, 'other', 'Pleural fluid ADA + cell count', 'pending', null],
      [1, 'culture', 'Sputum G/S + C/S', 'final', 'Gram stain พบ moderate leukocyte', 'ไม่พบเชื้อ', null],
    ],
    events: [
      [2, 'diagnosis', 'Dyspnea จาก pleural effusion', 'DDx CA metastasis vs infection'],
      [2, 'procedure', 'Thoracocentesis', 'ได้ fluid 120 ml ส่ง cell count, G/S, C/S, LDH, protein, cytology'],
      [1, 'note', 'เพิ่ม ADA ใน pleural fluid', 'work up infection เพิ่มเติม'],
    ],
    vitals: [
      [2, '08:00', { bt: 37.1, sbp: 164, dbp: 99, pr: 100, rr: 24, o2sat: 92 }],
      [1, '08:00', { bt: 37.0, sbp: 148, dbp: 88, pr: 94, rr: 22, o2sat: 94 }],
      [0, '08:00', { bt: 36.8, sbp: 140, dbp: 84, pr: 90, rr: 20, o2sat: 95 }],
    ],
    labs: [
      [2, { WBC: 15780, Hb: 10.0, Hct: 30.8, Plt: 347000, Na: 129, K: 4.19, Cr: 0.45, ALP: 164, Albumin: 3.8 }],
      [0, { WBC: 12400, Hb: 9.8, Na: 133, K: 4.0 }],
    ],
    soap: [
      [0, 'เช้า', 'เหนื่อยลดลงหลังเจาะปอด ปวดสะบักหลังลดลง', 'RR 20 O2sat 95% on HFNC, breath sound ดีขึ้นข้างขวา',
        'Pleural effusion ระบายแล้วอาการดีขึ้น รอผล cytology และ ADA', 'F/U CXR, รอผล fluid, ปรับ O2 ลง'],
    ],
  },
  {
    bed: '7', initials: 'ป.ร.', age: '77 ปี', sex: 'ชาย', allergy: null,
    diagnosis: 'Hypertensive emergency with acute de novo heart failure, severe AS',
    treatment: 'NTG IV drip keep SBP < 170, NIV, Lasix IV',
    admit: 1,
    events: [
      [1, 'diagnosis', 'HT emergency with acute de novo HF', 'SpO2 86% RA, RR 30 แรกรับ'],
      [1, 'complication', 'Acute respiratory failure', 'เริ่ม NIV ที่ ER'],
    ],
    vitals: [
      [1, '16:20', { bt: 36.7, sbp: 223, dbp: 112, pr: 127, rr: 24, o2sat: 100 }],
      [1, '20:00', { bt: 36.6, sbp: 178, dbp: 94, pr: 110, rr: 22, o2sat: 98 }],
      [0, '08:00', { bt: 36.5, sbp: 152, dbp: 84, pr: 96, rr: 20, o2sat: 97 }],
    ],
    labs: [
      [1, { Trop: 1392.9, ProBNP: 4256, Cr: 1.05, BUN: 18, Na: 136, K: 4.47, Lactate: 3.6, WBC: 12990, Hb: 14.0, Plt: 361000 }],
      [0, { Lactate: 1.8, Cr: 1.02, K: 4.2 }],
    ],
    soap: [
      [0, 'เช้า', 'หายใจดีขึ้น ถอด NIV ได้ ไม่แน่นหน้าอก', 'BP 152/84 PR 96 RR 20 crepitation both lower lungs ลดลง',
        'ความดันคุมได้ตามเป้า SBP < 170, HF ดีขึ้น', 'ลด NTG ลง, เริ่มยาลดความดันชนิดกิน, consult cardio เรื่อง severe AS'],
    ],
  },
  {
    bed: '9', initials: 'ม.ก.', age: '72 ปี', sex: 'ชาย', allergy: 'ปฏิเสธ',
    diagnosis: 'Type 2 DM with DKA precipitated by acute febrile illness, BPH with failed Foley catheterization',
    treatment: 'RI IV drip, NSS + KCl IV, ceftriaxone 2 g IV, consult Uro Sx',
    admit: 2,
    events: [
      [2, 'diagnosis', 'Mild to moderate DKA', 'ketone 8.9, CO2 18, pH 7.37'],
      [2, 'consult', 'Consult Uro Sx', 'ใส่สายสวนไม่สำเร็จจาก BPH'],
      [1, 'note', 'DKA resolved', 'เปลี่ยนจาก RI drip เป็น SC insulin'],
    ],
    vitals: [
      [2, '08:00', { bt: 38.0, sbp: 148, dbp: 66, pr: 93, rr: 22, o2sat: 93 }],
      [1, '08:00', { bt: 37.2, sbp: 138, dbp: 72, pr: 88, rr: 20, o2sat: 96 }],
      [0, '08:00', { bt: 36.8, sbp: 132, dbp: 70, pr: 80, rr: 18, o2sat: 98 }],
    ],
    labs: [
      [2, { Glucose: 700, Ketone: 8.9, HCO3: 15.6, pH: 7.358, Na: 123, K: 4.6, Hct: 30, Hb: 10.2, WBC: 15200 }],
      [1, { Glucose: 240, Ketone: 1.2, HCO3: 20, Na: 132, K: 3.8 }],
      [0, { Glucose: 168, Ketone: 0.3, HCO3: 23, Na: 136, K: 4.0 }],
    ],
    soap: [
      [0, 'เช้า', 'รู้สึกตัวดี ทานอาหารได้ ไม่คลื่นไส้', 'BT 36.8 DTX 168 mg/dL ไม่มี Kussmaul breathing',
        'DKA แก้ไขได้แล้ว ยังต้องคุมการติดเชื้อต่อ', 'เปลี่ยนเป็น SC insulin, ATB ต่อ, รอ Uro Sx'],
    ],
  },
  {
    bed: '11', initials: 'อ.ส.', age: '74 ปี', sex: 'ชาย', allergy: null,
    diagnosis: 'Acute asthmatic attack from secretion obstruction, R/O tracheobronchitis; tracheostomy No.8',
    treatment: 'Dexamethasone 4 mg IV q12h, Berodual NB q4h, Tazocin, ดูแล tracheostomy',
    admit: 4,
    events: [
      [4, 'admit', 'รับจาก ER เข้า RCU', 'หลัง suction เสมหะ อาการเหนื่อยลดลงมาก'],
      [4, 'procedure', 'เปลี่ยน tracheostomy tube', 'จาก No.7.5 เป็น No.8'],
      [2, 'note', 'ลด dexamethasone', 'จาก q8h เป็น q12h ตามอาการที่ดีขึ้น'],
      [1, 'transfer', 'ย้ายจาก RCU เข้าหอผู้ป่วยสามัญ', 'อาการคงที่ ไม่ต้องใช้ ventilator ต่อเนื่อง'],
    ],
    vitals: [
      [4, '08:00', { bt: 37.0, sbp: 142, dbp: 80, pr: 108, rr: 26, o2sat: 91 }],
      [3, '08:00', { bt: 36.8, sbp: 136, dbp: 78, pr: 96, rr: 22, o2sat: 94 }],
      [2, '08:00', { bt: 36.7, sbp: 130, dbp: 76, pr: 88, rr: 20, o2sat: 96 }],
      [0, '08:00', { bt: 36.6, sbp: 128, dbp: 74, pr: 84, rr: 18, o2sat: 97 }],
    ],
    labs: [
      [4, { WBC: 13800, Hb: 11.2, Plt: 288000, Na: 137, K: 4.2, Cr: 0.9, CRP: 48 }],
      [1, { WBC: 9200, CRP: 12, Na: 138, K: 4.1 }],
    ],
    soap: [
      [0, 'เช้า', 'เหนื่อยน้อยลงมาก เสมหะใสขึ้นและน้อยลง', 'RR 18 O2sat 97%, air entry ดีขึ้นทั้งสองข้าง wheezing ลดลง',
        'Asthmatic attack ดีขึ้นชัดเจน', 'ลด dexa, พ่นยาต่อ, วางแผนปรับ ventilator ที่บ้านก่อน D/C'],
    ],
  },
  {
    bed: '12', initials: 'ธ.บ.', age: '65 ปี', sex: 'ชาย', allergy: 'ปฏิเสธ',
    diagnosis: 'Upper GI bleeding with hypovolemic shock',
    treatment: 'NPO, pantoprazole IV drip, LPRC 4 units, hold ASA, เตรียม EGD',
    admit: 1,
    events: [
      [1, 'diagnosis', 'UGIB with hypovolemic shock', 'ถ่ายดำ 10+ ครั้ง, NG lavage ได้ coffee ground'],
      [1, 'procedure', 'NG lavage + เตรียมเลือด', 'G/M LPRC 4 units'],
      [0, 'consult', 'Consult GI เพื่อทำ EGD', 'นัด EGD พรุ่งนี้เช้า'],
    ],
    vitals: [
      [1, '02:00', { bt: 36.0, sbp: 97, dbp: 74, pr: 100, rr: 20, o2sat: 100 }],
      [1, '04:00', { bt: 36.2, sbp: 131, dbp: 91, pr: 102, rr: 20, o2sat: 100 }],
      [0, '08:00', { bt: 36.5, sbp: 118, dbp: 76, pr: 88, rr: 18, o2sat: 99 }],
    ],
    labs: [
      [1, { Hb: 8.0, Hct: 26, WBC: 11400, Plt: 210000, BUN: 38, Cr: 1.1, INR: 1.1 }],
      [0, { Hb: 9.6, Hct: 29, BUN: 28, Cr: 1.0 }],
    ],
    soap: [
      [0, 'เช้า', 'ไม่ถ่ายดำเพิ่ม ไม่เวียนศีรษะ', 'BP 118/76 PR 88 ไม่ซีดลง abdomen soft',
        'UGIB สงบลงหลังให้เลือดและ PPI', 'NPO ต่อ, PPI drip ต่อ, EGD พรุ่งนี้เช้า'],
    ],
  },
];

function reset() {
  for (const p of store.listPatients({ includeDischarged: true })) store.deletePatient(p.id);
  console.log('ล้างข้อมูลเดิมแล้ว');
}

function seed() {
  let counts = { patients: 0, soap: 0, vitals: 0, labs: 0, events: 0, problems: 0, ix: 0 };
  for (const c of CASES) {
    const patient = store.createPatient({
      bed: c.bed, initials: c.initials, age: c.age, sex: c.sex,
      diagnosis: c.diagnosis, treatment: c.treatment, allergy: c.allergy,
      admitted_at: d(c.admit),
    }, BY);
    counts.patients++;

    if (c.underlying || c.cc || c.pi || c.ph || c.pe) {
      store.updatePatient(patient.id, {
        underlying: c.underlying ?? null,
        chief_complaint: c.cc ?? null,
        present_illness: c.pi ?? null,
        past_history: c.ph ?? null,
        physical_exam: c.pe ?? null,
      }, BY);
    }
    for (const [title, status, back, detail, plan] of c.problems ?? []) {
      store.createProblem(patient.id, { title, status, started_at: d(back), detail, plan }, BY);
      counts.problems++;
    }
    for (const [back, category, name, status, result, organism, sensitivity] of c.ix ?? []) {
      store.createInvestigation(patient.id, {
        performed_at: d(back), category, name, status, result, organism, sensitivity,
      }, BY);
      counts.ix++;
    }

    store.createEvent(patient.id, {
      occurred_at: d(c.admit), kind: 'admit', title: 'Admit เข้าหอผู้ป่วย', detail: c.diagnosis,
    }, BY, 1);
    counts.events++;

    for (const [back, kind, title, detail] of c.events) {
      store.createEvent(patient.id, { occurred_at: d(back), kind, title, detail }, BY, 0);
      counts.events++;
    }
    for (const [back, hhmm, v] of c.vitals) {
      store.createVitals(patient.id, { ...v, measured_at: t(back, hhmm) }, BY);
      counts.vitals++;
    }
    for (const [back, values] of c.labs) {
      for (const [name, value] of Object.entries(values)) {
        store.createLab(patient.id, { name, value, collected_at: d(back) }, BY);
        counts.labs++;
      }
    }
    for (const [back, round, s, o, a, p] of c.soap) {
      store.createNote(patient.id, {
        note_date: d(back), round, subjective: s, objective: o, assessment: a, plan: p,
      }, BY);
      counts.soap++;
    }
  }
  return counts;
}

if (require.main === module) {
  // --clear ใช้ตอนจะเริ่มหอผู้ป่วยจากศูนย์ เช่น ล้างเคสตัวอย่างก่อนนำเข้าเคสจริง
  if (process.argv.includes('--clear')) {
    reset();
    console.log('ฐานข้อมูลว่างแล้ว พร้อมนำเข้าเคสจริงจากหน้าเว็บ (ปุ่ม “สำรอง / นำเข้า” บนหน้าแรก)');
    return;
  }
  if (process.argv.includes('--reset')) reset();
  const counts = seed();
  console.log(`ใส่ข้อมูลตัวอย่างแล้ว: ผู้ป่วย ${counts.patients} ราย, SOAP ${counts.soap}, V/S ${counts.vitals} ชุด, Lab ${counts.labs} ค่า, เหตุการณ์ ${counts.events}, ปัญหา ${counts.problems}, ผลตรวจ ${counts.ix}`);
  console.log('ทุกรายเป็นเคสสมมติ ชื่อย่อไม่ใช่ของจริง — ล้างทิ้งก่อนใส่เคสจริงด้วย node seed.js --clear');
}
