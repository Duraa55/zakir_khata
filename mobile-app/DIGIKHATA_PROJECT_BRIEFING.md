# DigiKhata — Project Briefing for Claude Code

## What This App Is
DigiKhata is an offline-first business management app for Pakistani shopkeepers — a digital version of the traditional "khata" (credit ledger) notebook. Built with React Native + Expo.

## Critical First Step
**Before touching anything, verify the working directory.** This project has accidentally been worked on from THREE different locations in the past due to backups/copies:
- `E:\Zakir_Digi-Khata_locally\mobile-app` ← **this is the correct, active project**
- `F:\Zakir_Digi-Khata_locally (3)\...` ← stale duplicate, ignore
- `D:\Zakir_Khata\mobile-app` ← stale duplicate, ignore

Always run `pwd` and confirm the path is `E:\Zakir_Digi-Khata_locally\mobile-app` before running any command.

## Tech Stack
- React Native + Expo SDK 51, TypeScript
- NativeWind (Tailwind) for styling, StyleSheet where needed
- Zustand for state management
- expo-sqlite for local offline storage
- Firebase (Firestore + Auth) for cloud sync
- EAS Build for Android APK generation

## Project Identifiers
- EAS account: `@chakar19`, project `digikhata-app`
- EAS projectId: `b817f3e3-dc43-43c4-aef6-d6676ceda7b0`
- Android package: `com.digikhata.app`
- Firebase project: `digikhata-1689b`

## Architecture
Offline-first sync engine: every write goes to SQLite immediately, then `syncProcessor.ts` pushes changes to Firestore in the background when online.

**Modules ("Books"):**
- CashBook — shop's daily cash drawer (Cash In / Cash Out)
- KhataBook — customer credit ledger (Lena/Dena — money owed to/by the shop)
- StockBook — inventory tracking
- BillBook — invoicing/POS
- ExpenseBook — overhead costs
- StaffBook — multi-user staff management (staff linked to admin via `parentId`), with monthly salary tracking being added
- Sync Center — partial, needs a proper UI
- Dashboard — **not yet built**, high priority
- Reports tab — **not yet built**
- Settings, Activity Log — exist

**Auth:** phone number + password, using a fake-email pattern for Firebase Auth (e.g. `923001234567@digikhata.internal`). Roles: `admin` / `staff`.

**Test admin account (seeded for testing):** phone `03001234567`, password `admin123`

## Known Fixed Issues
- `expense_date` column crash (database renamed to `digikhata_v3.db`, migrations restructured — if similar "table X has no column named Y" errors appear, check the migration loop that adds sync columns (`synced`, `is_deleted`, `deleted_at`, `firestore_path`) actually includes ALL tables, including newer ones like `customers`)
- Firebase Firestore security rules published (`allow read, write: if request.auth != null`)
- Various JSX tag mismatches from a previous dark theme rewrite — theme system now exists at `src/theme/` (Colors, Typography) with reusable UI components at `src/components/ui/` (Card, Button, Input, StatCard, ScreenContainer)
- `ScreenContainer` wrapper component was built to fix a recurring bug where content/buttons were hidden behind the bottom tab bar — this fix needs to be verified as applied consistently across ALL screens, not just the ones fixed so far

## Known Open Issues at Handoff
- Registration flow references an "OTPVerification" screen that doesn't exist — OTP was intentionally skipped for now, registration should complete directly to the dashboard
- Firebase cross-device sync/login has not been fully verified working end-to-end
- Dashboard, Reports tab, Global Search, WhatsApp sharing, and PDF export are all designed/planned but not implemented
- iOS build not started — deferred pending Apple Developer account ($99/year) and Mac access
- Staff monthly salary tracking feature was just requested (set fixed monthly salary, auto-calculate remaining due, smart pre-filled "Pay Salary" button) — status not confirmed

## Working Preferences (established the hard way)
- **Small, single-file changes, tested one at a time.** Large multi-file sweeping changes (e.g. a full dark-theme rewrite in one go) previously broke the entire app and required restoring from a zip backup.
- Do NOT change the bottom tab navigation structure — books stay in the bottom nav bar.
- NativeWind/Tailwind preferred; use plain StyleSheet only where Tailwind can't do it.
- Prefer clean, premium, modern dark UI (navy/charcoal backgrounds, green `#00A651` as primary/brand color, subtle glow effects on buttons and key elements) — readability and simplicity take priority over visual flourish.
- Test after every change via Expo Go: `npx expo start --clear`, press `a` to open on connected Android phone (Samsung, USB debugging enabled).
- Verify any claimed fix actually works before moving to the next task — don't assume a change succeeded without testing it.

## Suggested First Message to Claude Code
> "Read through the project at E:\Zakir_Digi-Khata_locally\mobile-app — check package.json, app.json, and index.js — confirm this is the correct project and that it currently builds and runs without errors. Then give me a summary of the current state before we start any new work."
