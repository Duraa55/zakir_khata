# CLAUDE.md

Read this before doing anything. It carries the decisions and traps that aren't visible in the code.

## The project

DigiKhata-style digital ledger (khata/udhaar bookkeeping) for a client in Pakistan whose
business runs in two locations — Khuzdar and Dubai. Owners need visibility into what staff
in the other location are doing.

React Native + Expo 51, TypeScript, expo-sqlite (local-first), Firebase Firestore
(push-only), Zustand, NativeWind + StyleSheet. ~27k LOC, ~170 source files, 35 tables,
schema at **v41**. English + Urdu.

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

9. **Keep all three suites green:** `tests/regression.test.cjs` (123 checks, all passing),
   `tests/entryAudit.test.cjs` (17), the i18n suite (8). Run them after every change.
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

- **Sync is the biggest piece and it's broken.** Push-only. `pullSyncService` imports a
  non-existent export and is never called; other pull functions query top-level collections
  while writes go to `users/{uid}/…`, so they always return `[]`. Two owners in two countries
  would have two isolated ledgers.
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
