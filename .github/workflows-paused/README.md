# Paused workflows

GitHub runs only the workflows in `.github/workflows`, so the files here never run. The Windows build
(`build-windows.yml`) and its smoke-test rerun (`smoke-windows.yml`) were paused on 2026-10-17: Windows
packaging takes 35–40 minutes per build, and downloads are for macOS and Linux for now.

To bring Windows back, move both files back unchanged:

```sh
git mv .github/workflows-paused/build-windows.yml .github/workflows-paused/smoke-windows.yml .github/workflows/
```

`desktop/build-windows.sh`, `desktop/smoke-windows.sh`, the Windows patches and the Windows icons are kept as they were.
