const { getOwnerId } = require("../_auth");

module.exports = async function (context, req) {
  const ownerId = getOwnerId(req);

  if (!ownerId) {
    context.res = {
      status: 401,
      body: { error: "Not authenticated" }
    };
    return;
  }

  // Load bills from storage
  const allBills = await loadBillsFromStorage();

  // 🔑 THIS is what makes data per-user
  const myBills = allBills.filter(b => b.ownerId === ownerId);

  context.res = {
    status: 200,
    body: myBills
  };
};