# Go-to-market assets - M365 Guardian

Everything here is ready to send. You're the one who has to actually send it -
I don't have an email or LinkedIn connector active for this account yet. If
you connect Gmail (I already surfaced that option), I can draft these as
real drafts in your inbox instead of markdown you copy-paste.

Positioning, in one line: **the same recurring M365/Entra misconfigurations
a $1,200-$9,000 manual security audit finds, checked automatically, free for
one tenant.**

---

## 1. Cold email to MSP owners

Subject line options (pick one, or split-test):
- "Free M365 security scan for [Client Name]?"
- "The 8 misconfigs every M365 pentest finds - automated"
- "Cut your M365 audit from 2 days to 2 minutes"

Body:

> Hi [Name],
>
> Quick one - I built a tool that checks an M365/Entra tenant for the same
> recurring misconfigurations pentesters keep finding in manual audits:
> missing baseline MFA, Conditional Access gaps, Global Admin sprawl, admins
> with no MFA registered, risky guest invite settings, and a few others.
>
> It's read-only (nothing it does can change a client's tenant), takes about
> two minutes end to end, and gives you a scored report you could hand to a
> client as-is.
>
> It's free for one tenant. If you manage more than one client, there's a
> $49/mo dashboard that shows all of them sorted worst-score-first.
>
> Would you be open to running it against one of your own client tenants and
> telling me honestly whether the findings are useful? No pitch beyond that -
> genuinely want to know if it's catching the right things.
>
> [Your link]
>
> [Your name]

---

## 2. LinkedIn DM (shorter, less formal)

> Hey [Name] - built a free tool that scans an M365 tenant for the
> misconfigs manual security audits always find (MFA gaps, CA policy holes,
> admin sprawl, etc). Takes ~2 min, read-only, scored report at the end.
> Would love if you tried it on one client tenant and told me if it's
> actually useful or if I'm missing something obvious. [link]

---

## 3. Reddit - r/msp, r/sysadmin, r/AZURE (community-first, not a pitch)

Read each subreddit's self-promo rules before posting - most cap it at once
a week or require a "flair" like [Tool] or [Free Resource]. Lead with the
finding, not the product.

> **Title:** Built a free tool that checks for the same 8ish M365
> misconfigs pentesters always find - feedback welcome
>
> I kept seeing the same pattern in write-ups from firms doing manual M365
> security assessments: baseline MFA missing, no CA policy covering all
> users/apps, no break-glass account, too many Global Admins, guest invites
> wide open, admins with zero MFA methods registered. Same issues, every
> time, across unrelated orgs.
>
> So I built a scanner that checks a tenant for exactly those, read-only,
> via Graph API app permissions - takes about 2 minutes and gives you a
> scored report with plain-English remediation steps.
>
> It's free for one tenant. Built it mostly to see if it's actually useful
> or if I'm missing checks that matter more - if anyone here runs it against
> a test tenant I'd genuinely like the feedback.
>
> [link]

---

## 4. "Design partner" ask (for people you already know)

Use this for actual MSP owners / IT admins in your network - the fastest
path to first real users, per the earlier research.

> Hey - random ask. I built a tool that scans M365 tenants for the common
> security misconfigs (MFA gaps, CA policy holes, admin sprawl, etc.) and
> scores them. Before I put real effort into promoting it, I want 2-3 people
> who actually manage tenants to run it and tell me straight if it's useful
> or if it's missing something obvious. Would you be willing to run it
> against a tenant you manage (read-only, takes 2 min) and give me 10
> minutes of honest feedback after? Happy to return the favor.

---

## 5. Show HN / Hacker News

> **Title:** Show HN: M365 Guardian - free scanner for the M365
> misconfigs pentesters always find
>
> I noticed a pattern reading write-ups from firms doing manual Microsoft
> 365 / Entra ID security assessments (these typically cost $1,200-$9,000):
> the same 8ish misconfigurations show up almost every time - missing
> baseline MFA enforcement, no Conditional Access policy covering all
> users/apps, no break-glass account excluded from MFA policies, more than 5
> Global Admins, guest invites open to everyone, Global Admins with zero MFA
> methods registered, and a couple others.
>
> Built a scanner that checks a tenant for exactly those via read-only Graph
> API app permissions. Free for one tenant, ~2 minutes, scored report with
> remediation steps. $49/mo unlocks a dashboard for people managing multiple
> tenants (MSPs).
>
> Genuinely interested in feedback on what checks are missing or wrong -
> this is v1.
>
> [link]

---

## Notes on sequencing

1. Start with #4 (people you actually know) - free, fast, highest response
   rate, and gets you your first 2-3 real reports to reference.
2. Once you have 1-2 positive results, use them as social proof in #1/#2
   ("just ran this against a client tenant and it caught X").
3. Reddit/HN posts work best *after* you have at least one real testimonial
   - "I built this, please validate it" posts undersell vs. "here's what it
   found on a real tenant."
