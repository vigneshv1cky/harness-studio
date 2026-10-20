# Notice for the Harness patches

Harness Studio now builds from its fork of Harness, [harness-studio-core](https://github.com/vigneshv1cky/harness-studio-core), whose `studio` branch holds these changes as commits. The patch files here and in [`desktop/patches`](../desktop/patches) are kept as a fallback until the first release built from the fork.

`harness-studio-brand.patch`, `harness-studio-account.patch`, `harness-browser-pane.patch` and the patches in [`desktop/patches`](../desktop/patches) modify source files of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and carry lines of that source as patch context. Those lines are covered by DeepSeek Harness's licence:

```
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The changes themselves are part of Harness Studio and released under the repository's [MIT licence](../LICENSE).

## The patch is opt-in

Apply it only if you want Google (and other) sign-ins inside the Browser pane. Know the trade-offs first:

- **Sign-in rules:** it gives the pane an identity that Google's sign-in accepts. Google's policies discourage signing in from embedded browsers, so Google may change its checks at any time, and you use it at your own risk. Signed-in browsing also works without the patch, in your own Chrome through the [Chrome bridge](../chrome-bridge).
- **Shared browser storage:** upstream Harness gives each workspace its own browser storage that is forgotten when the app quits. The patch replaces that with one store kept on disk and shared by all workspaces, so a sign-in made in one workspace is visible to the pages opened in every other.
- **Passkeys** do not work in the pane; at "Complete sign-in using your passkey", choose "Try another way".
