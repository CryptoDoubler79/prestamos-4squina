// Cálculo de préstamos 4Squina
// Dos tipos: 'reditos' (interés diario sobre el capital pendiente) y 'cuotas' (cuotas fijas con calendario)
export const r2 = x => Math.round((Number(x) || 0) * 100) / 100;

// ---------- fechas (texto YYYY-MM-DD) ----------
export function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const todayStr = () => ymd(new Date());
const parts = s => s.split('-').map(Number);
export function daysBetween(a, b) {
  const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function addDays(s, k) {
  const [y, m, d] = parts(s);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
}
export function addMonths(s, k) {
  const [y, m, d] = parts(s);
  const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + k, Math.min(d, last))).toISOString().slice(0, 10);
}
const dow = s => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const maxDate = (a, b) => (a > b ? a : b);

export const FREQ = { diario: 'Diario', semanal: 'Semanal', quincenal: 'Quincenal', mensual: 'Mensual' };

export function nextDueDate(from, freq, skipSundays) {
  if (freq === 'diario') { let c = addDays(from, 1); while (skipSundays && dow(c) === 0) c = addDays(c, 1); return c; }
  if (freq === 'semanal') return addDays(from, 7);
  if (freq === 'quincenal') return addDays(from, 15);
  return addMonths(from, 1);
}
export function dueDates(start, freq, n, skipSundays) {
  const out = [];
  if (freq === 'mensual') { for (let k = 1; k <= n; k++) out.push(addMonths(start, k)); return out; }
  let cur = start;
  while (out.length < n) { cur = nextDueDate(cur, freq, skipSundays); out.push(cur); }
  return out;
}

// ---------- calendario de cuotas ----------
// method 'plano': interés fijo por cuota = capital inicial × tasa (lo común con prestamistas)
// method 'frances': cuota fija con interés sobre saldo (como los bancos)
export function buildSchedule({ principal, rate, n, freq, method = 'plano', start, skipSundays = false }) {
  principal = r2(principal); n = Math.max(1, Math.floor(n));
  const dates = dueDates(start, freq, n, skipSundays);
  const rows = [];
  if (method === 'frances' && rate > 0) {
    const pay = principal * rate / (1 - Math.pow(1 + rate, -n));
    let bal = principal;
    for (let i = 0; i < n; i++) {
      const interest = r2(bal * rate);
      const capital = i === n - 1 ? r2(bal) : r2(pay - interest);
      bal = r2(bal - capital);
      rows.push({ n: i + 1, due: dates[i], interest, capital, amount: r2(interest + capital), paid: 0 });
    }
  } else {
    const cap = r2(principal / n), int = r2(principal * rate);
    let left = principal;
    for (let i = 0; i < n; i++) {
      const capital = i === n - 1 ? r2(left) : cap;
      left = r2(left - capital);
      rows.push({ n: i + 1, due: dates[i], interest: int, capital, amount: r2(int + capital), paid: 0 });
    }
  }
  return rows;
}

// ---------- mora ----------
// L.mora = { type: 'none' | 'fijo' (RD$ por día) | 'pct' (% por día), value, grace (días de gracia) }
function moraPerDay(L, base) {
  const m = L.mora || {};
  if (!m.type || m.type === 'none' || !(m.value > 0)) return 0;
  return m.type === 'pct' ? base * m.value / 100 : m.value;
}
const grace = L => Math.max(0, Number((L.mora || {}).grace) || 0);
function cuotaLiveMora(L, c, asOf) {
  const late = daysBetween(c.due, asOf) - grace(L);
  return late > 0 ? r2(moraPerDay(L, c.amount) * late) : 0;
}
// Réditos: si pasan 7 días + gracia sin pagar, corre mora por día sobre el capital
function reditosLiveMora(L, asOf) {
  const lastPay = L.lastPaymentDate || L.startDate;
  const from = maxDate(addDays(lastPay, 7 + grace(L)), L.lastCalcDate);
  const days = Math.max(0, daysBetween(from, asOf));
  return r2(moraPerDay(L, L.capitalBalance) * days);
}

// ---------- estado ----------
export function loanStatus(L, asOf = todayStr()) {
  return L.type === 'cuotas' ? cuotasStatus(L, asOf) : reditosStatus(L, asOf);
}

