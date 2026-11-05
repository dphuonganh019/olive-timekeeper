// Run: TZ=Asia/Bangkok npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = {};
vm.createContext(ctx);
const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
vm.runInContext(src('core.js') + '\n' + src('i18n.js') +
  ';this.X={computeDay,computeMonth,contractOf,progressiveTax,leaveUsed,gpsStep,geofenceReplay,DEFAULT_SETTINGS,settleLeave,leaveFinalMin,migrateHolidays,dayType,I18N,T,setLang,eventText,signalText,holidayName,dayLabel};', ctx);
const { computeDay, computeMonth, contractOf, progressiveTax, leaveUsed, geofenceReplay, DEFAULT_SETTINGS, settleLeave, leaveFinalMin } = ctx.X;
const S = DEFAULT_SETTINGS();
const day = (i, o, key = '2026-10-06') => computeDay(key, { manualIn: i, manualOut: o }, S);
const at = (d, h, m) => new Date(2026, 9, d, h, m).getTime();

test('rounds down to 15-minute blocks, subtracts 9 hours, OT from 30 minutes', () => {
  const cases = [
    ['08:00', '17:15', 1, 0], ['08:00', '17:43', 1, 30], ['06:00', '15:00', 1, 0],
    ['06:30', '17:00', 1, 90], ['06:07', '15:40', 1, 30], ['06:47', '17:00', 1, 60],
    ['08:30', '17:30', 1, 0],
  ];
  for (const [i, o, cong, ot] of cases) {
    const r = day(i, o);
    assert.equal(r.cong, cong, `${i}-${o} workday`);
    assert.equal(r.ot150, ot, `${i}-${o} OT`);
  }
  assert.equal(day('06:07', '15:40').inR, '06:00');
  assert.equal(day('06:47', '17:00').inR, '06:45');
});

test('half day = 0.5 workday; 4 hours on Saturday = 1 workday', () => {
  assert.equal(day('13:00', '17:00').cong, 0.5);
  assert.equal(day('08:00', '12:00').cong, 0.5);
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
});

test('Sunday pays 200%, a public holiday 300% plus the paid holiday workday', () => {
  assert.equal(day('08:00', '17:00', '2026-10-11').ot200, 480);
  const h = day('08:00', '17:00', '2026-11-24');
  assert.equal(h.ot300, 480);
  assert.equal(h.paidCong, 1);
});

/* Contract set once in Settings */
const withContract = (c) => {
  const d = DEFAULT_SETTINGS();
  return { ...d, contract: { ...d.contract, ...c, probation: { ...d.contract.probation, ...(c.probation || {}) }, official: { ...d.contract.official, ...(c.official || {}) } } };
};
const PROB = { probation: { from: '2026-10-01', to: '2026-12-31', base: 5400000, gross: 10800000 } };

test('day pay uses gross ÷ standard workdays, OT the contract base salary', () => {
  const s = withContract(PROB);
  const M = computeMonth(2026, 10, {
    '2026-10-06': { manualIn: '08:00', manualOut: '17:43' },  // 1 workday + 0.5 h OT 150%
    '2026-10-11': { manualIn: '08:00', manualOut: '17:00' },  // Sunday: 8 h OT 200%
  }, s);
  assert.equal(M.std, 27);
  assert.equal(M.totals.basePay, 400000);                     // 10,800,000 / 27
  assert.equal(M.totals.otPay, Math.round(0.5 * 1.5 * 25000) + 8 * 2 * 25000); // 5,400,000 / 27 / 8 = 25,000
});

