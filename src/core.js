/* ===== CORE: pure logic (no DOM) ===== */
const pad = n => String(n).padStart(2, '0');
const toMin = hm => { if (!hm) return null; const [h, m] = String(hm).split(':').map(Number); return h * 60 + m; };
const fromMin = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const dateKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m: 1-12
const monthKey = (y, m) => 'm-' + y + '-' + pad(m);
const minOfDay = ms => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

/* Vietnamese public holidays (Labour Code 2019 + Vietnam Culture Day, 24 Nov).
   kind 'holiday' = statutory holiday (paid 300%); 'comp' = compensatory day off (paid 200%).
   `key` (+ `n`) selects the display name in each language; user-added days carry a plain `name`. */
const DEFAULT_HOLIDAYS = [
  { date: '2026-01-01', key: 'newYear', kind: 'holiday' },
  { date: '2026-02-16', key: 'tetEve', kind: 'holiday' },
  { date: '2026-02-17', key: 'tet', n: 1, kind: 'holiday' },
  { date: '2026-02-18', key: 'tet', n: 2, kind: 'holiday' },
  { date: '2026-02-19', key: 'tet', n: 3, kind: 'holiday' },
  { date: '2026-02-20', key: 'tet', n: 4, kind: 'holiday' },
  { date: '2026-04-26', key: 'hungKings', kind: 'holiday' },
  { date: '2026-04-27', key: 'hungKingsComp', kind: 'comp' },
  { date: '2026-04-30', key: 'reunification', kind: 'holiday' },
  { date: '2026-05-01', key: 'labour', kind: 'holiday' },
  { date: '2026-09-01', key: 'nationalDayExtra', kind: 'holiday' },
  { date: '2026-09-02', key: 'nationalDay', kind: 'holiday' },
  { date: '2026-11-24', key: 'cultureDay', kind: 'holiday' },
  { date: '2027-01-01', key: 'newYear', kind: 'holiday' },
  { date: '2027-02-04', key: 'tetComp', kind: 'comp' },
  { date: '2027-02-05', key: 'tetEve', kind: 'holiday' },
  { date: '2027-02-06', key: 'tet', n: 1, kind: 'holiday' },
  { date: '2027-02-07', key: 'tet', n: 2, kind: 'holiday' },
  { date: '2027-02-08', key: 'tet', n: 3, kind: 'holiday' },
  { date: '2027-02-09', key: 'tet', n: 4, kind: 'holiday' },
  { date: '2027-02-10', key: 'tetComp', kind: 'comp' },
  { date: '2027-04-16', key: 'hungKings', kind: 'holiday' },
  { date: '2027-04-30', key: 'reunification', kind: 'holiday' },
  { date: '2027-05-01', key: 'labour', kind: 'holiday' },
  { date: '2027-05-03', key: 'labourComp', kind: 'comp' },
  { date: '2027-09-02', key: 'nationalDay', kind: 'holiday' },
  { date: '2027-09-03', key: 'nationalDayExtra', kind: 'holiday' },
  { date: '2027-11-24', key: 'cultureDay', kind: 'holiday' },
];

/* Vietnamese names saved by older versions → holiday keys (lets old data switch language). */
const LEGACY_HOLIDAY_NAMES = {
  'Tết Dương lịch': ['newYear'], 'Tết Nguyên đán (29 Tết)': ['tetEve'],
  'Tết Nguyên đán (Mùng 1)': ['tet', 1], 'Tết Nguyên đán (Mùng 2)': ['tet', 2], 'Tết Nguyên đán (Mùng 3)': ['tet', 3], 'Tết Nguyên đán (Mùng 4)': ['tet', 4],
  'Nghỉ bù Tết Nguyên đán': ['tetComp'], 'Giỗ Tổ Hùng Vương': ['hungKings'], 'Nghỉ bù Giỗ Tổ Hùng Vương': ['hungKingsComp'],
  'Ngày Chiến thắng 30/4': ['reunification'], 'Quốc tế Lao động 1/5': ['labour'], 'Nghỉ bù Quốc tế Lao động': ['labourComp'],
  'Quốc khánh 2/9': ['nationalDay'], 'Quốc khánh (ngày liền kề)': ['nationalDayExtra'], 'Ngày Văn hóa Việt Nam': ['cultureDay'],
};
function migrateHolidays(list) {
  return (list || []).map(h => {
    if (h.key || !h.name || !LEGACY_HOLIDAY_NAMES[h.name]) return h;
    const [key, n] = LEGACY_HOLIDAY_NAMES[h.name], out = { date: h.date, key, kind: h.kind };
    if (n) out.n = n;
    return out;
  });
}

/* Company pay policies. 'gross' = the original rules (Mon–Sat, day pay on gross pay); 'office' = Mon–Fri with
   a title salary, a monthly performance rate and allowances paid per day worked. Applying a preset sets the work
   days, lunch break and policy; salaries stay as entered.
   Pay item kinds: 'perDay' = amount × workdays; 'lunchDay' = amount per day worked across the whole lunch break;
   'byDays' = monthly amount × workdays ÷ standard workdays; 'fixed' = monthly amount for the days covered;
   'performance' = base salary × the month's rating % × workdays ÷ standard workdays.
   tax: 'taxable' | 'exempt' | 'meal' (cash meal allowance: tax-free up to the legal monthly cap). */
