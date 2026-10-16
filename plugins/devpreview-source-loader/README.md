# devpreview-source-loader

Development-only loader that stamps `data-src="path:line:col"` on JSX host elements, so the Harness Studio Browser pane can tell the agent exactly where a clicked element is written.

React 19 removed the fiber `_debugSource` field, so the location has to be added at build time.

## Next.js (Turbopack, Next 16+)

```ts
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      '*.{jsx,tsx}': {
        condition: { all: ['development', { not: 'foreign' }] },
        loaders: [{ loader: 'devpreview-source-loader', options: { root: process.cwd() } }],
        as: '*.tsx',
      },
    },
  },
}

export default nextConfig
```

Install it as a dev dependency. It only runs under `next dev` and never on `node_modules`.

## Output

```tsx
<button className="btn">Save</button>
// becomes, in development only:
<button data-src={"src/app/page.tsx:12:7"} className="btn">Save</button>
```

The value is written as a JSX expression holding a JSON string, so a path with quotes or braces cannot break the markup. Server and browser renders get identical attributes, so hydration is unaffected.

Lines never change: the attribute is inserted on the tag's own line. When an earlier loader passes a source map, it is carried through with its columns shifted past the inserted text, so stack traces and devtools still point at your original source; without one, the loader's own map is returned.
