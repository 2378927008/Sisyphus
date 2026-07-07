# Windows Native Input Hook V1 Plan

## Goal

Enable true hold-to-dictate and mouse-side-button press/release handling on Windows while preserving the existing Electron shortcut fallback.

## Steps

1. Install `uiohook-napi@1.5.5` and record package metadata in `package-lock.json`.
2. Add failing tests for native shortcut parsing and lifecycle.
3. Implement `src/main/native-input-shortcut.js`.
4. Add failing tests for the combined shortcut backend.
5. Implement `src/main/shortcut-backend.js`.
6. Wire the combined backend into `src/main/index.js`.
7. Update docs to explain true native hold mode and remaining limitations.
8. Run focused tests, full tests, Electron smoke, packaged build, and product checks.
