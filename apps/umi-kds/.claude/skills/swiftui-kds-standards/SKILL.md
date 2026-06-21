---
name: swiftui-kds-standards
description: Apply the local design rules for the native SwiftUI iPad kitchen display app. Use proactively for features, data flow, realtime behavior, and UI decisions in this repository.
---

# SwiftUI KDS Standards

## Rules
- Backend owns business truth.
- The app renders normalized orders, not raw channel payloads.
- Prefer feature slices over layered sprawl.
- Keep state transitions explicit: `new`, `accepted`, `preparing`, `ready`, `completed`.
- Optimize for glanceability, speed, reconnect safety, and shared iPad use in kitchen environments.
- Default to iPad-first shells, not phone-first navigation stacked onto a tablet.
- Favor landscape layouts, persistent context, and fast tap targets over modal-heavy flows.
- Make typography and status cues readable from a short standing distance.

## Default structure
- `App`: app entry, environment, routing.
- `Features`: board, ticket detail, settings.
- `Domain`: order, item, status, event.
- `Data`: API, realtime, cache, repositories.
- `DesignSystem`: shared visual tokens and components.

## Default technical choices
- `SwiftUI`
- `NavigationSplitView` or equivalent persistent-shell patterns when they improve operator speed
- `async/await`
- initial snapshot plus realtime stream
- small local cache only
- device-scoped auth for shared kitchen iPads

Read `notes.md`.
