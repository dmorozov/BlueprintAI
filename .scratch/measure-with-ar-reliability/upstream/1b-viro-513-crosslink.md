<!--
DRAFT (ticket 06) — post as a short comment on https://github.com/ReactVision/viro/issues/513
after draft 1 is posted on #499 (replace <link> with that comment's URL).
-->

Same symptom on a Galaxy S22 Ultra / Android 16 / Expo 57. In our case the cause was app-side: a `<ViroARScene>` rendered without a `<ViroARSceneNavigator>` creates no AR session. Details, logcat, and a quick check (look for `=== onAttachedToWindow START ===` and `AR session resumed`): <link>
