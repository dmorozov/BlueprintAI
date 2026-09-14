# AR "Measure with AR" dead-camera issue — investigation & fix summary

## The reported problem
Intermittently, the **Measure with AR** screen showed:
- an empty (black) area where the camera preview should be,
- **"Tracking lost"** in the top badge,
- tapping the empty area produced only a toast (*"Tracking lost — move the phone slowly and try again"*),
- **no button or way to recover** other than leaving the screen.

After my first fix round (a "Restart AR" chip + guidance pill), you reported it still showed *"Starting AR tracking — move the phone slowly."* in the middle **and** *"Tracking lost"* on top — two messages contradicting each other over a permanently empty screen.

## How I investigated

1. **Live logcat diagnosis on your phone.** Your device was connected via adb, so I cleared logcat, relaunched the app, and watched it while you used it. Reconstructing the timeline from touch events + Viro logs:
   - You entered AR capture → the scene **mounted cleanly on the native side**: `Viro: ARCore availability check returned [SUPPORTED_INSTALLED]`, `JNI setAnchorDetectionTypes called` (anchor detection configured).
   - But **`onTrackingUpdated` never fired once** — not after 20+ seconds of sampling. That's why the center pill stayed on its "Starting…" branch (it keys off *no update yet*), while the top badge showed "Tracking lost" (a fall-through label for the same null state — that was my labeling bug).
   - You pressed back and re-entered; second mount, identical result.

2. **Ruled out app-side causes.** The scene remounts correctly (verified: tapping Restart produced a fresh `setAnchorDetectionTypes` in logcat), permissions are granted, ARCore is installed and healthy, no JS errors/crashes. Also notable in the logs: Viro runs under RN 0.86's new architecture via **legacy view-manager interop** (`Could not find generated setter for ... VRTARSceneManager` warnings) — a fragile seam.

3. **Found the root cause upstream.** Checked versions (we're on the **latest** `@reactvision/react-viro` 2.58.1; its peer range officially covers RN 0.86), then searched the project's GitHub issues and found two open bugs matching your symptoms exactly:
   - **[ReactVision/viro#499](https://github.com/ReactVision/viro/issues/499)** — *"[Android 16] Camera texture never connects to ARCore session — background permanently black on Samsung Galaxy S24"*: session opens, tracking stays unavailable forever, other AR apps work fine on the same device.
   - **[ReactVision/viro#513](https://github.com/ReactVision/viro/issues/513)** — same black-background symptom on a Samsung A54 via Expo managed workflow.

   **Root cause: an open bug in Viro itself** — its camera surface texture fails to bind to the ARCore session on some Android 16 Samsung devices. No fix exists in any released version yet. (My web access dropped mid-investigation, so I couldn't read the issue comments/workarounds — the diagnosis stands on the issue bodies + your device's logs.)

## How I addressed it

Since the root cause can't be fixed from JS, I made the app **detect the dead state and stop pretending**:

| Change | `src/screens/ar-capture-screen.tsx` |
|---|---|
| **Badge contradiction fix** | No-update-yet now shows **"Starting AR…"** (not "Tracking lost"); "lost" is reserved for states ARCore actually reported |
| **Dead-session watchdog** | `STALL_TIMEOUT_MS = 10000`: if *zero* tracking updates arrive 10 s after scene mount, the screen enters a stalled state (any update — even "lost" — clears it) |
| **Prominent recovery** | Stalled state shows a centered card: *"AR camera didn't start. This can happen on some Android 16 devices — restart the session to try again."* with a **Restart AR button in the middle of the screen** (the bottom-bar chip remains as secondary) |
| **Consistent messaging** | Bottom hint line and tap-toast switch to *"AR camera didn't start — tap Restart AR."* when stalled, so no message suggests motion will fix an unbound camera |
| **Restart safety** (from round 1) | Restart remounts the scene = fresh ARCore session; if you've traced corners it confirms first (*"This discards the current trace (N corners)"*) because corner positions are tied to the old session's coordinate frame |

## Verification (on your phone)
- "Starting…" state renders consistently ✓ → after 10 s with no updates, stalled card + both Restart buttons appear ✓
- Tapping the overlay **Restart AR** produced a fresh Viro/ARCore mount in logcat and reset the UI to "Starting…" ✓
- typecheck ✓ · lint ✓ · 61/61 tests ✓ · no JS errors in logcat ✓

One honest gap: with the phone fixed via USB I can't establish real tracking, so the happy path (tracking good → corner taps) remains verified only as far as you've used it — which is also why "sometimes" worked for you.

## Where things stand
- **If #499 is deterministic on your device** (its reporter saw no recovery at all), restarts won't fix individual sessions either — the real fix has to come from a future Viro release; worth watching those two issues. I can re-test as soon as a new version ships.
- **Until then:** *Measure with photos* (your self-hosted MoGe server) is the working measurement path on this phone.
- Everything remains uncommitted alongside Wave 1 + the navigation-bar fix — say the word and I'll commit with proper messages.

