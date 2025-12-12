module.exports = async function (context, req) {
  try {
    const { billId, amount } = req.body || {};

    if (!billId || typeof billId !== "string") {
      context.res = { status: 400, body: { error: "billId is required" } };
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount)) {
      context.res = { status: 400, body: { error: "amount must be a number" } };
      return;
    }

    const payment = {
      id: `${billId}-${Date.now()}`,
      billId,
      amount: numericAmount,
      timestamp: new Date().toISOString()
    };

    // Write to Cosmos
    context.bindings.paymentDoc = payment;

    context.res = {
      status: 201,
      headers: { "Content-Type": "application/json" },
      body: payment
    };
  } catch (err) {
    context.log.error("LogPayment failed:", err);
    context.res = { status: 500, body: { error: "Failed to log payment" } };
  }
};