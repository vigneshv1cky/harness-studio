# Desktop and mobile apps

Build, run and check desktop and mobile apps from Harness Studio. Commands run in a sandbox that can write only inside the workspace, so every tool that normally writes to the home folder must be pointed into the project. Doing that from the start avoids failed builds and needless requests for full access.

## Before building

1. Find out what is installed, in one command: the platform, Xcode (`xcode-select -p`; a path ending in CommandLineTools means only the command-line tools), Swift, a JDK (`/usr/libexec/java_home -V` on macOS, or Android Studio's own at `/Applications/Android Studio.app/Contents/jbr`), the Android SDK (`~/Library/Android/sdk` on macOS, `~/Android/Sdk` on Linux, or `$ANDROID_HOME`), and Node, Rust or Flutter when the project needs them.
2. Say plainly what cannot be done here and stop on that part:
   - iPhone and iPad apps need full Xcode, which only the user can install (it needs their Apple account). Never try to install Xcode or sign in to Apple's sites.
   - macOS and iOS apps cannot be built on Linux at all.
   - Computer use (seeing and clicking app windows) is macOS only.
3. Large downloads (an Android emulator, Gradle, SDK parts, Electron) go inside the project. Name what will be downloaded and roughly how big before starting, and add those folders to `.gitignore`.

## Keep every tool's files inside the project

| Toolchain | Do this |
|---|---|
| Swift packages | `swift build --disable-sandbox --cache-path .build/cache --config-path .build/config --security-path .build/security`, with `CLANG_MODULE_CACHE_PATH=$PWD/.build/modulecache`. SwiftPM's own sandbox cannot start inside this one and fails with a misleading "Invalid manifest" error. |
| Xcode projects | `xcodebuild ... -derivedDataPath build/DerivedData -clonedSourcePackagesDirPath build/SourcePackages`, plus `CLANG_MODULE_CACHE_PATH` as above. |
| Gradle and Android | `export GRADLE_USER_HOME=$PWD/.gradle-home ANDROID_USER_HOME=$PWD/.android ANDROID_AVD_HOME=$PWD/.android/avd` and pass `-Duser.home=$PWD/.home` (the debug signing key is created under the user's home). |
| npm, pnpm, Electron | `npm_config_cache=$PWD/.npm-cache`; `ELECTRON_CACHE=$PWD/.electron-cache`. |
| Rust and Tauri | `CARGO_HOME=$PWD/.cargo-home` when crates must be fetched. |

Ask for full access only when no setting like these exists, and never just to repeat a build that already succeeded.

## Run and check the app

- **macOS apps:** launch the built app or executable in the background, then use computer use: select it (the user approves access once per task on a card in the chat), bring its window forward (a bare executable's window can start off-screen), read the window's state, click and type, and confirm the result from the state or a screenshot. Quit it with ⌘Q afterwards and confirm the process is gone. Computer use cannot work while the Mac's screen is locked: say so, leave the visual check undone, and do not try other routes such as AppleScript UI scripting, which macOS refuses here.
- **Android:** run the emulator headless (`emulator -avd <name> -no-window -no-audio`), install with `adb install -r`, launch the activity, act with `adb shell input tap/text`, and check with `adb shell uiautomator dump` and `adb exec-out screencap -p > screen.png` (read the image). Stop it with `adb emu kill`. If the installed emulator crashes on a newer macOS, download Google's current emulator into the project. If the SDK's old command-line tools need Java 8, use an installed JDK 8 or the current command-line tools.
- **iOS (with Xcode):** `xcrun simctl` to boot a simulator, install and launch the app; check with `xcrun simctl io booted screenshot` or computer use on the Simulator app.
- **Linux desktop apps:** they build and run, but their windows cannot be seen; check behaviour through logs, tests or the app's own output.
- **Web-based apps** (Electron or Tauri front ends, React Native or Expo web, Flutter web): also check the web build in the Browser pane at phone, tablet and desktop widths.

## Finish

Report what was built and where, how it was checked, each workaround used, and how much the downloaded tools take up, offering to delete them.