function reditosStatus(L, asOf) {
  const days = Math.max(0, daysBetween(L.lastCalcDate, asOf));
  const interestDue = r2((L.accruedInterest || 0) + L.capitalBalance * L.rateWeekly / 7 * days);
  const moraDue = r2((L.accruedMora || 0) + reditosLiveMora(L, asOf));
  const lastPay = L.lastPaymentDate || L.startDate;
  const daysSincePay = Math.max(0, daysBetween(lastPay, asOf));
  return {
    type: 'reditos', interestDue, moraDue, capital: r2(L.capitalBalance),
    total: r2(interestDue + moraDue + L.capitalBalance),
    dueNow: r2(interestDue + moraDue),
    daily: r2(L.capitalBalance * L.rateWeekly / 7), weekly: r2(L.capitalBalance * L.rateWeekly),
    daysSincePay,
    daysLate: Math.max(daysSincePay - 7, matured(L, asOf) ? daysBetween(L.maturityDate, asOf) : 0, 0),
    late: (daysSincePay > 7 && interestDue > 0) || matured(L, asOf),
    maturityDate: L.maturityDate || null,
    matured: matured(L, asOf),
    daysToMaturity: L.maturityDate ? daysBetween(asOf, L.maturityDate) : null,
  };
}
// Réditos con plazo: el capital vence en maturityDate
const matured = (L, asOf) => !!L.maturityDate && asOf > L.maturityDate && L.capitalBalance > 0;

function cuotasStatus(L, asOf) {
  let moraTotal = 0, balance = 0, capital = 0, interestLeft = 0, overdue = 0, overdueCount = 0, lateCount = 0, daysLate = 0, next = null, paidCount = 0;
  for (const c of L.schedule) {
    const rem = r2(c.amount - c.paid);
    if (rem <= 0.004) { moraTotal += c.moraFrozen || 0; paidCount++; continue; }
    moraTotal += cuotaLiveMora(L, c, asOf);
    balance += rem;
    capital += c.capital - Math.max(0, c.paid - c.interest);
    interestLeft += Math.max(0, c.interest - c.paid);
    if (c.due <= asOf) {
      overdue += rem; overdueCount++;
      if (c.due < asOf) { lateCount++; daysLate = Math.max(daysLate, daysBetween(c.due, asOf)); }
    } else if (!next) next = c;
  }
  const moraDue = Math.max(0, r2(moraTotal - (L.moraPaid || 0) - (L.moraWaived || 0)));
  const lastPay = L.lastPaymentDate || L.startDate;
  return {
    type: 'cuotas', capital: r2(capital), interestDue: r2(interestLeft), balance: r2(balance),
    overdue: r2(overdue), overdueCount, lateCount, paidCount, total: r2(balance + moraDue), moraDue,
    dueNow: r2(overdue + moraDue), next, daysLate,
    daysSincePay: Math.max(0, daysBetween(lastPay, asOf)),
    late: lateCount > 0,
  };
}

// ---------- pagos ----------
// Orden: mora → interés → capital (en cuotas: de la más vieja a la más nueva)
export function applyPayment(L, amount, date = todayStr()) {
  amount = r2(amount);
  if (!(amount > 0)) throw new Error('Monto inválido');
  return L.type === 'cuotas' ? payCuotas(L, amount, date) : payReditos(L, amount, date);
}

function payReditos(L, amount, date) {
  const st = reditosStatus(L, date);
  const toMora = r2(Math.min(amount, st.moraDue));
  let rest = r2(amount - toMora);
  const toInterest = r2(Math.min(rest, st.interestDue));
  rest = r2(rest - toInterest);
  const toCapital = r2(Math.min(rest, L.capitalBalance));
  if (r2(rest - toCapital) > 0) throw new Error('El pago excede la deuda total (RD$' + st.total.toFixed(2) + ')');
  const capitalBalance = r2(L.capitalBalance - toCapital);
  const accruedInterest = r2(st.interestDue - toInterest);
  const accruedMora = r2(st.moraDue - toMora);
  return {
    toMora, toInterest, toCapital,
    after: { capital: capitalBalance, interest: accruedInterest, mora: accruedMora, total: r2(capitalBalance + accruedInterest + accruedMora) },
    updates: {
      capitalBalance, accruedInterest, accruedMora, lastCalcDate: date, lastPaymentDate: date,
      totalInterestPaid: r2((L.totalInterestPaid || 0) + toInterest),
      totalCapitalPaid: r2((L.totalCapitalPaid || 0) + toCapital),
      totalMoraPaid: r2((L.totalMoraPaid || 0) + toMora),
      status: capitalBalance <= 0 && accruedInterest <= 0 && accruedMora <= 0 ? 'saldado' : 'activo',
    },
  };
}