const THIRD = 100 / 3;
const POLICY_PRESETS = {
  gross: {
    work: { workDays: [1, 2, 3, 4, 5, 6], satStdHours: 4, lunchStart: '12:00', lunchEnd: '13:00', stdDaysMode: '26' },
    policy: () => ({
      preset: 'gross', periodStart: 1, dayPay: 'gross', otBasis: 'base', leavePay: 'base', otApproval: false, leaveUnitHours: 4,
      wfh: false, wfhCapPct: 0, t13: false, t13Basis: 'base', leaveAccrual: 'monthly', leaveFrom: 'official', holidayAsWork: false,
      items: [], ratings: [], defaultRating: '',
    }),
  },
  office: {
    work: { workDays: [1, 2, 3, 4, 5], lunchStart: '11:45', lunchEnd: '12:45', stdDaysMode: 'auto' },
    policy: () => ({
      preset: 'office', periodStart: 24, dayPay: 'base', otBasis: 'base', leavePay: 'base', otApproval: true, leaveUnitHours: 1,
      wfh: true, wfhCapPct: 30, t13: true, t13Basis: 'base', leaveAccrual: 'annual', leaveFrom: 'contract', holidayAsWork: true,
      items: [
        { id: 'perf', tpl: 'perf', name: '', kind: 'performance', amount: 0, when: 'both', tax: 'taxable' },
        { id: 'living', tpl: 'living', name: '', kind: 'perDay', amount: 20000, when: 'both', tax: 'taxable' },
        { id: 'lunch', tpl: 'lunch', name: '', kind: 'lunchDay', amount: 40000, when: 'both', tax: 'meal' },
        { id: 'beauty', tpl: 'beauty', name: '', kind: 'byDays', amount: 300000, when: 'official', tax: 'taxable' },
        { id: 'insPay', tpl: 'insPay', name: '', kind: 'byDays', amount: 4226484, when: 'probation', tax: 'taxable' },
      ],
      ratings: [
        { id: 'awesome', name: 'Awesome Performance', pct: THIRD + 1.5 },
        { id: 'excellent', name: 'Excellent Performance', pct: THIRD + 1 },
        { id: 'strong', name: 'Strong Performance', pct: THIRD + 0.5 },
        { id: 'solid', name: 'Solid Performance', pct: THIRD },
        { id: 'inconsistent', name: 'Inconsistent Performance', pct: THIRD - 0.5 },
        { id: 'under', name: 'Under Performing', pct: THIRD - 1 },
        { id: 'violation', name: 'Serious Violation', pct: 0 },
      ],
      defaultRating: 'solid',
    }),
  },
};
const policyOf = settings => ({ ...POLICY_PRESETS.gross.policy(), ...(settings.policy || {}) });
const workDaysOf = settings => (settings.work && Array.isArray(settings.work.workDays) && settings.work.workDays.length)
  ? settings.work.workDays : [1, 2, 3, 4, 5, 6];

const DEFAULT_SETTINGS = () => ({
  name: '',
  lang: null,                // 'en' | 'vi'; null = follow the device language
  office: { name: '', lat: null, lng: null, radius: 150 },
  work: {
    workDays: [1, 2, 3, 4, 5, 6], // weekdays worked (0 = Sunday … 6 = Saturday); other days are weekly rest days
    nightStart: '22:00', nightEnd: '06:00', // night work (Labour Code 2019, Art. 106)
    lunchStart: '12:00', lunchEnd: '13:00',
    satStdHours: 4,          // Saturday 8:00–12:00 = 1 workday
    afternoonCutoff: '15:00',// leaving the office after this time = check-out
    tripWindowMin: 60,       // leaving within the first 60 min after check-in = business trip
    dwellMin: 5,             // inside the office zone for 5 min = check-in
    leaveConfirmMin: 3,      // outside the zone for 3 min = left (geofence signals)
    leaveFinalizeMin: 60,    // left before the cutoff and not back after 60 min = the departure becomes the check-out
                             // (leaving around lunch: wait until 30 min after lunch ends)
    otBlockMin: 30,          // overtime counts in 30-min steps
    roundMin: 15,            // check-in/out rounded to 15-min blocks
    roundMode: 'down',       // 'down' = round both down (6:07→6:00, 6:47→6:45); 'company' = in up / out down; 'nearest'; 'none'
    roundRule: 2,
    stdDaysMode: 'auto',     // 'auto' = number of Mon–Sat days in the month, or a fixed number
    congUnitMin: 60,         // workdays count whole hours only: each full hour = 1/8 workday (Sat: 1/Sat standard hours)
    tripFullDayHours: 7,     // on a business-trip day, 7 h worked = 1 full workday
    trackStart: '05:30',     // start waiting for check-in on each workday
    trackEnd: '20:00',       // stop tracking if you left the office and did not come back
  },
  // Set once in Settings. base = base salary on the contract (social insurance, OT and paid leave); gross = total monthly pay.
  contract: {
    probation: { from: '', to: '', base: 0, gross: 0 },
    official: { from: '', to: '', base: 0, gross: 0 },   // `to` empty = open-ended
    dependents: 0,             // dependants registered for the family deduction
    probationTax: 'flat10',    // 'flat10' = separate probation contract < 3 months: 10% from the threshold per payment
                               // 'progressive' = probation inside a contract of 3+ months; 'commit' = signed the no-withholding commitment
    leaveDaysPerYear: 12,
  },
  policy: POLICY_PRESETS.gross.policy(),
  salaries: [],              // legacy pay rates (before Settings held the contract): migrated by contractOf()
  holidays: DEFAULT_HOLIDAYS.map(h => ({ ...h })),
});

/* Day type: 'holiday' | 'comp' | 'sunday' | 'rest' (another weekly rest day, e.g. Saturday at a Mon–Fri company)
   | 'saturday' (a Saturday that is worked) | 'weekday'; `holiday` is the matching holiday entry; `work` = a workday of the week.
   The third argument is either the settings or a list of workdays. */
function dayType(key, holidays, wd) {
  const dow = parseKey(key).getDay();
  const days = Array.isArray(wd) ? wd : wd ? workDaysOf(wd) : [1, 2, 3, 4, 5, 6];
  const work = days.includes(dow);
  const h = (holidays || []).find(x => x.date === key);
  if (h && h.kind === 'holiday') return { type: 'holiday', holiday: h, dow, work };
  if (h && h.kind === 'comp') return { type: 'comp', holiday: h, dow, work };
  if (dow === 0) return { type: 'sunday', dow, work: false };
  if (!work) return { type: 'rest', dow, work };
  if (dow === 6) return { type: 'saturday', dow, work };
  return { type: 'weekday', dow, work };
}
const dayTypeOf = (key, settings) => dayType(key, settings.holidays, settings);

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/* Leave hours of a record: {hours} (hourly leave) or {part:'full'|'am'|'pm'} (half days). */
const leaveHours = lv => lv.hours > 0 ? Math.min(8, +lv.hours) : (lv.part === 'am' || lv.part === 'pm' ? 4 : 8);

