# CLAUDE.md

Read this before doing anything. It carries the decisions and traps that aren't visible in the code.

## The project

DigiKhata-style digital ledger (khata/udhaar bookkeeping) for a client in Pakistan whose
business runs in two locations — Khuzdar and Dubai. Owners need visibility into what staff
in the other location are doing.

React Native + Expo 51, TypeScript, expo-sqlite (local-first), Firebase Firestore
(push-only), Zustand, NativeWind + StyleSheet. ~27k LOC, ~170 source files, 35 tables,
schema at **v48**. English + Urdu.

Eight books: Cash, Khata (receivables), Bill, Stock, Expense, Purchase, Staff, Customer.
Plus Reports, Reminders, Activity Log, Global Search, Sync Center.

Roles: admin (owner) → staff → sub-staff. Visibility flows DOWNWARD through `users.parentId`.
`users.account_level` ('admin' | 'staff' | 'substaff') is for ROLE CHECKS ONLY — never for
scoping.

> **IN PROGRESS — sub-staff logins are being removed (approved 2026-09-28).** The tree becomes
> admin → staff only; sub-staff become `staff_records` rows with NO login (`linked_user_id`
> NULL) that a staff member adds to record salary.
>
> **ALL THREE STEPS ARE NOW DONE (c) landed 2026-10-06.** The `__DEV__` wipe exists
> (`devWipe.wipeSubStaffLoginsForTesting`), all depth logic is two levels, and Add Staff has
> its no-login mode.
>
> **How (c) works.** `createStaffMember` branches on WHO IS ADDING, and the caller cannot
> ask — if it could, a staff member's form could ask too (`adminIsAdding()`):
> - admin → a staff member WITH a login (phone is the username, password required). Unchanged.
> - staff → their own sub-staff as a RECORD: `linked_user_id` NULL, no password, phone
>   optional. `createStaffMember` returns `{ user: null, staff }` in this mode.
>
> A sub-staff never installs the app. Salary already hangs off `staff_records.id` (the
> `staff_salary_transactions` FK), **not** off a login, which is the whole reason a
> record-only person has full salary history with no schema work. The admin never creates
> one; they only SEE them, through the existing downward drill-down
> (`getStaffRecords(viewerId, createdBy)` → `entryOwner`). Decided 2026-10-06: no toggle
> for the admin.
>
> **Migration v43** relaxes `staff_records.phone` to nullable (a record has no login, so no
> username). It is the same table rebuild v37 used on this table. **The base schema in
> `initializeDatabase` deliberately still says `phone TEXT NOT NULL`** — leading with a
> nullable base lets a NULL phone exist BEFORE v37 runs, and v37's shipped DDL hardcodes
> `phone TEXT NOT NULL`, so its copy INSERT fails and aborts every later migration on that
> device. Checks 2 and 29 catch exactly this; do not "tidy" the base schema to match.
>
> **Sub-staff cannot log in, enforced at the door.** `assertConsistentLevel` already refused
> to CREATE such a login, but `verifyUserLogin` checked only `is_deleted` and the password
> hash — so a row created BEFORE the policy still signed in, and the wipe that clears those
> is `__DEV__`-only and manual. `verifyUserLogin` now refuses `account_level === 'substaff'`
> outright, without deleting anything. Check 138.
>
> Decisions already fixed, do not re-litigate:
> - The `account_level` CHECK constraint **stays as it is**. 'substaff' is retired in CODE only.
>   Rebuilding `users` — the table every foreign key points at — for no behavioural gain is not
>   worth the risk.
> - `canViewCnic` and `mayCloseDay` are **KEPT as stubs**, constant-true under a two-level tree,
>   with a comment saying so. They are the boundary if a third level ever returns. Deleting a
>   named security check is how it gets rebuilt wrong later. Check 81 stays.
> - The v32 migration and its tests (checks 33, 34) keep testing the migration **as shipped**;
>   only their sub-staff expectations drop. No assertion is weakened beyond removing the level.

> **IN PROGRESS — MULTI-CURRENCY, four steps (plan approved 2026-09-28, resumed 2026-10-02).**
> Four currencies, no more: **PKR, AED, USD, CNY**. See rule 3 for why the list is closed and
> why KWD is excluded. The owner tests on the device between steps, so each step pauses.
>
> - **Step 1 — foundation. DONE (2026-10-02).** `src/utils/currency.ts` holds the closed
>   `CURRENCIES` table (prefix, locale, `minorUnits: 100`) and `resolveCurrency`, which is
>   TOTAL: null, a legacy row, an unknown code or a stray argument all resolve to PKR rather
>   than throwing or printing "undefined" beside a figure. `formatCurrency(paisa, currency?)`
>   and `formatSignedCurrency` take an optional currency; omitting it gives byte-identical
>   output to before, so all ~114 existing call sites are unchanged. Migration **v41** adds
>   `users.default_currency` and `currency` to `bills`, `expenses`, `purchase_orders` and
>   `purchase_invoices`, all `NOT NULL DEFAULT 'PKR'`.
> - **Step 2 — account default currency. DONE (2026-10-03).** Suggest the default from the country
>   code of the staff account's login phone: `+92`→PKR, `+971`→AED, `+86`→CNY, `+1`→USD,
>   anything else→PKR. A **SUGGESTION, never a lock** — changeable on the Add Staff form before
>   saving and on the staff profile afterwards, because a person with a Pakistani number may
>   work in Dubai. **In scope and not optional:** add `CountryCodePicker` to the Add Staff
>   phone field and extend that component to include the US and China. It currently lists 12
>   Asian countries with neither, and the field is free text with a `"+92 300 1234567"`
>   placeholder — without this the suggestion almost never fires.
>   Built as: `currencyFromPhone` in `src/utils/currency.ts` (longest dial code first);
>   `CurrencyPicker` in `src/components/ui/CurrencyPicker.tsx` (inline chip + list, NOT a
>   modal — Add Staff is already a sheet, and a sheet over a sheet will not dismiss
>   reliably on Android); `users.default_currency` written by `createUser` and editable
>   through `updateStaffProfile`, which handles it OUTSIDE `STAFF_PROFILE_FIELDS` because
>   it lives on the login, not the staff_record — the same exception `name_en` makes.
>   The suggestion stops re-deriving the moment the admin picks a currency
>   (`currencyTouched`): a Pakistani number may belong to someone working in Dubai.
>   Check 126 pins all of it. Khata follows the account default (decided 2026-10-03) —
>   no column, no picker, nothing to migrate.
> - **Step 3 — per-entry currency picker. DONE (2026-10-04).** A small control in the amount area of
>   Bill, Purchase and Expense, applying to that entry only and leaving the account default
>   untouched. An entry is stored and displayed in the currency it was entered in.
>   Built as: `AmountText` gained a `currency` prop (omit = PKR, so every pre-v41 call
>   site is unchanged); the chip opens on the ACCOUNT default every time and nothing is
>   remembered between entries — checks 127/128 fail on AsyncStorage/lastCurrency in any
>   of those forms. Each data layer falls back to `users.default_currency`, never a
>   hardcoded PKR. A receipt, a return and the printed bill invoice all carry their
>   parent document’s currency.
> - **Step 4 — grouped totals. DONE (2026-10-04).** A total that may span currencies is
>   `CurrencyTotal[]` — ONE FIGURE PER CURRENCY, never a sum across them. Grouping is in
>   SQL (`GROUP BY … currency`); `totalsFrom` in `src/utils/currencyTotals.ts` only orders
>   the lines: ACCOUNT DEFAULT FIRST, then alphabetical, so a stack never reorders between
>   renders. `AmountStack` renders them; with one currency it is one `AmountText` and the
>   screen is unchanged. Affected: Bill/Expense/Purchase day headers and summaries, the
>   Outstanding and Paid-this-month tiles, the expense and bill PDFs (stacked) and the
>   expense CSV (a Currency column). Check 129 fails if any aggregate goes back to a flat
>   SUM. The six stale comments are cleared and `pendingPayments` is grouped, so it is a
>   real figure again — the dashboard still only asks whether anything is owed.
>   NOTE: a supplier payment has no currency of its own; it is read through its invoice
>   (`supplier_payments` LEFT JOIN `purchase_invoices`) so the two can never disagree.
> - **Step 5 — the REPORTS tab. DONE (2026-10-05).** Step 4 covered the books and MISSED
>   `services/database/reports/` entirely, so every report still did a flat `SUM(total)`
>   and printed it as rupees: a period holding Rs 45,000 and AED 3,000 reported
>   **"Total sales Rs. 48,000"** — found on the device, not by a test. Sales, Profit &
>   loss, Expenses, Customers, Inventory best-sellers and Staff all group by currency now,
>   through the same `totalsFrom` the books use.
>
>   **Derived figures refuse rather than guess.** Profit, margin and the comparison bars
>   appear only when the period is in ONE currency AND that currency is the account
>   default (`profitAvailable` / `profitCurrency` on `ProfitLossSummary`). Both halves
>   matter: AED revenue minus PKR expenses is not a number, and COGS comes from
>   `stock_items.purchase_price`, which has NO currency column and is therefore in the
>   account default — charging a PKR cost against an AED sale is the same error. A mixed
>   period shows the components stacked and says why there is no single profit.
>
>   **RANKING IS A COMPARISON, NOT A TOTAL (decided 2026-10-05).** There are no exchange
>   rates in this app by design, so Rs 45,000 cannot be ranked against AED 3,000. Top
>   buyers, best sellers and the expense category breakdown each return ONE ORDERED LIST
>   PER CURRENCY (`CustomerPerformanceGroup`, `ProductPerformanceGroup`,
>   `ExpenseCategoryGroup`), with the limit applied per currency and the groups ordered
>   account-default-first, then alphabetically — the same rule `totalsFrom` uses. A
>   single-currency account gets exactly one group and the list it always saw. Staff are
>   ordered by bills created, a COUNT, because that is currency-free; their sales stack.
>   Percentages are of their own currency's total. Do NOT collapse these back into one
>   ranked list, and do not add exchange rates to make it possible.
>
>   **Bars go away when a figure stacks.** A bar compares rows against one scale, and two
>   currencies have no common scale, so `BarRow` draws no track when it is given a
>   stacked total. Single-currency screens keep their bars unchanged.
>
>   `accountCurrencyOf` now lives ONCE in `services/database/accountCurrency.ts`; billDb
>   and expenseDb import it instead of each keeping a private copy. Check 136 pins all of
>   this, including a STATIC guard that fails if any new `SUM(` over bills / bill_items /
>   expenses in `reports/` is added without `GROUP BY ... currency`.

