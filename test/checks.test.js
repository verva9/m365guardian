// Logic tests for lib/checks.js - the actual scoring/finding logic that
// decides what a customer sees on their report. No test framework
// dependency: uses Node's built-in `node:test` + `node:assert/strict`
// (stable since Node 18), and mocks lib/graph.js's graphGet via
// require.cache so no network/Graph API calls happen.
//
// Run with: node --test test/checks.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const graphModulePath = require.resolve("../lib/graph");
const checksModulePath = require.resolve("../lib/checks");

// Loads a fresh copy of lib/checks.js with lib/graph.js's graphGet replaced
// by a mock function `(token, path, options) => response`. Fresh module
// instances per test avoid any state leaking between cases.
function loadChecksWithMock(mockGraphGetByPath) {
  delete require.cache[checksModulePath];
  delete require.cache[graphModulePath];
  require.cache[graphModulePath] = {
    id: graphModulePath,
    filename: graphModulePath,
    loaded: true,
    exports: {
      // graphGet's real signature is (token, path, options) - the mock
      // helpers below only care about `path`, so unwrap it here once.
      graphGet: async (token, path, options) => mockGraphGetByPath(path),
      getAppToken: async () => "mock-token",
    },
  };
  return require(checksModulePath);
}

function findingById(findings, id) {
  return findings.find((f) => f.id === id);
}

// A fully "healthy" tenant - every check should pass, and 100% MFA registration.
function healthyResponses(path) {
  if (path === "/policies/identitySecurityDefaultsEnforcementPolicy") {
    return { isEnabled: true };
  }
  if (path === "/identity/conditionalAccess/policies") {
    return [
      {
        displayName: "Require MFA for all users",
        state: "enabled",
        conditions: { users: { includeUsers: ["All"], excludeUsers: ["break-glass-id"] }, applications: { includeApplications: ["All"] } },
        grantControls: { builtInControls: ["mfa"] },
      },
    ];
  }
  if (path === "/policies/authorizationPolicy") {
    return { allowInvitesFrom: "adminsAndGuestInviters" };
  }
  if (path === "/directoryRoles") {
    return [{ id: "role-1", displayName: "Global Administrator" }];
  }
  if (path === "/directoryRoles/role-1/members") {
    return [{ id: "admin-1" }, { id: "admin-2" }];
  }
  if (path === "/reports/authenticationMethods/userRegistrationDetails") {
    return [
      { id: "admin-1", isMfaRegistered: true },
      { id: "admin-2", isMfaRegistered: true },
      { id: "user-3", isMfaRegistered: true },
      { id: "user-4", isMfaRegistered: true },
    ];
  }
  if (path === "/policies/adminConsentRequestPolicy") {
    return { isEnabled: true };
  }
  throw new Error(`Unhandled mock path: ${path}`);
}

test("healthy tenant scores 100 and every scorable check passes", async () => {
  const { runAllChecks } = loadChecksWithMock(healthyResponses);
  const report = await runAllChecks("token");

  assert.equal(report.score, 100);
  for (const f of report.findings) {
    if (f.weight > 0) {
      assert.equal(f.passed, true, `expected ${f.id} to pass`);
    }
  }
});

test("Security Defaults off is correctly flagged as failed, not unverifiable", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/policies/identitySecurityDefaultsEnforcementPolicy") return { isEnabled: false };
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  const f = findingById(report.findings, "security-defaults");
  assert.equal(f.passed, false);
  assert.ok(f.remediation, "a failed check should include remediation guidance");
});

test("CA policy missing 'All' apps/users does not count as baseline MFA coverage", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/identity/conditionalAccess/policies") {
      return [
        {
          displayName: "MFA for finance only",
          state: "enabled",
          conditions: { users: { includeUsers: ["some-group"] }, applications: { includeApplications: ["All"] } },
          grantControls: { builtInControls: ["mfa"] },
        },
      ];
    }
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  assert.equal(findingById(report.findings, "ca-baseline-mfa").passed, false);
});

test("break-glass check is null/unscored when there are no MFA-enforcing CA policies", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/identity/conditionalAccess/policies") return [];
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  const f = findingById(report.findings, "break-glass");
  assert.equal(f.passed, null);
  assert.equal(f.weight, 10);
  // null-passed findings must not count toward the score denominator
  const scorable = report.findings.filter((x) => x.passed !== null && x.weight > 0);
  assert.ok(!scorable.includes(f));
});

