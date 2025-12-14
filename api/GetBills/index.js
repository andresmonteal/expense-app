module.exports = async function (context, req, bills) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: bills || []
  };
};