/* Computes one day. opts.nowMin: for today without a check-out, count up to the current time.
   rec.leave = {type:'paid'|'unpaid', part:'full'|'am'|'pm'} or {type, hours} marks annual (paid) leave or unpaid leave.
   rec.wfh = worked from home (counts as a normal workday). rec.otApproved = approved overtime hours, used instead of
   the recorded overtime when the policy requires approval. */
function computeDay(key, rec, settings, opts) {
  const r = computeWorkDay(key, rec, settings, opts);
  const P = policyOf(settings);
  r.wfh = !!(rec && rec.wfh && P.wfh);
  // Overtime that needs approval: pay the approved hours at the day's rate; recorded overtime is kept for reference
  r.otRecorded = r.ot150 + r.ot200 + r.ot300 + r.otn200 + r.otn270 + r.otn390; r.otPending = 0; r.otApproved = null;
  if (P.otApproval) {
    const ap = Math.max(0, Math.round((+(rec && rec.otApproved) || 0) * 60));
    r.otApproved = ap;
    r.ot150 = r.ot200 = r.ot300 = r.otn200 = r.otn270 = r.otn390 = 0;
    if (r.dt.type === 'holiday') r.ot300 = ap;
    else if (r.dt.type === 'weekday' || r.dt.type === 'saturday') r.ot150 = ap;
    else r.ot200 = ap;
    r.otPending = Math.max(0, r.otRecorded - ap);
  }
  r.leave = null; r.paidLeave = 0; r.unpaidLeave = 0;
  const lv = rec && rec.leave;
  if (!lv || (lv.type !== 'paid' && lv.type !== 'unpaid')) return r;
  if (r.dt.type !== 'weekday' && r.dt.type !== 'saturday') return r; // rest days and holidays are already days off
  const hours = r.dt.type === 'saturday' ? 8 : leaveHours(lv);   // a short Saturday counts as one whole day
  const amt = hours / 8;
  const part = hours >= 8 ? 'full' : lv.hours > 0 ? 'hours' : lv.part;
  r.leave = { type: lv.type, part, hours, days: amt };
  r.cong = Math.max(0, Math.min(r.cong, 1 - amt));        // leave + work never exceed 1 workday
  if (lv.type === 'paid') r.paidLeave = amt; else r.unpaidLeave = amt;
  return r;
}

function computeWorkDay(key, rec, settings, opts) {
  const w = settings.work;
  const dt = dayTypeOf(key, settings);
  const g = (rec && rec.gps) || {};
  const inHM = (rec && rec.manualIn) || g.in || null;
  // Left before the cutoff and has not come back (morning shift, leaving early): the departure is a provisional check-out
  const leftEarly = !(rec && rec.manualOut) && !g.out && g.status === 'out' && g.lastLeave ? g.lastLeave : null;
  const outHM = (rec && rec.manualOut) || g.out || leftEarly || null;
  const r = {
    key, dt, inHM, outHM,
    inSrc: rec && rec.manualIn ? 'manual' : (g.in ? 'gps' : null),
    outSrc: rec && rec.manualOut ? 'manual' : (g.out || leftEarly ? 'gps' : null),
    provisionalOut: !!leftEarly,
    trips: g.trips || [], note: (rec && rec.note) || '',
    trip: !!((g.trips && g.trips.length) || (rec && rec.manualTrip)),
    workedMin: 0, lunchMin: 0, regularMin: 0, cong: 0, paidCong: 0,
    rawExtra: 0, ot150: 0, ot200: 0, ot300: 0, otn200: 0, otn270: 0, otn390: 0, nightMin: 0, spansLunch: false,
    missingOut: false, live: false, invalid: false, inR: null, outR: null,
  };
  if ((dt.type === 'holiday' || dt.type === 'comp') && dt.work) r.paidCong = 1; // paid holiday on a workday
  if (!inHM) return r;
  const RB = Math.max(1, +w.roundMin || 15), mode = w.roundMode || 'company';
  const rIn = m => mode === 'none' ? m : mode === 'nearest' ? Math.round(m / RB) * RB : mode === 'down' ? Math.floor(m / RB) * RB : Math.ceil(m / RB) * RB;
  const rOut = m => mode === 'none' ? m : mode === 'nearest' ? Math.round(m / RB) * RB : Math.floor(m / RB) * RB;
  const inMin = rIn(toMin(inHM));
  r.inR = fromMin(inMin);
  let outMin = toMin(outHM);
  if (outMin == null) {
    if (opts && opts.nowMin != null) { outMin = opts.nowMin; r.live = true; }
    else { r.missingOut = true; return r; }
  }
  outMin = rOut(outMin);
  r.outR = fromMin(outMin);
  if (outMin <= inMin) { r.invalid = !r.live && toMin(outHM) <= toMin(inHM); return r; }
  r.lunchMin = overlap(inMin, outMin, toMin(w.lunchStart), toMin(w.lunchEnd));
  r.spansLunch = toMin(inHM) <= toMin(w.lunchStart) && (r.live ? outMin : toMin(outHM)) >= toMin(w.lunchEnd);
  r.workedMin = outMin - inMin - r.lunchMin;
  const B = Math.max(1, +w.otBlockMin || 30);
  const floorB = m => Math.floor(m / B) * B;
  if (dt.type === 'weekday' || dt.type === 'saturday') {
    const std = dt.type === 'saturday' ? (+w.satStdHours) * 60 : 480;
    r.regularMin = Math.min(r.workedMin, std);
    // Workdays count whole hours: 4h45 is still 4 h = 0.5; a business-trip day with 7 h = 1 workday
    const unit = Math.max(1, +w.congUnitMin || 60);
    const counted = Math.floor(r.workedMin / unit) * unit;
    r.cong = Math.min(1, counted / std);
    if (dt.type === 'weekday' && r.trip && r.workedMin >= (+w.tripFullDayHours || 7) * 60) r.cong = 1;
    r.rawExtra = Math.max(0, r.workedMin - std);
    r.ot150 = floorB(r.rawExtra);
  } else if (dt.type === 'sunday' || dt.type === 'rest' || dt.type === 'comp') {
    r.ot200 = floorB(r.workedMin);
  } else if (dt.type === 'holiday') {
    r.ot300 = floorB(r.workedMin);
  }
  // Night work (22:00–06:00): overtime in those hours is paid 200% (workday), 270% (rest day), 390% (holiday)
  // (Decree 145/2020, Art. 57: OT rate + 30% + 20% of the day rate); normal hours at night earn +30%.
  // Night hours are counted as overtime first.
  const ns = toMin(w.nightStart || '22:00'), ne = toMin(w.nightEnd || '06:00');
  const night = floorB(overlap(inMin, outMin, ns, 24 * 60) + overlap(inMin, outMin, 0, ne));
  if (night > 0) {
    let used = 0;
    if (r.ot150) { used = Math.min(r.ot150, night); r.ot150 -= used; r.otn200 = used; }
    else if (r.ot200) { used = Math.min(r.ot200, night); r.ot200 -= used; r.otn270 = used; }
    else if (r.ot300) { used = Math.min(r.ot300, night); r.ot300 -= used; r.otn390 = used; }
    r.nightMin = Math.max(0, Math.min(night - used, r.regularMin));
  }
  return r;
}