test('probation and permanent periods split the month by date', () => {
  const s = withContract({
    probation: { from: '2026-10-01', to: '2026-10-14', base: 5400000, gross: 10800000 },
    official: { from: '2026-10-15', base: 10800000, gross: 13500000 },
  });
  const M = computeMonth(2026, 10, {
    '2026-10-06': { manualIn: '08:00', manualOut: '18:00' },  // 1 h OT at 25,000
    '2026-10-20': { manualIn: '08:00', manualOut: '18:00' },  // 1 h OT at 50,000
  }, s);
  assert.equal(M.totals.otPay, 1.5 * 25000 + 1.5 * 50000);
  assert.equal(M.totals.basePay, 400000 + 500000);
  assert.equal(M.rows[5].salary.status, 'probation');
  assert.equal(M.rows[19].salary.status, 'official');
});

test('days outside both periods have no pay and are counted', () => {
  const s = withContract({ official: { from: '2026-10-15', base: 10000000, gross: 13500000 } });
  const M = computeMonth(2026, 10, { '2026-10-06': { manualIn: '08:00', manualOut: '17:00' } }, s);
  assert.equal(M.totals.basePay, 0);
  assert.equal(M.totals.noSalaryDays, 1);
});

test('old dated pay rates are converted into probation and permanent periods', () => {
  const c = contractOf({ ...DEFAULT_SETTINGS(), salaries: [
    { id: 'a', from: '2026-10-01', amount: 10800000, otBase: 5400000, status: 'probation' },
    { id: 'b', from: '2026-12-01', amount: 15000000, status: 'official' },
  ] });
  assert.equal(c.probation.from, '2026-10-01'); assert.equal(c.probation.to, '2026-11-30');
  assert.equal(c.probation.base, 5400000); assert.equal(c.probation.gross, 10800000);
  assert.equal(c.official.from, '2026-12-01'); assert.equal(c.official.base, 15000000); // no base saved: gross
});

test('paid leave pays the contract base salary, unpaid leave pays nothing', () => {
  const s = withContract(PROB);
  const M = computeMonth(2026, 10, {
    '2026-10-06': { leave: { type: 'paid', part: 'full' } },
    '2026-10-07': { leave: { type: 'unpaid', part: 'full' } },
    '2026-10-08': { manualIn: '13:00', manualOut: '17:00', leave: { type: 'paid', part: 'am' } },
  }, s);
  assert.equal(M.totals.paidLeave, 1.5);
  assert.equal(M.totals.unpaidLeave, 1);
  assert.equal(M.totals.leavePay, 200000 + 100000);           // 5,400,000 / 27 = 200,000 per day
  assert.equal(M.totals.workPay, 200000);                     // afternoon worked: 0.5 × 400,000
});

test('leave on top of a full day of work never exceeds one workday; Sundays ignore leave', () => {
  const s = withContract(PROB);
  const r = computeDay('2026-10-06', { manualIn: '08:00', manualOut: '17:00', leave: { type: 'paid', part: 'pm' } }, s);
  assert.equal(r.cong + r.paidLeave, 1);
  assert.equal(computeDay('2026-10-11', { leave: { type: 'paid' } }, s).paidLeave, 0);
  assert.equal(computeDay('2026-10-10', { leave: { type: 'paid', part: 'am' } }, s).paidLeave, 1); // Saturday = 1 day
});

test('PIT 2026: 5 progressive brackets', () => {
  assert.equal(progressiveTax(0), 0);
  assert.equal(progressiveTax(10e6), 500000);
  assert.equal(progressiveTax(30e6), 500000 + 2000000);
  assert.equal(progressiveTax(45e6), 2500000 + 3000000);
  assert.equal(progressiveTax(120e6), 2500000 + 6000000 + 12000000 + 7000000);
});

const fullMonth = (y, m, from = '08:00', to = '17:00') => {
  const days = {};
  for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
    const dt = new Date(y, m - 1, d), key = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    if (dt.getDay() === 0) continue;
    days[key] = dt.getDay() === 6 ? { manualIn: '08:00', manualOut: '12:00' } : { manualIn: from, manualOut: to };
  }
  return days;
};

