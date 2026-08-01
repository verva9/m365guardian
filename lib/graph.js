const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Get an application-only (client credentials) access token scoped to a
 * specific customer tenant, using our multi-tenant app registration.
 */
async function getAppToken(tenantId, clientId, clientSecret) {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.access_token;
}

/**
 * GET a Graph resource, following @odata.nextLink pagination automatically.
 * Returns the combined `value` array for collection endpoints, or the raw
 * object for single-resource endpoints.
 */
async function graphGet(token, path, options) {
  const maxPages = (options && options.maxPages) || Infinity;
  let url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  let combined = null;
  let isCollection = false;
  let pages = 0;

  while (url && pages < maxPages) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph GET ${path} failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    pages++;

    if (Array.isArray(data.value)) {
      isCollection = true;
      combined = (combined || []).concat(data.value);
      url = data["@odata.nextLink"] || null;
    } else {
      combined = data;
      url = null;
    }
  }
  return isCollection ? combined : combined;
}

module.exports = { getAppToken, graphGet };
