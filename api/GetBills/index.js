const { getOwnerId } = require("../_auth");

module.exports = async function (context, req, bills) {
  const ownerId = getOwnerId(req);

  if (!ownerId) {
    context.res = {
      status: 401,
      headers: { "Content-Type": "application/json" },
      body: { error: "Not authenticated" }
    };
    return;
  }

  const all = Array.isArray(bills) ? bills : [];
  const mine = all.filter(b => String(b.ownerId) === String(ownerId));

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: mine
  };
};