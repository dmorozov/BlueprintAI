# BlueprintAI

Cross-platform mobile app built with **React Native**, **Expo SDK 57**, and **TypeScript** (strict mode). One codebase targets Android and iOS (web works too, for quick iteration).

## Stack

| Layer           | Choice                          | Notes                                                                                                                                                                                 |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework       | React Native 0.86 + Expo SDK 57 | [Expo](https://expo.dev) is the officially recommended way to start a new RN app; autolinking handles native modules, and EAS Build produces store-ready artifacts for both platforms |
| Language        | TypeScript 6 (strict)           | `pnpm typecheck` runs `tsc --noEmit`; extra safety flags on top of `strict`, see [TypeScript and linting](#typescript-and-linting)                                                    |
| Linting         | ESLint + eslint-config-expo     | Flat config with the recommended Expo/React Native ruleset, Prettier integrated via `eslint-plugin-prettier`; `pnpm lint`                                                             |
| Formatting      | Prettier                        | Minimal `.prettierrc` on top of defaults; format-on-save in VS Code; `pnpm format` / `pnpm format:check`                                                                              |
| Navigation      | expo-router                     | File-based routing under `src/app/`; typed routes enabled                                                                                                                             |
| Package manager | pnpm                            | Lockfile committed; use a single package manager per project                                                                                                                          |

SDK 57 targets: Android 7+ (compileSdk/targetSdk 36), iOS 16.4+ (Xcode 26.4+), Node.js ≥ 22.13.

## Getting started

```bash
pnpm install
pnpm start        # Expo dev server; press i / a / w for iOS, Android, or web
```

The first `expo` run generates `expo-env.d.ts` (gitignored) with type declarations for assets/CSS — needed by `pnpm typecheck`.

### Scripts

| Script                                   | Purpose                               |
| ---------------------------------------- | ------------------------------------- |
| `pnpm start`                             | Start the Expo/Metro dev server       |
| `pnpm ios` / `pnpm android` / `pnpm web` | Run on simulator/emulator/browser     |
| `pnpm typecheck`                         | TypeScript check (`tsc --noEmit`)     |
| `pnpm lint`                              | ESLint via `expo lint`                |
| `pnpm format` / `pnpm format:check`      | Format with Prettier (write / verify) |

### TypeScript and linting

- **TypeScript** — `tsconfig.json` extends `expo/tsconfig.base` with `strict` plus extra safety flags: `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`. Component props, theme tokens, and hooks are explicitly typed (named interfaces/unions in `src/constants/theme.ts`), so typos in token or variant names fail at compile time.
- **ESLint** — `eslint.config.js` (flat config) extends [`eslint-config-expo`](https://docs.expo.dev/guides/using-eslint/), the recommended Expo/React Native ruleset, including the React Compiler-era hooks rules (`react-hooks/refs`, `react-hooks/set-state-in-effect`). Run `pnpm lint`; for diagnostics while editing, install the [ESLint VS Code extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint).
- **Prettier** — `.prettierrc` customizes only what the codebase needs (`singleQuote: true`); everything else follows [Prettier defaults](https://prettier.io/docs/en/options.html). It is wired into ESLint via `eslint-plugin-prettier/recommended`, so `pnpm lint` also fails on formatting drift. VS Code formats on save with the Prettier extension (see `.vscode/`).

## Project structure

```
src/
  app/                  # expo-router routes — thin files, navigation wiring only
    _layout.tsx         # Root layout: theme provider, Stack navigator, splash handling
    index.tsx           # Home route → renders HomeScreen
  screens/              # Screen components (UI + local state)
    home-screen.tsx     # Home page with the "Test" button
  components/           # Reusable UI
    toast-bubble.tsx    # Notification bubble ("toast"), pure React Native
    themed-text.tsx     # Theme-aware text primitives
    themed-view.tsx
  constants/            # Design tokens
    theme.ts            # Colors (light/dark), fonts, spacing
  hooks/                # Shared hooks
    use-theme.ts        # Resolves light/dark palette
    use-color-scheme(.web).ts
assets/                 # App icons, splash, adaptive-icon sources
app.json                # Expo config: name, slug, scheme, icons, plugins
```

### Conventions

- **Routes stay thin.** Files in `src/app/` only wire navigation; all UI lives in `src/screens/`, reusable pieces in `src/components/`. Add a new screen by adding a route file + a screen component.
- **kebab-case** file names; components use named exports.
- Import app code via the `@/*` path alias (maps to `src/*`).
- No hardcoded colors in components — use tokens from `src/constants/theme.ts`.
- Native folders (`/ios`, `/android`) are **generated** by Expo on first build and gitignored; see below before making manual native changes.

## The home page

The single home screen shows the app title and a **Test** button. Tapping it shows a notification bubble with the text **"Test clicked!"** — implemented as `ToastBubble`, a pure React Native component (spring in, auto-dismiss after 2 s) so it behaves identically on Android, iOS, and web without any native dependency.

## Photo assist (self-hosted, optional)

For rooms that can't be walked in AR, an optional photo-based path runs **MoGe-2**
(MIT) on **your own GPU** to propose candidate walls — no third-party API is ever
called. It lives outside the app in [`services/photo-assist/`](services/photo-assist/README.md)
(FastAPI + Dockerfile + CPU-only tests). The app feature is feature-flagged and hidden
until you point it at your service:

```bash
EXPO_PUBLIC_PHOTO_ASSIST_URL=http://192.168.1.42:8734   # .env, then rebuild/restart
```

Suggested walls are capped at `confidence ≤ 0.5`, labeled "auto-detected — verify", and
each assisted room gets its own frame id, so it joins the combined blueprint through the
align editor — never by auto-merge. See the service README for assumptions (level
camera, per-photo frames) and deployment.

## Building native apps

### Local builds (CNG — Continuous Native Generation)

Expo generates the native projects on demand: the first `pnpm ios` or `pnpm android` runs prebuild and creates `/ios` and `/android`.

- **iOS:** macOS with Xcode 26.4+; `pnpm ios` builds into the simulator (or a connected device).
- **Android:** Android Studio + Android SDK 36; `pnpm android` builds into an emulator or USB device.

If you later need hand-edited native code, make the edits in `/ios`/`/android` and stop re-running prebuild over them (or move changes into config plugins).

### Troubleshooting: "Cannot find native module" / Viro errors at startup

If the log shows `Cannot find native module 'ExpoMediaLibraryNext'`,
`ViroMaterials: MaterialManager ... is not available!`, or route warnings like
`Route "./ar-capture.tsx" is missing the required default export`, the installed app
predates the current set of native dependencies — or you are running **Expo Go**, which
never includes ViroReact. Rebuild the development client:

```bash
pnpm android    # re-runs prebuild and installs a fresh build on the connected device
```

Until then the app still starts: the AR route loads lazily and shows an explanatory
message instead of crashing, and "Save image to gallery" reports that it is unavailable
in this build. The photo-assist plugin in `app.json` also registers the Android media
permissions a fresh build needs for gallery saving.

### EAS Build (CI / store-ready artifacts)

```bash
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform ios --profile production    # .ipa
pnpm dlx eas-cli build --platform android --profile production # .aab
```

Requires an [EAS](https://expo.dev/eas) account and the usual Apple/Google signing credentials. EAS also handles `eas submit` for store uploads and `eas update` for JS-only over-the-air updates.

## Learn more

- [Expo documentation (SDK 57)](https://docs.expo.dev/versions/v57.0.0/)
- [expo-router](https://docs.expo.dev/router/introduction)
- [React Native docs](https://reactnative.dev/docs/getting-started)
