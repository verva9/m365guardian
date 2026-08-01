const { graphGet } = require("./graph");

// Each check is worth `weight` points toward the final /100 score.
// If a check can't be evaluated (missing license, permission, or API
// error), it's excluded from both the score and the denominator rather
// than counted as a failure - we say "couldn't verify", not "failed".

async function checkSecurityDefaults(token, findings) {
  try {
    const policy = await graphGet(token, "/policies/identitySecurityDefaultsEnforcementPolicy");
    findings.push({
      id: "security-defaults",
      title: "Security Defaults or equivalent baseline MFA",
      severity: "critical",
      weight: 15,
      passed: !!policy.isEnabled,
      detail: policy.isEnabled
        ? "Security Defaults is enabled, enforcing MFA for all users tenant-wide."
        : "Security Defaults is OFF. Baseline protection depends entirely on Conditional Access policies being configured correctly (checked separately below).",
      remediation: policy.isEnabled
        ? null
        : "If you don't have custom Conditional Access policies covering all users, enable Security Defaults in Entra ID > Properties, or build an equivalent CA policy.",
    });
  } catch (e) {
    findings.push(unverifiable("security-defaults", "Security Defaults or equivalent baseline MFA", e));
  }
}

async function checkConditionalAccessMFA(token, findings, caPoliciesRef) {
  try {
    const policies = await graphGet(token, "/identity/conditionalAccess/policies");
    caPoliciesRef.policies = policies;

    const enabled = policies.filter((p) => p.state === "enabled");
    const baseline = enabled.find((p) => {
      const users = p.conditions?.users?.includeUsers || [];
      const apps = p.conditions?.applications?.includeApplications || [];
      const controls = p.grantControls?.builtInControls || [];
      return users.includes("All") && apps.includes("All") && controls.includes("mfa");
    });

    findings.push({
      id: "ca-baseline-mfa",
      title: "Conditional Access policy enforcing MFA for all users/apps",
      severity: "critical",
      weight: 20,
      passed: !!baseline,
      detail: baseline
        ? `Found an enabled policy ("${baseline.displayName}") requiring MFA for all users across all apps.`
        : `No enabled Conditional Access policy requires MFA for all users across all cloud apps. Found ${enabled.length} other enabled polic${enabled.length === 1 ? "y" : "ies"}.`,
      remediation: baseline
        ? null
        : "Create a Conditional Access policy targeting All users / All cloud apps with a Require multifactor authentication grant control.",
    });
  } catch (e) {
    findings.push(unverifiable("ca-baseline-mfa", "Conditional Access policy enforcing MFA for all users/apps", e));
  }
}

function checkBreakGlassExclusion(findings, caPoliciesRef) {
  const policies = caPoliciesRef.policies || [];
  const mfaPolicies = policies.filter((p) => {
    const controls = p.grantControls?.builtInControls || [];
    return p.state === "enabled" && controls.includes("mfa");
  });
  const anyExclusion = mfaPolicies.some((p) => (p.conditions?.users?.excludeUsers || []).length > 0);

  findings.push({
    id: "break-glass",
    title: "Break-glass account excluded from MFA policies",
    severity: "medium",
    weight: 10,
    passed: mfaPolicies.length === 0 ? null : anyExclusion,
    detail:
      mfaPolicies.length === 0
        ? "No MFA-enforcing Conditional Access policies exist yet, so this doesn't apply until you add one."
        : anyExclusion
        ? "At least one MFA policy has a user exclusion configured. Verify it's a documented, monitored break-glass account, not an accidental gap."
        : "None of your MFA-enforcing policies have any user exclusions. That's good for coverage, but confirm you have an emergency access account excluded somewhere, or a lockout during an MFA outage could lock out all admins.",
    remediation: anyExclusion || mfaPolicies.length === 0
      ? null
      : "Create one dedicated emergency-access account, exclude it from CA policies, secure it with a long random password, and monitor its sign-ins closely.",
  });
}

async function checkGuestInvitePolicy(token, findings) {
  try {
    const policy = await graphGet(token, "/policies/authorizationPolicy");
    const setting = policy.allowInvitesFrom;
    const risky = setting === "everyone";
    findings.push({
      id: "guest-invites",
      title: "Guest invitation policy",
      severity: "medium",
      weight: 10,
      passed: !risky,
      detail: `Current setting: "${setting}". ${
        risky
          ? "Any user in the tenant can invite external guests without approval."
          : "Guest invitations are restricted to admins/specific roles, which is the safer default."
      }`,
      remediation: risky
        ? "In Entra ID > External Identities > External collaboration settings, restrict guest invitations to admins and users in the Guest Inviter role."
        : null,
    });
  } catch (e) {
    findings.push(unverifiable("guest-invites", "Guest invitation policy", e));
  }
}

