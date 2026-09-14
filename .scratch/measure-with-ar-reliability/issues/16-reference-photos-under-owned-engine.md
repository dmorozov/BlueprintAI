# 16 — Decision: reference photos when the engine is owned

Type: grilling
Mode: HITL
Status: open
Blocked by: 14
Part of: ../map.md

## Question

**If ticket 14 chooses an owned engine:** reference photos are captured from the engine's own camera frame (`captureFrame()`), so `expo-camera` never coexists with the AR session. Decide resolution/format, reuse of `preparePhoto()` (resize/compress/base64), storage in the session store, and — since the AR scene no longer unmounts for photos — whether consecutive rooms keep **one tracking frame** (removing the "next room needs manual alignment" tip) and what the frame-group id rotation rule becomes.

**If ticket 14 keeps Viro:** close this ticket as not needed (the Track A camera-release guard stands) and leave one line in the map.

## Comments