const addDays = (key, n) => { const d = parseKey(key); d.setDate(d.getDate() + n); return dateKey(d); };

/* The contract from Settings; older data that only has dated pay rates is converted on the fly. */
function contractOf(settings) {
  const d = DEFAULT_SETTINGS().contract, c = settings.contract || {};
  const out = { ...d, ...c, probation: { ...d.probation, ...(c.probation || {}) }, official: { ...d.official, ...(c.official || {}) } };
  if (!out.probation.from && !out.official.from && (settings.salaries || []).length) {
    const list = settings.salaries.slice().sort((a, b) => a.from < b.from ? -1 : 1);
    const last = st => list.filter(x => (x.status || 'probation') === st).pop();
    const p = last('probation'), o = last('official');
    if (p) out.probation = { from: p.from, to: '', base: p.otBase || p.amount, gross: p.amount };
    if (o) out.official = { from: o.from, to: '', base: o.otBase || o.amount, gross: o.amount };
    if (p && o && o.from > p.from) out.probation.to = addDays(o.from, -1);
  }
  return out;
}

/* The contract period covering a day: {status, from, to, base, gross, amount, otBase} or null. */
function salaryOn(key, contract) {
  for (const status of ['official', 'probation']) {
    const p = contract[status];
    if (!p || !p.from || !(p.gross > 0 || p.base > 0) || key < p.from || (p.to && key > p.to)) continue;
    const base = p.base > 0 ? p.base : p.gross, gross = p.gross > 0 ? p.gross : base;
    return { id: status, status, from: p.from, to: p.to, gross, base, amount: gross, otBase: base };
  }
  return null;
}
const otBaseOf = sal => sal ? sal.base : 0;

/* ===== Insurance and personal income tax (Vietnam) =====
   Employee insurance: social 8% + health 1.5% + unemployment 1% of the contract base salary (Social Insurance Law 2024,
   Employment Law 2025). Social/health insurance capped at 20 × the statutory base pay (lương cơ sở: 2,340,000;
   2,530,000 from 1 Jul 2026, Decree 161/2026); unemployment insurance capped at 20 × the region I minimum wage
   (5,310,000 from 2026, Decree 293/2025). Not due in a month with 14+ working days not worked and unpaid
   (including days outside the permanent contract).
   PIT from tax year 2026 (Law 109/2025/QH15): 5 progressive brackets; deductions 15.5 M for the taxpayer and
   6.2 M per dependant; all overtime pay is exempt (Decree 253/2026, Art. 26). Contracts under 3 months: 10% withheld
   on payments from 5,000,000 VND (2,000,000 before 1 Jul 2026), settled in the annual tax return. */
const TAX = {
  baseSalary: [['2024-07-01', 2340000], ['2026-07-01', 2530000]],
  regionMin: [['2025-01-01', 4960000], ['2026-01-01', 5310000]],
  ins: { social: 0.08, health: 0.015, unemployment: 0.01 },
  personal: 15500000, dependant: 6200000,
  brackets: [[10e6, 0.05], [30e6, 0.10], [60e6, 0.20], [100e6, 0.30], [Infinity, 0.35]],
  flatRate: 0.10, flatThreshold: [['2026-01-01', 2000000], ['2026-07-01', 5000000]],
  // Cash meal allowance tax-free up to this amount a month (Circular 26/2016; 1,200,000 from 1 Jul 2026, Decree 253/2026 Art. 8)
  mealCap: [['2016-01-01', 730000], ['2026-07-01', 1200000]],
};
const asOf = (table, key) => table.filter(([d]) => d <= key).reduce((v, [, x]) => x, table[0][1]);

function progressiveTax(income) {
  let tax = 0, lo = 0;
  for (const [hi, rate] of TAX.brackets) {
    if (income <= lo) break;
    tax += (Math.min(income, hi) - lo) * rate; lo = hi;
  }
  return Math.round(tax);
}

/* Employee insurance for a month. rows: computeMonth rows (for unpaid leave). */
function insuranceFor(y, m, rows, contract) {
  const off = contract.official, first = y + '-' + pad(m) + '-01';
  const none = reason => ({ due: false, reason, base: 0, social: 0, health: 0, unemployment: 0, total: 0 });
  if (!off.from || !(off.gross > 0 || off.base > 0)) return none(rows.some(r => r.salary && r.salary.status === 'probation') ? 'probation' : 'noContract');
  let covered = 0, notWorked = 0;
  for (const r of rows) {
    if (!r.dt.work) continue;                           // weekly rest day
    const inC = r.key >= off.from && (!off.to || r.key <= off.to);
    if (inC) { covered++; notWorked += r.unpaidLeave; } else notWorked++;
  }
  if (!covered) return none('probation');
  if (notWorked >= 14) return none('under14');
  const base = off.base > 0 ? off.base : off.gross;
  const capSH = 20 * asOf(TAX.baseSalary, first), capU = 20 * asOf(TAX.regionMin, first);
  const social = Math.round(Math.min(base, capSH) * TAX.ins.social);
  const health = Math.round(Math.min(base, capSH) * TAX.ins.health);
  const unemployment = Math.round(Math.min(base, capU) * TAX.ins.unemployment);
  return { due: true, reason: null, base, capped: base > capSH, social, health, unemployment, total: social + health + unemployment };
}

