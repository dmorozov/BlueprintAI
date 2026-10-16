# 16 — Decision: reference photos when the engine is owned

Type: grilling
Mode: HITL
Status: resolved (out of scope, 2026-10-15)
Blocked by: 14
Part of: ../map.md

## Question

**If ticket 14 chooses an owned engine:** reference photos are captured from the engine's own camera frame (`captureFrame()`), so `expo-camera` never coexists with the AR session. Decide resolution/format, reuse of `preparePhoto()` (resize/compress/base64), storage in the session store, and — since the AR scene no longer unmounts for photos — whether consecutive rooms keep **one tracking frame** (removing the "next room needs manual alignment" tip) and what the frame-group id rotation rule becomes.

**If ticket 14 keeps Viro:** close this ticket as not needed (the Track A camera-release guard stands) and leave one line in the map.

## Comments
- **2026-10-15, ticket 12:** if ticket 19 passes, ticket 14 keeps Viro and this ticket goes out of scope by its own rule (the camera wait from ticket 04 stands).
- **2026-10-15: out of scope by its own rule.** Ticket 14 kept Viro (ticket 19 passed), so the engine is not owned and reference photos stay on expo-camera behind ticket 04's camera wait.
