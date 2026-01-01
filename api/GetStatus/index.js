const DAY_MS = 24 * 60 * 60 * 1000;
const BOGOTA_OFFSET_HOURS = 5; // Bogota is UTC-5 (no DST)
const { getOwnerId } = require("../_auth");

function todayBogotaUtcDateOnly() {
  const shifted = new Date(Date.now() - BOGOTA_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ));
}

function monthWindowBogotaUtc(todayUtc) {
  // todayUtc is already "Bogota date-only" represented in UTC
  const y = todayUtc.getUTCFullYear();
  const m = todayUtc.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0));
  return { start, end };
}

function getLatestPaymentThisMonth(payments, billId, ownerId, monthStartUtc, nextMonthStartUtc) {
  const startMs = monthStartUtc.getTime();
  const endMs = nextMonthStartUtc.getTime();
  const bid = String(billId || "").trim();
  const oid = String(ownerId || "").trim();

  let best = null; // { tsMs, timestamp, amount }

  for (const p of (payments || [])) {
    if (String(p.ownerId || "").trim() !== oid) continue;
    if (String(p.billId || "").trim() !== bid) continue;

    const tsMs = new Date(p.timestamp).getTime();
    if (!Number.isFinite(tsMs)) continue;

    if (tsMs < startMs || tsMs >= endMs) continue;

    if (!best || tsMs > best.tsMs) {
      best = {
        tsMs,
        timestamp: p.timestamp,
        amount: Number(p.amount) || 0
      };
    }
  }

  return best; // null if not paid this month
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

module.exports = async function (context, req, bills, payments) {
  try {
    const todayUtc = todayBogotaUtcDateOnly();
    const { start: monthStartUtc, end: nextMonthStartUtc } = monthWindowBogotaUtc(todayUtc);
    const windowEndUtc = new Date(todayUtc.getTime() + 5 * DAY_MS);

    const lastAmountMap = buildLastAmountMap(payments || []);

    const payImmediately = [];
    const upcoming = [];
    const paid = [];
    const ownerId = getOwnerId(req);

    if (!ownerId) {
      context.res = {
        status: 401,
        headers: { "Content-Type": "application/json" },
        body: { error: "Not authenticated" }
      };
      return;
    }

    for (const b of (bills || [])) {
      if (!b || b.isActive !== true) continue;
      if (String(b.ownerId) !== String(ownerId)) continue;

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

        cycleStartUtc = startUtc;
        cycleEndUtc = addByFrequency(startUtc, unit, interval);
      } else {
        // Started bill
        const cycle = computeCycle(todayUtc, startUtc, unit, interval);
        if (!cycle) continue;

        // For "This Month", if the most recent due was in a previous month,
        // show the next due (the one that belongs to this month / upcoming).
        let dueCandidate = cycle.currentDue;

        if (cycle.currentDue.getTime() < monthStartUtc.getTime()) {
          dueCandidate = cycle.nextDue;
        }

        dueUtc = dueCandidate;

        // keep cycle window consistent with the due date you are showing
        cycleStartUtc = dueUtc;
        cycleEndUtc = addByFrequency(dueUtc, unit, interval);
      }

      // ✅ Rule: if there's any payment in the current month, it's "already paid"
      const latestPay = getLatestPaymentThisMonth(
        payments || [],
        b.id,
        ownerId,
        monthStartUtc,
        nextMonthStartUtc
      );

      const paidThisMonth = !!latestPay;
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
        paidThisMonth,
        paidAt: latestPay ? latestPay.timestamp : null,
        paidAmount: latestPay ? latestPay.amount : null,
        dueDate: dueUtc.toISOString().slice(0, 10)
      };

      if (paidThisMonth) {
        paid.push(out);
        continue;
      }

      if (todayUtc < startUtc) {
        // not started yet but within next 5 days => upcoming
        upcoming.push(out);
        continue;
      }

      // PayImmediately if due date is today or in the past (overdue logic)
      if (dueUtc.getTime() <= todayUtc.getTime()) {
        const daysOverdue = Math.max(0, daysBetween(dueUtc, todayUtc));
        payImmediately.push({ ...out, daysOverdue });
        continue;
      }

      // keep for completeness:
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