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

  // Make ownerId available for the binding expression in function.json
  context.bindingData = context.bindingData || {};
  context.bindingData.ownerId = ownerId;

  // `context.bindings.bills` comes from Cosmos input binding
  const myBills = context.bindings.bills || [];

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: myBills
  };
};