# Release artefacts

Built packages land here, and only the files in this folder are ever uploaded as
release assets:

    dist/tommys-hermes-acp-<version>.vsix

`npm run package` writes here. Everything except this README is gitignored, so a
built package can never be mistaken for source, and the folder can be emptied
without consequence.

Why the rule: 2.1.0 was published as a release with no asset attached, and 2.1.1
shipped a secondant bundle that still called itself 2.1.0. Neither is possible when
the only place a release file can come from is one folder with one name.