test("break-glass fails when an MFA policy has zero exclusions", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/identity/conditionalAccess/policies") {
      return [
        {
          displayName: "Require MFA for all users",
          state: "enabled",
          conditions: { users: { includeUsers: ["All"], excludeUsers: [] }, applications: { includeApplications: ["All"] } },
          grantControls: { builtInControls: ["mfa"] },
        },
      ];
    }
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  assert.equal(findingById(report.findings, "break-glass").passed, false);
});

test("guest invites open to everyone fails the check", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/policies/authorizationPolicy") return { allowInvitesFrom: "everyone" };
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  assert.equal(findingById(report.findings, "guest-invites").passed, false);
});

test("more than 5 Global Admins fails with remediation, 0 admins fails without remediation text", async () => {
  const manyAdmins = Array.from({ length: 6 }, (_, i) => ({ id: `admin-${i}` }));
  const { runAllChecks: runMany } = loadChecksWithMock((p) => {
    if (p === "/directoryRoles/role-1/members") return manyAdmins;
    return healthyResponses(p);
  });
  const reportMany = await runMany("token");
  const manyFinding = findingById(reportMany.findings, "global-admin-count");
  assert.equal(manyFinding.passed, false);
  assert.ok(manyFinding.remediation);

  const { runAllChecks: runZero } = loadChecksWithMock((p) => {
    if (p === "/directoryRoles/role-1/members") return [];
    return healthyResponses(p);
  });
  const reportZero = await runZero("token");
  const zeroFinding = findingById(reportZero.findings, "global-admin-count");
  assert.equal(zeroFinding.passed, false);
  assert.equal(zeroFinding.remediation, null); // documented existing behavior, not a bug fix
});

test("MFA registration percentage math and the Global-Admin-without-MFA cross-reference", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/directoryRoles/role-1/members") return [{ id: "admin-1" }, { id: "admin-2" }];
    if (p === "/reports/authenticationMethods/userRegistrationDetails") {
      return [
        { id: "admin-1", isMfaRegistered: true },
        { id: "admin-2", isMfaRegistered: false }, // unprotected admin
        { id: "user-3", isMfaRegistered: true },
        { id: "user-4", isMfaRegistered: false },
      ];
    }
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");

  const coverage = findingById(report.findings, "mfa-coverage");
  assert.equal(coverage.detail.includes("50%"), true); // 2/4 registered

  const gap = findingById(report.findings, "admin-mfa-gap");
  assert.equal(gap.passed, false);
  assert.equal(gap.severity, "critical");
  assert.equal(gap.detail.includes("1 Global Administrator"), true);
});

test("a failed Graph call produces an unverifiable finding, excluded from the score", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/policies/adminConsentRequestPolicy") throw new Error("Forbidden - missing permission");
    return healthyResponses(p);
  });
  const report = await runAllChecks("token");
  const f = findingById(report.findings, "admin-consent-workflow");
  assert.equal(f.passed, null);
  assert.equal(f.weight, 0);
  assert.ok(f.detail.includes("Couldn't verify"));
  // Excluding this 5-point check from a fully-healthy tenant should still
  // leave a perfect score across the remaining scorable checks.
  assert.equal(report.score, 100);
});

test("a fully broken tenant scores 0, not null, when every check is scorable and failing", async () => {
  const { runAllChecks } = loadChecksWithMock((p) => {
    if (p === "/policies/identitySecurityDefaultsEnforcementPolicy") return { isEnabled: false };
    if (p === "/identity/conditionalAccess/policies") return [];
    if (p === "/policies/authorizationPolicy") return { allowInvitesFrom: "everyone" };
    if (p === "/directoryRoles") return [{ id: "role-1", displayName: "Global Administrator" }];
    if (p === "/directoryRoles/role-1/members") return Array.from({ length: 8 }, (_, i) => ({ id: `admin-${i}` }));
    if (p === "/reports/authenticationMethods/userRegistrationDetails") {
      return Array.from({ length: 8 }, (_, i) => ({ id: `admin-${i}`, isMfaRegistered: false }));
    }
    if (p === "/policies/adminConsentRequestPolicy") return { isEnabled: false };
    throw new Error(`Unhandled mock path: ${p}`);
  });
  const report = await runAllChecks("token");
  assert.equal(report.score, 0);
});