test('permanent month: 10.5% insurance on the base salary, PIT after deductions, OT tax-free', () => {
  const s = withContract({ official: { from: '2026-01-01', base: 20000000, gross: 40000000 }, dependents: 1 });
  const days = fullMonth(2026, 10); days['2026-10-11'] = { manualIn: '08:00', manualOut: '17:00' }; // Sunday OT
  const D = computeMonth(2026, 10, days, s).deductions;
  assert.equal(D.insurance.due, true);
  assert.equal(D.insurance.social, 1600000); assert.equal(D.insurance.health, 300000); assert.equal(D.insurance.unemployment, 200000);
  assert.equal(D.officialIncome, 40000000);                   // OT not taxable
  assert.ok(D.otExempt > 0);
  // 40,000,000 − 2,100,000 − 15,500,000 − 6,200,000 = 16,200,000 → 500,000 + 620,000
  assert.equal(D.taxable, 16200000);
  assert.equal(D.pit, 1120000);
  assert.equal(D.net, D.gross - 2100000 - 1120000);
});

test('insurance is capped at 20 × the statutory base pay (2,530,000 from July 2026)', () => {
  const s = withContract({ official: { from: '2026-01-01', base: 80000000, gross: 80000000 } });
  assert.equal(computeMonth(2026, 10, fullMonth(2026, 10), s).deductions.insurance.social, Math.round(50600000 * 0.08));
  assert.equal(computeMonth(2026, 6, fullMonth(2026, 6), s).deductions.insurance.social, Math.round(46800000 * 0.08));
  assert.equal(computeMonth(2026, 10, fullMonth(2026, 10), s).deductions.insurance.unemployment, 800000); // cap 106.2 M
});

test('no insurance in a month with 14+ working days outside the contract or on unpaid leave', () => {
  const late = withContract({ official: { from: '2026-10-19', base: 10000000, gross: 15000000 } });   // 16 Mon–Sat days before
  assert.equal(computeMonth(2026, 10, {}, late).deductions.insurance.reason, 'under14');
  const early = withContract({ official: { from: '2026-10-12', base: 10000000, gross: 15000000 } });  // 10 days before
  assert.equal(computeMonth(2026, 10, {}, early).deductions.insurance.due, true);
  const s = withContract({ official: { from: '2026-01-01', base: 10000000, gross: 15000000 } });
  const days = {};
  for (let d = 1; d <= 16; d++) { const k = '2026-10-' + String(d).padStart(2, '0'); if (new Date(2026, 9, d).getDay()) days[k] = { leave: { type: 'unpaid' } }; }
  assert.equal(computeMonth(2026, 10, days, s).deductions.insurance.due, false);
  assert.equal(computeMonth(2026, 10, {}, withContract(PROB)).deductions.insurance.reason, 'probation');
});

test('probation PIT: 10% from 5,000,000 per payment (2,000,000 before July 2026), or progressive, or none', () => {
  const p = { probation: { from: '2026-01-01', to: '2026-12-31', base: 8000000, gross: 13500000 } };
  const M = computeMonth(2026, 10, fullMonth(2026, 10), withContract(p));
  assert.equal(M.deductions.insurance.due, false);
  assert.equal(M.deductions.pitFlat, Math.round(M.totals.basePay * 0.1));
  const small = computeMonth(2026, 10, { '2026-10-06': { manualIn: '08:00', manualOut: '17:00' } }, withContract(p));
  assert.equal(small.deductions.pit, 0);                       // 500,000 < 5,000,000
  const june = computeMonth(2026, 6, { '2026-06-01': { manualIn: '08:00', manualOut: '17:00' }, '2026-06-02': { manualIn: '08:00', manualOut: '17:00' }, '2026-06-03': { manualIn: '08:00', manualOut: '17:00' }, '2026-06-04': { manualIn: '08:00', manualOut: '17:00' } }, withContract(p));
  assert.equal(june.deductions.flatDue, true);                 // 2,000,000 ≥ 2,000,000
  assert.equal(computeMonth(2026, 10, fullMonth(2026, 10), withContract({ ...p, probationTax: 'progressive' })).deductions.pit, 0); // 13.5 M < 15.5 M
  assert.equal(computeMonth(2026, 10, fullMonth(2026, 10), withContract({ ...p, probationTax: 'commit' })).deductions.pit, 0);
});

