const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_HOURS = 5; // Bogota is UTC-5 (no DST)

function todayBogotaUtcDateOnly() {
  const shifted = new Date(Date.now() - BOGOTA_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ));
}

function parseYMD(ymd) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}

function daysBetween(dateA, dateB) {
  return Math.floor((dateB.getTime() - dateA.getTime()) / DAY_MS);
}

function addMonthsClamped(dateUtc, months) {
  const y = dateUtc.getUTCFullYear();
  const m = dateUtc.getUTCMonth();
  const d = dateUtc.getUTCDate();

  const first = new Date(Date.UTC(y, m + months, 1));
  const daysInTarget = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);

  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), day, 0, 0, 0));
}

function addYearsClamped(dateUtc, years) {
  const y = dateUtc.getUTCFullYear();
  const m = dateUtc.getUTCMonth();
  const d = dateUtc.getUTCDate();

  const first = new Date(Date.UTC(y + years, m, 1));
  const daysInTarget = new Date(Date.UTC(y + years, m + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTarget);

  return new Date(Date.UTC(y + years, m, day, 0, 0, 0));
}

function addByFrequency(dateUtc, unit, interval) {
  const intv = Math.max(1, Number(interval) || 1);
  if (String(unit).toLowerCase() === "year") return addYearsClamped(dateUtc, intv);
  return addMonthsClamped(dateUtc, intv); // default month
}

/**
 * Cycle definition for started bills:
 *  - currentDue: most recent due <= today
 *  - nextDue: currentDue + frequency
 */
function computeCycle(todayUtc, startUtc, unit, interval) {
  if (todayUtc < startUtc) return null;

  const u = String(unit || "month").toLowerCase();
  const intv = Math.max(1, Number(interval) || 1);

  let currentDue = startUtc;
  let nextDue = addByFrequency(currentDue, u, intv);

  while (nextDue.getTime() <= todayUtc.getTime()) {
    currentDue = nextDue;
    nextDue = addByFrequency(currentDue, u, intv);
  }

  return { currentDue, nextDue };
}

function buildLastAmountMap(payments) {
  const map = {};
  for (const p of (payments || [])) {
    const billId = String(p.billId || "").trim();
    if (!billId) continue;

    const tsMs = new Date(p.timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;

    const prev = map[billId]?.tsMs ?? -1;
    if (tsMs >= prev) {
      map[billId] = { amount: Number(p.amount) || 0, tsMs };
    }
  }
  return map;
}

function isPaidInWindow(payments, billId, startUtc, endUtc) {
  const startMs = startUtc.getTime();
  const endMs = endUtc.getTime();

  for (const p of (payments || [])) {
    if (String(p.billId) !== String(billId)) continue;

    const tsMs = new Date(p.timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;

    if (tsMs >= startMs && tsMs < endMs) return true;
  }
  return false;
}

module.exports = async function (context, req, bills, payments) {
  try {
    const todayUtc = todayBogotaUtcDateOnly();
    const windowEndUtc = new Date(todayUtc.getTime() + 5 * DAY_MS);

    const lastAmountMap = buildLastAmountMap(payments || []);

    const payImmediately = [];
    const upcoming = [];
    const paid = [];

    for (const b of (bills || [])) {
      if (!b || b.isActive !== true) continue;

      const startUtc = parseYMD(b.startDate);
      if (!startUtc) continue;

      const unit = b.frequency?.unit || "month";
      const interval = b.frequency?.interval || 1;

      let dueUtc;
      let cycleStartUtc;
      let cycleEndUtc;

      if (todayUtc < startUtc) {
        // Not started yet: first due is startDate
        dueUtc = startUtc;

        // show only if within next 5 days
        if (!(dueUtc.getTime() > todayUtc.getTime() && dueUtc.getTime() <= windowEndUtc.getTime())) {
          continue;
        }

        // Define a "cycle" anyway for consistency (rarely matters before start)
        cycleStartUtc = startUtc;
        cycleEndUtc = addByFrequency(startUtc, unit, interval);
      } else {
        // Started: use current cycle due date (for overdue) and next due (for cycle end)
        const cycle = computeCycle(todayUtc, startUtc, unit, interval);
        if (!cycle) continue;

        cycleStartUtc = cycle.currentDue;
        cycleEndUtc = cycle.nextDue;
        dueUtc = cycleStartUtc; // this is the due date we compare to today for overdue

        // This bill is relevant now if either overdue/due-today OR next due is within 5 days
        // Overdue/due-today is determined by dueUtc <= today (always true here)
        // Upcoming is determined by *next* due date (cycleEndUtc) being within 5 days AND not overdue.
      }

      const paidThisCycle = isPaidInWindow(payments || [], b.id, cycleStartUtc, cycleEndUtc);
      const lastAmount = lastAmountMap[String(b.id)]?.amount ?? 0;

      const out = {
        id: String(b.id),
        name: b.name,
        type: b.type,
        reference: b.reference || "",
        autoPay: !!b.autoPay,
        isVariableAmount: !!b.isVariableAmount,
        isActive: true,
        startDate: b.startDate,
        frequency: b.frequency,
        lastAmount,
        paidThisMonth: paidThisCycle,
        dueDate: dueUtc.toISOString().slice(0, 10)
      };

      if (paidThisCycle) {
        paid.push(out);
        continue;
      }

      if (todayUtc < startUtc) {
        // not started yet but within next 5 days => upcoming
        upcoming.push(out);
        continue;
      }

      // Started bills:
      // PayImmediately if due date is today or in the past (overdue logic)
      if (dueUtc.getTime() <= todayUtc.getTime()) {
        const daysOverdue = Math.max(0, daysBetween(dueUtc, todayUtc));
        payImmediately.push({ ...out, daysOverdue });
        continue;
      }

      // (Normally unreachable with monthly/yearly cycleStart <= today)
      // But keep for completeness:
      if (dueUtc.getTime() > todayUtc.getTime() && dueUtc.getTime() <= windowEndUtc.getTime()) {
        upcoming.push(out);
      }
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { payImmediately, upcoming, paid }
    };
  } catch (err) {
    context.log.error("GetStatus failed:", err);
    context.res = { status: 500, body: { error: "Failed to compute status" } };
  }
};