/* Pay, insurance, PIT and take-home pay of a computed month. */
function deductionsFor(y, m, rows, totals, contract) {
  const ins = insuranceFor(y, m, rows, contract);
  const first = y + '-' + pad(m) + '-01';
  // Taxable income per period: day pay + taxable items + the part of meal allowances above the legal cap
  const sumSt = (st, f) => Math.round(rows.filter(r => r.salary && r.salary.status === st).reduce((a, r) => a + f(r), 0));
  const mealCap = asOf(TAX.mealCap, first);
  const meal = { probation: sumSt('probation', r => r.mealRaw), official: sumSt('official', r => r.mealRaw) };
  const mealTotal = meal.probation + meal.official, mealExempt = Math.min(mealTotal, mealCap);
  const mealExcess = st => mealTotal ? Math.round((meal[st] / mealTotal) * (mealTotal - mealExempt)) : 0;
  const incomeOf = st => sumSt(st, r => r.cong * r.daily + r.paidCong * r.daily + r.paidLeave * r.leaveDaily + r.taxableRaw) + mealExcess(st);
  const probInc = incomeOf('probation'), offInc = incomeOf('official');
  const deps = Math.max(0, Math.floor(+contract.dependents || 0));
  const family = TAX.personal + deps * TAX.dependant;
  const mode = contract.probationTax || 'flat10';
  const progIncome = offInc + (mode === 'progressive' ? probInc : 0);
  const taxable = Math.max(0, progIncome - ins.total - family);
  const pitProgressive = progIncome > 0 ? progressiveTax(taxable) : 0;
  const threshold = asOf(TAX.flatThreshold, first);
  const flatDue = mode === 'flat10' && probInc >= threshold;
  const pitFlat = flatDue ? Math.round(probInc * TAX.flatRate) : 0;
  const pit = pitProgressive + pitFlat;
  const exemptItems = totals.items.filter(i => i.tax === 'exempt').reduce((a, i) => a + i.amount, 0);
  return {
    insurance: ins, probationIncome: probInc, officialIncome: offInc, otExempt: totals.otPay,
    mealCap, mealTotal, mealExempt, exemptItems,
    mode, dependents: deps, family, progIncome, taxable, pitProgressive,
    flatThreshold: threshold, flatDue, pitFlat, pit,
    gross: totals.total, totalDeductions: ins.total + pit, net: totals.total - ins.total - pit,
  };
}

/* The pay period of month m: the calendar month, or — when the policy's period starts on day S > 1 —
   from day S of the previous month to day S−1 of month m (e.g. "November" = 24 Oct – 23 Nov). */
function periodOf(y, m, settings) {
  const S = Math.min(28, Math.max(1, Math.floor(+policyOf(settings).periodStart || 1)));
  let from, to;
  if (S === 1) { from = new Date(y, m - 1, 1); to = new Date(y, m, 0); }
  else { from = new Date(y, m - 2, S); to = new Date(y, m - 1, S - 1); }
  const keys = [];
  for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) keys.push(dateKey(d));
  return { start: S, from: keys[0], to: keys[keys.length - 1], keys };
}
/* The pay month (y, m) whose period contains the day. */
function payMonthOf(key, settings) {
  const S = Math.min(28, Math.max(1, Math.floor(+policyOf(settings).periodStart || 1)));
  const [y, m, d] = key.split('-').map(Number);
  if (S === 1 || d < S) return { y, m };
  return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
}

/* Standard workdays: the workdays of the week in the pay period (holidays included), or a fixed number. */
function stdDays(y, m, settings) {
  const mode = settings.work.stdDaysMode;
  if (mode !== 'auto' && +mode > 0) return +mode;
  const wd = workDaysOf(settings);
  return periodOf(y, m, settings).keys.filter(k => wd.includes(parseKey(k).getDay())).length;
}

const itemApplies = (it, sal) => sal && (it.when === 'both' || !it.when || it.when === sal.status);
/* Amount of one pay item for one day (unrounded). rate: the month's performance %. */
function itemAmount(it, r, sal, std, rate, P) {
  if (!itemApplies(it, sal)) return 0;
  const amt = +it.amount || 0;
  const c = r.cong + (P && P.holidayAsWork ? r.paidCong : 0);   // paid holidays count as days worked when the policy says so
  switch (it.kind) {
    case 'perDay': return amt * c;
    case 'lunchDay': return r.cong > 0 && r.spansLunch ? amt : 0;
    case 'byDays': return amt * c / std;
    case 'fixed': return r.dt.work ? amt / std : 0;
    case 'performance': return sal.base * (rate || 0) / 100 * c / std;
    default: return 0;
  }
}
/* The month's performance rating: chosen in the Pay tab (stored on the month), else the policy default. */
function ratingFor(P, chosen) {
  const list = P.ratings || [];
  return list.find(x => x.id === chosen) || list.find(x => x.id === P.defaultRating) || list[0] || null;
}

/* Computes a pay month (its pay period). days: {'YYYY-MM-DD': rec}, covering the whole period.
   now: {key, min} for today's running total. month: the stored month ({rating}) for monthly inputs. */