test('annual leave used in a year counts half days and Saturdays', () => {
  const s = withContract({});
  const days = { 1: { '2026-01-05': { leave: { type: 'paid' } }, '2026-01-06': { leave: { type: 'paid', part: 'am' } } },
    10: { '2026-10-10': { leave: { type: 'paid', part: 'am' } }, '2026-10-07': { leave: { type: 'unpaid' } } } };
  const u = leaveUsed(2026, m => days[m], s);
  assert.equal(u.used, 2.5); assert.equal(u.quota, 12); assert.equal(u.left, 9.5);
});

function replay(events, manualIn) {
  const days = { '2026-10-06': manualIn ? { manualIn } : {} }, rt = {};
  const evs = geofenceReplay(events, rt, k => (days[k] = days[k] || {}), S);
  return { g: days['2026-10-06'].gps, evs };
}

test('Case 1 (geofence): arrive 7:55, trip at 8:30, back 14:00, leave 16:10', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 55) }, { type: 'dwell', time: at(6, 8, 0) },
    { type: 'exit', time: at(6, 8, 30) },
    { type: 'enter', time: at(6, 14, 0) }, { type: 'dwell', time: at(6, 14, 5) },
    { type: 'exit', time: at(6, 16, 10) },
  ]);
  assert.equal(g.in, '07:55');
  assert.equal(g.trips[0].start, '08:30');
  assert.equal(g.trips[0].end, '14:00');
  assert.equal(g.out, '16:10');
});

test('Case 2 (geofence): no trip, out for lunch, leave 17:40', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 8, 0) }, { type: 'dwell', time: at(6, 8, 5) },
    { type: 'exit', time: at(6, 12, 0) },
    { type: 'enter', time: at(6, 13, 0) }, { type: 'dwell', time: at(6, 13, 5) },
    { type: 'exit', time: at(6, 17, 40) },
  ]);
  assert.equal(g.in, '08:00');
  assert.equal(g.trips.length, 0);
  assert.equal(g.out, '17:40');
});

test('Passing by the office during a trip does not end the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 0) }, { type: 'dwell', time: at(6, 6, 5) },
    { type: 'exit', time: at(6, 6, 20) },
    { type: 'enter', time: at(6, 11, 0) }, { type: 'exit', time: at(6, 11, 2) },
  ]);
  assert.equal(g.status, 'trip');
  assert.equal(g.trips[0].end, null);
  assert.equal(g.out ?? null, null);
});

test('Oct 7: manual check-in at 06:58; a zone signal at 16:33 creates no new check-in; leaving at 17:11 is the check-out', () => {
  const { g, evs } = replay([
    { type: 'dwell', time: at(6, 16, 38) },
    { type: 'exit', time: at(6, 17, 11) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips.length, 0);
  assert.equal(g.out, '17:11');
  assert.ok(evs.some(e => e.kind === 'event' && e.code === 'gps.presentManual' && e.p.manualIn === '06:58'));
  assert.ok(!evs.some(e => e.code === 'gps.trip'));
});

test('False Android signals (real position far away) are ignored and only logged', () => {
  const { g, evs } = replay([
    { type: 'enter', time: at(6, 16, 33), dist: 2400, acc: 900, rejected: true },
    { type: 'dwell', time: at(6, 16, 38), dist: 1800, acc: 25, fresh: true, rejected: true },
    { type: 'exit', time: at(6, 17, 11), dist: 400, acc: 15 },
  ], '06:58');
  assert.equal(g.status ?? null, null);
  assert.equal(g.out ?? null, null);
  assert.equal(evs.filter(e => e.kind === 'event').length, 0);
  assert.equal(evs.filter(e => e.kind === 'signal' && e.rejected).length, 2);
});

test('8 minutes at the office then straight to a trip, with no "dwell" signal: still checks in and records the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55) },
    { type: 'exit', time: at(6, 7, 3) },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.trips[0].start, '07:03');
});

