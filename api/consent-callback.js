const { Redis } = require("@upstash/redis");
const crypto = require("crypto");
const redis = Redis.fromEnv();

const RETENTION_SECONDS = 60 * 60 * 24 * 90; // 90 days - see data retention note in README

module.exports = async (req, res) => {
  const { tenant, admin_consent, error, error_description, state } = req.query;

  if (error) {
    res.writeHead(302, { Location: `/?consent_error=${encodeURIComponent(error_description || error)}` });
    res.end();
    return;
  }

  if (admin_consent !== "True" || !tenant) {
    res.writeHead(302, { Location: `/?consent_error=${encodeURIComponent("Admin consent was not granted.")}` });
    res.end();
    return;
  }

  // Verify the state param matches one we actually issued (CSRF/replay protection).
  // The state is a one-time token set in a cookie before redirecting to Microsoft.
  const expectedState = getCookie(req, "m365g_state");
  if (!expectedState || !state || expectedState !== state) {
    res.writeHead(302, {
      Location: `/?consent_error=${encodeURIComponent("This consent link is invalid or expired. Please start the connect flow again.")}`,
    });
    res.end();
    return;
  }

  // Generate a private access token for viewing/re-scanning this tenant's report.
  // The tenant GUID alone is no longer sufficient to view a report - this token is.
  const accessToken = crypto.randomBytes(24).toString("hex");

  try {
    await redis.set(
      `tenant:${tenant}`,
      JSON.stringify({ tenantId: tenant, connectedAt: Date.now(), accessToken }),
      { ex: RETENTION_SECONDS }
    );
  } catch (e) {
    res.writeHead(302, {
      Location: `/?consent_error=${encodeURIComponent("Connected, but we couldn't save the connection. Please try again or contact support.")}`,
    });
    res.end();
    return;
  }

  res.writeHead(302, {
    "Set-Cookie": "m365g_state=; Max-Age=0; Path=/", // clear the one-time state cookie
    Location: `/?tenant=${encodeURIComponent(tenant)}&token=${accessToken}&connected=1`,
  });
  res.end();
};

function getCookie(req, name) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((c) => c.trim()).find((c) => c.startsWith(name + "="));
  return match ? match.split("=")[1] : null;
}

