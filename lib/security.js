const crypto = require("crypto");

// Constant-time string comparison. A plain `a !== b` leaks timing
// information proportional to how many leading characters match, which in
// theory lets an attacker recover a secret token byte-by-byte over enough
// requests. Tokens here are 192-bit random hex (crypto.randomBytes(24)),
// making that attack impractical regardless, but comparing secrets this way
// is the correct default rather than something to special-case later.
function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch, so pad to equal length first
  // (comparing against a hash of both keeps this branch itself safe from
  // being used as a length oracle).
  if (bufA.length !== bufB.length) {
    // Still do a dummy fixed-size compare so a length mismatch doesn't return
    // measurably faster than a full comparison would.
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Microsoft tenant IDs are GUIDs. Validating this before using the value in
// a URL (getAppToken's token endpoint), a Redis key, or a Graph API call
// closes off injection paths (SSRF via a crafted "tenant" pointing somewhere
// that isn't login.microsoftonline.com, Redis key-prefix confusion, log
// injection, etc.) - reject anything that isn't a well-formed GUID up front.
const GUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function isValidTenantId(value) {
  return typeof value === "string" && GUID_RE.test(value);
}

// Generic bounded-string check for anything else user-supplied (tokens,
// mspKeys, labels) - rejects non-strings, empty strings, and anything
// absurdly long (guards against someone sending a multi-MB "label" to churn
// CPU/Redis storage).
function isBoundedString(value, maxLen) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLen;
}

module.exports = { safeCompare, isValidTenantId, isBoundedString };