test('Manual check-in, then a trip within the first hour: GPS still records the trip', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 57) }, { type: 'dwell', time: at(6, 7, 2) },
    { type: 'exit', time: at(6, 7, 20) },
  ], '06:58');
  assert.equal(g.in ?? null, null);
  assert.equal(g.trips[0].start, '07:20');
});

test('Workdays count whole hours: 4h45 = 0.5; 7h = 0.875; a trip day with 7 hours = 1 workday', () => {
  // 08:00–12:45 doesn't cross lunch → 4h45
  assert.equal(day('08:00', '12:45').cong, 0.5);
  // late arrival 09:40–17:30 → rounded 09:30–17:30, minus lunch → 7h
  assert.equal(day('09:40', '17:30').cong, 0.875);
  // morning shift 07:58–12:02 → 07:45–12:00 = 4h15 → 0.5
  assert.equal(day('07:58', '12:02').cong, 0.5);
  // business-trip day: 7h → 1 workday; 6h45 → 0.75
  const trip = (i, o) => computeDay('2026-10-06', { manualIn: i, manualOut: o, manualTrip: true }, S);
  assert.equal(trip('09:30', '17:30').cong, 1);
  assert.equal(trip('09:30', '17:15').cong, 0.75);
  // Saturday: 4 hours = 1 workday, 3 hours = 0.75
  assert.equal(day('08:00', '12:00', '2026-10-10').cong, 1);
  assert.equal(day('08:00', '11:30', '2026-10-10').cong, 0.75);
});

test('Afternoon shift: 12:55–17:05 → 0.5 workday', () => {
  const r = day('12:55', '17:05');
  assert.equal(r.inR, '12:45');
  assert.equal(r.workedMin, 240);
  assert.equal(r.cong, 0.5);
});

test('Morning shift: leaving at 12:02 before the cutoff without returning → 12:02 is a provisional check-out', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 58) }, { type: 'dwell', time: at(6, 8, 3) },
    { type: 'exit', time: at(6, 12, 2) },
  ]);
  assert.equal(g.lastLeave, '12:02');
  const r = computeDay('2026-10-06', { gps: g }, S);
  assert.equal(r.outHM, '12:02');
  assert.equal(r.provisionalOut, true);
  assert.equal(r.cong, 0.5);
});

test('Going out for lunch and coming back is not a check-out', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 7, 58) }, { type: 'dwell', time: at(6, 8, 3) },
    { type: 'exit', time: at(6, 12, 2) },
    { type: 'enter', time: at(6, 12, 55) }, { type: 'dwell', time: at(6, 13, 0) },
  ]);
  assert.equal(g.lastLeave, null);
  assert.equal(computeDay('2026-10-06', { gps: g }, S).outHM, null);
});

test('Widget taps: check-in and check-out record the tap times, like manual punches', () => {
  const days = { '2026-10-06': {} }, rt = {};
  geofenceReplay([
    { type: 'punch', kind: 'in', time: at(6, 6, 58), src: 'widget' },
    { type: 'punch', kind: 'in', time: at(6, 7, 1), src: 'widget' },
    { type: 'punch', kind: 'out', time: at(6, 17, 5), src: 'notification' },
  ], rt, k => (days[k] = days[k] || {}), S);
  assert.equal(days['2026-10-06'].manualIn, '06:58');
  assert.equal(days['2026-10-06'].manualOut, '17:05');
});

test('Reference-only (info) signals do not change state', () => {
  const { g } = replay([{ type: 'enter', time: at(6, 7, 0), info: true }, { type: 'dwell', time: at(6, 7, 5), info: true }]);
  assert.equal(g.status ?? null, null);
});

