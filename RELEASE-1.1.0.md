# Dryad 1.1.0

This release adds a dark Windows launcher with browser approval status, account
and overlay-control shortcuts, and automatic signed package updates. The native
overlay controls also use the dark purple design.

Developer mode is controlled only through an explicit `developerMode=1` or
`developerMode=0` in the adjacent `PlayOverlay.ini`. No default entry is generated.
The injector checkbox, `--developer` option and remote developer override were
removed. Restart the game after changing this config setting.

The launcher checks stable updates after sign-in and every fifteen minutes.
It verifies the pinned signed manifest and package size/hash, stages the three
binaries, waits for the game/injector to close, and restarts after replacement.
Failed replacement/restart attempts restore the previous binaries. Configuration
and account state are preserved. Install in a writable folder.

Backend native manifest requests now support `artifact: "package"`. Existing DLL
requests remain compatible. Package downloads retain device/membership checks,
sixty-second single-use tokens, and enabled catalog/package binding.

The stable manifest includes the protected DLL and full Windows x64 package. The
production public pin is unchanged; no signing-key or database-schema migration
is required. Startup verifies package integrity and backs up the database before
catalog activation through the existing release activation workflow.

Users on 1.0.0 need to download 1.1.0 once from Account → Downloads. Existing
1.0.0 launchers do not have a package self-updater. Future automatic releases must
increase the version. Restart the game before loading a new overlay DLL.

Validation: 22 backend regressions; separate packaged launcher/native license
integration; updater hash/size/origin, archive handling, file-lock deferral,
rollback, replacement/restart and config preservation; ConfigTest and
MenuInputTest. Production builds and isolated activation of the actual package
passed. Visual QA and real-game update acceptance remain incomplete.
