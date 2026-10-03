# Capture index

Date: 2026-09-29. Client: Chromium 153 on Hyprland, `DISPLAY=:1`, windowed at 1440x1000.
Route: `node /tmp/umi-fetch.mjs` (Playwright, `headless: false`, system Chromium at
`/usr/lib/chromium/chromium`). The Playwright browser download is absent on this box, so the
system Chromium is the instrument.

| File                           | Product  | Screen                                                | Source URL                                                                           | Status | Date       |
| ------------------------------ | -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------ | ------ | ---------- |
| `square-add-team-member.png`   | Square   | Team member creation, "email address or phone number" | https://squareup.com/help/us/en/article/8356-add-and-manage-team-members             | 200    | 2026-09-29 |
| `square-sign-in-owner.png`     | Square   | Account sign-in (owner plane)                         | https://squareup.com/help/us/en/article/5062-sign-in-and-out-of-square-point-of-sale | 200    | 2026-09-29 |
| `loyverse-pin-code-access.png` | Loyverse | "Every user must have a unique 4-digit PIN"           | https://help.loyverse.com/help/pin-code-access                                       | 200    | 2026-09-29 |
| `toast-pos-access-code.png`    | Toast    | POS access code, three to eight digits                | https://support.toasttab.com/en/article/Find-or-Edit-an-Employee-s-POS-Access-Code   | 200    | 2026-09-29 |

## Not captured

The remaining products in the matrix were read as text. Their help centres were not captured as
images in this pass, because each one needs an interactive search or a login to reach the named
screen. That is a recorded gap, not a silent one. The two routes tried per blocked host are in the
README's route-failure log.