>
> **Currency lives on the ENTRY ROOTS only** — the four tables above. A bill item, a goods
> receipt, a supplier payment and a purchase return inherit the currency of the document they
> belong to; a second column would let a line disagree with its invoice. Check 123 asserts
> their absence.
>
> **Khata and cashbook follow the ACCOUNT DEFAULT (decided 2026-10-03).** They have no
> currency column and no picker: an entry is denominated in the owning account's
> `users.default_currency`. Nothing to migrate, and a Dubai account's ledger is in AED
> without a per-entry choice. Do not add a picker to khata without asking.
>
> **A picker-less form must still NAME its currency (2026-10-06).** Khata, cashbook, stock
> prices and a staff salary have no picker, and their labels hardcoded "(Rs.)" in every
> account — a Dubai shop was told to type rupees into a field that stores dirhams. Those
> five labels now take a `{currency}` parameter filled by
> `utils/currency.accountCurrencyLabel(user?.defaultCurrency)`, which is the same `prefix`
> the figures are formatted with, trimmed. One source, so a label cannot name a different
> currency from the amount beside it. Any new picker-less money field does the same.
>
> **Stale comments to clear in step 4.** These were written for a multi-currency design that
> did not exist, and each also has a valid independent reason (no caller, or a parallel
> implementation that could drift) — so the removals they describe were fine, but their
> currency rationale is not yet true: `billDb.ts`
> `calculatePendingPayments` comment, `expenseDb.ts` `getExpensesByUserId` comment, and three
> in `useDashboardStore.ts` including the one telling readers never to render
> `pendingPayments`.

> **PHONE NUMBERS ARE E.164 (2026-10-07).** `userDb.normalisePhone` returns `+<cc><number>`
> and delegates the country logic to `utils/phone.internationalPhone` — do not write a
> second copy of that rule.
>
> **It restores the trunk '0' FIRST, and that line is load-bearing — do not "simplify" it
> away.** `internationalPhone` reads a number with no leading zero as "already carries a
> country code". That is correct for a STORED contact number (its documented job: SMS and
> WhatsApp) and wrong for a TYPED login, where "3001234567" is someone omitting the trunk
> zero, not the country code. Without that line, `3001234567` normalised to `+3000000000`
> — a real account, reachable only by typing it back in that exact shape, which locked the
> owner out of the seeded admin. Migration **v47** repairs rows v45 wrote that way; its
> rule is `'+' + exactly 10 digits`, which is not valid E.164 for any supported currency
> (PK 12 digits, AE 12, US 11, CN 13) and so cannot touch a real number. Check 145 pins
> that every spelling of one number is one account; check 146 pins the repair. It previously stripped only `92` and forced a leading `0`, so a
> Dubai `+971501234567` was stored as `0971501234567` and a US number as `012...`:
> self-consistent, so login worked, but not a phone number and not recoverable into one.
> It had to be fixed before the phone becomes the Firebase Auth identifier, because after
> that it is frozen.
>
> **Migration v45** re-normalises existing `users.phone` and `staff_records.phone`. Without
> it an upgrade does not merely lock people out — it CRASHES on launch: the seed guards
> look for the normalised spelling, miss the old-format row, and re-seed; the old
> `seedTestUsers` then inserted its hardcoded id and died on `UNIQUE constraint failed:
> users.id` inside startup. Two numbers that normalise to the same value are SKIPPED, never
> merged: that is a duplicate account for the owner to resolve, not something to guess at.
>
> **`seedTestUsers` is DELETED.** It created a second admin (`03339999999` / `admin123`) via
> raw SQL that bypassed `createUser` — and so bypassed the password strength rule that
> account would have failed — in every build, surviving every wipe because its id was
> hardcoded. v45 soft-deletes the row on devices that already have it. **The seed creates
> ONE admin**: `03000000000` / `Admin@12345`, stored as `+923000000000`.
>
> **Guard a migration on the COLUMN, not the table.** `PRAGMA table_info` returns `[]` for a
> missing table, so one check covers both. v45's first version read `users.phone`
> unconditionally and stalled the whole chain in the entryAudit suite, whose fixture `users`
> has no `phone` column — the exact trap rule 9 names.

> **FIREBASE AUTH IS A TRANSPORT CREDENTIAL, NOT THIS APP'S LOGIN (step 7, 2026-10-07).**
> The app authenticates locally against `users.passwordHash`; Firestore merely refuses a
> write from nobody. `ensureFirebaseAccount` runs as a SIDE-EFFECT of a login that already
> succeeded — fire-and-forget, never awaited, never throws. Nothing about logging in,
> working offline or the local session depends on it.
>
> - **Sign in BEFORE create.** With email-enumeration protection on, an unknown account
>   returns `auth/invalid-credential`, not `auth/user-not-found` — so "create on not-found"
>   silently stops creating anyone. `auth/email-already-in-use` from the create attempt is
>   what distinguishes a new account from a wrong password.
> - The account is keyed on a synthetic address, `<E.164 digits>@digikhata.internal`. The
>   domain is deliberately unreachable, which is also why no password reset can arrive by
>   email.
> - React Native persistence (`getReactNativePersistence(AsyncStorage)`) is read off the
>   module at runtime: it exists in the build Metro resolves but not in the browser
>   typings. Without it a restart signs the account out and uploads stop until the next
>   local login.
>
> **PASSWORD DIVERGENCE IS STRUCTURAL, NOT AN EDGE CASE.** `users.passwordHash` is in
> `LOCAL_ONLY_FIELDS`, so local hashes are PER DEVICE. Change a password on one phone and
> the other still accepts the old one, while Firebase — the only copy both share — holds
> the new one. Chosen answer (2026-10-07):
> - `changeOwnPassword` **refuses when offline** and moves **Firebase first**, local hash
>   second. A Firebase refusal therefore leaves nothing changed anywhere. Changing a
>   password needs connectivity; writing a transaction never does.
> - A divergence surfaces in Settings and is resolved with **Firebase as the tiebreaker**:
>   if Firebase accepts the typed password, that password is current and the LOCAL hash is
>   updated to match it.
>
> **The long-term answer is CUSTOM TOKENS, and it was not done now.** A Cloud Function
> holding the Admin SDK would mint a custom token after the app proves a local login, so no
> Firebase password would exist at all and divergence would be impossible by construction.
> It was deferred because it needs a backend this project does not yet have, and because
> the hard part — how the function decides to trust the request — most likely comes back to
> the local password anyway. Revisit when a backend exists; it replaces the whole
> divergence mechanism rather than extending it.

> **ownerId / visibleTo ARE STAMPED AT UPLOAD, NOT AT WRITE (step 6, 2026-10-07).**
> `services/database/syncAuthorisation.ts` is the single place: the author comes from the
> document path (`users/{localId}/…`), `ownerId` is that account's `firebase_uid`, and
> `visibleTo` is the author plus their live parent chain. Both uploaders in syncProcessor
> stamp through it — if one ever does not, it bypasses the rules.
>
> - **Upload time, not write time.** A row queued before its author had a Firebase uid
>   would otherwise carry no ownerId forever and stay refused even after they logged in. At
>   upload the uid is necessarily present (you cannot upload signed out) and the parent
>   chain is CURRENT, so a staff member moved between owners does not ship a stale audience.
>   This still satisfies "computed, not stored": no table gains a column, and check 150
>   asserts that.
> - **No identity yet => the row stays PENDING, never `failed`.** It is a perfectly good row
>   whose author simply has not logged in since Auth landed. Marking it failed would bury it.
>   The batch uploader excludes such rows and marks synced only what it actually sent — a
>   batch is all-or-nothing, so one unauthorised row must not take the commit down, and
>   deleting a skipped row would lose it unsent.
> - **A removed ancestor ends the chain.** A soft-deleted owner stops appearing in
>   `visibleTo`, so they stop reading their old team's books.
> - Consequence worth knowing: a user who never logs in again never gets an identity, so
>   their queue never drains and grows unbounded. That is the deferred "confirm your
>   password to turn on backup" nudge in the backlog, now with teeth.
>
> **TESTING TRAP.** The regression harness loads modules in their own realm, so an array
> built inside one has a different `Array.prototype`, and `node:assert/strict` rejects it on
> prototype alone even when the contents match. Wrap such values in the suite's `plain()`
> helper before `deepEqual`. This cost real time on check 150; `sorted()` hides it because
> spreading rebuilds the array in the test's realm.
>
> **AND A SECOND ONE, FOUND 2026-10-12: A GUARD THAT COULD NEVER FIRE.** Check 158's sweep
> for "a status logged without its code" held two literal BACKSPACE bytes (0x08) where `\b`
> was meant — a regex written through a shell that interpreted the escape — so it matched
> nothing and asserted nothing for its whole life. Repaired, and made STATEMENT-based rather
> than line-based, because a wrapped `console.log` keeps its codes on the continuation lines.
> The lesson is not about one regex: a source-text assertion that can only ever pass looks
> exactly like a passing test. When a static guard is added, make it FAIL once on purpose
> before believing it.

