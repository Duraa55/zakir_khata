# DigiKhata App Testing Guide

## Prerequisites
- Node.js installed
- Expo CLI installed: `npm install -g expo-cli`
- Android Studio (for Android testing)
- Xcode (for iOS testing, Mac only)
- Physical device or emulator/simulator

## Local Development Testing

### Start Development Server
```bash
npx expo start
```

### Test on Android
1. Enable USB debugging on your Android device
2. Connect device via USB
3. Run: `npx expo start --android`
4. Or scan QR code from Expo Go app

### Test on iOS
1. Connect iPhone via USB
2. Run: `npx expo start --ios`
3. Or scan QR code from Expo Go app

## Test Cases

### Authentication
- [ ] Login as Zakir (03368542509 / Zakir@123) — seed default, change it on first login
- [ ] Login as Waseem (03337334333 / Wasi@123) — seed default, change it on first login
- [ ] Each sees ONLY its own books, staff and reports; neither appears in the other's Staff Book
- [ ] (upgraded device only) the pre-existing Admin / 03000000000 account still opens and still holds its data
- [ ] Login with admin credentials (the seed defaults above;
      the values are `ADMIN_SEED_NAME` / `ADMIN_SEED_PASSWORD` in `src/services/database/seedData.ts`, and
      changing it there affects FRESH INSTALLS ONLY. An existing device keeps its own,
      and is moved with Settings -> Change password, which needs to be online.)
- [ ] Login with staff credentials (03001234567 / Ahmed@123)
- [ ] Login with invalid credentials shows error
- [ ] Register new staff account
- [ ] Register with duplicate phone number shows error
- [ ] Logout functionality works

### Staff Features
- [ ] Home screen displays correct metrics
- [ ] Add new transaction (Lena)
- [ ] Add new transaction (Dena)
- [ ] Edit existing transaction
- [ ] Delete transaction with confirmation
- [ ] Khata screen shows all transactions
- [ ] Khata screen filters by type (All/Lena/Dena)
- [ ] Khata screen search functionality
- [ ] Khata screen PDF export
- [ ] Cash Book screen shows all entries
- [ ] Cash Book screen filters by type (All/In/Out)
- [ ] Add cash entry (In)
- [ ] Add cash entry (Out)
- [ ] Cash Book screen PDF export

### Admin Features
- [ ] Admin dashboard loads correctly
- [ ] View all staff members
- [ ] View staff metrics
- [ ] Refresh staff list

### Database
- [ ] Seed data loads on first launch
- [ ] Data persists after app restart
- [ ] SQLite operations work correctly
- [ ] Parameterized queries prevent SQL injection

### Offline Functionality
- [ ] App works without internet
- [ ] Data syncs when connection restored
- [ ] Pending sync status shown

### PDF Generation
- [ ] Transaction PDF generates correctly
- [ ] Cash Book PDF generates correctly
- [ ] PDF sharing works

## Performance Testing
- [ ] App loads within 3 seconds
- [ ] Screen transitions are smooth
- [ ] Large transaction lists scroll smoothly
- [ ] No memory leaks detected

## Security Testing
- [ ] Passwords are hashed
- [ ] Session stored securely
- [ ] No sensitive data in console logs
- [ ] SQL injection prevention

## Bug Reporting
Document any bugs found with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Device/OS information