test('Tapping "Confirm 06:55" on the notification after 2 minutes checks in at 06:55', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55), src: 'service' },
    { type: 'dwell', time: at(6, 6, 57), src: 'service', force: true },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.status, 'in');
});

test('Active tracking: arrive 06:55, trip 07:03, back 16:50, leave 17:12 → in 06:55, out 17:12', () => {
  const { g } = replay([
    { type: 'enter', time: at(6, 6, 55), src: 'service' }, { type: 'dwell', time: at(6, 7, 0), src: 'service' },
    { type: 'exit', time: at(6, 7, 3), src: 'service' },
    { type: 'enter', time: at(6, 16, 50), src: 'service' }, { type: 'dwell', time: at(6, 16, 55), src: 'service' },
    { type: 'exit', time: at(6, 17, 12), src: 'service' },
  ]);
  assert.equal(g.in, '06:55');
  assert.equal(g.trips[0].start, '07:03');
  assert.equal(g.trips[0].end, '16:50');
  assert.equal(g.out, '17:12');
  const r = computeDay('2026-10-06', { gps: g }, S);
  assert.equal(r.cong, 1);
  assert.equal(r.inR, '06:45');
  assert.equal(r.outR, '17:00');
  assert.equal(r.ot150, 60);
});

/* ===== Left early and not back: the provisional check-out becomes the check-out ===== */
const fm = hm => { const m = leaveFinalMin(hm, S); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

test('waiting time: 60 minutes, or until 30 minutes after lunch when leaving around lunch', () => {
  assert.equal(fm('10:00'), '11:00');
  assert.equal(fm('11:29'), '12:29');
  assert.equal(fm('11:55'), '13:30');
  assert.equal(fm('12:08'), '13:30');
  assert.equal(fm('12:59'), '13:59');
  assert.equal(fm('14:10'), '15:10');
});

function leftAt1208() {
  const days = { '2026-10-10': {} }, rt = {};
  const get = k => (days[k] = days[k] || {});
  geofenceReplay([
    { type: 'enter', time: at(10, 7, 59), src: 'service' }, { type: 'dwell', time: at(10, 8, 4), src: 'service' },
    { type: 'exit', time: at(10, 12, 8), src: 'service' },
  ], rt, get, S);
  return { days, rt, get, rec: days['2026-10-10'] };
}

test('Oct 10: left at 12:08 and not back → still provisional at 13:29, check-out 12:08 from 13:30', () => {
  const { rec } = leftAt1208();
  assert.equal(rec.gps.lastLeave, '12:08');
  assert.deepEqual([...settleLeave(rec.gps, '2026-10-10', at(10, 13, 29), S)], []);
  assert.equal(computeDay('2026-10-10', rec, S).provisionalOut, true);
  const evs = settleLeave(rec.gps, '2026-10-10', at(10, 13, 31), S);
  assert.equal(evs.length, 1);
  assert.equal(evs[0].code, 'gps.leaveFinal');
  assert.equal(evs[0].t, '13:30');
  const r = computeDay('2026-10-10', rec, S);
  assert.equal(r.outHM, '12:08');
  assert.equal(r.provisionalOut, false);
  assert.equal(r.outSrc, 'gps');
  assert.equal(r.cong, 1);                 // Saturday: 07:45–12:00 = 4 h 15 → full Saturday workday
});

test('Confirming from the widget at 12:40 makes 12:08 the check-out right away', () => {
  const { rec, rt, get } = leftAt1208();
  const out = geofenceReplay([{ type: 'finalize', time: at(10, 12, 40), src: 'widget', at: '12:08' }], rt, get, S);
  const e = out.find(x => x.kind === 'event');
  assert.equal(e.code, 'gps.leaveConfirmed');
  assert.equal(e.t, '12:40');
  assert.equal(e.p.src, 'widget');
  assert.equal(computeDay('2026-10-10', rec, S).outHM, '12:08');
  assert.ok(!out.some(x => x.kind === 'signal'));   // a confirmation is not a location signal
});

test('Android finalizing on its own (src service) is logged as an automatic check-out', () => {
  const { rec, rt, get } = leftAt1208();
  const out = geofenceReplay([{ type: 'finalize', time: at(10, 13, 34), src: 'service', at: '12:08' }], rt, get, S);
  assert.equal(out[0].code, 'gps.leaveFinal');
  assert.equal(rec.gps.out, '12:08');
});

test('Back from lunch at 12:55 → no check-out; back after it was finalized → the check-out is cleared', () => {
  const a = leftAt1208();
  geofenceReplay([{ type: 'enter', time: at(10, 12, 55), src: 'service' }, { type: 'dwell', time: at(10, 13, 0), src: 'service' }], a.rt, a.get, S);
  assert.equal(a.rec.gps.status, 'in');
  assert.equal(a.rec.gps.out ?? null, null);
  const b = leftAt1208();
  const out = geofenceReplay([{ type: 'enter', time: at(10, 14, 0), src: 'service' }, { type: 'dwell', time: at(10, 14, 5), src: 'service' }], b.rt, b.get, S);
  assert.deepEqual([...out.filter(x => x.kind === 'event').map(x => x.code)], ['gps.leaveFinal', 'gps.backUndoOut']);
  assert.equal(b.rec.gps.out, null);
  assert.equal(b.rec.gps.status, 'in');
});

test('A day that ended with a provisional check-out is settled when the app opens the next day', () => {
  const { rec } = leftAt1208();
  const evs = settleLeave(rec.gps, '2026-10-10', at(11, 8, 0), S);
  assert.equal(evs[0].t, '13:30');
  assert.equal(rec.gps.out, '12:08');
});

test('A widget confirmation the app could not match still keeps the confirmed time', () => {
  const days = { '2026-10-10': { manualIn: '07:59' } }, rt = {};
  geofenceReplay([{ type: 'finalize', time: at(10, 13, 0), src: 'widget', at: '12:08' }], rt, k => days[k], S);
  assert.equal(days['2026-10-10'].manualOut, '12:08');
});

/* ===== Bilingual (English / Vietnamese) ===== */
const { I18N, T, setLang, eventText, signalText, holidayName, dayLabel, migrateHolidays, dayType } = ctx.X;

test('every text key has a non-empty English and Vietnamese version with the same placeholders', () => {
  const ph = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const [k, v] of Object.entries(I18N)) {
    assert.equal(v.length, 2, k);
    assert.ok(v[0] && v[1], k + ' is empty');
    assert.equal(ph(v[0]), ph(v[1]), k + ' placeholders differ');
  }
});

