# Can BlueprintAI's Android toolchain go to compileSdk 37 + Kotlin 2.4.10 (SceneView 4.35.0)?

Researched 2026-09-14 against primary sources (Maven/Google Maven artifact metadata, developer.android.com,
kotlinlang.org, docs.expo.dev v57, expo/expo and facebook/react-native repos, this repo's `node_modules`).
Anything not confirmed by a primary source is marked **UNVERIFIED**.

## TL;DR

- **Yes, but as a "partial" upgrade.** On Expo SDK 57 / RN 0.86.3 you can raise **compileSdk to 37** and
  **Kotlin to 2.4.10** while **keeping AGP 8.12.0 and Gradle 9.3.1**. You cannot move to AGP 9 on SDK 57:
  Expo's own gradle plugin is compiled with Kotlin 2.1.20 and cannot run on the Gradle ≥ 9.4.1 that AGP ≥ 9.2 needs;
  Expo closed the request as "SDK 58 only" (expo/expo#49550).
- **Two hard requirements come from SceneView, not one.** (1) `arsceneview-4.35.0.aar` carries
  `minCompileSdk=37` in its AAR metadata (AGP enforces this as an error). (2) Every SceneView ≥ 4.19.0 is compiled by
  Kotlin **2.4** (metadata version 2.4.0), which a Kotlin ≤ 2.2 compiler refuses to read; you need Kotlin ≥ 2.3.x,
  in practice **2.4.10 or 2.4.20**.
- **No 4.x release fits Kotlin 2.1/2.2 and compileSdk 36 at the same time.** 4.0.0–4.18.0 need Kotlin ≥ 2.2 (metadata
  2.3.0) and ARCore 1.53/1.54; only the 3.0.0 line (Mar 2026, Kotlin 2.1.21, ARCore 1.53.0) fits today's Kotlin 2.1.20.
- **You are riding the wave, not fighting it, on compileSdk 37**: RN 0.87.1 / 0.88.0-rc.0 pin compileSdk 37,
  buildTools 37.0.0, AGP 9.2.1, Kotlin 2.2.0 (targetSdk stays 36); Expo SDK 58 (currently `58.0.0-preview.1`, on RN
  0.88.0-rc.0) defaults to the same. **Kotlin 2.4 is where you would still be ahead of everyone**: SDK 58/RN 0.88 ship
  Kotlin 2.2.0, so SceneView will require a Kotlin override there too.
- **The hello_ar_kotlin/ARCore 1.56.0 route needs none of this**: `com.google.ar:core:1.56.0` has no Kotlin dependency,
  no `minCompileSdk` stamp, and only `androidx.annotation:1.3.0` as a dependency.
- **Cross-cutting blocker for every route**: `@reactvision/react-viro` ships ARCore as a local AAR
  (`android/arcore_client/core-1.43.0.aar`, wired as `implementation project(':arcore_client')`). Adding
  `com.google.ar:core:1.5x` next to it means duplicate `com.google.ar.core.*` classes.

---

## 1. Do the target versions exist, and what do they need?

| Fact | Value | Source |
|---|---|---|
| Kotlin 2.4.10 | Bug-fix release, **2026-07-14** (2.4.0 language release 2026-06-03; 2.4.20 tooling release 2026-09-07 is the current latest) | https://kotlinlang.org/docs/releases.html, https://github.com/JetBrains/kotlin/releases |
| API level 37 | **Android 17** (codename `CINNAMON_BUN`). Platform Stability at Beta 3 (2026-03-26); "Today we're releasing Android 17…" **2026-06-16**; SDK Platform `platforms;android-37` and `build-tools;37.0.0` are in the SDK repository | https://android-developers.googleblog.com/2026/06/Android-17.html, https://developer.android.com/about/versions/17/release-notes, https://apilevels.com/, https://dl.google.com/android/repository/repository2-3.xml |
| AGP ↔ max compileSdk | AGP **8.13**: "maximum API level … is API level 36.1"; AGP **9.0**: 36.1; AGP **9.1.1**: "supports Android API level 37.0 and below"; 9.2: 37.0; 9.3: 37; 9.4: 37 | https://developer.android.com/build/releases/agp-8-13-0-release-notes, …/agp-9-0-0-release-notes, …/agp-9-1-0-release-notes, …/agp-9-2-0-release-notes, …/agp-9-3-0-release-notes, https://developer.android.com/build/releases/gradle-plugin |
| AGP ↔ min Gradle | 8.13 → Gradle 8.13; 9.0 → 9.1.0; **9.1 → 9.3.1**; 9.2 → 9.4.1; 9.3 → 9.5.0; 9.4 → 9.6.0 | same pages |
| AGP 9.0 breaking changes | built-in Kotlin on by default (`android.builtInKotlin=true`), new DSL, `applicationVariants`/`variantFilter` removed, runtime dependency on KGP 2.2.10 | https://developer.android.com/build/releases/agp-9-0-0-release-notes, https://developer.android.com/build/migrate-to-built-in-kotlin |
| KGP ↔ Gradle/AGP | **KGP 2.4.0–2.4.10: Gradle 7.6.3–9.5.0, AGP 8.5.2–9.1.0**; KGP 2.4.20: Gradle 7.6.3–9.7.0, AGP 8.5.2–9.3.1; KGP 2.1.20: Gradle 7.6.3–8.12.1, AGP 7.3.1–8.7.2 | https://kotlinlang.org/docs/gradle-configure-project.html |
| compileSdk above AGP's tested max | AGP prints a *warning* ("This Android Gradle plugin (X) was tested up to compileSdk = Y … add `android.suppressUnsupportedCompileSdk=37`") and continues. **UNVERIFIED on a primary page** — the text is quoted in many issue reports (e.g. https://github.com/googleads/googleads-mobile-unity/issues/3040) and comes from AGP itself; not documented on developer.android.com. | — |

So: Kotlin 2.4.10 + Gradle 9.3.1 is inside KGP's supported range; Kotlin 2.4.10 + AGP 8.12.0 is inside the range
(min AGP 8.5.2). AGP 9.1.x would be the first AGP that *officially* supports API 37 and it wants exactly Gradle 9.3.1
— but AGP 9 is off the table on SDK 57 (section 2).

## 2. What RN 0.86 and Expo SDK 57 pin, and what `expo-build-properties` can override

### React Native (primary: `packages/react-native/gradle/libs.versions.toml` at each tag)

| RN tag | compileSdk | targetSdk | buildTools | ndk | agp | kotlin | template Gradle wrapper |
|---|---|---|---|---|---|---|---|
| v0.86.3 (installed) | 36 | 36 | 36.0.0 | 27.1.12297006 | **8.12.0** | **2.1.20** | 9.3.1 (react-native-community/template 0.86-stable) |
| v0.87.1 | **37** | 36 | **37.0.0** | 27.1.12297006 | **9.2.1** | **2.2.0** | 9.4.1 (0.87-stable) |
| v0.88.0-rc.0 | 37 | 36 | 37.0.0 | 27.1.12297006 | 9.2.1 | 2.2.0 | — |

RN 0.87 blog (https://reactnative.dev/blog/2026/08/11/react-native-0.87): "This is the first release of React Native
that adds support for AGP 9"; "Minimum Kotlin version is now 2.0+ (bundled Kotlin version is 2.2.0)";
"`compileSdk`/`buildTools` was bumped to 37"; recommended `android.builtInKotlin=false` and `android.newDsl=false`
in gradle.properties ("Starting from AGP 10.x these opt outs will be removed").

### How the versions actually reach this build (verified by `./gradlew buildEnvironment` in `android/`)

- Root `android/build.gradle` uses versionless `classpath('com.android.tools.build:gradle')` /
  `classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')`. They resolve transitively through the included build
  `com.facebook.react:react-native-gradle-plugin`, whose `build.gradle.kts` declares
  `implementation(libs.kotlin.gradle.plugin)` + `implementation(libs.android.gradle.plugin)` → the report shows
  `org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20` under the RN plugin (AGP line: see §"resolved classpath" note
  at the end of this file).
- `expoAutolinking.useExpoVersionCatalog()` (settings.gradle) builds an `expoLibs` catalog from RN's
  `gradle/libs.versions.toml` and overrides entries from gradle.properties:
  `android.buildToolsVersion→buildTools`, `android.minSdkVersion→minSdk`, `android.compileSdkVersion→compileSdk`,
  `android.targetSdkVersion→targetSdk`, `android.kotlinVersion→kotlin`
  (`expo-modules-autolinking/android/expo-gradle-plugin/expo-autolinking-settings-plugin/src/main/kotlin/expo/modules/plugin/ExpoAutolinkingSettingsExtension.kt`).
- `expo-root-project` (`ExpoRootProjectPlugin.kt`) then sets `rootProject.ext.{buildToolsVersion,minSdkVersion,
  compileSdkVersion,targetSdkVersion,ndkVersion,kotlinVersion,kspVersion}` from that catalog (`setIfNotExist`, so
  an `ext {}` block in build.gradle wins). Banner today:
  `buildTools 36.0.0 · minSdk 24 · compileSdk 36 · targetSdk 36 · ndk 27.1.12297006 · kotlin 2.1.20 · ksp 2.1.20-2.0.1`.
- **Expo's Kotlin gate** (`KSPLookup.kt`): known map 2.1.20 … 2.2.21; for any `kotlinVersion >= "2.3.0"` it silently
  uses `latestKspVersion = "2.3.7"` ("Starting with KSP 2.3.0, KSP is no longer tied to a specific Kotlin version").
  So Kotlin 2.4.10 is *accepted* by Expo SDK 57's plugin — there is no upper bound.
- All native deps read `rootProject.ext.compileSdkVersion` / `kotlinVersion` (app/build.gradle,
  expo-modules-core `ExpoModulesCorePlugin.gradle` default 36, reanimated 4.5.1 & worklets 0.10.1
  `safeExtGet("compileSdkVersion", 36)`, screens `safeExtGet('kotlinVersion', '1.8.0')`, gesture-handler
  `RNGH_kotlinVersion=2.0.21` fallback). None declares a Kotlin *upper* bound.

### `expo-build-properties` (docs v57 + `sdk-57` source)

Supported Android keys (https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/ and
`packages/expo-build-properties/src/pluginConfig.ts` @ sdk-57): `compileSdkVersion` (number),
`targetSdkVersion` (number), `minSdkVersion` (number), `buildToolsVersion` (string), `kotlinVersion` (string,
"Override the Kotlin version used when building the app"), `cmakeVersion` (string), plus unrelated ones
(`buildArchs`, `extraMavenRepos`, `packagingOptions`, `useLegacyPackaging`, `enableProguardInReleaseBuilds`, …).
**Not supported: `ndkVersion`, Gradle version, AGP version.** No supported *range* is documented for any key.
`android.ts` writes them to `android/gradle.properties` as `android.compileSdkVersion`, `android.targetSdkVersion`,
`android.buildToolsVersion`, `android.kotlinVersion`, `android.minSdkVersion`, `android.cmakeVersion` — exactly the
keys the Expo settings plugin reads above, so the override path is first-class and end-to-end.

SDK 57 expects `expo-build-properties@~57.0.17` (`node_modules/expo/bundledNativeModules.json`).

### Why AGP 9 is impossible on SDK 57 (expo/expo#49550, closed 2026-09-04)

expo-bot: "Published `expo-modules-autolinking@57.0.12` compiles `expo-gradle-plugin` with Kotlin 2.1.20. Gradle
9.4.1 and later put a newer `kotlin-stdlib` on that compile classpath … The 2.1.20 compiler cannot read the newer
metadata … `main` declares Kotlin 2.2.21 … It is not on `sdk-57`, so do not wait for an SDK 57 patch. Until you
move to SDK 58, keep Gradle 9.3.1." tsapeta: "SDK 57 recommends and relies on React Native 0.86, which doesn't
support AGP 9 anyway. We're going to release SDK 58 with support for AGP 9 later this month."
Installed `expo-modules-autolinking@57.0.13` still declares `kotlin("jvm") version "2.1.20"`; the same error message
gives the Kotlin reading rule verbatim: *"compiler version 2.1.0 can read versions up to 2.2.0"*.

## 3. Known breakages when raising Kotlin past RN's pin

- **Kotlin metadata rule** (https://kotlinlang.org/docs/kotlin-evolution-principles.html): "a newer compiler can read
  older binaries"; "the binary format is mostly forwards compatible with the next language release, but not later
  ones (… 1.9 can understand most binaries from 2.0, but not 2.1)". Consequence: a **2.2.x compiler cannot consume
  SceneView 4.19+ (metadata 2.4.0)**; 2.3.x "mostly" can; 2.4.x fully can. Raising the *app's* Kotlin is the safe
  direction: all RN/Expo libs are compiled from source by the app's KGP (metadata written = app's version), and the
  only prebuilt Kotlin AARs in play are Compose (runtime 1.10.6 = metadata 1.9.x; 1.11.4 = 2.1.0) and okhttp-android
  (2.1.0) — all readable by 2.4.
- **GitHub issue search** (`gh search issues` in reanimated, screens, gesture-handler, expo, react-native for
  "Kotlin 2.4", "compileSdk 37", "AGP 9"): **no hits** except expo#49550 above. reanimated 4.5.1's
  `build.gradle.kts` already carries a "Workaround for AGP 9 + Kotlin 2.x lint K2 UAST crash" — i.e. it is being
  built against AGP 9/Kotlin 2.x upstream. Absence of reports is not evidence of compatibility with 2.4 specifically
  (**UNVERIFIED** until built).
- **Root buildscript classpath — the real trap.** `android.kotlinVersion` changes `rootProject.ext.kotlinVersion`
  (what libraries put in *their* `buildscript.classpath` and `kotlin-stdlib` deps), but the *root* classpath still
  gets KGP 2.1.20 transitively from the RN plugin and the root buildscript classloader is the parent of every
  subproject's. Whether the subprojects' `kotlin-gradle-plugin:2.4.10` / `kotlin.plugin.compose:2.4.10` requests
  win over the already-loaded 2.1.20 is **UNVERIFIED**; the robust approach is to pin the root explicitly
  (`classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10')`) — see recipe. Note `android/` is gitignored
  (`.gitignore:46 /android`), so this must be a config plugin (or a manual edit on the spike branch).
- **RN 0.86 gradle plugin under KGP 2.4.10**: it only imports `org.jetbrains.kotlin.gradle.dsl.kotlinExtension` and
  `org.jetbrains.kotlin.gradle.plugin.extraProperties` (stable API) — likely fine, **UNVERIFIED**.
- **KSP**: Expo picks KSP **2.3.7** for Kotlin ≥ 2.3.0, but KSP 2.3.10 (2026-07-09) notes "Sanitize ':' in
  internal-name module suffix so KSP works with Kotlin 2.4.0 default module names (#2964)" and an AGP 9 R-class fix
  (https://github.com/google/ksp/releases). Latest on Maven: 2.3.12 (2026-09-09). Set `ext.kspVersion = "2.3.12"`
  (ExpoRootProjectPlugin honours a pre-existing `kspVersion`).
- **Compose compiler**: since Kotlin 2.0 the compiler ships with KGP via `org.jetbrains.kotlin.plugin.compose`
  ("this version matches your Kotlin version"); "When you use the Compose Compiler Gradle plugin, you don't have to
  check Compose to Kotlin compatibility" (https://developer.android.com/develop/ui/compose/compiler,
  https://developer.android.com/jetpack/androidx/releases/compose-kotlin). `@expo/ui` and `expo-modules-core`
  already apply it at `${kotlinVersion}`, so with 2.4.10 they get compiler 2.4.10 against runtime 1.10.6 — supported.
  Compose runtime ≥ 1.10.0-alpha02 requires "KGP 2.0.0 or newer to be consumed" (…/compose-runtime) — satisfied.
  SceneView's `compose-bom 2026.06.01` resolves `androidx.compose.ui/runtime` to **1.11.4** and `material3` 1.4.0;
  Gradle will lift `@expo/ui`'s ui/foundation 1.10.6 → 1.11.4 (material3 stays at its 1.5.0-alpha17). Compose 1.x
  minor bumps are meant to be binary compatible — **UNVERIFIED** for `@expo/ui` specifically.

## 4. Is the next SDK already there?

| | compileSdk | targetSdk | buildTools | AGP | Gradle | Kotlin | notes |
|---|---|---|---|---|---|---|---|
| RN 0.87.1 (2026-08-11) / 0.88.0-rc.0 (2026-09-08) | 37 | 36 | 37.0.0 | 9.2.1 | 9.4.1 | 2.2.0 | first AGP 9 support; opt out of built-in Kotlin/new DSL |
| Expo `sdk-58` branch (`expo@58.0.0-preview.1`, bundles `react-native 0.88.0-rc.0`, `reanimated 4.6.0`, `screens ~4.27.0`, `@expo/ui ~58.0.1`) | 37 (plugin default) | 36 | 37.0.0 | (RN's 9.2.1) | 9.4.1 (template) | 2.2.0 | template gradle.properties: `android.builtInKotlin=false`, `android.newDsl=false`; expo-modules-core 58.0.0 (2026-09-10): "Bump the Gradle plugin's Kotlin version to 2.2.21", "Make `expo-module-gradle-plugin` compatible with AGP 9" |

npm dist-tags today: `latest`/`sdk-57` = 57.0.22, `next` = 58.0.0-preview.1 (https://registry.npmjs.org, `npm view expo dist-tags`).
SDK 58 stable is announced for "later this month" (expo#49550, 2026-09-04) — **not yet released** (no
https://expo.dev/changelog/sdk-58 page; 404).

Verdict: compileSdk 37 / buildTools 37 = riding the wave (RN 0.87+, SDK 58). Kotlin 2.4 = still ahead of the
platform (RN 0.88rc/SDK 58 ship 2.2.0; KGP 2.4.10's tested AGP max is 9.1.0 < SDK 58's 9.2.1 → on SDK 58 use
**KGP 2.4.20**, whose tested range covers AGP 9.3.1 / Gradle 9.7.0).

## 5. What SceneView really requires (primary: Maven Central POM + `.module` + AAR `aar-metadata.properties` + `.kotlin_module` header)

`arsceneview-4.35.0` POM/`.module`: depends on `io.github.sceneview:sceneview:4.35.0`, `com.google.ar:core:1.54.0`,
`org.jetbrains.kotlin:kotlin-stdlib:2.4.10`, platform `androidx.compose:compose-bom:2026.06.01`,
`androidx.core:core-ktx:1.18.0`, `androidx.appcompat:appcompat:1.8.0`, `androidx.compose.ui:ui`,
`androidx.compose.foundation:foundation`; created by Gradle 9.7.1. `sceneview-4.35.0` adds Filament
`filament-android`/`gltfio-android`/`filament-utils-android` **1.72.1**. Neither POM lists okhttp; the SceneView
repo's own catalog (https://raw.githubusercontent.com/sceneview/sceneview/main/gradle/libs.versions.toml) has
`agp 9.4.0, kotlin 2.4.10, arCore 1.54.0, filament 1.72.1, okhttp 5.5.0, composeBom 2026.06.01`.
GitHub release v4.34.0 (2026-09-09): "Every Android module now compiles against SDK 37" because `okhttp-android`
5.5.0 requires it (its AAR says `minCompileSdk=37`); "targetSdk remains at 36 deliberately".
README advertises 4.36.0 but Maven Central and GitHub releases stop at **4.35.0** (2026-09-11).

| arsceneview | published | kotlin-stdlib (POM) | Kotlin metadata in AAR (needs compiler ≥) | AAR minCompileSdk | ARCore | Filament (sceneview POM) | compose-bom |
|---|---|---|---|---|---|---|---|
| **4.35.0** | 2026-09-11 | 2.4.10 | 2.4.0 (≥ 2.3, ideally 2.4) | **37** | 1.54.0 | 1.72.1 | 2026.06.01 |
| 4.34.0 | 2026-09-03 | 2.4.10 | 2.4.0 | 1 (not stamped, despite release note) | 1.54.0 | 1.72.1 | 2026.06.01 |
| 4.33.0 | 2026-08-26 | 2.4.10 | 2.4.0 | 1 | 1.54.0 | 1.72.1 | 2026.06.01 |
| 4.30.0–4.32.0 | 2026-08-12…22 | 2.4.10 | 2.4.0 | 1 | 1.54.0 | 1.72.1 | 2026.06.01 |
| 4.25.0–4.29.0 | 2026-07-21…08-12 | 2.4.10 | 2.4.0 | 1 | 1.54.0 | 1.72.1 | 2026.06.01 |
| 4.19.0–4.24.0 | 2026-07-04… | 2.4.0 | 2.4.0 | 1 | 1.54.0 | 1.71.5 (4.19) | 2026.05.01 / .06.01 |
| **4.18.0** | 2026-06-06 | 2.3.21 | **2.3.0 (≥ 2.2)** | 1 | 1.54.0 | 1.71.5 | 2026.05.01 |
| 4.15.4–4.17.0 | 2026-05-26…31 | 2.3.21 | 2.3.0 | 1 | 1.54.0 | — | 2026.05.01 |
| 4.0.0–4.10.0 | 2026-04-12…05-17 | 2.3.20/2.3.21 | 2.3.0 | 1 | 1.53.0 | — | 2026.03.00/.05.00 |
| 3.6.2 | 2026-04-08 | 2.3.20 | 2.3.0 | 1 | 1.53.0 | 1.70.2 | 2026.03.00 |
| **3.0.0** | 2026-03-15 | 2.1.21 | **2.1.0 (≥ 2.0)** | 1 | 1.53.0 | 1.56.0 | none |
| 2.3.3 | 2026-01-13 | 2.2.21 | 2.2.0 (≥ 2.1) | 1 | 1.52.0 | 1.68.2 | none |

Answers: (a) 4.35.0 really requires compileSdk 37 (enforced) and Kotlin ≥ 2.3 (2.4 metadata) — there is no
4.x that fits Kotlin 2.1/2.2 *and* compileSdk 36 *and* ARCore ≥ 1.52 except **4.18.0-and-below with Kotlin 2.2.x**
(that is exactly RN 0.87 / SDK 58's default Kotlin, compileSdk 36 or 37 both fine). (b) With today's Kotlin 2.1.20
the only ARCore ≥ 1.52 option is **3.0.0** (Kotlin 2.1.21, ARCore 1.53.0, Filament 1.56.0) — a much older API.

## 6. The hello_ar_kotlin / ARCore 1.56.0 route

- Google Maven `com.google.ar:core` versions: … 1.52.0, 1.53.0, 1.54.0, **1.56.0** (no 1.55.0). 1.56.0 POM
  dependencies: only `androidx.annotation:annotation:1.3.0`. The AAR has **no** `aar-metadata.properties`
  (no `minCompileSdk` floor), no Kotlin; its manifest declares `minSdkVersion 24`, `targetSdkVersion 37`.
- ARCore 1.56.0 release notes (2026-09-04): "ARCore's `targetSdkVersion` has been updated to Android API level 37. If
  your app does not specify a `targetSdkVersion`, your app's `targetSdkVersion` will become 37 due to manifest
  merging" — Expo always sets one (36), so no effect. Adds `AcquireDepthImageMeters`/`AcquireRawDepthImageMeters`.
- `google-ar/arcore-android-sdk` `samples/hello_ar_kotlin`: `compileSdkVersion 37`, `minSdkVersion 24`,
  `targetSdkVersion 37`, `com.google.ar:core:1.56.0`, `de.javagl:obj:0.4.0`; root build uses AGP 8.4.0 and Kotlin
  **1.6.10** — the sample's Kotlin/GL code has no dependency on modern Kotlin or on API-37 classes
  (**UNVERIFIED** that nothing in 1.56's public API references API-37 types; there is no metadata floor).
- ARCore quickstart requirement: "Android SDK Platform version 7.0 (API level 24) or higher"
  (https://developers.google.com/ar/develop/java/quickstart).

**Conclusion: a custom Expo Module wrapping ARCore 1.56.0 + the hello_ar GL renderer needs no toolchain change
(compileSdk 36, Kotlin 2.1.20, AGP 8.12.0, Gradle 9.3.1 as-is).** The only work is de-duplicating ARCore with
react-viro's bundled `core-1.43.0.aar`.

---

## (a) Current vs required, per route

| Component | Current (SDK 57 / RN 0.86.3, verified) | Route A: SceneView 4.35.0 | Route B: older SceneView (4.18.0 / 3.0.0) | Route C: hello_ar GL + ARCore 1.56.0 |
|---|---|---|---|---|
| Gradle wrapper | 9.3.1 | 9.3.1 (OK for KGP 2.4.10 ≤ 9.5.0) | 9.3.1 | 9.3.1 |
| AGP | 8.12.0 (RN plugin transitive) | 8.12.0 kept (+ compileSdk-37 warning); AGP 9.1.x is the "official" one but impossible on SDK 57 | 8.12.0 | 8.12.0 |
| Kotlin (KGP + stdlib) | 2.1.20 | **2.4.10** (2.4.20 also OK; ≥ 2.3.x minimum) | 4.18.0: ≥ 2.2.x (2.2.21 in Expo's KSP map); 3.0.0: 2.1.20 works | 2.1.20 |
| compileSdk | 36 | **37** (AAR `minCompileSdk=37`) | 36 | 36 |
| targetSdk | 36 | 36 (SceneView itself stays on 36) | 36 | 36 |
| buildTools | 36.0.0 | 37.0.0 (installed locally) | 36.0.0 | 36.0.0 |
| NDK | 27.1.12297006 | unchanged | unchanged | unchanged |
| Compose compiler | KGP-bundled 2.1.20 | KGP-bundled 2.4.10 | 2.2.x / 2.1.20 | 2.1.20 |
| Compose runtime/ui | 1.10.6 (@expo/ui), material3 1.5.0-alpha17 | ui/runtime → 1.11.4 via compose-bom 2026.06.01 | 4.18.0: bom 2026.05.01; 3.0.0: none | unchanged |
| KSP | 2.1.20-2.0.1 | Expo picks 2.3.7 → set 2.3.12 | 2.2.21-2.0.5 / unchanged | unchanged |
| ARCore | Viro's local core-1.43.0.aar | 1.54.0 (transitive; can be raised to 1.56.0) — **conflicts with Viro AAR** | 1.54.0 / 1.53.0 — conflicts | 1.56.0 — conflicts |
| Filament | — | 1.72.1 | 1.71.5 / 1.56.0 | none (raw GLES) |
| Local SDK | platforms 36, 36.1; build-tools 35–37.0.0 | needs `platforms;android-37` | OK | OK |

## (b) `expo-build-properties` config that attempts Route A (v57 keys only)

```json
{
  "expo": {
    "plugins": [
      [
        "expo-build-properties",
        {
          "android": {
            "compileSdkVersion": 37,
            "targetSdkVersion": 36,
            "buildToolsVersion": "37.0.0",
            "kotlinVersion": "2.4.10"
          }
        }
      ]
    ]
  }
}
```

That yields `android.compileSdkVersion=37`, `android.targetSdkVersion=36`, `android.buildToolsVersion=37.0.0`,
`android.kotlinVersion=2.4.10` in `android/gradle.properties`, which the Expo settings plugin folds into the
`expoLibs` catalog and `expo-root-project` into `rootProject.ext`. Things the plugin cannot express and that likely
need a tiny local config plugin (`withProjectBuildGradle` / `withGradleProperties`) because `android/` is gitignored:

```groovy
// android/build.gradle (what the config plugin should produce)
buildscript {
  ext { kspVersion = "2.3.12" }                      // ExpoRootProjectPlugin.setIfNotExist honours it
  dependencies {
    classpath('com.android.tools.build:gradle')      // stays 8.12.0 on SDK 57
    classpath('com.facebook.react:react-native-gradle-plugin')
    classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.10')   // pin the ROOT classpath (see risk 2)
  }
}
```
```properties
# android/gradle.properties (optional)
android.suppressUnsupportedCompileSdk=37   # silences AGP 8.12's "tested up to compileSdk = 36" warning
```

Add SceneView in the module's `build.gradle`: `implementation("io.github.sceneview:arsceneview:4.35.0")` (Maven
Central; no extra repo), and exclude Viro's ARCore (see risk 1).

## (c) Risks (ordered by likelihood of biting first)

1. **Duplicate ARCore classes** — `project(':arcore_client')` (core-1.43.0.aar) + `com.google.ar:core:1.5x`.
   Remove the Viro AR modules or stop linking `arcore_client` (only possible if Viro's AR isn't used at runtime).
2. **Root classpath still on KGP 2.1.20** (`android.kotlinVersion` doesn't touch it). Symptoms: Compose plugin
   version mismatch, "Kotlin Gradle plugin loaded multiple times", or libs silently compiling with 2.1.20 and then
   failing on SceneView with "Module was compiled with an incompatible version of Kotlin … metadata 2.4.0".
   Mitigation: explicit pin above. **UNVERIFIED which way Gradle resolves it without the pin.**
3. **Kotlin 2.4 language/K2 strictness on library sources** compiled by the app (screens 4.26.2, gesture-handler
   2.32.0, reanimated 4.5.1 + worklets 0.10.1, expo-modules-core 57.0.18, @expo/ui 57.0.18, expo-camera,
   expo-media-library, react-native-svg). No issues found upstream, but none of them is CI-tested on 2.4 either.
4. **KSP 2.3.7 vs Kotlin 2.4.0 module-name bug** (fixed in KSP 2.3.10) — expo-modules-core codegen may fail; set
   `kspVersion` 2.3.12.
5. **AGP 8.12.0 compiling against API 37** — warning only; lint/D8 on API-37 class files are usually fine but
   8.12 is documented only "up to 36.1". `platforms;android-37` must be installed (AGP auto-installs if licences
   are accepted).
6. **Compose runtime lift 1.10.6 → 1.11.4** for `@expo/ui` (binary compat assumed, not verified).
7. **Included-build plugins compile with their own KGP 2.1.20** (expo-gradle-plugin, RN gradle plugin) while the
   app uses 2.4.10 — usually harmless in composite builds, unverified here.
8. **RN 0.86's gradle plugin under KGP 2.4.10** — small API surface; unverified.
9. **`expo-doctor`/EAS**: EAS Build images must carry API 37 platform + build-tools 37.0.0 (they track Android
   Studio; **UNVERIFIED** for the image you use).
10. **Divergence from the platform**: SDK 58 will move you to AGP 9.2.1 / Gradle 9.4.1 / Kotlin 2.2.0; the Kotlin
    2.4 override must then become **2.4.20** (KGP 2.4.10's tested AGP max is 9.1.0) and the pin location changes
    (SDK 58 template still uses versionless root classpath entries). Migrating to SceneView on SDK 57 now buys ~2–3
    weeks before redoing the toolchain part.

## (d) "Test on a branch" recipe

```bash
git checkout -b spike/android-compilesdk37-kotlin24
pnpm add expo-build-properties@~57.0.17
# 1) app.json: add the expo-build-properties block from (b)
# 2) plugins/withAndroidToolchainPins.js: withProjectBuildGradle → pin kotlin-gradle-plugin:2.4.10 and ext.kspVersion;
#    withGradleProperties → android.suppressUnsupportedCompileSdk=37   (register it in app.json "plugins")
sdkmanager "platforms;android-37" "build-tools;37.0.0"        # $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager
npx expo prebuild --platform android --clean
cd android
./gradlew buildEnvironment --console=plain | grep -E "tools.build:gradle|kotlin-gradle-plugin:|kotlin.plugin.compose"
#   expect: gradle:8.12.0, kotlin-gradle-plugin:2.4.10 (if 2.1.20 still shows, the root pin didn't apply)
./gradlew :app:assembleDebug --console=plain 2>&1 | tee ../spike-build.log
```
What to look for in `spike-build.log`:
- `[ExpoRootProject] Using the following versions:` banner shows `compileSdk 37 · buildTools 37.0.0 · kotlin 2.4.10 · ksp 2.3.12`.
- `was compiled with an incompatible version of Kotlin` → root classpath pin missing, or a prebuilt AAR newer than your compiler.
- `We recommend using a newer Android Gradle plugin to use compileSdk = 37` → expected warning (suppress or ignore).
- `Duplicate class com.google.ar.core.…` → Viro's `arcore_client` vs `com.google.ar:core`.
- `e: … .kt` errors in `react-native-screens`, `react-native-gesture-handler`, `expo-modules-core`, `@expo/ui`, `reanimated` → Kotlin 2.4 source breakages (risk 3).
- `[ksp]`/`KspAATask` failures → risk 4.
- Then add a throwaway Expo module with `implementation("io.github.sceneview:arsceneview:4.35.0")` and rebuild; confirm `androidx.compose.ui:ui` resolved to 1.11.4 via `./gradlew :app:dependencies --configuration debugRuntimeClasspath | grep compose.ui`.
- Runtime smoke: launch on a device with Google Play Services for AR; check `adb logcat -s ARCore Filament`.
- Also run `npx expo-doctor` (expect only the build-properties plugin to be new) and `git diff` of nothing under `android/` (it's ignored — everything must live in app.json + the config plugin).

Fallbacks if Route A is a swamp: (i) Route B with **arsceneview 4.18.0** needs only `kotlinVersion: "2.2.21"`
(in Expo's KSP map, no KSP override) and compileSdk 36 — the cheapest SceneView option on SDK 57 and the natural
one on SDK 58; (ii) Route C needs nothing but the Viro ARCore de-dup.

---

### Resolved classpath note (this repo, `./gradlew buildEnvironment`, 2026-09-14)
`expo.modules:expo-module-gradle-plugin → com.facebook.react:react-native-gradle-plugin → org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20`
and `… → com.android.tools.build:gradle:8.12.0`; the root's versionless entry reports
`+--- com.android.tools.build:gradle -> 8.12.0 (*)`. The RN plugin's `libs.versions.toml` (`agp = "8.12.0"`,
`kotlin = "2.1.20"`) is the only source of both versions — nothing in Expo pins AGP or KGP.

### Sources
- Expo docs v57 build-properties: https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/
- Expo SDK 57 changelog: https://expo.dev/changelog/sdk-57 ; expo/expo#49550: https://github.com/expo/expo/issues/49550
- Expo sources (sdk-57 / sdk-58): `packages/expo-build-properties/src/{pluginConfig,android}.ts`, `packages/expo-modules-autolinking/android/expo-gradle-plugin/**/{ExpoRootProjectPlugin,KSPLookup,ExpoAutolinkingSettingsExtension}.kt`, `packages/expo-modules-core/CHANGELOG.md`, `templates/expo-template-bare-minimum/android/gradle.properties` (https://github.com/expo/expo)
- RN catalogs: https://raw.githubusercontent.com/facebook/react-native/{v0.86.3,v0.87.1,v0.88.0-rc.0}/packages/react-native/gradle/libs.versions.toml ; templates https://github.com/react-native-community/template ({0.86,0.87}-stable) ; blog https://reactnative.dev/blog/2026/08/11/react-native-0.87
- AGP: https://developer.android.com/build/releases/gradle-plugin and per-version pages (8-13-0, 9-0-0, 9-1-0, 9-2-0, 9-3-0) ; built-in Kotlin: https://developer.android.com/build/migrate-to-built-in-kotlin
- Kotlin: https://kotlinlang.org/docs/releases.html , https://kotlinlang.org/docs/gradle-configure-project.html , https://kotlinlang.org/docs/kotlin-evolution-principles.html , https://github.com/JetBrains/kotlin/releases
- Compose: https://developer.android.com/develop/ui/compose/compiler , https://developer.android.com/jetpack/androidx/releases/compose-kotlin , https://developer.android.com/jetpack/androidx/releases/compose-runtime
- Android 17: https://android-developers.googleblog.com/2026/06/Android-17.html , https://developer.android.com/about/versions/17/release-notes , https://apilevels.com/
- SceneView: https://github.com/sceneview/sceneview (README, releases, `gradle/libs.versions.toml`), https://repo1.maven.org/maven2/io/github/sceneview/{arsceneview,sceneview}/<v>/ (POM, .module, AAR)
- ARCore: https://dl.google.com/dl/android/maven2/com/google/ar/core/ (maven-metadata, 1.56.0 POM/AAR), https://github.com/google-ar/arcore-android-sdk/releases , samples/hello_ar_kotlin build files, https://developers.google.com/ar/develop/java/quickstart
- KSP: https://github.com/google/ksp/releases , https://repo1.maven.org/maven2/com/google/devtools/ksp/symbol-processing-gradle-plugin/maven-metadata.xml
- Local: `android/{build.gradle,settings.gradle,gradle.properties,gradle/wrapper/gradle-wrapper.properties,app/build.gradle}`, `node_modules/react-native/gradle/libs.versions.toml`, `node_modules/@reactvision/react-viro/android/*/build.gradle`, `./gradlew buildEnvironment` output.