## Non-negotiable rules

1. **Every account is its own business ("like Facebook").** Every BOOK query filters on its
   author column (`user_id = ?` / `userId = ?`) — never on the team. The only cross-account
   read is the Staff Book drill-down, through `entryScope.entryOwner(viewerId, createdBy)`
   (downward only, permission-checked). Writes are the AUTHOR's alone, enforced in the data
   layer (parents included). `userScope()` and its remaining inline copies — Staff Book,
   staff reports, per-staff monitoring aggregates — stay byte-identical, and no scoping
   subquery may mention `account_level` or `is_deleted`.

2. **Totals are ALWAYS SQL aggregates** over the whole filtered set. Never summed from loaded
   rows, never paged. Lists page; totals do not. This is the single most common bug class in
   this codebase.

3. **Money is INTEGER PAISA everywhere** (since v29). Never store a float. Input converts via
   `rupeesToPaisa()`; display goes through `formatCurrency()` exactly once. Watch for doubled
   "Rs Rs." and hand-division reintroducing a 100× error.

   More precisely: every amount is an integer in its currency's MINOR unit, and the whole
   money layer hardcodes **100 minor units per major unit** — `rupeesToPaisa`,
   `paisaToRupees`, `paisaToRupeesString` and `formatCurrency`. All four supported
   currencies (PKR, AED, USD, CNY) honour that, which is the only reason one divisor serves
   them all. `src/utils/currency.ts` states `minorUnits: 100` per currency and a test
   asserts it.

   **KWD was considered for the currency list and deliberately EXCLUDED (2026-09-28).** The
   Kuwaiti dinar has **1000** minor units, not 100, so adding it to `CURRENCIES` would make
   every stored and displayed Kuwaiti amount wrong by 10× at once — storage, input, totals,
   PDFs. The same bars BHD, OMR, JOD and TND. A Kuwaiti phone number therefore falls back to
   PKR with the picker available (see the currency plan below). Supporting a 1000-minor-unit
   currency means changing the converters and migrating stored rows: it is a real piece of
   work, not another line in a list. Do not add one casually.

   **`+1` is treated as the United States, and that is an accepted limitation
   (2026-09-28).** `+1` is the whole North American Numbering Plan — Canada and ~20
   Caribbean territories share it — so a Toronto number suggests USD. Because the currency
   is only ever a SUGGESTION the admin can change before saving and afterwards, this is a
   one-time correction, not a trap. Do not "fix" it with an area-code table.

4. **Nothing is ever hard-deleted.** Entries and users soft-delete (`is_deleted`/`isDeleted`
   + `deleted_at`). A removed user's row stays so their past entries remain visible to the
   owner and their parent staff.

5. **Schema changes are versioned migrations** keyed on `PRAGMA user_version`, inside
   `db.withTransactionAsync()`, idempotent, preserving every row.

6. **Dates are YYYY-MM-DD, derived in LOCAL time** via `src/utils/dates.ts`. Never
   `toISOString()` — the app serves PKT (UTC+5), where UTC derivation rolled the day over at
   5 AM instead of midnight.

7. **No package installs.** Write the import, list the package in your summary, the user
   installs it. **No git operations.**

8. **No new `console.log`**; gate debug behind `__DEV__`. Never log CNIC or phone numbers.

9. **Keep all three suites green:** `tests/regression.test.cjs` (163 checks, all passing),
   `tests/entryAudit.test.cjs` (18), the i18n suite (8). Run them after every change.
   These counts were stale for a long time (123 / 17); they are the TOTAL lines each suite
   prints, so correct them rather than trusting a number in this file.

   **ONE CHECK WHILE WRITING ONE:** `ONLY=162 node tests/regression.test.cjs` (or
   `ONLY=159,160`) runs just those, in seconds rather than the five minutes a full suite
   costs — every check boots its own database and runs every migration, which is what made
   mutation-testing a single guard a twenty-minute job. It prints a banner, prints NO `TOTAL`
   line, and exits **2** even when everything selected passes, so a filtered run cannot be
   read as a green suite. Rule 9 still means all three suites in full, before any report.
   Requires Node 22 (`nvm use 22`) — `node:sqlite` throws on 18/20. Expo builds still use
   Node 18 via `.nvmrc`.
   **Run all three, not just the big one.** `entryAudit` builds its OWN minimal fixture
   schema, so a migration that assumes a table exists stalls there while the regression
   harness stays green — that is how the v41 `sqlite_master` guard came to be needed.

## How to work

- **Investigate-first for anything non-trivial.** STEP 1: investigate and report with
  file:line evidence, then STOP for approval. STEP 2: execute only after approval.
- **One screen/book at a time**, pausing between so each can be tested before the next.
- **Never resolve a merge conflict by choosing a side.** Show both versions and let the user
  decide. Two silent regressions have already come from picking during conflict resolution.
- **If structure must change, STOP and say so.** A previous visual-only step silently deleted
  the entire staff list from AdminDashboard because the new layout had no room for it. Flag
  the conflict; don't work around it.
- **Tests for logic, not for style.** Assert the property, not a magic number — "these totals
  are equal at 1 page and 20 pages" beats "this function returns 47".
- **Push back if an instruction is wrong.** Several times the correction has been right and
  the instruction was based on a stale audit.
- **Be honest about what's unverified.** Passing tests are not a working app. Most of this
  codebase is test-verified but device-unverified — treat rendering, navigation and layout
  as unproven.

## Design system

`src/theme/tokens.ts` is the single source of truth. **Zero hardcoded hex in any file you
touch** — that's the completion bar for any visual step.

- Light theme. Depth from tone difference and hairline borders — no shadows, no glows.
  Gradient exists ONLY on the home hero card; don't repeat it elsewhere.
- **Two font weights only** — regular and medium. Never 700/800.
- **Sentence case** everywhere. No ALL CAPS, no Title Case.
- **Colour carries meaning only:** green = money in/received, red = money out/owed, amber =
  needs attention, one accent for interactive. Nothing coloured decoratively. A *balance* is
  neutral ink, not green.
- **No emoji anywhere.** Feather icons, consistent weight.
- 4px spacing base. 44px minimum touch targets — used one-handed on cheap Android phones.
- Reuse the primitives (Screen, Card, Row, SectionHeader, Button, AmountText). Don't
  hand-roll a styled View where a primitive exists.

### Urdu constraints

- **DOWNLOADS STAY ENGLISH — the owner decided this (2026-09-26).** Every PDF and CSV
  (the bill invoice, every book export, every report) prints English labels AND English
  names, whatever the UI language is. They are handed to suppliers, accountants and
  banks. Do not translate an export, and do not "fix" the mismatch between an Urdu
  screen and its English PDF — it is deliberate.
- Money and dates are English in BOTH languages: "Rs. 1,25,400", "22-Sep-2026".

- Layout stays **LEFT-TO-RIGHT**. Never call `I18nManager.forceRTL` — hundreds of hardcoded
  left/right/marginLeft values would break at once.
- Urdu strings run ~40% longer. No fixed-width text containers; every label must survive
  growth without truncating.
- Money and dates are pinned to `'en-PK'` and must NEVER be string-concatenated into an Urdu
  sentence — bidi reorders them. A parity test rejects any `ur` value containing "Rs." or a
  digit run.
- **SMS is the one place that rule cannot hold.** An Urdu SMS body has no markup to isolate
  a figure, so `formatCurrency` output is concatenated straight into the Urdu sentence and the
  amount MAY render in an unexpected position on some handsets. This is accepted, not an
  oversight: the alternative is sending English only. Do not "fix" it by splitting the
  message or by dropping the amount — and do not relax the parity rule for `ur.ts` values,
  which still forbids this everywhere a layout exists.
- The parity test rejects **Arabic-Indic digits** (۱۲۳) and "Rs." in an `ur` value. Plain ASCII
  digits inside an example ("e.g. 0300 1234567") are allowed — figures the app renders still
  come from `formatCurrency` and the date helpers, in English.
- **Stored values are never translated, only their labels.** A category ("Sales"), a unit
  ("kg") and a party name ("Walk-in Customer") stay English in SQLite so reports, exports and
  old rows keep matching. `src/i18n/categoryLabel.ts` maps a stored category or unit to its
  display key; an unknown value shows exactly as stored. `src/i18n/messageLabel.ts` does the
  same for messages the data layer throws (it cannot know the UI language).
- A `React.memo` row component defined ABOVE a screen needs its OWN `const { t } = useLanguageStore()`.
  Do not name anything else `t` in a translated file — the day-total `t` shadowed the translate
  function in Bill Book and Expense Book.
