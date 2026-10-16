# devpreview-companion

Development-only script that lets the Harness Studio **Browser pane** pick elements in your running app.

## Add it to your app (development only)

Plain HTML / any framework — load it only in development:

```html
<script src="/devpreview-companion.js"></script>
```

Next.js (App Router) — copy `companion.js` to `public/devpreview-companion.js` and add to `app/layout.tsx`:

```tsx
import Script from 'next/script'

{process.env.NODE_ENV === 'development' && (
  <Script src="/devpreview-companion.js" strategy="afterInteractive" />
)}
```

Never ship it to production.

Next.js only serves its development scripts to `localhost` by default. If you open the dev server as `127.0.0.1` (or a LAN address), add it to `allowedDevOrigins` in `next.config.ts`, otherwise the page never hydrates and the companion never starts.

## What it sends

When you click an element in pick mode: tag, CSS selector, id/classes, visible text, size and position, key computed styles, trimmed `outerHTML`, React component names (from React's dev fibers), and the nearest `data-src` source location if your build stamps one (see [devpreview-source-loader](../devpreview-source-loader)).

## Protocol

| Direction | Message |
|---|---|
| Browser pane → page | `{ source: 'harness-studio-devpreview', type: 'hello' \| 'pick:on' \| 'pick:off' }` |
| page → Browser pane | `{ source: 'harness-studio-companion', version, type: 'ready' \| 'pick:state' \| 'pick:cancelled' \| 'selection', … }` |

- In an iframe (Harness Web) messages use `postMessage`. The page only obeys its parent window, and only when that parent is on a Harness origin: `dsh-app://app`, `http://localhost:3080` or `http://127.0.0.1:3080`. If you open Harness Web on another origin, list it (space-separated) in the script tag: `<script src="/devpreview-companion.js" data-harness-origins="https://harness.example.test"></script>`. The page says nothing until such a parent sends `hello`, then replies only to that origin and never posts to `'*'`, so a third-party site that frames your dev app can't turn pick mode on or receive picked HTML.
- As a top-level page (Harness Desktop `<webview>`) the Browser pane calls `window.__hsDevPreview.command(msg)` and reads replies from console messages prefixed `__HS_DEVPREVIEW__`.
- Harness treats everything the page sends as untrusted: it accepts a selection only right after you turn pick mode on, validates and trims it, and tells the agent the element's text, HTML, component names and source location came from the page.
