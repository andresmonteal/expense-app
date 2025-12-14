function getClientPrincipal(req) {
  const encoded = req.headers["x-ms-client-principal"];
  if (!encoded) return null;

  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  return JSON.parse(decoded);
}

function getOwnerId(req) {
  const principal = getClientPrincipal(req);
  return principal?.userId || principal?.userDetails || null;
}

module.exports = { getOwnerId };