function computeMonth(y, m, days, settings, now, month) {
  const std = stdDays(y, m, settings);
  const period = periodOf(y, m, settings);
  const rows = [];
  const C = contractOf(settings), P = policyOf(settings);
  const rating = ratingFor(P, month && month.rating);
  const items = (P.items || []).map(it => ({ ...it, raw: 0 }));
  const t = { workedMin: 0, cong: 0, paidCong: 0, paidLeave: 0, unpaidLeave: 0, ot150: 0, ot200: 0, ot300: 0,
    otn200: 0, otn270: 0, otn390: 0, nightMin: 0,
    workPay: 0, holidayPay: 0, leavePay: 0, ot150Pay: 0, ot200Pay: 0, ot300Pay: 0,
    otn200Pay: 0, otn270Pay: 0, otn390Pay: 0, nightPay: 0, itemsPay: 0,
    basePay: 0, otPay: 0, total: 0, tripDays: 0, missing: 0, noSalaryDays: 0,
    wfhDays: 0, otPending: 0, lunchDays: 0, t13Cong: 0 };
  const raw = { workPay: 0, holidayPay: 0, leavePay: 0, ot150Pay: 0, ot200Pay: 0, ot300Pay: 0, otn200Pay: 0, otn270Pay: 0, otn390Pay: 0, nightPay: 0 };
  const NIGHT = { otn200: 2, otn270: 2.7, otn390: 3.9 };
  for (const key of period.keys) {
    const opts = now && now.key === key ? { nowMin: now.min } : null;
    const r = computeDay(key, days[key] || {}, settings, opts);
    const sal = salaryOn(key, C);
    r.salary = sal;
    const pick = (mode) => sal ? (mode === 'gross' ? sal.gross : sal.base) / std : 0;
    r.daily = pick(P.dayPay);                         // day rate
    r.leaveDaily = pick(P.leavePay);                  // paid leave rate
    r.baseDaily = r.leaveDaily;
    r.hourly = pick(P.otBasis) / 8;                   // OT hourly rate
    r.workPay = Math.round(r.cong * r.daily);
    r.holidayPay = Math.round(r.paidCong * r.daily);
    r.leavePay = Math.round(r.paidLeave * r.leaveDaily);
    r.ot150Pay = Math.round(r.ot150 / 60 * 1.5 * r.hourly);
    r.ot200Pay = Math.round(r.ot200 / 60 * 2 * r.hourly);
    r.ot300Pay = Math.round(r.ot300 / 60 * 3 * r.hourly);
    for (const k in NIGHT) r[k + 'Pay'] = Math.round(r[k] / 60 * NIGHT[k] * r.hourly);
    r.nightPay = Math.round(r.nightMin / 60 * 0.3 * r.hourly);
    r.items = {}; r.taxableRaw = 0; r.mealRaw = 0;
    let itemsDay = 0;
    for (const it of items) {
      const v = itemAmount(it, r, sal, std, rating ? rating.pct : 0, P);
      if (!v) continue;
      r.items[it.id] = v; it.raw += v; itemsDay += v;
      if (it.tax === 'meal') r.mealRaw += v; else if (it.tax !== 'exempt') r.taxableRaw += v;
    }
    r.basePay = r.workPay + r.holidayPay + r.leavePay;
    r.otPay = r.ot150Pay + r.ot200Pay + r.ot300Pay + r.otn200Pay + r.otn270Pay + r.otn390Pay + r.nightPay;
    r.itemsPay = Math.round(itemsDay);
    r.total = r.basePay + r.otPay + r.itemsPay;
    if (!sal && (r.cong || r.paidCong || r.paidLeave || r.ot150 || r.ot200 || r.ot300)) t.noSalaryDays++;
    t.workedMin += r.workedMin; t.cong += r.cong; t.paidCong += r.paidCong;
    t.paidLeave += r.paidLeave; t.unpaidLeave += r.unpaidLeave;
    t.ot150 += r.ot150; t.ot200 += r.ot200; t.ot300 += r.ot300;
    t.otn200 += r.otn200; t.otn270 += r.otn270; t.otn390 += r.otn390; t.nightMin += r.nightMin;
    if (r.wfh && r.cong > 0) t.wfhDays++;
    if (r.cong > 0 && r.spansLunch) t.lunchDays++;
    t.otPending += r.otPending;
    if (sal) t.t13Cong += r.cong + r.paidCong + r.paidLeave;   // days under contract counted for the 13th-month salary
    // Month totals add the unrounded day amounts, so a full month of work pays exactly the monthly gross
    raw.workPay += r.cong * r.daily; raw.holidayPay += r.paidCong * r.daily; raw.leavePay += r.paidLeave * r.leaveDaily;
    raw.ot150Pay += r.ot150 / 60 * 1.5 * r.hourly; raw.ot200Pay += r.ot200 / 60 * 2 * r.hourly; raw.ot300Pay += r.ot300 / 60 * 3 * r.hourly;
    for (const k in NIGHT) raw[k + 'Pay'] += r[k] / 60 * NIGHT[k] * r.hourly;
    raw.nightPay += r.nightMin / 60 * 0.3 * r.hourly;
    if (r.trip) t.tripDays++;
    if (r.missingOut || r.invalid) t.missing++;
    rows.push(r);
  }
  for (const k in raw) t[k] = Math.round(raw[k]);
  t.items = items.map(it => ({ id: it.id, tpl: it.tpl, name: it.name, kind: it.kind, tax: it.tax, unit: +it.amount || 0, amount: Math.round(it.raw) }));
  t.itemsPay = t.items.reduce((a, i) => a + i.amount, 0);
  t.basePay = t.workPay + t.holidayPay + t.leavePay;
  t.otPay = t.ot150Pay + t.ot200Pay + t.ot300Pay + t.otn200Pay + t.otn270Pay + t.otn390Pay + t.nightPay;
  t.total = t.basePay + t.otPay + t.itemsPay;
  // Gross per contract period, for months that are split across two payslips (probation + permanent)
  t.byStatus = {};
  for (const r of rows) if (r.salary) t.byStatus[r.salary.status] = (t.byStatus[r.salary.status] || 0) + r.cong * r.daily + r.paidCong * r.daily
    + r.paidLeave * r.leaveDaily + (r.ot150 * 1.5 + r.ot200 * 2 + r.ot300 * 3 + r.otn200 * 2 + r.otn270 * 2.7 + r.otn390 * 3.9 + r.nightMin * 0.3) / 60 * r.hourly
    + Object.values(r.items).reduce((a, v) => a + v, 0);
  for (const k in t.byStatus) t.byStatus[k] = Math.round(t.byStatus[k]);
  t.wfhCap = P.wfh && P.wfhCapPct > 0 ? Math.floor(std * P.wfhCapPct / 100 + 1e-9) : null;
  return { y, m, std, period, rows, totals: t, contract: C, policy: P, rating, deductions: deductionsFor(y, m, rows, t, C) };
}

