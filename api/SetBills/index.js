const { randomUUID } = require("crypto");

const { getOwnerId } = require("../_auth");

const ALLOWED_KEYS = new Set([
  "id",
  "name",
  "type",
  "startDate",
  "frequency",
  "reference",
  "autoPay",
  "isVariableAmount",
  "isActive",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function toBool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

function sanitizeBillInput(input) {
  const bill = {};

  for (const k of Object.keys(input || {})) {
    if (ALLOWED_KEYS.has(k)) bill[k] = input[k];
  }

  if (!isNonEmptyString(bill.name)) throw new Error("Field 'name' is required.");
  if (!isNonEmptyString(bill.type)) throw new Error("Field 'type' is required.");
  if (!isNonEmptyString(bill.startDate)) throw new Error("Field 'startDate' is required (YYYY-MM-DD).");

  const freq = bill.frequency || {};
  const unit = freq.unit;
  const interval = freq.interval;

  if (!freq || typeof freq !== "object") throw new Error("Field 'frequency' is required.");
  if (!["day", "week", "month", "year"].includes(unit)) {
    throw new Error("Field 'frequency.unit' must be one of: day, week, month, year.");
  }
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new Error("Field 'frequency.interval' must be a positive integer.");
  }

  bill.frequency = { unit, interval };

  bill.reference = typeof bill.reference === "string" ? bill.reference : "";
  bill.autoPay = toBool(bill.autoPay, false);
  bill.isVariableAmount = toBool(bill.isVariableAmount, false);
  bill.isActive = toBool(bill.isActive, true);

  bill.id = isNonEmptyString(bill.id) ? bill.id.trim() : randomUUID();

  return bill;
}

module.exports = async function (context, req) {
  try {
    const bill = sanitizeBillInput(req.body || {});
    const ownerId = getOwnerId(req);

    if (!ownerId) {
        context.res = {
        status: 401,
        body: { error: "Not authenticated" }
        };
        return;
    }

    const billWithOwner = {
        ...bill,
        ownerId
    };

    // IMPORTANT: this must match the Cosmos output binding name in function.json ("bills")
    context.bindings.bills = billWithOwner;

    context.res = {
      status: 201,
      headers: { "Content-Type": "application/json" },
      body: billWithOwner,
    };
  } catch (err) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: {
        error: "Invalid request",
        message: err?.message ?? String(err),
      },
    };
  }
};