function payCuotas(L, amount, date) {
  const st = cuotasStatus(L, date);
  const toMora = r2(Math.min(amount, st.moraDue));
  let rest = r2(amount - toMora);
  let toInterest = 0, toCapital = 0;
  const schedule = L.schedule.map(c => ({ ...c }));
  for (const c of schedule) {
    if (rest <= 0) break;
    const rem = r2(c.amount - c.paid);
    if (rem <= 0.004) continue;
    const take = r2(Math.min(rest, rem));
    const i = r2(Math.min(take, Math.max(0, c.interest - c.paid)));
    toInterest = r2(toInterest + i); toCapital = r2(toCapital + take - i);
    c.paid = r2(c.paid + take); rest = r2(rest - take);
    if (r2(c.amount - c.paid) <= 0.004) { c.moraFrozen = cuotaLiveMora(L, c, date); c.paidDate = date; }
  }
  if (rest > 0) throw new Error('El pago excede la deuda total (RD$' + st.total.toFixed(2) + ')');
  const moraPaid = r2((L.moraPaid || 0) + toMora);
  const after = cuotasStatus({ ...L, schedule, moraPaid }, date);
  return {
    toMora, toInterest, toCapital,
    after: { capital: after.capital, interest: after.interestDue, mora: after.moraDue, total: after.total, overdue: after.overdue },
    updates: {
      schedule, moraPaid, capitalBalance: after.capital, lastPaymentDate: date, lastCalcDate: date,
      totalInterestPaid: r2((L.totalInterestPaid || 0) + toInterest),
      totalCapitalPaid: r2((L.totalCapitalPaid || 0) + toCapital),
      totalMoraPaid: r2((L.totalMoraPaid || 0) + toMora),
      status: after.balance <= 0.004 && after.moraDue <= 0 ? 'saldado' : 'activo',
    },
  };
}

// Campos del préstamo que un pago cambia (para poder anularlo)
export const PAY_FIELDS = ['capitalBalance', 'accruedInterest', 'accruedMora', 'lastCalcDate', 'lastPaymentDate', 'lastPaymentId',
  'totalInterestPaid', 'totalCapitalPaid', 'totalMoraPaid', 'moraPaid', 'schedule', 'status'];

// ---------- otras operaciones ----------
// Perdonar la mora pendiente
export function waiveMora(L, date = todayStr()) {
  const st = loanStatus(L, date);
  if (L.type === 'cuotas') return { amount: st.moraDue, updates: { moraWaived: r2((L.moraWaived || 0) + st.moraDue) } };
  // réditos: congelar interés a hoy y poner la mora en cero
  return { amount: st.moraDue, updates: { accruedInterest: st.interestDue, accruedMora: 0, lastCalcDate: date } };
}

// Ampliar un préstamo de réditos (prestar más sobre el mismo préstamo)
export function extendReditos(L, extra, date = todayStr()) {
  extra = r2(extra);
  if (!(extra > 0)) throw new Error('Monto inválido');
  const st = reditosStatus(L, date);
  return {
    capitalBalance: r2(L.capitalBalance + extra), principal: r2((L.principal || 0) + extra),
    accruedInterest: st.interestDue, accruedMora: st.moraDue, lastCalcDate: date,
  };
}

// Prórroga: mover las cuotas pendientes k períodos hacia adelante
export function postponeCuotas(L, k = 1) {
  const schedule = L.schedule.map(c => ({ ...c }));
  for (const c of schedule) {
    if (r2(c.amount - c.paid) <= 0.004) continue;
    let d = c.due;
    for (let i = 0; i < k; i++) d = nextDueDate(d, L.freq, L.skipSundays);
    c.due = d;
  }
  return schedule;
}

// Cédula dominicana: 11 dígitos con dígito verificador (Luhn)
export function validCedula(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let v = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (v > 9) v -= 9;
    sum += v;
  }
  return (10 - (sum % 10)) % 10 === Number(d[10]);
}

// ---------- plazo (1 a 3 meses, o el que se elija) ----------
// Cuántas cuotas caben en un plazo de X meses según la frecuencia
export function cuotasForTerm(start, freq, months, skipSundays = false) {
  months = Math.max(1, Math.floor(months));
  if (freq === 'mensual') return months;
  if (freq === 'quincenal') return months * 2;
  if (freq === 'semanal') return months * 4;
  const end = addMonths(start, months);
  let n = 0, cur = start;
  while (true) { cur = nextDueDate(cur, 'diario', skipSundays); if (cur > end) break; n++; }
  return n;
}
// Convierte la forma de decir el interés a "% por cuota" (método plano)
// mode: 'mensual' (% al mes), 'total' (% sobre todo el préstamo), 'cuota' (% por cuota)
export function ratePerCuota(mode, value, months, n) {
  const v = (Number(value) || 0) / 100;
  if (!(n > 0)) return 0;
  if (mode === 'mensual') return v * months / n;
  if (mode === 'total') return v / n;
  return v;
}
// Para el método francés: tasa por período a partir de una tasa mensual
export const PERIOD_DAYS = { diario: 1, semanal: 7, quincenal: 15, mensual: 30 };
export function monthlyToPeriod(monthly, freq) { return monthly * PERIOD_DAYS[freq] / 30; }
