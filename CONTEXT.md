# BlueprintAI

BlueprintAI turns a physical room into a measured 2D floor plan, on-device, with real metric dimensions.

## Language

**Measurement path**:
How a room's floor plan was produced: _AR tap-to-trace_, _photo assist_, or _mock_.
_Avoid_: provider, mode, generation method

**AR tap-to-trace**:
The measurement path where the user taps each wall corner and each door/window on a live AR view; wall lengths come from the tapped real-world positions.
_Avoid_: AR measure, AR capture (as a path name), AR scan

**Photo assist**:
The measurement path where a self-hosted service proposes candidate walls from photos and the user confirms which to keep.
_Avoid_: photo analysis, AI assist, cloud assist

**AR engine**:
The native component that supplies the live camera background, world tracking, tracking state, and hit-tests to AR tap-to-trace.
_Avoid_: AR library, scene, Viro (as a concept — Viro is one engine)

**Dead session**:
An AR session that mounted but never reported any tracking state, leaving a black camera view with no way forward.
_Avoid_: dead camera, black camera, stalled session, tracking lost (that is a reported state, not a dead one)