async function checkGlobalAdminCount(token, findings, globalAdminsRef) {
  try {
    const roles = await graphGet(token, "/directoryRoles");
    const gaRole = roles.find((r) => r.displayName === "Global Administrator");
    if (!gaRole) {
      findings.push(unverifiable("global-admin-count", "Global Administrator count", new Error("Role not activated/found")));
      return;
    }
    const members = await graphGet(token, `/directoryRoles/${gaRole.id}/members`);
    globalAdminsRef.ids = members.map((m) => m.id);
    globalAdminsRef.details = members;

    const count = members.length;
    const tooMany = count > 5;
    findings.push({
      id: "global-admin-count",
      title: "Number of Global Administrators",
      severity: "high",
      weight: 15,
      passed: !tooMany && count > 0,
      detail: `${count} account(s) hold the Global Administrator role.`,
      remediation:
        count === 0
          ? null
          : tooMany
          ? "Microsoft recommends fewer than 5 Global Admins. Move day-to-day admins to narrower roles (User Admin, Exchange Admin, etc.) and reserve Global Admin for break-glass and true tenant owners."
          : null,
    });
  } catch (e) {
    findings.push(unverifiable("global-admin-count", "Number of Global Administrators", e));
  }
}

async function checkMfaRegistrationCoverage(token, findings, globalAdminsRef) {
  try {
    // Capped at 5 pages (~5,000 users) to stay within serverless function
    // time limits on large tenants. Enough users for an accurate percentage
    // even if not every single account is included.
    const details = await graphGet(token, "/reports/authenticationMethods/userRegistrationDetails", { maxPages: 5 });
    if (!details || details.length === 0) {
      findings.push(unverifiable("mfa-coverage", "MFA registration coverage", new Error("No data returned")));
      return;
    }
    const registered = details.filter((d) => d.isMfaRegistered).length;
    const pct = Math.round((registered / details.length) * 100);

    findings.push({
      id: "mfa-coverage",
      title: "Percentage of users registered for MFA",
      severity: "high",
      weight: 15,
      passed: pct >= 90,
      detail: `${pct}% of users (${registered}/${details.length}) have at least one MFA method registered.`,
      remediation: pct >= 90 ? null : "Target 100% MFA registration. Use Entra ID's registration campaign feature to nudge remaining users.",
    });

    // Cross-reference: any Global Admin without MFA registered
    if (globalAdminsRef.ids && globalAdminsRef.ids.length) {
      const byId = new Map(details.map((d) => [d.id, d]));
      const unprotectedAdmins = globalAdminsRef.ids.filter((id) => {
        const d = byId.get(id);
        return d && !d.isMfaRegistered;
      });
      findings.push({
        id: "admin-mfa-gap",
        title: "Global Administrators without MFA registered",
        severity: "critical",
        weight: 15,
        passed: unprotectedAdmins.length === 0,
        detail:
          unprotectedAdmins.length === 0
            ? "Every Global Administrator account has at least one MFA method registered."
            : `${unprotectedAdmins.length} Global Administrator account(s) have NO MFA method registered. This is the single highest-impact finding possible in a tenant.`,
        remediation:
          unprotectedAdmins.length === 0
            ? null
            : "Register MFA for these accounts immediately, or better, ensure Conditional Access blocks any admin sign-in without MFA.",
      });
    }
  } catch (e) {
    findings.push(unverifiable("mfa-coverage", "MFA registration coverage", e));
    findings.push(unverifiable("admin-mfa-gap", "Global Administrators without MFA registered", e));
  }
}

async function checkAdminConsentWorkflow(token, findings) {
  try {
    const policy = await graphGet(token, "/policies/adminConsentRequestPolicy");
    findings.push({
      id: "admin-consent-workflow",
      title: "Admin consent workflow for risky app permissions",
      severity: "low",
      weight: 5,
      passed: !!policy.isEnabled,
      detail: policy.isEnabled
        ? "Admin consent workflow is enabled - users who hit a permission wall can request review instead of being stuck or admins granting broad user consent."
        : "Admin consent workflow is disabled. Combined with permissive user consent settings, this can let users grant risky third-party apps access to company data.",
      remediation: policy.isEnabled
        ? null
        : "Enable the admin consent workflow in Entra ID > Enterprise applications > Consent and permissions, and review current user consent settings.",
    });
  } catch (e) {
    findings.push(unverifiable("admin-consent-workflow", "Admin consent workflow for risky app permissions", e));
  }
}

function unverifiable(id, title, error) {
  return {
    id,
    title,
    severity: "info",
    weight: 0,
    passed: null,
    detail: `Couldn't verify this check - likely a missing license, permission, or API limitation for this tenant. (${String(error.message || error).slice(0, 200)})`,
    remediation: null,
  };
}

async function runAllChecks(token) {
  const findings = [];
  const caPoliciesRef = {};
  const globalAdminsRef = {};

  await checkSecurityDefaults(token, findings);
  await checkConditionalAccessMFA(token, findings, caPoliciesRef);
  checkBreakGlassExclusion(findings, caPoliciesRef);
  await checkGuestInvitePolicy(token, findings);
  await checkGlobalAdminCount(token, findings, globalAdminsRef);
  await checkMfaRegistrationCoverage(token, findings, globalAdminsRef);
  await checkAdminConsentWorkflow(token, findings);

  const scorable = findings.filter((f) => f.passed !== null && f.weight > 0);
  const earned = scorable.reduce((sum, f) => sum + (f.passed ? f.weight : 0), 0);
  const possible = scorable.reduce((sum, f) => sum + f.weight, 0);
  const score = possible > 0 ? Math.round((earned / possible) * 100) : null;

  return { score, findings, scannedAt: new Date().toISOString() };
}

module.exports = { runAllChecks };
