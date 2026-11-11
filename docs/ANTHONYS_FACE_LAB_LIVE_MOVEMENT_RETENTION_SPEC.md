# Live liveness movement score amendment - 2026-11-04

Status: **Superseded for the live meter.** The 50/50 buckets and 15-second reset below are no longer the live display. Detected movement now sets one calculated score, and that score changes only when a later movement calculates a different amount. Capture proof is unchanged. See the [parent acceptance audit](ANTHONYS_FACE_LAB_MOVEMENT_AND_PHYSICAL_EVALUATION_CHECKLIST.md) for the earlier verification.

This amendment supersedes the live meter display/retention rules in ANTHONYS_FACE_LAB_LIVENESS_METER_SPEC.md. It does not reinterpret historical capture proof or lower enrollment checks.

User-confirmed behavior:

- Blink OR supported non-eye facial movement contributes a shared maximum 50 points. Blinking plus facial expression cannot double-count this bucket.
- Head rotation contributes up to the other 50 points. Translation/box movement alone does not count.
- Each track retains its highest credited contributions while usable motion continues. Temporary quality or phase resets cannot reduce the displayed score for the same continuous face.
- Every qualified movement refreshes the track's inactivity timer, including movements in an already-full bucket and after enrollment checks have passed.
- At 15,000 ms with no qualified movement, reset live movement contributions to 0. Valid stationary observations do not refresh the timer. Detecting a continuing held pose/expression does not count as new movement.
- Face loss/ambiguity, stopped camera, stale analysis, worker replacement and a new enrollment operation retain existing continuity safeguards; evidence cannot transfer to another face.
- Completed enrollment checks remain ready after an idle live-score reset. Sealed reviews, attempts, templates and retry proof remain unchanged. Live movement percentage is transient feedback, separate from the immutable accepted capture evidence and explicit prompted challenge.

Implementation:

- Add a deterministic bounded per-track activity reducer and versioned `live-movement-v1` display policy (50/50, 15,000 ms). Keep capture reducer, `motion-evidence-v1` proof rules/weights and validators intact. Expose separate activity metadata on meter snapshots; UI reads this live score, while internal score/accepted proof retains its original meaning. Do not inflate or rewrite acceptedScore.
- Credit blink/facial motion only from usable finite fresh exclusive observations (observed blink transition or expression coefficient change supported by normalized nonrigid geometry). Retain existing jitter/box/rigid-transform protections. Use yaw/pitch rotation for head motion; ignore subthreshold jitter and repeated constant values. Record component scores and lastMovementAt; bound all history. Do not earn percentage from merely establishing a neutral baseline.
- Continue independent activity observation for confirmed Scan and completed-but-visible Enroll tracks. A terminal review's sealed proof must never be mutated; live feed activity must not freeze on a saved session snapshot. Fresh operations start fresh live activity and proof. Losing one track does not reset others.
- Tick idle time from the existing scheduler/stale cadence using the same monotonic camera clock, not synthetic frames or wall-clock timestamps. Ignore duplicate/out-of-order samples. Quality pauses retain contributions before the idle boundary; unavailable/invalidated feeds must not show an invented active percentage.
- MUI meter/overlay/card/list shows separate live movement score and completed-check state. Preserve the Liveness evidence accessible label/legacy snapshot fallback, 5 Hz maximum updates, transition-only announcements, face association and mobile bounds. Add concise Face/blink x/50 and Head y/50 breakdown in detailed presentation; keep overlays compact. Idle 0 must not look like an enrollment failure or disable already-completed capture readiness. No instructions on Scan.
- Read-only settings explanation and docs distinguish live movement from recorded enrollment evidence. No schema/storage-policy/model/dependency changes. No camera/frames/landmarks persisted by this amendment.

QA:

Independent tracks, blink-only/facial-only max 50, head max 50, total 100, no baseline/jitter/rigid motion credit, active nondecreasing score, refreshed timer for movements in full buckets, constant-pose inactivity, 14,999/15,000 ms boundary, repeated resets/recovery, accepted proof byte-for-byte unchanged, quality pauses, loss/reused IDs, post-save/guided retry, confirmed Scan with no repeat SFace, desktop/mobile bounds and accessible throttling. Run relevant and full unit/browser suites, formatting and production build. The [physical-camera evaluation workflow](ANTHONYS_FACE_LAB_PHYSICAL_CAMERA_EVALUATION_SPEC.md) is implemented in the same authorized scope; its real-camera measurements remain operator work. Fixtures do not establish attack resistance.
