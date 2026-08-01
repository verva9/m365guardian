// The @upstash/redis client auto-detects JSON-looking strings and returns
// them already parsed as objects from .get()/.lrange() - but not always,
// depending on how the value was stored and the client's config. Code
// throughout this app was written assuming .get() always returns a raw
// string that still needs JSON.parse(), which breaks (throws, gets
// swallowed by a try/catch, and silently turns into "invalid/expired
// token" errors) whenever the client auto-deserializes for us instead.
//
// This helper handles both cases safely: parse if it's still a string,
// pass through unchanged if it's already an object.
function parseJson(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }
  return raw;
}

module.exports = { parseJson };
