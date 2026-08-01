// Logic tests for lib/graph.js - the pagination helper every check depends
// on. Mocks the global fetch() so no real network call happens.
//
// (Renaming note: this file started as a scratch debug script while writing
// checks.test.js. Repurposed into a real test rather than left as dead
// weight in the repo.)
//
// Run with: node --test test/debug.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const { graphGet } = require("../lib/graph");

function mockFetchSequence(responses) {
  let call = 0;
  return async (url) => {
    const resp = responses[call];
    call++;
    if (!resp) throw new Error(`Unexpected extra fetch call to ${url}`);
    return {
      ok: resp.ok !== false,
      status: resp.status || 200,
      json: async () => resp.body,
      text: async () => JSON.stringify(resp.body),
    };
  };
}

test("graphGet follows @odata.nextLink pagination and combines results", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchSequence([
    { body: { value: [{ id: "a" }, { id: "b" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page" } },
    { body: { value: [{ id: "c" }] } },
  ]);
  t.after(() => { global.fetch = originalFetch; });

  const result = await graphGet("token", "/some/collection");
  assert.deepEqual(result.map((r) => r.id), ["a", "b", "c"]);
});

test("graphGet respects maxPages and stops early on large collections", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchSequence([
    { body: { value: [{ id: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/page2" } },
    { body: { value: [{ id: "b" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/page3" } },
  ]);
  t.after(() => { global.fetch = originalFetch; });

  const result = await graphGet("token", "/some/collection", { maxPages: 2 });
  assert.deepEqual(result.map((r) => r.id), ["a", "b"]);
});

test("graphGet returns a single object as-is for non-collection responses", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchSequence([{ body: { isEnabled: true } }]);
  t.after(() => { global.fetch = originalFetch; });

  const result = await graphGet("token", "/policies/identitySecurityDefaultsEnforcementPolicy");
  assert.deepEqual(result, { isEnabled: true });
});

test("graphGet throws with status code on a non-ok response", async (t) => {
  const originalFetch = global.fetch;
  global.fetch = mockFetchSequence([{ ok: false, status: 403, body: { error: "Forbidden" } }]);
  t.after(() => { global.fetch = originalFetch; });

  await assert.rejects(
    () => graphGet("token", "/policies/authorizationPolicy"),
    /403/
  );
});