/* 13th-month salary estimate: basis salary × days counted (workdays incl. WFH, paid holidays, paid leave, probation
   included) ÷ the standard workdays of the year's 12 pay periods. monthDays(m) = the days covering pay month m. */
function t13For(y, monthDays, settings) {
  let days = 0, std = 0;
  const cal = settings;
  for (let m = 1; m <= 12; m++) {
    std += stdDays(y, m, cal);
    days += computeMonth(y, m, monthDays(m) || {}, cal).totals.t13Cong;
  }
  const C = contractOf(settings), P = policyOf(settings);
  const p = C.official.from && (C.official.gross > 0 || C.official.base > 0) ? C.official : C.probation;
  const basis = P.t13Basis === 'gross' ? (p.gross > 0 ? p.gross : p.base) : (p.base > 0 ? p.base : p.gross);
  return { days: Math.round(days * 1000) / 1000, std, basis: basis || 0, amount: std ? Math.round((basis || 0) * days / std) : 0 };
}

/* Annual leave used in a year. monthDays(m) returns that month's {key: rec}. */
function leaveUsed(y, monthDays, settings, asOf) {
  let used = 0;
  for (let m = 1; m <= 12; m++) {
    const days = monthDays(m) || {};
    for (const [key, rec] of Object.entries(days)) {
      if (!rec || !rec.leave || rec.leave.type !== 'paid') continue;
      const dt = dayTypeOf(key, settings);
      if (dt.type === 'weekday') used += leaveHours(rec.leave) / 8;
      else if (dt.type === 'saturday') used += 1;
    }
  }
  const C = contractOf(settings), quota = Math.max(0, +C.leaveDaysPerYear || 0);
  let accrued = quota;
  // Monthly accrual: quota ÷ 12 for each month of the year from the leave start month (included) up to asOf.
  // Leave starts with the permanent contract (preset 1) or with the first contract.
  const P = policyOf(settings);
  if (P.leaveAccrual === 'monthly' && asOf) {
    const start0 = P.leaveFrom === 'official' ? C.official.from : (C.probation.from || C.official.from);
    if (start0 && start0 <= asOf) {
      const start = start0 < y + '-01-01' ? y + '-01-01' : start0;
      const end = asOf < y + '-12-31' ? asOf : y + '-12-31';
      const [sy, sm] = start.split('-').map(Number), [ey, em] = end.split('-').map(Number);
      const months = end < start ? 0 : (ey - sy) * 12 + (em - sm) + 1;
      accrued = Math.min(quota, Math.round(months * quota / 12 * 100) / 100);
    } else accrued = 0;
  }
  return { used: Math.round(used * 1000) / 1000, quota, accrued, monthly: accrued !== quota || policyOf(settings).leaveAccrual === 'monthly',
    left: Math.round((accrued - used) * 1000) / 1000 };
}

/* ===== GPS state machine (office day / trip day) =====
   rt: transient state {insideSince, outsideSince}
   g : persisted rec.gps {in, out, trips:[{start,end}], status:'in'|'trip'|'out'|'left', lastLeave}
   manualIn: manual check-in time, if any. GPS never creates a second check-in after a manual one,
             and the "first hour" trip window is measured from the effective check-in (GPS or manual).
   Returns new log events as {t, code, p}; the app translates `code` for display. */
/* Left before the cutoff and not back: the minute of the day when the provisional check-out becomes final.
   Leaving from 30 min before lunch until lunch ends waits until 30 min after lunch, so a lunch break isn't a check-out. */
const LUNCH_GRACE_MIN = 30;
function leaveFinalMin(leftHM, settings) {
  const w = settings.work, dep = toMin(leftHM);
  const ls = toMin(w.lunchStart), le = toMin(w.lunchEnd);
  let at = dep + Math.max(1, +w.leaveFinalizeMin || 60);
  if (dep >= ls - LUNCH_GRACE_MIN && dep < le) at = Math.max(at, le + LUNCH_GRACE_MIN);
  return at;
}

/* Turns a provisional check-out (left early, not back) into the check-out.
   how: undefined = only if its time has come (or the day is over); 'service' = Android decided it was time;
   'widget' | 'notification' | 'app' = you confirmed it. Returns the log events. */
function settleLeave(g, key, nowMs, settings, how) {
  if (!g || g.status !== 'out' || !g.lastLeave) return [];
  const at = g.lastLeave, finalMin = leaveFinalMin(at, settings);
  const sameDay = dateKey(new Date(nowMs)) === key;
  let t;
  if (how) t = sameDay ? fromMin(minOfDay(nowMs)) : fromMin(Math.min(finalMin, 1439));
  else if (!sameDay && dateKey(new Date(nowMs)) > key) t = fromMin(Math.min(finalMin, 1439));
  else if (sameDay && minOfDay(nowMs) >= finalMin) t = fromMin(finalMin);
  else return [];
  g.out = at; g.status = 'left'; g.lastLeave = null;
  if (how && how !== 'service') return [{ t, code: 'gps.leaveConfirmed', p: { at, src: how } }];
  return [{ t, code: 'gps.leaveFinal', p: { at } }];
}

