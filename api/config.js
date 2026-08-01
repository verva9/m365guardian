const crypto = require("crypto");

// Optional: set AZURE_CLIENT_SECRET_EXPIRES (ISO date, e.g. "2027-03-15") to
// the expiry date shown on the client secret in Azure. If it's within 30
// days, this surfaces a warning banner so scans don't silently start
// failing tenant-wide when the secret lapses (Azure secrets max out at 24
// months and nothing else reminds you to rotate one).
function secretExpiryWarning() {
  const expiresRaw = process.env.AZURE_CLIENT_SECRET_EXPIRES;
  if (!expiresRaw) return null;
  const expires = new Date(expiresRaw);
  if (isNaN(expires.getTime())) return null;
  const daysLeft = Math.ceil((expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft > 30) return null;
  if (daysLeft < 0) {
    return `Your Azure client secret expired ${Math.abs(daysLeft)} day(s) ago. All scans are likely failing. Rotate it in Azure > App registrations > Certificates & secrets.`;
  }
  return `Your Azure client secret expires in ${daysLeft} day(s). Rotate it soon in Azure > App registrations > Certificates & secrets, or scans will start failing tenant-wide.`;
}

module.exports = async (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  // Short-lived, httpOnly cookie holding the one-time state value. Verified
  // in consent-callback.js when Microsoft redirects the admin back to us.
  res.setHeader("Set-Cookie", `m365g_state=${state}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`);

  res.status(200).json({
    clientId: process.env.AZURE_CLIENT_ID || "",
    state,
    secretWarning: secretExpiryWarning(),
  });
};

