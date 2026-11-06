// Workstation wrapper. The portable Stageshow recorder accepts CHROME_PATH.
process.env.CHROME_PATH ||= '/Users/moon/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell'
await import('./film.mjs')