test('every key used by the app, the markup and the logic exists', () => {
  const app = src('app.js'), body = src('body.html'), core = src('core.js');
  const used = new Set();
  for (const m of app.matchAll(/\bT\('([\w.]+)'/g)) used.add(m[1]);
  for (const m of body.matchAll(/data-i18n(?:-html|-ph|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of app.matchAll(/btn\('\w+', '([\w.]+)'\)/g)) used.add(m[1]);
  for (const m of app.matchAll(/logEvent\([^)]*?, '([\w.]+)'/g)) used.add('ev.' + m[1]);
  for (const m of core.matchAll(/code: '([\w.]+)'/g)) used.add('ev.' + m[1]);
  for (const m of core.matchAll(/key: '(\w+)'/g)) used.add('hol.' + m[1]);
  for (const t of ['weekday', 'saturday', 'sunday', 'holiday', 'comp']) used.add('day.' + t);
  for (const t of ['waiting', 'arriving', 'inside', 'outside']) used.add('gps.mode.' + t);
  for (const t of ['enter', 'dwell', 'exit']) used.add('sig.' + t);
  for (const c of ['date', 'dow', 'type', 'in', 'inR', 'inSrc', 'out', 'outR', 'outSrc', 'lunch', 'worked', 'cong', 'paid', 'ot150', 'ot200', 'ot300', 'trip', 'dayPay', 'otPay', 'dayTotal', 'note']) used.add('x.col.' + c);
  for (const c of ['date', 'dow', 'type', 'in', 'out', 'lunch', 'worked', 'cong', 'trip', 'amount', 'note']) used.add('pdf.col.' + c);
  for (const k of [...used]) if (k.endsWith('.')) used.delete(k); // prefixes completed at runtime (listed above)
  for (let i = 0; i < 7; i++) used.add('dow.' + i);
  for (let i = 1; i <= 12; i++) used.add('month.' + i);
  assert.ok(used.size > 250, 'scan found ' + used.size + ' keys');
  const missing = [...used].filter(k => !I18N[k]);
  assert.deepEqual(missing, []);
});

test('log events are stored as codes and shown in the chosen language', () => {
  const { evs } = replay([{ type: 'dwell', time: at(6, 16, 38) }, { type: 'exit', time: at(6, 17, 11) }], '06:58');
  const e = evs.find(x => x.code === 'gps.presentManual');
  setLang('en'); assert.equal(eventText(e), 'At the office (already checked in manually at 06:58)');
  setLang('vi'); assert.equal(eventText(e), 'Có mặt ở chỗ làm (đã check in tay lúc 06:58)');
  const p = { t: '07:00', code: 'punch.in', p: { src: 'notification' } };
  setLang('en'); assert.equal(eventText(p), 'Checked in from the notification');
  setLang('vi'); assert.equal(eventText(p), 'Bấm check in trên thông báo');
  // Entries saved by older versions keep their original text
  assert.equal(eventText({ t: '08:00', text: 'Bạn bấm check in' }), 'Bạn bấm check in');
});

test('location signals are stored as data and described in the chosen language', () => {
  const { evs } = replay([{ type: 'enter', time: at(6, 16, 33), dist: 2400, acc: 900, rejected: true }], '06:58');
  const s = evs.find(x => x.kind === 'signal');
  assert.equal(s.type, 'enter'); assert.equal(s.dist, 2400); assert.equal(s.rejected, true);
  setLang('en'); assert.match(signalText(s), /^entered zone · 2.4 km away \(±900 m\) · ignored/);
  setLang('vi'); assert.match(signalText(s), /^vào vùng · cách 2,4 km \(±900 m\) · bỏ qua/);
});

test('holiday names follow the language; old Vietnamese holiday lists are migrated', () => {
  const old = [{ date: '2026-02-18', name: 'Tết Nguyên đán (Mùng 2)', kind: 'holiday' }, { date: '2026-12-25', name: 'Company trip', kind: 'comp' }];
  const m = migrateHolidays(old);
  assert.deepEqual({ ...m[0] }, { date: '2026-02-18', key: 'tet', n: 2, kind: 'holiday' });
  assert.equal(m[1].name, 'Company trip');
  setLang('en'); assert.equal(holidayName(m[0]), 'Lunar New Year (day 2)'); assert.equal(holidayName(m[1]), 'Company trip');
  setLang('vi'); assert.equal(holidayName(m[0]), 'Tết Nguyên đán (Mùng 2)');
  const dt = dayType('2026-09-02', S.holidays);
  setLang('en'); assert.equal(dayLabel(dt), 'National Day (2/9)');
  setLang('vi'); assert.equal(dayLabel(dayType('2026-10-11', S.holidays)), 'Chủ nhật');
});

test('the calculations do not depend on the display language', () => {
  const sample = () => { const r = day('06:47', '17:00'); return [r.cong, r.ot150, r.inR, r.outR, r.workedMin]; };
  setLang('en'); const en = sample();
  setLang('vi'); const vi = sample();
  assert.deepEqual(en, vi);
});
