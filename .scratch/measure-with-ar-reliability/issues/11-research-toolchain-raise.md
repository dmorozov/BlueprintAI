# 11 — Research: can the Android toolchain be raised to compileSdk 37 / Kotlin 2.4.10?

Type: research
Mode: AFK
Status: resolved (2026-09-14)
Blocked by: —
Part of: ../map.md

## Question

SceneView 4.35.0 (the polished Android AR view library) reportedly requires minCompileSdk 37 and Kotlin stdlib 2.4.10, while this app is on Expo SDK 57 / RN 0.86 defaults: AGP 8.12.0, Kotlin 2.1.20, compileSdk 36, Gradle 9.3.1, with `@expo/ui` already applying the Compose compiler at the pinned Kotlin. Can the toolchain be raised — and should it?

1. Do Kotlin 2.4.10 and API 37 exist and are they stable? Which AGP supports compileSdk 37, and which Gradle does that AGP need? Does KGP 2.4.10 support them?
2. Which AGP/Kotlin do RN 0.86 and Expo SDK 57 pin, and does Expo SDK 57 officially support overriding `compileSdkVersion`, `targetSdkVersion`, `buildToolsVersion`, `kotlinVersion`, `ndkVersion` (and the AGP version) via `expo-build-properties` (exact supported keys from the v57 docs)?
3. Known breakages when raising Kotlin beyond RN's pin (reanimated 4.5.1, screens, gesture-handler, expo-modules-core, Viro); Compose compiler ↔ Compose 1.10.6 runtime compatibility under KGP 2.4.
4. Do Expo SDK 58 / RN 0.87 already move to compileSdk 37 / Kotlin 2.4 (riding the wave vs fighting it)?
5. Does SceneView 4.35.0 really require those versions (POM / Gradle module metadata)? Is there an older 4.x that fits compileSdk 36 / Kotlin 2.1–2.2 with ARCore ≥ 1.52?
6. Is any of this needed for the `hello_ar` GL route (ARCore 1.56.0 AAR requirements)?

Deliver: current-vs-required version table per route, the exact `expo-build-properties` config that would attempt it, a risk list, and a branch test recipe. Per the standing decision, the raise is **ruled out unless Expo 58 / RN 0.87 are moving there** — this ticket supplies the fact.

## Answer

**Feasible, but not worth doing on Expo SDK 57 — and unnecessary for the recommended engine route.** Full report with sources: `../research/research-toolchain-upgrade.md`.

1. **The versions exist and fit each other.** Kotlin 2.4.10 (2026-07-14; 2.4.20 is current) supports Gradle 7.6.3–9.5.0 and AGP 8.5.2–9.1.0, so it fits our Gradle 9.3.1 / AGP 8.12.0. API 37 = Android 17 (2026-06-16). AGP 8.12 only *warns* about compileSdk 37; the first AGP that officially supports it is 9.1.x.
2. **What Expo SDK 57 lets us override.** `expo-build-properties` (v57) supports `compileSdkVersion`, `targetSdkVersion`, `minSdkVersion`, `buildToolsVersion`, `kotlinVersion`, `cmakeVersion` — no NDK/AGP/Gradle keys, no documented ranges. **AGP 9 is impossible on SDK 57** (expo/expo#49550 closed as SDK-58-only). Traps: `android.kotlinVersion` does not re-pin the *root* buildscript KGP (still 2.1.20 — needs an explicit pin, and which version wins without it is UNVERIFIED); Expo's KSP 2.3.7 predates a Kotlin-2.4 fix (use 2.3.12); SceneView's Compose BOM lifts `@expo/ui`'s Compose 1.10.6 to 1.11.4.
3. **Breakage risk.** No GitHub issues for Kotlin 2.4 / compileSdk 37 in reanimated, screens, gesture-handler; reanimated 4.5.1 already carries an AGP 9 workaround; the Compose compiler is bundled with KGP, so 2.4.10 + Compose runtime 1.10.6 is supported.
4. **Riding the wave?** RN 0.87.1 / 0.88.0-rc.0 pin compileSdk 37, buildTools 37.0.0, AGP 9.2.1, **Kotlin 2.2.0**; Expo SDK 58 (`58.0.0-preview.1`, on RN 0.88-rc) defaults to the same. So **compileSdk 37 arrives by itself with the next SDK; Kotlin 2.4 does not** — a raise done now would have to be redone in weeks at SDK 58.
5. **SceneView reality (from POM / `.module` / AAR metadata).** 4.35.0: `minCompileSdk=37`, ARCore 1.54.0, kotlin-stdlib 2.4.10, Filament 1.72.1, Compose BOM 2026.06.01. Every release ≥ 4.19.0 needs a Kotlin ≥ 2.3 compiler; 4.0.0–4.18.0 need ≥ 2.2 (ARCore 1.53/1.54); only 3.0.0 (Kotlin 2.1.21, ARCore 1.53.0) works with today's 2.1.20. Cheapest SceneView option today: **arsceneview 4.18.0 with `kotlinVersion: "2.2.21"` and compileSdk 36**; the View-based 2.3.3 line (ARCore 1.52) also fits.
6. **The `hello_ar` GL route needs no upgrade.** ARCore 1.56.0 has no Kotlin dependency and no `minCompileSdk` stamp (only `androidx.annotation:1.3.0`); the sample compiles under old Kotlin; its manifest `targetSdk 37` only leaks in if the app sets none (Expo sets 36).
7. **Cross-cutting blocker for every owned-module route:** `@reactvision/react-viro` bundles `arcore_client/core-1.43.0.aar` as a *project* dependency, so adding `com.google.ar:core:1.5x` to the build produces **duplicate classes** while Viro is installed. Coexistence for an A/B (the seam plan) therefore needs Viro's `arcore_client` excluded/swapped (ticket 07's recipe) or Viro removed on the spike branch.

**Standing decision confirmed:** the toolchain raise stays ruled out on SDK 57; revisit only after the SDK 58 upgrade, and only for a SceneView ≤ 4.18 / Kotlin 2.2 combination. The recommended engine route (ARCore 1.56 + `hello_ar` GL renderer) changes nothing in the toolchain.

## Comments