- `src/screens/staff/CashBookScreen.tsx` and `src/screens/staff/ExpensesScreen.tsx` are DEAD
  (the navigator uses `CashBook/` and `ExpenseBook/`). Do not translate them; delete them.
- **The Urdu pass is COMPLETE (2026-09-28), with one correction (2026-10-06).** 905 keys in
  each dictionary, 79 screens and components wired. The rule for new code is that a
  user-visible string goes in `en.ts`/`ur.ts` before it goes in a screen.
  - "Complete" was not quite true, and the reason matters: the i18n suite only scans the
    files listed in its `CONVERTED` array, and the three BOOK screens were not in it. They
    shipped hardcoded English heroes ("Total expense — ", "Total sale … bills", "Today
    balance", "Pick a day") behind a green suite. They are in `CONVERTED` now. **Adding a
    screen to that list is part of converting it** — a conversion nothing scans is a claim,
    not a guarantee.
  - The scanner also had a hole: a conditional in a user-facing ATTRIBUTE
    (`label={cond ? 'A' : 'B'}`) was skipped, which is exactly how the Cash Book's two
    strings survived. Closed, and the suite's own fixture self-test now covers the pattern.
  - **The key-existence check had the SAME hole (closed 2026-10-06).** It only validated
    `t('literal')`; `t(cond ? 'a' : 'b')` was skipped entirely. That matters more than a
    missed label: `translate()` calls `.replace()` on the looked-up value, so a missing key
    is a **TypeError the moment the screen renders**, not a blank. Both branches are checked
    now. Nothing was actually dangling when it was closed — it is a trap removed, not a bug
    found. Note that `t()` reached through a local const (`placeholder={dayNavLabel}`) is
    still invisible to both scanners.
  - Still unguarded and worth a pass: `ReadOnlyBanner`'s `book` prop is given hardcoded
    English ("Cash", "Bill", "Expense") by every book screen, and `book` is not in the
    scanner's `USER_FACING_PROPS`, so no list catches it.
- Statuses translate through `statusLabel` in `src/i18n/categoryLabel.ts`, the same
  stored-value-stays-English pattern as categories and units.
- Amounts group Western-style: `formatCurrency(12540000)` renders **"Rs. 1,254,000"**, not
  "Rs. 1,25,400". This file claimed lakh/crore grouping for a long time; it was never true.
  `'en-PK'` groups in thousands — only `'en-IN'` produces "12,54,000" — and the locale is
  pinned per currency in `src/utils/currency.ts`. Changing it would move every figure in the
  app and in every PDF, so it is an owner decision, not a cleanup. Labels get `flex: 1`,
  figures get `flexShrink: 0`. A fixed-width 60px amount column previously clipped anything
  over Rs 1,000.

## Recurring traps

- **Totals computed from loaded rows.** Check every time paging, filtering or exporting is
  involved.
- **Unit drift.** Any new code path can silently reintroduce a 100× paisa error.
- **The amount ceiling is one number for every currency.** `rupeesToPaisa` refuses anything
  above 99,999,999 major units (`src/utils/calculations.ts`), and it is not parameterised by
  currency. Today that only ever means rupees: the currency columns exist (v41) but no screen
  writes anything but PKR until the pickers land in steps 2 and 3 of the currency plan. Once
  they do, the same 99,999,999 will cap an entry in any currency — ~Rs 10 crore, but only
  ~$100M. Fine at this scale. Noted so it is not rediscovered as a bug, and so this entry is
  not read as a claim that multi-currency entries already exist.
- **Fixes that look right and are wrong.** E.g. making a TypeScript error disappear by
  deleting a field the UI collects. Ask what the user-visible consequence is.
- **Silent data loss.** Deletes that make records unreachable, migrations that rewrite stored
  values, "fresh start" features that remove rather than filter.
- **The same bug in a second place.** When you fix a pattern, check whether it exists
  elsewhere. It usually does.
- **Reports that disagree with screens.** An exported PDF must show the same numbers as the
  screen it came from, for the same filters — reconcile by calling the same query.
- **Changes that only break in release builds.** Hermes disables `eval()` in release; the
  expense calculator was bitten by this.
- **CRLF.** `core.autocrlf=true` with no `.gitattributes` means checkouts write CRLF, and
  test regexes spanning lines with `\n` can't consume the `\r`. Fix with `.gitattributes`,
  never by patching the assertion.

## Current state

**OWN-ONLY BOOKS — DONE for every book (2026-09-22).** The owner's model: every login is a
completely separate account — same app, own data, no interference ("like Facebook"). The
owner REJECTED shared stock: inventory and customers are per-account too.
- **Own-only:** Cash, Khata (+ per-customer ledger), Bill, Expense, Stock (items, value,
  movements), Purchase, Customer, and every report, export, search and reminder built on them.
  Cash also treats a row as deleted if EITHER `isDeleted` or `is_deleted` is set.
- **Drill-down (monitoring):** Staff Book → staff → Entries opens every book READ-ONLY
  (`route.params.viewAs = { userId, name }`): a `ReadOnlyBanner` replaces the book switcher,
  and every create / edit / delete / download control is hidden. Data calls pass
  `createdBy`/`viewingId`, resolved by `entryOwner` (downward only: admin → staff and their
  sub-staff; staff → own sub-staff; sideways/upward rejected). Khata's screens are
  registered a second time in each main stack (`StaffKhata`, and CustomerDetail for the
  admin) so they open from Staff Book. `CustomerLedgerScreen` was DELETED on 2026-10-05 —
  the Khata screen now shows the customer list itself (`components/khata/CustomerBalanceList.tsx`),
  so the old screen had no route in and no caller.
- **Shared stores carry the drill-down separately** (`viewingId`), never in `filter`, so the
  viewer's own book — which refetches on focus without it — can't show someone else's rows.
- **Author-only writes:** Khata edits/deletes (entryAuditDb `ownedRecord(..., write)`; parents
  keep read-only history), bills, expenses, customers, stock items AND stock movements.
- **Still team-wide on purpose (monitoring, not books):** Staff Book, staff reports
  (`reports/staffReportDb.getStaffPerformance`), `transactionDb.getAllStaffMetricsAggregate`,
  and the Activity Log (per-entry `visible_to` list). `reportDb.ts` held a THIRD copy of
  staff sales that nothing imported; it was deleted on 2026-10-06 and check 136 asserts it
  stays gone, because a parallel copy of a figure is free to drift from the one on screen.
- **ONE rule links a typed name to a customer:** `customerDb.matchCustomerByName`. Khata
  entries, bills and the Customer Detail screen's own lookup all resolve through it, and it
  links ONLY on exactly one live customer — a new or ambiguous name stays unlinked rather
  than guessing money onto the wrong ledger. Do not add a second name lookup: a typed name
  filed as a walk-in while that customer sat in the Khata is what this fixed (2026-10-06).
  Bills carry `WALK_IN_CUSTOMER_ID` (billDb) when unlinked, because `bills.customer_id` is
  NOT NULL; `transactions.customer_id` is nullable and simply goes null.
  - **On CREATE and on EDIT.** Renaming re-links, and renaming away un-links. The khata's
    half does NOT live in `updateTransaction`: khata is an audited book and `customer_id` is
    derived, not something a caller may set, so the audit engine recomputes it through
    `entryAuditDb`'s `derive` hook — written with the edit, never audited, so it stays out of
    the entry's visible history and out of the editable-field whitelist. Add a derived column
    there, never to `fields`.
  - **An AMBIGUOUS name is deliberately left alone.** Two customers sharing a name saves
    unlinked and silently. Resolving it properly is a "which Bilal?" picker on the bill and
    khata forms — a real feature with its own design (it must also handle the case where
    neither is right), not part of this fix. Do not paper over it by guessing.
  - Checks 132 (khata linking) and 137 (both books, create and edit, the derive hook's
    non-auditing guarantee, and the bill form's confirm step on a brand-new name).
- Tests: `OWN_ONLY` covers every book; check 115 pins the drill-down and author-only writes.

**Theme rollout DONE for every reachable screen and component.** Zero hardcoded hex, rgba,
`className=`, emoji or 600+/bold weights outside `src/theme/`. Modal backdrops use
`color.scrim`; the full-screen photo viewer uses `color.scrimPhoto`. PDFs and the bill invoice
share one print design (`components/Download/printStyle.ts`: `PRINT_STYLE`, `esc`). Checks 110–114
pin the swept files. The ONLY files still on the old style are dead (nothing imports or
navigates to them): components SuccessModal, SummaryCard, ui/Button, ui/Card, StatCard,
QuickActionButton, ui/Input; screens staff/CashBookScreen, staff/ExpensesScreen. Also
old-style and registered but UNREACHABLE (no navigate call): admin/StaffDetailScreen (the
admin `StaffDetail` route — see the routing bug) and StaffBooksView. Delete or rebuild only
with the owner's approval. `react-native-gifted-charts` is no longer imported anywhere.

**Every `console.*` call is behind `__DEV__`** (check 114 walks all of `src/`).

**Supplier payments work (they never did):** the payment screen called a store action that
did not exist. `supplierDb.addSupplierPayment` is now validated (whole paisa above zero, not
more than the invoice balance) and writes the payment and the invoice's paid/balance/status
in ONE transaction. `createPurchaseInvoice` is still NOT atomic — next candidate.

**TypeScript: 7 errors remain, all deliberate leftovers** (this said 9 for a while; it was
already 7 before the currency work, which adds none): navigator typing for `CashEntryDetail`
(route registration — not touched, 1) and the broken sync services (`firebase/syncService.ts`
5, `pullSyncService.ts` 1 — part of the sync rework below). Verify with
`npx tsc --noEmit` rather than trusting this number.

**Home carries NO staff list — the owner's decision (2026-09-23).** A visual step once deleted
the staff list, staff metrics and global search from AdminDashboard; a rebuilt "Your team"
section and a "Whole business" overview screen were both offered and REJECTED ("i dont need
unessary codes in the app"). Staff visibility lives in the Staff Book: the list, each person's
profile, and their books read-only through Entries. `userDb.getUsersInScope` is still the
scoping query and is still tested (check 36) — do not add a team list to home again unasked.

**9 screens hardcode `85 + insets.bottom`**, tuned to the old floating pill bottom bar. Any
change to bar geometry silently misplaces buttons on all nine.

**ONE PORTAL for every account (2026-09-24).** Admin, staff and sub-staff see the SAME app:
same tabs, same home (`AdminDashboard`), same seven reports, same books. `AppNavigator`
renders `AdminNavigator` for everyone — `StaffNavigator.tsx` is DELETED, and so are the old
staff-only screens (`staff/HomeScreen`, `ReportsMenuScreen`, `FinancialReportsScreen`,
`InventoryReportsScreen`, `PeopleReportsScreen`). What differs between accounts is only the
DATA each one owns (every book is own-only) and what the data layer lets them do. Global
search and Sync Center moved to the shared dashboard header (they lived only on the old staff
home); the seven reports each already export PDF and CSV via `handleReportExport`. Do not
re-introduce a role-specific navigator or home screen.

**The Staff Book is own-only and NESTED.** `staffDb.getStaffRecords(viewerId, createdBy?)`
lists the people THAT account added (`user_id = ?`), so an admin sees their staff, and a
staff member's own sub-staff appear inside that person's profile (`StaffDetail` → "Sub-staff"
→ their profile → their Entries). Admin → staff → sub-staff, never a flat list of peers. The
staff PDF/CSV roster matches the screen (own rows only).

**Staff accounts and staff records ARE LINKED (done).** `staff_records.linked_user_id` (v36)
points at the login the profile belongs to. Staff Book's **Add Staff is the ONLY creation
path**: `managedAccountDb.createStaffMember` writes the `users` row and the `staff_records`
row in ONE `withWriteTransaction`, so there is never a login without a profile or the
reverse. The admin types the password; the phone is both contact number and login username.
An admin adds staff, a staff member adds their own sub-staff, sub-staff add nobody — same
depth/strength/branch rules as before, unchanged code. Settings → Manage Sub-Staff and
`SubStaffScreen` are DELETED, and `staffDb.addStaffRecord` (the profile-without-login path)
is gone. Removing someone is `removeStaffAccess` from the staff profile: it soft-deletes the
login and marks the profile inactive, deleting nothing.

Two helpers exist because of this: `syncHelpers.writeRowWithSyncIn` / `afterSyncedWrite` let
several rows share one transaction — **calling `writeWithSync` inside `withWriteTransaction`
deadlocks**, since that helper serialises every write on one queue.

**Attachments are durable (v39).** Every picked file — cash, bill and expense attachments,
item and profile photos, customer and staff photos, staff documents — goes through ONE helper,
`src/utils/durableFile.ts` (`persistAttachment` / `persistInto`), which copies it out of the
picker CACHE (Android may clear it) into documentDirectory before it is saved. Never save a
raw picker URI again.

The v39 REPAIR sweep is narrower than that list, and deliberately so. `ATTACHMENT_TARGETS`
(`attachmentRepair.ts`) covers only the five columns that existed BEFORE `durableFile` and so
could still hold a cache path: `cashbook.attachment_url`, `bills.attachment_urls`,
`expenses.receipt_url`, `stock_items.picture_url`, `users.pictureUrl`. Survivors were copied
and repointed; vanished files kept their original path and were recorded in `lost_attachments`.
Customer photos (v34), staff photos (v35) and staff documents were durable from the day their
columns were added, so they have no un-repaired era and are correctly absent — do not "fix"
that by adding them. If a NEW column ever stores a picked file, it needs no repair entry
either, as long as it goes through `persistAttachment` / `persistInto` from the start.

documentDirectory belongs to the APP, not to an account: every login on the device resolves
every durable path. A photo that one account can see and another cannot is never a file-path
problem — it is the two rows failing to join (see `accountPhotoUri`).

**Dev-only wipe:** `devWipe.wipeNonAdminStaffForTesting()`, triggered from Settings behind
`__DEV__` for admins only. It hard-deletes non-admin logins and all staff profiles for clean
testing; every `role = 'admin'` row survives and the seeds re-create a missing admin at boot.
Entries recorded by wiped users are deliberately left in their tables (unreachable, since
visibility follows the users tree).

**TWO PHONE HELPERS, DIFFERENT JOBS. Do not merge them.**

`src/utils/phone.ts` — `internationalPhone()` turns a stored number into the E.164 digits
WhatsApp and SMS need. It is **country-agnostic** and is the only thing that may be used for
dialling or messaging. It replaced per-screen code that prepended `92` unconditionally, so a
`+971`/`+966`/`+1` number dialled a real Pakistani stranger. The rule is a LENGTH rule, not
a country list: `+cc`/`00cc` are trusted as-is, `0` + up to 10 digits is a national number of
`DEFAULT_COUNTRY_CODE`, and `0` + more than 10 is a foreign number flattened into the local
shape, so the `0` is dropped. Nothing in it is country-specific except its two constants.

`userDb.normalisePhone` — the LOGIN IDENTITY key, still Pakistan-shaped: it strips
`+92`/`0092` and forces a leading `0`, so `+971 50 123 4567` is stored `0971501234567`.
That is ugly but **consistent**, and it is exactly the "local shape" `internationalPhone`
decodes, so the two agree today. Logins work because create and login run the same function.
Leave it alone unless you also migrate every stored row.

**Known gap, accepted (2026-10-02): a foreign number whose country code plus national number
is exactly 10 digits.** Length cannot tell `04721234567` (Norway) from a Pakistani national
number, so it becomes `92…`. Only the flattened-local shape is affected — `+47`, `0047` and
`4721234567` are all correct — and the only failure mode is landing on the PKR default, never
a wrong non-default currency. It bites Norway, Denmark and Iceland among others; this business
has no Nordic contacts. The real fix is a country-code picker on the contact phone fields (or
`libphonenumber-js`, ~145KB), not a longer list of prefixes. The `>= 10` floor also rejects
genuinely short international numbers (`+683`, `+500`).

**Planned next:** staff detail drill-down (tap a staff member → same book layout,
scoped to their entries, attachments included, READ-ONLY at every level; admin drills into
any staff's sub-staff too), then the salary section (admin read+write, staff read-only on
their own, enforced in the data layer not by hiding buttons).

## Bigger remaining work

> **SYNC HAS NO INITIAL-UPLOAD PATH — HARD PREREQUISITE FOR THE PULL STEP (noted 2026-10-07).**
> `sync_queue` only ever gains a row when something is WRITTEN (`syncHelpers.writeRowWithSyncIn`
> step 3), and migration v44 emptied it. So every row already in SQLite — every customer,
> bill and khata entry that exists today — will NEVER upload: nothing will touch it again.
> A second device would sign in and see an empty book, and it would look like pull was
> broken when the cause is that nothing was ever pushed.
>
> A BACKFILL that enqueues existing rows must be built BEFORE the pull step, or that step
> cannot be judged to work. It has to compute `ownerId` / `visibleTo` per row exactly as a
> live write does, which is why it comes after Auth rather than before. Do not treat pull as
> finished without it.
>
> **Sync identity, decided 2026-10-06/07:** the document path stays the LOCAL id
> (`users/{localId}/…`); authorisation rides on `ownerId` + `visibleTo` denormalised onto
> each document, both holding FIREBASE uids, mapped through `users.firebase_uid` (v46).
> Per-uid paths were rejected because an owner must read staff books, which live under the
> staff member's own identity. `visibleTo` is computed at PAYLOAD time, not stored as
> columns. Order is Auth → ownerId → rules: `ownerId` cannot exist before the uid does.
> Rules must also be matched by every pull query (`array-contains`), because Firestore
> rules reject a query they cannot prove — they do not filter it.
>
> **AUDIENCE INJECTION — BLOCKING PREREQUISITE FOR THE PULL STEP (accepted 2026-10-11).**
> Pull MUST DISCARD any document whose `ownerId` is not a known team member's
> `users.firebase_uid`. This is a requirement, not a hardening idea: the read rule admits a
> document because the caller is in its `visibleTo`, and `visibleTo` is written by whoever
> AUTHORED that document. Account creation is open to anyone holding the API key shipped in
> the APK, so a stranger can create a document, stamp `ownerId` with their OWN uid — which
> is all the create rule asks — and put a victim's uid in `visibleTo`. The victim's own
> `array-contains` pull query then returns it, and a forged bill lands in their book.
> The rules cannot close this: `ownerId` immutability stops a document being MOVED into
> another business, not one being BORN pointing at it. Nor can the path, which is the local
> id and unconstrained by design.
> The filter therefore belongs to the READER, checked against the local tree
> (the puller's own `firebase_uid` plus their descendants'), and an
> unknown `ownerId` is dropped silently — no row written, no error on screen.
> PULL IS NOT DONE UNTIL THAT FILTER EXISTS AND IS TESTED.
> **BUILT 2026-10-12** as `services/database/pullAudience.ts`; check 159, mutation-tested.
>
> **REMOVED DESCENDANTS ARE IN THE KNOWN SET, DELIBERATELY (2026-10-12).** `knownAudience`
> filters on `firebase_uid IS NOT NULL` and `userScope('id')` and nothing else — it does NOT
> exclude `is_deleted = 1`, and that is the decision, not an oversight. A dismissed staff
> member's entries must stay visible (non-negotiable rule 4); their documents were stamped
> `visibleTo = [them, the admin]` while they were still live, so the rules admit them; and on
> a device that has never pulled them, THIS FILTER IS THE ONLY THING standing between the
> owner and losing that history. Excluding them would break rule 4 in a place nobody would
> think to look, because it reads like ordinary hygiene. The audience set is "whose documents
> may enter", never "who may log in" — `verifyUserLogin` is where removal is enforced.
>
> `userScope` gained `'id'` for this: the same SQL with a different column, so the `users`
> table can be scoped against itself. It is an EXCEPTION TO RULE 1 made visibly — the reason
> is in the helper's own doc comment, and check 159 asserts `pullAudience` calls the shared
> helper rather than hand-rolling the predicate, and mentions neither `account_level` nor
> `is_deleted`.
>
> **AND A CURSOR MUST NEVER ADVANCE PAST A DOCUMENT IT DROPPED (2026-10-12).** The obvious
> way to bootstrap a fresh device is two passes: pull with the known set as just the viewer,
> derive the team from what arrives, then pull again with the team included. IT LOSES DATA
> SILENTLY. Pass one advances the `bills` cursor past a staff member's bills it had just
> dropped, and pass two never refetches them — a gap nobody would find, because every later
> pull starts after it.
>
> Advancing only over ACCEPTED documents is not the fix either: one document with a
> permanently unknown owner would then block that collection's cursor for ever.
>
> So anything the filter depends on must be in place BEFORE pull runs at all and before any
> cursor moves. The team bootstrap is therefore a single cursor-free query of the admin's own
> `staff_records` — not a pull pass — and the order is: identity bootstrap, audience filter,
> team bootstrap, pull.
>
> **THE TEAM BOOTSTRAP — BUILT 2026-10-12.** `services/firebase/firebaseTeam.ts`
> (`bootstrapTeamFromCloud`) with its local half in `services/database/teamBootstrap.ts`,
> split for the same reason adoption is: the harness cannot load the Firebase packages, so
> anything beside them is assertable only as source text. Check 160. It runs in the login
> side-effect right after the profile publish, and **the pull step must AWAIT it and gate on
> `complete` rather than assume a login ran it.**
>
> - **IT IS NOT A SECOND-DEVICE-ONLY STEP.** `users` is in `LOCAL_ONLY_TABLES` and
>   `firebase_uid` is written only for the account that signs in ON THIS DEVICE — so the
>   ORIGINAL device, which has every staff row, holds NULL for all of them. Its known set is
>   just as short and its pull would drop just as much.
> - **MEMBERSHIP COMES FROM A DOCUMENT THE VIEWER WROTE:** one `getDocs` of
>   `users/{myLocalId}/staff_records`, keeping only documents whose `ownerId` is the viewer's
>   own uid, then `linked_user_id` off each. The collection-group query over `profile` that
>   `findAccountProfile` uses would be one call instead of several and MUST NOT be used here:
>   it returns every profile naming the viewer in `visibleTo`, so a stranger could add
>   THEMSELVES to the team — the exact thing the audience filter exists to stop.
> - **THE UID COMES FROM THE MEMBER'S OWN `profile/self`**, read by direct path. Nothing else
>   could carry it, and only that account can have stamped its `ownerId`.
> - **STRUCTURE IS LOCAL, IDENTITY IS REMOTE.** `parentId` is forced to the viewer, role and
>   level to staff, the business name taken off the viewer's own row; only name, phone, photo,
>   area and currency come from the document. A profile claiming `parentId: <someone else>` or
>   `role: 'admin'` is filed as the viewer's own staff member anyway, because the claim is
>   never read. The tree rule is `assertConsistentLevel`, shared with account creation, which
>   is also what refuses a bootstrap under a viewer who is not an admin.
> - **IT NEVER REWRITES AN IDENTITY.** It creates a row for a local id it has none for, or
>   fills in a MISSING `firebase_uid` and nothing else. A row already carrying a different uid
>   (`uid-mismatch`), a uid another row holds (`uid-claimed`), a phone another row holds
>   (`phone-claimed`) and the viewer's own row (`self`) are all refused with a reason, with
>   nothing written. A created row gets `NO_LOGIN_HASH` — the empty string, which
>   `verifyStoredHash` can never produce a match for — because this device holds no password
>   for that person and inventing a hash would be inventing a login.
> - **A DISMISSED MEMBER IS STILL BOOTSTRAPPED**, mirrored as soft-deleted from the viewer's
>   own record, for the rule-4 reason above.
> - **KNOWN LIMIT, and it is the next step's gate.** A member who never published a profile
>   has no uid — and no uid means `authorisationFor` returns null, so they have never uploaded
>   anything and pull has nothing of theirs to drop. The case that is NOT safe is a profile
>   that EXISTS and cannot be read: a uid exists that this device cannot learn. Both are
>   reported in `unresolved`, and `complete` is false for either, which is why pull must gate
>   on it rather than run and advance cursors.
> - **Accepted divergence:** the bootstrap never changes `is_deleted` on a row that already
>   exists, so if a member is dismissed AFTER a second device created their row, that device
>   keeps them live until it is wiped. Mirroring removal onto an existing account would mean a
>   cloud document could soft-delete a login — and nothing about pull depends on it, since the
>   audience set includes removed descendants either way.
>
> **PULL, P1 — THE PREREQUISITES. BUILT 2026-10-12, DEPLOY REQUIRED.** Pull itself (P2) is
> not built. P1 is everything that has to be LIVE before pull can be judged at all, and all
> of it was approved by the owner on 2026-10-12.
>
> - **THE CURSOR IS A SERVER TIMESTAMP** — `SYNCED_AT_FIELD` (`syncedAt`) in
>   `syncAuthorisation.ts`, stamped by `authorisedPayload`. Never a client clock: two phones
>   disagree about "later" by however much their clocks do, and a cursor that moves on a
>   wrong clock skips documents permanently. The sentinel is PASSED IN
>   (`serverTimestamp()`), never imported there — that module is loaded and RUN by the
>   harness, which cannot load the Firebase packages.
> - **TWO CONSEQUENCES, and both have bitten projects before they were written down.**
>   (1) A query ordering on a field returns ONLY documents that have it — Firestore excludes
>   the rest rather than treating them as oldest. So every document uploaded before this
>   existed was invisible to pull, which is why the initial upload was re-run from scratch
>   (`resetBackfill`, and the second `__DEV__` button in Settings). (2) **A DELETION MUST
>   CARRY THE STAMP TOO.** The delete path writes its own small payload and used to bypass
>   `authorisedPayload` entirely — an unstamped delete never travels, so the other phone
>   keeps showing a row its owner deleted. `deletionPayload` now exists so neither uploader
>   can build that write by hand, and check 161 fails if either one does.
> - **Migration v52: `sync_pull`**, per account and per table like `sync_backfill`, holding
>   seconds + nanos + **document id**. The id half is load-bearing: the batch uploader
>   commits up to 500 documents at once and a batch gives them all the SAME write time, so
>   `startAfter(timestamp)` alone would skip the rest of that batch at a page boundary.
>   Order on `(syncedAt, __name__)` and resume after that pair.
> - **23 COLLECTION-GROUP READ BLOCKS AND 23 COMPOSITE INDEXES**, generated from
>   `SYNC_PATHS` — 17 flat leaves plus 6 nested, `day_closings` excluded as `pending`. A
>   flat collection lives under the AUTHOR's local id, so reading a whole team in one query
>   means a collection-group query, and **a collection-group query supplies no ancestry, so
>   the `/users/{pathId}/{document=**}` block cannot match it** — the `profile` lesson, now
>   the rule rather than the exception. The collection name must be a literal (there is no
>   variable-collection form), which is why it is 23 blocks; the CONDITION is one shared
>   `pulled()`, because 23 copies of a security test is 23 chances for one to differ. They
>   grant no write, and nothing outside `/users` grants one either, which is what bounds the
>   widening. Check 161 asserts a block AND an index per live table, and none for a pending
>   one, so a table can never be wired on one side only.
> - **NOT DEPLOYED BY BUILDING IT.** From the repo ROOT: `npx firebase-tools deploy --only
>   firestore:rules` then `--only firestore:indexes`. Read the publish timestamp in the
>   version history afterwards — a green Playground proves the EDITOR, never what is live.
>
> **PULL, P2 — BUILT 2026-10-13, AND IT RAN ON TWO DEVICES THE SAME DAY (owner).** The
> first real run was `applied=10, dropped=2`; after the payload fix below, device 2 holds
> everything device 1 wrote. This is the first time a second phone has shown this business's
> books. What is confirmed is the RE-UPLOAD path (the backfill, which never had the payload
> bug) end to end: query, rules, indexes, team bootstrap, audience filter, cursor and apply. `firebase/firebasePull.ts`
> (`pullRemoteChanges`, `planPull`) with its local half in `database/pullApply.ts` and the
> cursor store in `database/pullCursor.ts`. Check 162, mutation-tested. `pullSyncService.ts`
> is DELETED — it imported a non-existent export, queried the wrong paths, and interpolated
> REMOTE KEYS into its SQL.
>
> - **ONE CHOKE POINT.** `pullApply.applyDocument` is the only way a document reaches SQLite,
>   and it refuses in this order: the audience filter (`acceptable`), then
>   `ownerMatchesAuthor`, then the id, then a `sync_queue` row, then the column whitelist
>   from `PRAGMA table_info`. The local half holds every decision that could lose data and
>   imports no Firebase, so the harness RUNS it.
> - **THE GATE, EVERY RUN.** Pull bootstraps the team first and refuses outright unless it
>   came back `complete`. The case it exists for is a member whose uid exists (so they can
>   upload) but whose profile this device cannot read, which can become true between logins.
>   Given the gate, the cursor advances over EVERY document a query returned — dropped ones
>   included — because one permanently unknown owner must not block a collection for ever.
> - **PUSH DRAINS FIRST**, and whatever is still queued afterwards is KEPT OUT and counted.
>   Local unsent work wins whole, never field by field: a half-merged row is a number nobody
>   wrote.
> - **A DELETION APPLIES, AND THAT TOOK TWO FIXES** (owner-found on the device, 2026-10-12):
>   1. **BOTH SPELLINGS TRAVEL AND THEY DISAGREE.** A real document carries
>      `is_deleted: true, deleted_at: "…"` beside `isDeleted: 0, deletedAt: null`, because a
>      soft delete writes only the snake_case pair and the camelCase half is whatever the
>      create left behind. Copying fields onto columns would land `isDeleted = 0` — and the
>      Khata reads `isDeleted` and nothing else, so the entry would arrive LOOKING ALIVE. So
>      the flags are DERIVED (deleted if either spelling says so) and written to every delete
>      column the table has, from `PRAGMA table_info` rather than a table-keyed map that
>      would go stale. Check 162 asserts a pulled deletion is gone from
>      `getCashEntriesByUserId` and `getTransactionsByUserId` — the app's OWN queries.
>   2. **THE AUDIT GUARD REFUSED DELETIONS.** `assertAuditedRemoteUnchanged` compares the
>      delete flags too, so a remote khata deletion read as a conflict and was kept out,
>      leaving a deleted entry alive on the other phone for ever. The flags are now judged
>      apart from the fields: a soft delete applies, a document that moves an audited FIELD is
>      still refused and counted. Safe because no money moves, the deletion's own
>      `entry_audit` rows sync separately, and only the entry's own account can write them.
> - **UPDATE AN EXISTING ROW, INSERT A NEW ONE — NOT `ON CONFLICT DO UPDATE`.** SQLite builds
>   the candidate row before it notices the conflict, so a NOT NULL column a document does
>   not carry fails the whole statement even when the row exists and the update would never
>   have touched it — which is exactly the shape of a soft delete. A document that cannot
>   CREATE a row is refused as `incomplete` rather than filled in with guesses.
> - **`entry_audit` IS INSERT-ONLY** against triggers that `RAISE(ABORT)` on update and on
>   replace — `OR IGNORE` aborts too — so it looks first and then inserts. A rewritten
>   history document changes nothing.
> - **COUNTED, AND SHOWN.** `sync_pull` keeps `applied` / `dropped` / `kept_out` per account
>   and table (v53), and the Sync Centre shows the kept-out number with its reason and says
>   when a download was BLOCKED. A silently refused edit is what gets rediscovered weeks
>   later as "sync is broken" (owner, 2026-10-12).
> - **Still open, by design:** pulled attachment paths point at the OTHER device's
>   documentDirectory, so a pulled photo is a dead path until an attachment-transfer step
>   exists. Across runs a child row can arrive before its parent (separate cursors, foreign
>   keys off) and waits as an orphan.
>
> **THE PAYLOAD WAS NOT THE ROW — FIXED 2026-10-13, FOUND ON THE DEVICE.** The first real
> two-device pull returned `applied=10, dropped=2`, one cashbook and one transactions
> document, failing on `transactions.createdAt`. It was NOT a camelCase/snake_case mismatch,
> which is what it looks like: both tables carry BOTH spellings as real columns
> (`createdAt`/`updatedAt` NOT NULL, `created_at` DEFAULT CURRENT_TIMESTAMP, `updated_at`
> nullable), so pull's column whitelist would have accepted either. **The document carried
> neither.**
>
> `writeRowWithSyncIn` appended the timestamps to the INSERT's own keys/values arrays and
> never to `data` — and the queue payload was built from `data`. So they reached SQLite and
> never reached Firestore. The payload is now built from `written`, the row AS WRITTEN, through
> the shared `outgoingPayload` in `syncHelpers.ts`.
>
> - **IT WAS NEVER ABOUT THOSE TWO TABLES.** `expenses` and `reminders` shipped without their
>   NOT NULL `created_at` for the same reason and would have dropped the moment one was
>   pulled onto a device that did not already hold the row. `customers` was fine only because
>   `addCustomer` happens to put `created_at` into `data` by hand. Fixing the two tables the
>   device named would have left the other two to be rediscovered.
> - **A BACKFILLED DOCUMENT NEVER HAD THE BUG** — it is `SELECT *` of the real row — which is
>   exactly why the first upload looked fine and only entries written AFTERWARDS vanished.
>   That is also why the backfill no longer keeps its own copy of the strip list: a live
>   document and a backfilled one face the same pull, so any difference between them is a bug
>   that only appears after a backfill. One builder, `outgoingPayload`, for both.
> - **A DELETE's stored payload now carries its own `deleted_at`**, so `deletionPayload` reads
>   a real stamp instead of falling back to its own clock. The delete SQL is unchanged.
> - **WHY 162 DID NOT CATCH IT.** Every document check 162 feeds the choke point is written BY
>   THE TEST. It proved pull handles the documents the test believes push sends. Check 163
>   closes that: it writes through the real data layer on one harness, takes the payload out
>   of `sync_queue`, stamps it with the real `authorisedPayload`, and applies it to a SECOND
>   harness that has never seen the row. **Two databases is load-bearing** — in one, the row
>   already exists and `applyDocument` takes the UPDATE path, which never needed the missing
>   columns and so never failed. Its guard is driven by `PRAGMA table_info`, not a column
>   list, and it was made to fail twice on purpose: once with the payload rebuilt from
>   `data` (reproducing `createdAt, updatedAt` exactly), once with pull dropping `createdAt`
>   (proving the device-2 round trip bites on its own).
> - **STILL UNCONFIRMED ON A DEVICE: THE LIVE-WRITE CASE ITSELF.** The owner's successful run
>   was the RE-UPLOAD, and the backfill never had this bug. What proves the fix is an entry
>   created on device 1 AFTER this build and then pulled — check 163 proves it in the harness,
>   the device has not. Do not mark this device-verified until that is watched by hand.
> - **NOT BUILT, AND DELIBERATELY: a cursor reset.** Pull advances over dropped documents by
>   design, so the two stranded documents could not return on their own — but re-uploading
>   from device 1 gives them a fresh `syncedAt`, after the cursor, so they arrive on the next
>   pull with nothing to reset. If a reset is ever wanted as a DEBUGGING tool, it is
>   `resetCursor(db, account, tables?)` NULLing `cursor_seconds`/`cursor_nanos`/`cursor_doc_id`
>   in `sync_pull` — `readCursor` already returns null for that, so the collection restarts
>   from its first document and the counters survive. `clearPullCounters` deliberately does
>   NOT touch the cursor. Do not build it as part of a fix; a re-upload is the fix.
>
> **THE NEXT TWO STEPS AFTER PULL, IN THIS ORDER (owner, 2026-10-12).** Found while building
> the team bootstrap; neither is a hardening idea and neither is optional. **Without (2) the
> two-location requirement — the thing this app is for — does not work: a Dubai staff
> member's books would never reach the Khuzdar owner.** Device 2 is the OWNER'S second phone,
> so (1) does not block the pull step; it blocks every staff member's phone.
>
> 1. **PROVISION THE STAFF MEMBER'S FIREBASE IDENTITY AT ADD STAFF TIME.** Today
>    `ensureFirebaseAccount` runs only at a login of that account, so a staff member created
>    by an admin has NO Firebase identity until they log in somewhere — and on a fresh install
>    they cannot: no local row, so `verifyUserLogin` fails, adoption tries to sign in to
>    Firebase, no account exists, and the login is refused as `invalid`. A staff member can
>    therefore never set up their own phone. `createStaffMember` is the one moment their
>    plaintext password legitimately exists, which is why the identity belongs there (and the
>    profile publish with it). Rollout workaround until then: the staff member logs in once on
>    the admin's phone while online.
> 2. **THE STAFF DEVICE MUST KNOW ITS PARENT'S uid, so its uploads name the admin.**
>    `authorisationFor` walks `parentId` through local `users` rows. On a staff member's own
>    device, adoption creates their row but no row for the admin, so the walk ends at once and
>    `visibleTo` is `[staff]` alone — the admin's `array-contains` pull query would never
>    return their books. **This is the two-location requirement, not a refinement.** The team
>    bootstrap is downward by design and does not fix it, and today nothing the staff device
>    may read carries the admin's uid (the admin's own profile and staff_records are stamped
>    `visibleTo = [admin]`).
>    **CEILING ON THE OBVIOUS FIX, recorded rather than designed around (owner, 2026-10-12):**
>    the admin's profile publish naming its team in `visibleTo` — which it can do once the
>    team bootstrap has run — collides with the rules' `sane()` cap of `size() <= 8`. It
>    holds for an admin with at most 7 staff and silently breaks their own publish beyond
>    that. Do not pick a design for this yet.
>
> **THE OTHER PLACE THE CLIENT HAS TO PROTECT US: the profile lookup's ownerId filter
> (2026-10-12).** `findAccountProfile` runs a collection-group query over `profile` and keeps
> only documents whose `ownerId` equals its own uid. THAT FILTER IS LOAD-BEARING, not a
> convenience for picking one result out of several.
>
> A stranger holding the API key that ships in the APK can create
> `users/<anything>/profile/<anything>`: the create rule asks only that `ownerId` be their own
> uid, and the leading-wildcard read block means such a document turns up in a victim's
> collection-group results. It is harmless ONLY because the lookup drops anything whose
> `ownerId` is not its own, and a document carrying the victim's uid as `ownerId` cannot be
> created by anyone else. Remove or loosen that filter and a planted document can be adopted
> as an identity — which hands over the local id every future document path is built from.
>
> These two filters are the same shape and the same lesson: the rules can prove who WROTE a
> document, never who it is ABOUT. Wherever the client acts on `ownerId`, the client is the
> thing enforcing it. Checked by 158 (`ownerId === uid` in the lookup) and, once pull lands,
> by its own check.

> **THE RULES PLAYGROUND EVALUATES THE EDITOR, NOT WHAT IS LIVE (learned the hard way,
> 2026-10-11).** It simulates against the text in the console's rules editor, including
> UNPUBLISHED changes. Eight green simulations therefore prove the draft and say nothing
> whatever about the published ruleset. This cost a debugging session: the step-8b rules were
> pasted into the editor, simulated green, and reported as published; the live ruleset was
> still the Oct 7 deny-all, so every upload was refused with correct uids and correct
> stamping, which reads exactly like a payload bug and is not one. The version history
> settled it — the real rules were published THIRTEEN MINUTES AFTER the failing run.
> To know what is live, read the PUBLISH TIMESTAMP in the rules version history and compare
> it to when the failure happened. Never the editor contents, and never a green Playground.
> `[Sync]` log ids carry their own epoch-ms, so the moment of a refused write is recoverable
> from the queue id. Deploying from git (`firebase deploy --only firestore:rules`) removes
> the whole ambiguity, which is one more reason to fix the CLI login.

- **DEPLOY RULES AND INDEXES FROM GIT, and the login flag that makes it possible
  (2026-10-11).** From the repo ROOT, never `mobile-app/`:

      npx firebase-tools deploy --only firestore:rules
      npx firebase-tools deploy --only firestore:indexes

  **`npx firebase-tools login --no-localhost` is the flag that works on this machine.** The
  default flow opens a browser and waits on a `localhost:9005` callback that never arrives
  here, ending in `ExitPromptError` — the tail of `firebase-debug.log` is that failure.
  `--no-localhost` prints a code to paste instead and gets past it. Logged in as
  cbaloch54@gmail.com.

  This closes the gap that forced step 8b's rules to be published from the CONSOLE and
  `firestore.rules` to be transcribed BACK by hand — the exact thing putting the file in git
  was meant to prevent (`ROOT_IS_NOT_THE_APP.md`). Deploy git → live from here on, never the
  other way.

  **A DEPLOY DOES NOT DIFF.** It compiles and releases, and reports neither what the live
  ruleset was nor whether it changed. A successful deploy therefore proves that live now
  matches the repo; it proves nothing about what live held a moment earlier. Before deploying
  over a ruleset somebody may have edited in the console, read the publish timestamp in the
  rules version history first — see the Playground note above for why that timestamp, and
  nothing else, tells you what is live.
- **BACKLOG — login takes ~3s offline because of the Firebase attempt (owner-measured,
  2026-10-07).** `ensureFirebaseAccount` is already fire-and-forget (`void`, not awaited)
  in `authStore.login`, so the delay is NOT the await — it is the work happening on the JS
  thread while the UI tries to transition. Options when this is picked up: skip the attempt
  outright when `useSyncStore.isOnline` is false (cheapest, and the offline case is exactly
  the slow one); defer it behind `InteractionManager.runAfterInteractions`; or shorten the
  Firebase timeout. Acceptable today, measured at about 3 seconds, and explicitly deferred
  by the owner. Do not "fix" it by awaiting it or by blocking login on the result.
- **BACKLOG — a "confirm your password to turn on backup" nudge.** An already-logged-in user
  gets no Firebase account until their NEXT local login, because the app holds a hash and
  not a password. Someone who stays logged in for months therefore never starts syncing, and
  nothing tells them. Deferred by the owner on 2026-10-07; no sign-out, no account, writes
  simply queue meanwhile.
- **Sync is no longer push-only (2026-10-13).** Pull runs on two devices and the owner has
  seen device 1's books on device 2. `pullSyncService` — the one that imported a non-existent
  export and queried top-level collections — is DELETED. **It is still a `__DEV__` BUTTON and
  nothing else:** no automatic trigger, no schedule, no pull on login or on focus. The owner
  wants to watch it by hand before it runs on its own, and `useSyncStore.pullRemoteChanges`
  deliberately has no screen caller. The two-location requirement is still NOT met — see the
  staff-device uid step above, which is what makes a Dubai staff member's books reach the
  Khuzdar owner.
- **SECURITY — check before any real client build.** There is NO `firestore.rules` file and
  NO Firebase Auth. Every write is an unauthenticated `setDoc`. The API key ships in the APK.
  If the rules are open, anyone with that key can read/write every business's data.
  **Check the rules first.** Also deferred: homegrown password hashing (10k sequential
  SHA-256, salt only at iteration 0 — replace with real PBKDF2), login rate limiting declared
  but never implemented. (Fixed since: own password change now requires the current password
  and the creation strength rule — `userDb.changeOwnPassword`; login no longer logs the phone;
  the seed creates only the admin.)
- **Audit trail covers Khata only.** `entry_audit`'s books config enrols `transactions` only.
  Cash, Expense and Bill edits don't appear. Extend using the same infrastructure and the same
  downward permission model.
- **Urdu is DONE (2026-09-28).** 905 keys per dictionary, 79 files wired. Only the brand name
  "AL-REEF" on the login screen stays English. See the Urdu constraints section.
- **Expense tagging to a person — NOT built, owner will decide separately (raised 2026-09-28).**
  Needed so a staff member can record a sub-staff's expense on their own account, tagged to that
  person. `expenses` has NO person column today beyond `user_id`, the author. Smallest design:
  one nullable `staff_record_id TEXT` on `expenses`, a picker on the expense form listing the
  author's own `staff_records`, and a filter on the sub-staff's profile. It must point at
  `staff_records`, NEVER at `users` — sub-staff have no user row. Do not build it unasked.
- **Day Close and Attendance: BUILT, TESTED, NO UI — decide whether to wire or remove
  (owner to decide, raised 2026-10-05).** Both have a complete data layer that nothing on
  screen reaches.
  - **Day Close** — `src/services/database/dayClosingDb.ts`: `closeDay()`, `mayCloseDay()`
    (a kept stub, constant-true under the two-level tree — see the sub-staff section) and a
    `canClose` flag. NO screen imports it and no route exists. A day can never be closed.
    It also WRITES a `firestore_path` by raw SQL (`dayClosingDb.ts:109`) while never enqueuing
    anything, so it has a document shape and no push. It sits in `syncPaths.SYNC_PATHS` as
    `pending` for that reason — parked beside Attendance, deliberately not wired (owner,
    2026-10-11) — rather than left out, where it would be rediscovered as a missing step.
  - **Attendance** — `src/services/database/attendanceDb.ts` (`clockIn` / `clockOut` /
    `getTodayAttendanceForUser`) and a screen, `src/screens/StaffBook/StaffAttendanceScreen.tsx`,
    registered as `StaffAttendance` in `src/navigation/AdminNavigator.tsx:120` but with NO
    `navigate('StaffAttendance')` anywhere — unreachable. The Staff REPORT does read
    attendance (`getStaffAttendanceSummary`), so the report has a section that can only ever
    be empty.
  Do NOT seed either and do NOT build UI for them unasked.
- **`customerDb.autoSeedCustomersFromTransactions` has no caller** (`src/services/database/customerDb.ts:232`).
  It back-filled `customers` rows from legacy `transactions.partyName` values for the old
  Customer Ledger screen, which was deleted on 2026-10-05. It is no longer NEEDED — `getPartyBalances`
  keys on `COALESCE(customer_id, 'n:' || TRIM(partyName))`, so an unlinked legacy row still
  appears in the Khata list by name — but it is now dead code. Remove it or call it; do not
  leave it to be rediscovered as a missing step.
- **Activity Log** has a hard `LIMIT 100`, an SQL precedence bug (`A OR B` then ` AND C`
  giving `A OR (B AND C)`), and never filters `is_deleted`.
- **No "overdue" concept exists** anywhere in the codebase — no due dates on bills or khata.
  Don't fabricate it; it needs a schema decision first.
