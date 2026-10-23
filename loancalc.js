// Cálculo de préstamos — interés diario sobre capital pendiente
export const r2 = x => Math.round((Number(x) || 0) * 100) / 100;

export function ymd(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const todayStr = () => ymd(new Date());

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

// Estado de un préstamo a una fecha
export function loanStatus(L, asOf = todayStr()) {
  const days = Math.max(0, daysBetween(L.lastCalcDate, asOf));
  const daily = r2(L.capitalBalance * L.rateWeekly / 7);
  const newInt = r2(L.capitalBalance * L.rateWeekly / 7 * days);
  const interestDue = r2((L.accruedInterest || 0) + newInt);
  const lastPay = L.lastPaymentDate || L.startDate;
  const daysSincePay = Math.max(0, daysBetween(lastPay, asOf));
  return {
    interestDue,
    capital: r2(L.capitalBalance),
    total: r2(interestDue + L.capitalBalance),
    daily,
    weekly: r2(L.capitalBalance * L.rateWeekly),
    daysSincePay,
    late: daysSincePay > 7 && interestDue > 0,
  };
}

// Aplica un pago: primero al interés, el resto al capital
export function applyPayment(L, amount, date = todayStr()) {
  amount = r2(amount);
  if (!(amount > 0)) throw new Error('Monto inválido');
  const st = loanStatus(L, date);
  const toInterest = r2(Math.min(amount, st.interestDue));
  const toCapital = r2(Math.min(r2(amount - toInterest), L.capitalBalance));
  const excess = r2(amount - toInterest - toCapital);
  if (excess > 0) throw new Error('El pago excede la deuda total (' + st.total.toFixed(2) + ')');
  const capitalBalance = r2(L.capitalBalance - toCapital);
  const accruedInterest = r2(st.interestDue - toInterest);
  return {
    toInterest, toCapital, capitalBalance, accruedInterest,
    status: capitalBalance <= 0 && accruedInterest <= 0 ? 'saldado' : 'activo',
  };
}
