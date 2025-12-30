const { getOwnerId } = require("../_auth");

module.exports = async function (context, req, payments, bills) {
  const ownerId = getOwnerId(req);

  if (!ownerId) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: { error: "Not authenticated" }
    };
    return;
  }

  const payAll = Array.isArray(payments) ? payments : [];
  const billsAll = Array.isArray(bills) ? bills : [];

  // Filter to my data only (same pattern as GetBills)
  const myPayments = payAll.filter(p => String(p.ownerId) === String(ownerId));
  const myBills = billsAll.filter(b => String(b.ownerId) === String(ownerId));

  // Build a quick lookup: billId -> billName
  const billNameById = new Map(myBills.map(b => [String(b.id), String(b.name || "Bill")]));

  // Group payments by month YYYY-MM
  const monthsMap = {};

  for (const p of myPayments) {
    const iso = p.timestamp;
    if (!iso) continue;

    const d = new Date(iso);
    if (isNaN(d)) continue;

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const key = `${year}-${month}`;

    if (!monthsMap[key]) {
      monthsMap[key] = {
        key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
        totalPaid: 0,
        payments: []
      };
    }

    const amount = Number(p.amount || 0);
    monthsMap[key].totalPaid += amount;

    monthsMap[key].payments.push({
      id: p.id,
      billId: p.billId,
      billName: billNameById.get(String(p.billId)) || "Unknown bill",
      paidAt: p.timestamp, // frontend expects paidAt; we map timestamp -> paidAt
      amount
    });
  }

  // Convert map -> sorted array
  const months = Object.values(monthsMap).sort((a, b) => a.key.localeCompare(b.key));

  // Optional: within each month, sort payments newest-first
  for (const m of months) {
    m.payments.sort((a, b) => String(b.paidAt).localeCompare(String(a.paidAt)));
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { months }
  };
};