function gpsStep(rt, g, inside, nowMs, settings, manualIn) {
  const w = settings.work, ev = [];
  ev.push(...settleLeave(g, dateKey(new Date(nowMs)), nowMs, settings));
  const t = ms => fromMin(minOfDay(ms));
  const dwellMs = w.dwellMin * 60000;
  g.trips = g.trips || [];
  if (inside) {
    rt.outsideSince = null;
    if (rt.insideSince == null) rt.insideSince = nowMs;
    const stayed = nowMs - rt.insideSince;
    if (stayed < dwellMs) return ev;              // not inside long enough yet
    const at = t(rt.insideSince);
    if (!g.status) {                              // first confirmed presence of the day
      g.status = 'in';
      if (manualIn) ev.push({ t: at, code: 'gps.presentManual', p: { manualIn } });
      else { g.in = at; ev.push({ t: at, code: 'gps.checkIn', p: { dwell: w.dwellMin } }); }
    } else if (g.status !== 'in') {
      if (g.status === 'trip') {
        const last = g.trips[g.trips.length - 1];
        if (last && !last.end) last.end = at;
        ev.push({ t: at, code: 'gps.backFromTrip' });
      } else if (g.status === 'left') {
        ev.push({ t: at, code: 'gps.backUndoOut', p: { out: g.out } });
        g.out = null;
      } else {
        ev.push({ t: at, code: 'gps.back' });
      }
      g.status = 'in';
      g.lastLeave = null;
    }
  } else {
    // Just left the zone: settle the time spent inside first (in case no "dwell" signal arrived)
    if (rt.insideSince != null) ev.push(...gpsStep(rt, g, true, nowMs, settings, manualIn));
    rt.insideSince = null;
    if (rt.outsideSince == null) rt.outsideSince = nowMs;
    if (g.status === 'in' && nowMs - rt.outsideSince >= w.leaveConfirmMin * 60000) {
      const dep = rt.outsideSince, depMin = minOfDay(dep), at = t(dep);
      const inRef = g.in || manualIn;
      if (depMin >= toMin(w.afternoonCutoff)) {
        g.out = at; g.status = 'left';
        ev.push({ t: at, code: 'gps.checkOut', p: { cutoff: w.afternoonCutoff } });
      } else if (!g.trips.length && inRef && depMin - toMin(inRef) <= w.tripWindowMin) {
        g.trips.push({ start: at, end: null }); g.status = 'trip';
        ev.push({ t: at, code: 'gps.trip', p: { window: w.tripWindowMin } });
      } else {
        g.status = 'out'; g.lastLeave = at;
        ev.push({ t: at, code: 'gps.leftEarly', p: { at } });
      }
    }
  }
  return ev;
}

/* Replays location events queued by Android while the app was closed.
   events: [{type:'enter'|'dwell'|'exit'|'punch'|'finalize', time, dist?, acc?, fresh?, rejected?, info?, wifi?, force?, src?, kind?}]
   rtByDay: {key: {insideSince, outsideSince}}; getRec(key) returns the day record (created if missing).
   Returns [{key, kind:'event', t, code, p}] and [{key, kind:'signal', t, type, dist, acc, rejected, src, wifi, info}].
   Signals Android reported wrongly (rejected) or that are for reference only (info) are logged, never counted. */
function geofenceReplay(events, rtByDay, getRec, settings) {
  const out = [], w = settings.work;
  const list = events.slice().sort((a, b) => a.time - b.time);
  for (const e of list) {
    const key = dateKey(new Date(e.time));
    const rt = rtByDay[key] || (rtByDay[key] = { insideSince: null, outsideSince: null });
    const rec = getRec(key);
    const g = rec.gps || (rec.gps = {});
    if (e.type === 'punch') {               // Check in / Check out tapped on the widget or a notification
      const hm = fromMin(minOfDay(e.time)), src = e.src === 'notification' ? 'notification' : 'widget';
      if (e.kind === 'in' && !rec.manualIn) {
        rec.manualIn = hm;
        out.push({ key, kind: 'event', t: hm, code: 'punch.in', p: { src } });
      } else if (e.kind === 'in') {
        out.push({ key, kind: 'event', t: hm, code: 'punch.inIgnored', p: { src, manualIn: rec.manualIn } });
      } else if (e.kind === 'out') {
        const was = rec.manualOut;
        rec.manualOut = hm;
        out.push({ key, kind: 'event', t: hm, code: was ? 'punch.outWas' : 'punch.out', p: { src, was } });
      }
      continue;
    }
    if (e.type === 'finalize') {            // the provisional check-out was confirmed (widget, notification) or its time came
      const how = e.src === 'widget' || e.src === 'notification' ? e.src : 'service';
      const evs = settleLeave(g, key, e.time, settings, how);
      if (!evs.length && how !== 'service' && e.at && !rec.manualOut && !g.out) {
        rec.manualOut = e.at;                // the phone knew a departure the app hadn't replayed: keep what you confirmed
        evs.push({ t: fromMin(minOfDay(e.time)), code: 'gps.leaveConfirmed', p: { at: e.at, src: how } });
      }
      evs.forEach(x => out.push({ key, kind: 'event', ...x }));
      continue;
    }
    out.push({ key, kind: 'signal', t: fromMin(minOfDay(e.time)), type: e.type, dist: e.dist ?? null, acc: e.acc ?? null,
      rejected: !!e.rejected, src: e.src || 'geofence', wifi: !!e.wifi, info: !!e.info });
    if (e.rejected || e.info) continue;
    const push = evs => evs.forEach(x => out.push({ key, kind: 'event', ...x }));
    const mi = rec.manualIn || null;
    if (e.type === 'enter') push(gpsStep(rt, g, true, e.time, settings, mi));
    else if (e.type === 'dwell') {
      if (rt.insideSince == null) rt.insideSince = e.time - w.dwellMin * 60000;
      // "Confirm" tapped on the notification before 5 minutes passed: treat as stayed long enough; check-in is still the arrival time
      const vt = e.force ? Math.max(e.time, rt.insideSince + w.dwellMin * 60000) : e.time;
      push(gpsStep(rt, g, true, vt, settings, mi));
    } else if (e.type === 'exit') {
      push(gpsStep(rt, g, false, e.time, settings, mi));
      push(gpsStep(rt, g, false, e.time + w.leaveConfirmMin * 60000, settings, mi));
    }
  }
  return out;
}

function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const fmtH = min => { const h = Math.floor(min / 60), mm = min % 60; return min ? h + 'h' + (mm ? pad(mm) : '') : '0h'; };
/* ===== END CORE ===== */
