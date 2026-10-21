// Harness Studio · Compact theme (client only, no build step).
// Moves Harness toward a Claude-like feel: denser spacing (smaller type, shorter rows,
// a slimmer composer, compact sidebar cards), then serif replies and calmer chrome in Harness's own colours.
//


// Harness styles use CSS-module class names such as `gBsEha_panelRow`; the prefix changes
// between builds, so every rule matches the stable local name after the underscore.
window.__ModuleLoader__.load({
  id: '@harness-studio/compact',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    /** Selector for a CSS-module local name, matching any build hash: `x_name` exactly. */
    const c = name => `:is([class$="_${name}"],[class*="_${name} "])`
    /** Selector for a `_name_hash_line` class (the right sidebar's naming), and the same inside that pane. */
    const m = name => `[class*="_${name}_"]`
    const p = name => `${m('tabCell')} ${m(name)}`
    /** A chat item that is on screen. The steps folded under "Completed in …" stay in the page as hidden
     *  (`hidden="until-found"`, zero height) or empty items that Harness leaves out of its spacing; a margin
     *  on each of those would stack into a blank gap above the reply. */
    const shownItem = `${c('flowItem')}:not([hidden]):not(:empty):not(:has(> [data-slot="conversation.chat.node"]:empty))`

    // [selector, declarations]
    const RULES = [
      // ---- type ------------------------------------------------------------------------
      ['body', 'font-size: 14px'],
      // While a sidebar or right-panel edge is being dragged, nothing on the page gets selected by the same drag.
      ['body:has([data-side][data-dragging]), body:has([data-side][data-dragging]) *', 'user-select: none !important; -webkit-user-select: none !important'],

      // ---- conversation header -----------------------------------------------------------
      [c('crumb'), 'padding: 2px 6px !important; border-radius: 6px !important'],
      // Chat / Trajectory tabs, compact: smaller and closer together, closer under the title row, with
      // the header no taller than its content.
      ['header:has([data-conversation-tabs])', 'min-height: 0 !important'],
      ['[data-conversation-tabs]', 'gap: 20px !important; margin-top: 4px !important'],
      [`[data-conversation-tabs] ${c('tab')}`, 'padding-bottom: 7px !important; font-size: 12.5px !important; line-height: 15px !important'],
      // The active tab's bar sits on the header's own bottom edge rather than 1px below it, over the chat.
      [`[data-conversation-tabs] ${c('tab')}::after`, 'bottom: 0 !important'],
      // Chat text scrolled up to the header fades out over its last 12px instead of running into the line.
      [c('scrollBody'), 'mask-image: linear-gradient(to bottom, transparent 0, #000 12px) !important; -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 12px) !important'],

      // ---- conversation body -------------------------------------------------------------
      [c('scroll'), 'padding-top: 8px !important'],
      [shownItem, 'margin-top: 10px !important'],
      // Your message's time, copy and rewind buttons sit in a small row under the bubble, right-aligned as in Claude,
      // kept in the flow (20px tall) so they never float over the reply below.
      // A grid: the bubble across the top, then the Read tick (when there is one) left of the time and buttons.
      [c('userRow'), 'display: grid !important; grid-template-columns: 1fr auto !important; column-gap: 8px !important; row-gap: 6px !important; justify-items: end !important; align-items: center !important'],
      [`${c('userRow')} > ${c('userStack')}`, 'grid-column: 1 / -1 !important; grid-row: 1 !important; min-width: 0 !important; max-width: 100% !important'],
      [`${c('userRow')} > .hs-read-state`, 'grid-column: 1 !important; grid-row: 2 !important; margin: 0 !important'],
      [`${c('userRow')} > ${c('actions')}`, 'grid-column: 2 !important; grid-row: 2 !important; flex: none !important; margin: 0 !important; height: 22px !important; gap: 6px !important; align-items: center !important; font-size: 11px !important'],
      [`${c('userRow')} ${c('timeStart')}`, 'padding-right: 2px !important; font-size: 11px !important; line-height: 22px !important'],
      [`${c('userRow')} > ${c('actions')} button`, 'width: auto !important; min-width: 22px !important; height: 22px !important; padding: 0 4px !important; border-radius: 6px !important'],
      [`${c('userRow')} > ${c('actions')} svg`, 'width: 14px !important; height: 14px !important'],
      // A reply's own action row (copy, branch, usage, time) sits close under the reply, at the same small size as
      // the row under your message.
      [`${shownItem}:has([data-slot="conversation.chat.turnTail"])`, 'margin-top: 2px !important'],
      [`${shownItem}:has([data-slot="conversation.chat.turnTail"]) ${c('actions')}`, 'gap: 6px !important; font-size: 11px !important; align-items: center !important'],
      [`${shownItem}:has([data-slot="conversation.chat.turnTail"]) ${c('actions')} button`, 'width: auto !important; min-width: 22px !important; height: 22px !important; padding: 0 4px !important; border-radius: 6px !important'],
      [`${shownItem}:has([data-slot="conversation.chat.turnTail"]) ${c('actions')} svg`, 'width: 14px !important; height: 14px !important'],
      ['[class*="_markdown_"]', 'line-height: 20px !important'],
      ['[class*="_markdown_"] p', 'margin: 0 0 10px !important'],
      ['[class*="_markdown_"] li', 'margin: 2px 0 !important'],
      ['[class*="_markdown_"] :is(ul,ol)', 'margin: 0 0 10px !important'],
      ['[class*="_markdown_"] pre', 'padding: 6px 14px 12px !important'],
      [c('bubble'), 'padding: 7px 12px !important; border-radius: 14px !important'],
      [`${c('card')}:has(${c('tile')})`, 'border-radius: 10px !important'],
      [c('tile'), 'width: 28px !important; height: 28px !important; border-radius: 7px !important'],
      [`${c('card')} ${c('header')}`, 'padding: 6px 10px !important'],

      // ---- composer ----------------------------------------------------------------------
      [`${c('composerSeat')} ${c('card')}`, 'border-radius: 14px !important; padding-top: 0 !important; gap: 0 !important'],
      // The box keeps Harness's two rows: the text on top, and under it the + button, the access mode menu, the model
      // menu and send. The + is a plain icon until pointed at; the mode and model labels a little smaller.
      // The text starts in line with the + button below it (Harness indents it 54px).
      [`${c('composerSeat')} ${c('card')} > ${c('scroll')}`, 'padding-left: 4px !important; padding-right: 16px !important'],
      [`${c('composerSeat')} ${c('input')}`, 'padding-left: 10px !important'],
      [`${c('composerSeat')} ${c('add')}`, 'background: transparent !important; color: var(--dsw-alias-label-secondary) !important'],
      [`${c('composerSeat')} ${c('add')}:hover`, 'background: var(--dsw-alias-interactive-bg-hover) !important; color: var(--dsw-alias-label-primary) !important'],
      [`${c('composerSeat')} ${c('row')} ${c('trigger')}, ${c('composerSeat')} ${c('row')} ${c('trigger')} *`, 'font-size: 12.5px !important'],
      // The usage line sits under the box, centred, 12px above the bottom. Only the composer's own dock
      // ([data-composer-dock]): Harness's queued-message panel and goal bar use the same class name and stay where Harness puts them.
      [`${c('composerSeat')} ${c('root')}:has(> ${c('card')})`, 'position: relative !important; padding-bottom: 48px !important; container: hs-composer / inline-size'],
      [`${c('composerSeat')} [data-composer-dock]`, 'position: absolute !important; left: 0 !important; right: 0 !important; bottom: 12px !important; height: 28px !important; ' +
        'display: flex !important; align-items: center !important; justify-content: center !important; padding: 0 !important; font-size: 11px !important; opacity: 0.8; pointer-events: none'],
      [`${c('composerSeat')} [data-composer-dock] > *`, 'pointer-events: auto'],
      // Quieter readings: no icons on the two text readings, and tighter pills.
      [`${c('composerSeat')} [data-composer-dock] [class*="_anchor"] svg`, 'display: none !important'],
      [`${c('composerSeat')} [data-composer-dock] [class*="_pill"]`, 'padding: 0 5px !important; gap: 0 !important'],
      [`${c('composerSeat')} [data-composer-dock] *`, 'font-size: 11px !important'],
      // The send (and stop) button, smaller, as in Claude Code desktop: a 24px circle with a 13px glyph.
      [`${c('composerSeat')} ${c('primary')}`, 'width: 24px !important; height: 24px !important; min-width: 24px !important; min-height: 24px !important; padding: 0 !important; margin: 0 !important; transform: none !important'],
      [`${c('composerSeat')} ${c('primary')} svg`, 'width: 13px !important; height: 13px !important'],

      // The composer's + menu (also its "/" and "@" lists): Harness stretches it across the whole
      // message box. Like Claude Code desktop's, it is a popover sized to its contents, anchored at the
      // left where the + button sits, with 28px rows and each description muted on the same line.
      ['[data-composer-overlay] [data-trigger-menu]', 'right: auto !important; width: max-content !important; min-width: 240px !important; max-width: min(420px, 100%) !important; border-radius: 12px !important'],
      // The list draws its own hairline ring with square corners over the rounded menu; the menu's
      // material already has that ring, so the list keeps only the rounding.
      [`[data-trigger-menu] ${c('viewport')}`, 'padding: 4px !important; border-radius: 12px !important; box-shadow: none !important'],
      [`[data-trigger-menu] ${c('sectionTitle')}`, 'height: auto !important; min-height: 0 !important; padding: 6px 8px 2px !important; font-size: 11px !important; line-height: 16px !important'],
      [`[data-trigger-menu] ${c('item')}`, 'height: 28px !important; min-height: 28px !important; padding: 0 8px !important; gap: 8px !important; border-radius: 7px !important; font-size: 13px !important'],
      [`[data-trigger-menu] ${c('itemName')}`, 'flex: none !important; white-space: nowrap !important'],
      // The question panel (the agent asking you to choose), with Claude Code desktop's measurements from its own
      // stylesheet: 12px between sections, choices 3px apart with 8px padding and 5px corners, 14px labels over a
      // 13px secondary description, buttons 8px apart at the bottom right. Scoped to the card that holds the
      // choices, since "card", "header" and "title" are common class names in Harness.
      ...(() => {
        const Q = `${c('card')}:has(${c('optionCopy')})`
        const ROW = `${Q} :is(${c('option')}, ${c('customRow')})`
        const ACCENT = 'var(--dsw-alias-button-info-fill)'
        return [
          [`${Q} ${c('header')}`, 'padding: 16px 12px 0 16px !important; gap: 12px !important'],
          [`${Q} ${c('eyebrow')}`, 'margin-bottom: 4px !important; font-size: 11.5px !important; line-height: 16px !important'],
          [`${Q} ${c('title')}`, 'font-size: 14px !important; line-height: 20px !important; font-weight: 600 !important'],
          // The explanation under the title lines up with it (Harness leaves it 2px from the card's edge).
          [`${Q} ${c('detail')}`, 'margin: 6px 16px 0 !important; font-size: 13px !important; line-height: 19px !important; color: var(--dsw-alias-label-secondary) !important; overflow-wrap: anywhere'],
          // The choices sit straight on the card, without a box or lines: rounded rows that tint on hover, the chosen
          // row in a light accent tint; the label over a smaller, lighter description; the number in a 24px chip at the
          // right that fills with the accent when chosen; the typed answer as the last row.
          [`${Q} ${c('options')}`, 'margin: 10px 8px 0 !important; padding: 0 !important; gap: 2px !important; border: none !important'],
          [ROW, 'min-height: 0 !important; margin: 0 !important; padding: 10px 10px 10px 8px !important; gap: 12px !important; border: none !important; border-radius: 8px !important; align-items: center !important; justify-content: space-between !important; background: transparent !important'],
          [`${Q} ${c('option')}:hover`, 'background: var(--dsw-alias-interactive-bg-hover) !important'],
          [`${Q} ${c('option')}[aria-checked="true"]`, `background: color-mix(in srgb, ${ACCENT} 10%, transparent) !important`],
          [`${Q} ${c('optionCopy')}`, 'order: 1; flex: 1 1 auto !important; min-width: 0 !important'],
          [`${Q} ${c('number')}`, 'order: 2; flex: none !important; width: 24px !important; height: 24px !important; margin: 0 0 0 16px !important; display: grid !important; place-items: center !important; ' +
            'font-size: 12px !important; line-height: 24px !important; border-radius: 5px !important; border: none !important; ' +
            'background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent) !important; color: var(--dsw-alias-label-secondary) !important'],
          [`${Q} ${c('option')}[aria-checked="true"] ${c('number')}`, `background: ${ACCENT} !important; color: #fff !important`],
          [`${Q} ${c('customRow')} ${c('number')}`, 'background: transparent !important; color: var(--dsw-alias-label-tertiary) !important'],
          [`${Q} ${c('customRow')} ${c('field')}`, 'order: 1; flex: 1 1 auto !important; min-width: 0 !important'],
          [`${Q} ${c('optionLine')}`, 'display: flex !important; flex-direction: column !important; align-items: flex-start !important; gap: 2px !important'],
          [`${Q} ${c('optionLabel')}`, 'font-size: 14px !important; line-height: 20px !important; color: var(--dsw-alias-label-primary) !important'],
          [`${Q} ${c('description')}`, 'margin: 0 !important; font-size: 12.5px !important; line-height: 17px !important; color: var(--dsw-alias-label-tertiary) !important'],
          [`${Q} ${c('badge')}`, 'font-size: 11px !important; line-height: 16px !important'],
          [`${Q} ${c('fieldInput')}, ${Q} ${c('fieldMirror')}, ${Q} ${c('field')} > *`, 'font-size: 14px !important; line-height: 20px !important'],
          [`${Q} ${c('footer')}`, 'margin-top: 16px !important; padding: 0 16px 16px !important; gap: 8px !important'],
          [`${Q} ${c('footer')} button:not(${c('iconButton')})`, 'height: 32px !important; min-height: 32px !important; padding: 0 12px !important; font-size: 13px !important; border-radius: 8px !important'],
          [`${Q} ${c('progress')}`, 'font-size: 12px !important; line-height: 20px !important'],
        ]
      })(),
      [`[data-trigger-menu] ${c('itemDescription')}`, 'flex: 1 1 auto !important; min-width: 0 !important; width: auto !important; margin-left: 4px !important; text-align: left !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; font-size: 12px !important; color: var(--dsw-alias-label-tertiary) !important'],

      // ---- right sidebar start page --------------------------------------------------------
      [c('guide'), 'padding: 0 12px !important; gap: 6px !important'],
      [`${c('guide')} ${c('entry')}`, 'padding: 8px 12px !important; border-radius: 10px !important; gap: 10px !important; min-height: 0 !important'],
      [`${c('guide')} ${c('entryCell')}`, 'min-height: 0 !important'],
    ]

    // ---- look: serif replies and calmer chrome, in Harness's own colours ---------------
    // Every colour below is one of the app's own tokens, so both themes and any future palette
    // change in Harness carry through untouched.
    // Claude Code desktop's conversation: a system-style sans at 15/22px (its own type scale pairs a
    // 15px prose size with a 22px line, and 13px code with a 19px line), ~16px between paragraphs,
    // in a centred column about 768px wide that the message box shares (a few px wider than the text).
    const CHAT_COLUMN = 768
    // The conversation's text face is the user's choice (Settings → Chat font), applied through one CSS
    // variable so a change takes effect at once. The default is the system font; every choice is drawn
    // with the platform's normal smoothing, since Harness's grayscale smoothing makes small text thin.
    const CHAT_TEXT = 'var(--hs-chat-font, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif)'
    // 14px on a 20px line, the Code tab's transcript text in Claude Code desktop (its stylesheet's --chat-body and
    // --chat-leading).
    const CHAT_TEXT_STYLE = `font-family: ${CHAT_TEXT} !important; font-size: 14px !important; line-height: 20px !important; ` +
      'font-weight: 400; -webkit-font-smoothing: auto !important; font-variant-ligatures: none'

    // Panels and popups that stand apart, like Claude Code desktop's: Harness draws menus 58% (light) and 45%
    // (dark) opaque with almost no shadow, so the page shows through them. Popups here are solid in both themes,
    // in the raised surface colour, with Claude's popover shadow; the side panes and message box carry its panel shadow.
    const LIGHT = 'body:not([data-ds-dark-theme])'
    const DARK = 'body[data-ds-dark-theme]'
    const POPUPS = ':is([class*="_material_"], [role="menu"], [role="listbox"], [class*="_dialog_"], [data-studio-menu])'
    const LAYER_RULES = [
      [LIGHT, '--dsw-specific-menu: #fff !important; --dsw-menu-surface-fill: #fff !important; ' +
        '--hs-popup-shadow: 0 0 0 0.5px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08); ' +
        '--hs-panel-shadow: 0 0 0 0.5px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.05)'],
      [DARK, '--dsw-specific-menu: var(--dsw-alias-bg-layer-3) !important; --dsw-menu-surface-fill: var(--dsw-alias-bg-layer-3) !important; ' +
        '--hs-popup-shadow: 0 0 0 0.5px rgba(255,255,255,0.12), 0 8px 24px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.2); ' +
        '--hs-panel-shadow: 0 0 0 0.5px rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.3)'],
      [POPUPS, 'box-shadow: var(--hs-popup-shadow) !important'],
      // No preview on hover over files in the chat: the diff preview of a changed-files card and the image preview of
      // an image link (both portalled to the page). Clicking still opens the file. The sidebar's hover cards are kept.
      // Its classes come in either naming form (`x_card` or `_card_hash_line`), so both are matched.
      [`body > :is(${c('card')}, ${m('card')}):is(${c('preview')}, ${c('media')}, ${m('preview')}, ${m('media')})`, 'display: none !important'],
    ]

    const TABLE = `${c('body')} [class*="_markdown_"]`
    // Every Markdown table in the app (the conversation, the Files tab, file previews) gets the same look.
    const ANY_TABLE = '[class*="_markdown_"]'
    // A fenced code block in any Markdown view: Harness's CodeBlock carries the stable md-code-block class.
    const CODE_BLOCK = '[class*="_markdown_"] .md-code-block'
    const TABLE_LINE = 'color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent)'
    const TABLE_FILL = 'color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent)'

    // Full pages (Plugins, Connectors, Automation tasks, Instructions, About, Git): their separator lines are drawn
    // from the border tokens, which at 4-16% of the text colour were too faint to read the page's structure. On these
    // pages the tokens are stronger, mixed from the text colour so every theme and both schemes follow.
    const FULL_PAGES = `${c('centerCol')}:not(:has(${c('composerSeat')})), .hg-page`
    const PAGE_LINES = ['--dsw-alias-border-l1: 8%', '--dsw-alias-border-l2: 16%', '--dsw-alias-border-l3: 20%', '--dsw-alias-border-l4: 24%']
      .map(entry => { const [name, amount] = entry.split(': '); return `${name}: color-mix(in srgb, var(--dsw-alias-label-primary) ${amount}, transparent)` }).join('; ')

    const LOOK_RULES = [
      ...LAYER_RULES,
      // ---- approval card, calm like Claude Code desktop's permission prompt ---------------------------
      // A neutral card with a hairline border (no orange frame or amber header), a small muted "Waiting for
      // approval" label, the question at 14px, and 28px buttons.
      ['[data-approval-key] > div:first-child', 'border: 0.5px solid var(--dsw-alias-border-l3) !important; border-radius: 12px !important; box-shadow: var(--hs-panel-shadow) !important'],
      [`[data-approval-key] ${c('strip')}`, 'background: transparent !important; color: var(--dsw-alias-label-tertiary) !important; padding: 12px 16px 0 !important; font-size: 12px !important; line-height: 16px !important; gap: 0 !important'],
      // The strip holds the status dot as its only element, then the label as plain text.
      [`[data-approval-key] ${c('strip')} > *`, 'display: none !important'],
      [`[data-approval-key] ${c('body')}`, 'padding: 4px 16px 0 !important; gap: 6px !important'],
      [`[data-approval-key] ${c('headline')}`, 'font-size: 14px !important; line-height: 20px !important; font-weight: 400 !important'],
      [`[data-approval-key] ${c('command')}`, 'font-size: 12.5px !important; line-height: 18px !important'],
      [`[data-approval-key] ${c('actionRow')}`, 'padding: 12px 16px !important; gap: 8px !important'],
      [`[data-approval-key] ${c('actionRow')} button`, 'height: 28px !important; min-height: 28px !important; padding: 0 12px !important; font-size: 13px !important; border-radius: 8px !important'],
      [FULL_PAGES, PAGE_LINES],
      // Harness's own full pages group their lists in bordered sections, like the Instructions page: the Plugins page's
      // cards and the Automation tasks list, rows divided inside.
      [`${c('page')}:has(> ${c('pageHead')}) ${c('cards')}, ${c('listRows')}`, 'border: 0.5px solid var(--dsw-alias-border-l2) !important; border-radius: 12px !important; padding: 0 12px !important; margin: 0 !important; list-style: none'],
      [`${c('page')}:has(> ${c('pageHead')}) ${c('cards')} > li, ${c('listRows')} > li`, 'margin: 0 !important; width: auto !important; border-radius: 0 !important'],
      [`${c('page')}:has(> ${c('pageHead')}) ${c('cards')} > li :is(${c('cardHead')}), ${c('listRows')} > li > button`, 'border-radius: 0 !important'],
      [`${c('page')}:has(> ${c('pageHead')}) ${c('cards')} > li + li, ${c('listRows')} > li + li`, 'border-top: 0.5px solid var(--dsw-alias-border-l2) !important'],
      // Under a colour theme the left sidebar takes the theme's sidebar colour, without Harness's blue-and-violet
      // gradient, which belongs to the default look.
      [`html[data-hs-color-theme]:not([data-hs-color-theme="default"]) ${c('sidebarCol')}`, 'background: var(--dsw-alias-bg-module-platform) !important'],
      // The left sidebar's scrollbar: Harness draws its thumb in #e5e5e5 on a sidebar of about #f5f7fa, which is
      // close to invisible in the light theme. Mixing it from the text colour keeps it a quiet grey in both
      // themes. Set on the sidebar itself and only while the pointer is over it, so Harness still hides the bar
      // when the pointer leaves.
      [`${c('root')}:has(> ${c('regionArea')}):not([class*="_quietBars"])`, '--dsh-scrollbar-thumb: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); ' +
        '--dsh-scrollbar-thumb-hover: color-mix(in srgb, var(--dsw-alias-label-primary) 38%, transparent)'],
      // The sidebar foot: About stacked under Settings (Harness lays the launcher seat out as a row).
      [`${c('triggerRow')}:has([data-studio-about])`, 'flex-direction: column !important; align-items: stretch !important; gap: 0 !important'],
      // ---- conversation typography and column, like Claude Code desktop ------------------------
      // Regular weight with the app's antialiased smoothing, as Claude Code desktop draws all its text.
      [`${c('body')} [class*="_markdown_"]`, `${CHAT_TEXT_STYLE}; letter-spacing: 0; color: var(--dsw-alias-label-primary) !important`],
      [`${c('body')} [class*="_markdown_"] :is(h1,h2,h3,h4)`, `font-family: ${CHAT_TEXT} !important; font-weight: 600 !important`],
      [`${c('body')} [class*="_markdown_"] :is(strong,b)`, 'font-weight: 600 !important'],
      [`${c('body')} [class*="_markdown_"] :is(pre,pre *)`, 'font-family: var(--dsw-font-markdown-code-font-family) !important; letter-spacing: 0'],
      // Paragraphs and lists 0.75em apart (10.5px), lines within a list item kept close, as in Claude's prose.
      [`${c('body')} [class*="_markdown_"] p`, 'margin: 0 0 10.5px !important'],
      [`${c('body')} [class*="_markdown_"] :is(ul,ol)`, 'margin: 0 0 10.5px !important'],
      [`${c('body')} [class*="_markdown_"] li`, 'margin: 3px 0 !important'],
      [`${c('body')} [class*="_markdown_"] > :last-child`, 'margin-bottom: 0 !important'],
      // Tables like Claude Code desktop's (measured from its rendering): 15px text on a 20px line, cells
      // padded 6px by 11px with the text at the top, columns sized to their content (Harness caps each
      // cell at 320px), a 1px rounded border and 1px row lines at 10% of the text colour, and a header
      // in the cells' weight on a 5% fill. Mixing from the text colour keeps both themes right.
      [`${ANY_TABLE} table`, 'border-collapse: separate !important; border-spacing: 0 !important; border-radius: 8px !important; ' +
        `border: 1px solid ${TABLE_LINE} !important`],
      [`${ANY_TABLE} :is(th,td)`, `font-family: ${CHAT_TEXT} !important; font-size: 13px !important; line-height: 20px !important; font-weight: 400 !important; ` +
        `color: var(--dsw-alias-label-primary) !important; padding: 6px 11px !important; vertical-align: top !important; text-align: left !important; ` +
        `max-width: none !important; border: none !important; border-bottom: 1px solid ${TABLE_LINE} !important`],
      [`${ANY_TABLE} tr:last-child td`, 'border-bottom: none !important'],
      // Claude keeps a table inside the text column and wraps its cells; Harness widens wide tables
      // past the column and scrolls them sideways. The table fills the column instead, and the wrapper
      // drops Harness's widening (it only scrolls if a single word cannot fit).
      [`${ANY_TABLE} [class*="_tableScroll_"] > table`, 'width: 100% !important; max-width: 100% !important; table-layout: auto !important'],
      [`${ANY_TABLE} .md-table-wide`, 'width: 100% !important; margin-left: 0 !important; padding-left: 0 !important; padding-bottom: 0 !important; overflow-x: auto !important'],
      [`${ANY_TABLE} [class*="_tableScroll_"]`, 'margin: 12px 0 16px !important'],
      [`${ANY_TABLE} th`, `background: ${TABLE_FILL} !important`],
      [`${ANY_TABLE} tr:first-child th:first-child`, 'border-top-left-radius: 7px !important'],
      [`${ANY_TABLE} tr:first-child th:last-child`, 'border-top-right-radius: 7px !important'],
      [`${ANY_TABLE} :is(th,td) code`, 'font-size: 13px !important'],
      // Plain inline code flows as text, like Claude's: Harness makes each chip one inline-flex box,
      // so a path that wraps becomes a two-line block filling the cell. Inline, every wrapped line
      // gets its own chip and the line spacing stays even. Chips holding an icon (file links) keep
      // Harness's layout.
      [`${TABLE} :not(pre) > code:not(:has(*))`, 'display: inline !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; ' +
        'padding: 1px 2px !important; overflow-wrap: anywhere'],
      // Code: Harness sets fenced blocks at 11px, well under the text around them; Claude uses 13/19px
      // for blocks and inline code alike.
      [`${c('body')} [class*="_markdown_"] pre, ${c('body')} [class*="_markdown_"] pre *`, 'font-size: 13px !important; line-height: 19px !important'],
      // Inline code as Claude Code desktop's code chip draws it in replies: the code font at 13px on a 1.4 line, a
      // soft chip (the text colour at 7.5%), 4px corners, 1px by 2px padding, no border, in the text colour.
      [`${c('body')} [class*="_markdown_"] :not(pre) > code`, 'font-family: var(--dsw-font-markdown-code-font-family, ui-monospace, monospace) !important; font-size: 13px !important; line-height: 1.4 !important; ' +
        'background: color-mix(in srgb, var(--dsw-alias-label-primary) 7.5%, transparent) !important; color: inherit !important; border: none !important; border-radius: 4px !important; padding: 1px 2px !important'],
      // Code blocks as Claude Code desktop draws them in replies (its prose pre rule): a 5% fill of the text colour with
      // a 0.5px border at 20%, 9px corners, 14px padding, and no header bar. Harness's language label goes; its
      // copy and wrap buttons float at the top right and show while the pointer is over the block. Every Markdown
      // view gets this: the conversation, the Files tab and file previews.
      [CODE_BLOCK, `background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent) !important; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent) !important; ` +
        'border-radius: 9px !important; margin: 12px 0 !important; position: relative !important'],
      [`${CODE_BLOCK} > ${m('bannerWrap')}`, 'position: absolute !important; top: 6px !important; right: 6px !important; z-index: 2 !important; background: transparent !important; opacity: 0; transition: opacity 120ms ease'],
      [`${CODE_BLOCK}:is(:hover, :focus-within) > ${m('bannerWrap')}`, 'opacity: 1'],
      [`${CODE_BLOCK} > ${m('bannerWrap')} > *`, 'padding: 2px !important; gap: 2px !important; border-radius: 7px !important; background: var(--dsw-alias-bg-base) !important; ' +
        `box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--dsw-alias-label-primary) 20%, transparent) !important`],
      [`${CODE_BLOCK} > ${m('bannerWrap')} :is(${m('infostring')}, ${m('language')}, ${m('heading')})`, 'display: none !important'],
      [`${CODE_BLOCK} pre`, 'background: transparent !important; padding: 14px !important; border-radius: 9px !important'],
      [c('bubble'), CHAT_TEXT_STYLE],
      // Tighter vertical rhythm: 10px between transcript items (Claude's --chat-item-gap), the reply's action
      // row pulled up to its text, and less padding around the "Completed in …" summary row.
      [shownItem, 'margin-top: 10px !important'],
      [`${c('flowItem')} ${c('root')}:has(> ${c('actions')})`, 'gap: 6px !important'],
      [`${c('flowItem')} ${c('root')} > ${c('actions')}`, 'margin-top: 0 !important'],
      [`${c('flowItem')}[data-chat-flow-kind="turn-process"]`, '--dsh-chat-flow-gap: 8px'],
      [`${c('flowItem')}[data-chat-flow-kind="turn-process"] button${c('root')}`, 'padding-bottom: 6px !important'],
      // One centred column for the transcript and the message box, at least 40px from the pane edges.
      [`${c('scroll')}`, 'padding-left: 40px !important; padding-right: 40px !important'],
      [`${c('composerSeat')} > ${c('root')}, ${c('composerSeat')} ${c('root')}:has(> ${c('card')})`, 'padding-left: 32px !important; padding-right: 32px !important'],
      // The column width is set through Harness's own width variable as well, because wide tables
      // break out of the column by a margin computed from that variable: capping only the column left
      // them offset by the difference and running past the pane's right edge.
      [c('scroll'), `--dsh-chat-content-width: ${CHAT_COLUMN}px !important`],
      [`${c('scroll')} ${c('column')}`, `max-width: ${CHAT_COLUMN}px !important`],
      [`${c('composerSeat')} ${c('card')}`, `max-width: ${CHAT_COLUMN + 10}px !important`],
      // Queued messages, like Claude Code desktop's: Harness's queue panel above the box (one row per message, in order)
      // loses its frame and header, so each queued message reads as your own message at the end of the conversation,
      // faded, with a "Queued" label; edit, remove and send-now show on hover. Found by Harness's [data-queue-dock].
      ['[data-queue-dock]', `width: 100% !important; max-width: ${CHAT_COLUMN + 10}px !important; margin: 0 auto 10px !important; padding: 0 5px 0 0 !important; box-sizing: border-box !important`],
      [`[data-queue-dock] ${c('panel')}`, 'background: none !important; padding: 0 !important; overflow: visible !important; border-radius: 0 !important'],
      [`[data-queue-dock] ${c('panel')}::before, [data-queue-dock] ${c('panel')}::after`, 'display: none !important'],
      [`[data-queue-dock] ${c('header')}, [data-queue-dock] ${c('lead')}`, 'display: none !important'],
      [`[data-queue-dock] ${c('list')}`, 'display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 8px !important; max-height: 40vh !important'],
      [`[data-queue-dock] ${c('row')}`, 'justify-content: flex-end !important; gap: 8px !important; min-height: 0 !important; padding: 0 !important; box-shadow: none !important; background: none !important'],
      [`[data-queue-dock] ${c('row')}::before`, 'content: "Queued"; order: -2; flex: none; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary)'],
      [`[data-queue-dock] ${c('preview')}, [data-queue-dock] ${c('attachments')}`, 'flex: 0 1 auto !important; max-width: calc(100% - 96px) !important; opacity: 0.55'],
      [`[data-queue-dock] ${c('preview')}`, 'padding: 7px 12px !important; border-radius: 14px !important; background: var(--dsw-specific-bubble) !important; font-size: 14px !important; line-height: 20px !important; color: var(--dsw-alias-label-primary) !important'],
      // Buttons first, then the label, then the message, so the label sits beside the message and the buttons appear to its left.
      [`[data-queue-dock] ${c('actions')}`, 'order: -3; gap: 2px !important; opacity: 0; transition: opacity 120ms'],
      [`[data-queue-dock] ${c('row')}:is(:hover, :focus-within) ${c('actions')}`, 'opacity: 1'],
      // The usage line spans the box's width (not the column's), with its readings centred.
      [`${c('composerSeat')} [data-composer-dock]`, `left: 32px !important; right: 32px !important; margin: 0 auto !important; max-width: ${CHAT_COLUMN + 10}px !important; padding: 0 !important; box-sizing: border-box !important`],
      // Harness's drag-to-resize handles beside the transcript: the column is fixed at 768px here, as in
      // Claude Code desktop, so they would only show a stray resize cursor and glow next to the text.
      [c('widthHandle'), 'display: none !important'],

      // ---- macOS window buttons under zoom -------------------------------------------------------
      // The traffic lights stay at fixed screen positions while the app zooms, so the space Harness
      // reserves for them (and the collapsed-sidebar buttons placed after them) scales by 1/zoom.
      [`[data-platform="darwin"] ${c('frame')}[data-sidebar-collapsed]`, '--dsh-frame-leading-clearance: calc(160px / var(--hs-zoom, 1)) !important'],
      [`[data-platform="darwin"][data-fullscreen] ${c('frame')}[data-sidebar-collapsed]`, '--dsh-frame-leading-clearance: calc(84px / var(--hs-zoom, 1)) !important'],
      [`[data-platform="darwin"] ${c('leadingSeat')}`, 'left: calc(88px / var(--hs-zoom, 1)) !important'],
      [`[data-platform="darwin"][data-fullscreen] ${c('leadingSeat')}`, 'left: 12px !important'],

      // ---- left sidebar: sessions sit indented under their folder, as in Claude Code desktop ------
      [c('sessionRow'), 'padding-left: 20px !important'],
      // Sessions started by another session sit under it, as in Claude Code desktop: the parent stays at the left
      // edge and its children's titles start 8px right of the parent's title (20 + 16px status cell + 4px gap),
      // beside a thin guide line through the middle of the parent's status cell.
      [`${c('sessionRow')}${c('nested')}`, 'padding-left: 48px !important'],
      [`${c('sessionChildren')}::before`, 'left: 27.5px !important'],
      // Text and row sizes measured from Claude Code desktop at 100%: 13px sidebar, title and controls text,
      // about 28px rows (Harness: 14px on 32–36px rows). Here the text matches (13px) on slightly tighter 26px rows, so more sessions fit.
      [`${c('root')}:not(${c('collapsed')}) ${c('panelList')}`, 'gap: 0 !important'],
      // Rows are 26px (Claude Code desktop's are 28): the sidebar holds more rows now (Instructions, About), so
      // the workspace list keeps its room.
      [`${c('root')}:not(${c('collapsed')}) ${c('panelRow')}`, 'min-height: 26px !important; height: 26px !important; padding: 3px 8px !important; font-size: 13px !important; line-height: 20px !important'],
      [`${c('sessionRow')}, ${c('projectRow')}`, 'min-height: 26px !important; height: 26px !important'],
      [`${c('regionArea')} ${c('sectionHeader')}`, 'height: 28px !important; min-height: 28px !important'],
      [c('projectRow'), 'font-size: 13px !important'],
      [`${c('projectRow')} ${c('title')}`, 'font-size: 13px !important; line-height: 20px !important'],
      [`${c('sessionRow')} ${c('title')}`, 'font-size: 13px !important; line-height: 20px !important'],
      // Claude shows no times beside sessions; Harness's are kept, at Claude's 12px small-text size.
      [`${c('sessionRow')} ${c('time')}`, 'font-size: 12px !important; line-height: 16px !important'],
      [c('sectionLabel'), 'font-size: 13px !important'],
      [`${c('trigger')}[data-signed-out="true"]`, 'font-size: 13px !important'],
      [c('crumbs'), 'font-size: 13px !important'],
      [`${c('composerSeat')} button`, 'font-size: 13px !important'],
      // The "More" button at the foot of the sidebar: the dots stay at the left and the word is centred
      // on the full row (the label's right padding mirrors the 28px the dots take on the left).
      [`${c('triggerRow')} ${c('trigger')}[data-signed-out="true"] > span:last-child`, 'flex: 1 1 auto !important; text-align: center !important; padding-right: 26px !important'],

      // ---- left sidebar top, as in Claude Code desktop: a search field, then New session as a row --
      // New session takes the Plugins row's metrics (36px, 7px 8px, 16px glyph, 8px gap, 14/22 regular).
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')}`, 'justify-content: flex-start !important; height: 26px !important; padding: 3px 8px !important; margin: 0 2px !important; font-size: 13px !important; border-color: transparent !important; background: transparent !important; font-weight: 400 !important'],
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')}:hover`, 'background: var(--dsw-alias-interactive-bg-hover) !important'],
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')} ${c('newSessionLabelMask')}`, 'flex: 1 1 auto !important'],
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')} ${c('newSessionContent')}`, 'justify-content: flex-start !important; gap: 8px !important; width: auto !important'],
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')} ${c('newSessionContent')} > svg`, 'width: 16px !important; height: 16px !important'],
      // The search field sits where the New session button was, in its fill and edge.
      ['[data-hs-sidebar-search]', 'box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 30px; flex: 0 0 auto; margin: 0 2px 8px; padding: 0 10px 0 8px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-tertiary); cursor: text'],
      ['[data-platform="darwin"] [data-hs-sidebar-search]', 'background: rgba(255, 255, 255, 0.55)'],
      ['[data-platform="darwin"] [data-ds-dark-theme] [data-hs-sidebar-search]', 'background: rgba(255, 255, 255, 0.15)'],
      ['[data-hs-sidebar-search]:focus-within', 'border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary))'],
      ['[data-hs-sidebar-search] > svg', 'flex: 0 0 auto'],
      ['[data-hs-sidebar-search] > input', 'flex: 1 1 auto; min-width: 0; padding: 0; border: 0; outline: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px'],
      ['[data-hs-sidebar-search] > input::placeholder', 'color: var(--dsw-alias-label-tertiary); opacity: 1'],
      ['[data-hs-sidebar-search] > kbd', 'flex: 0 0 auto; font: inherit; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary)'],
      ['[data-hs-sidebar-search]:focus-within > kbd, [data-hs-sidebar-search][data-filled] > kbd', 'display: none'],
      [`${c('collapsed')} [data-hs-sidebar-search]`, 'display: none'],
      // The Workspaces header's own search box is driven from the field above, so it stays hidden.
      // Visually hidden rather than display:none, so ⌘K can still focus it and be handed to the field.
      [`${c('root')}:not(${c('collapsed')}):has(> [data-hs-sidebar-search]) ${c('searchSlot')}`, 'position: absolute !important; width: 1px !important; height: 1px !important; max-width: 1px !important; overflow: hidden !important; opacity: 0 !important; pointer-events: none !important; clip-path: inset(50%) !important'],
      [`${c('root')}:not(${c('collapsed')}):has(> [data-hs-sidebar-search]) ${c('sectionLabel')}`, 'margin-right: auto !important'],

      // ---- long messages you sent fold, with Show more / Show less under them ------------------------
      ['[data-hs-fold="folded"]', 'max-height: 200px !important; overflow: hidden !important; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 56px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 56px), transparent)'],
      // In the time-and-copy row: the time's own size and grey, and always shown, while the time and copy keep
      // Harness's reveal-on-hover for earlier messages.
      ['[data-hs-fold-toggle]', 'flex: none; height: 24px; margin: 0 4px 0 0; padding: 0 6px; border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: var(--dsh-content-font-size-secondary, 13px); line-height: 24px; white-space: nowrap; cursor: pointer'],
      ['[data-hs-fold-toggle]:hover', 'background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary)'],
      [`${c('actions')}:has(> [data-hs-fold-toggle])`, 'opacity: 1 !important'],
      [`:is([data-actions-reveal="hover"], :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]):has(~ :is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]))):not(:hover):not(:focus-within) ${c('actions')} > :not([data-hs-fold-toggle])`, 'opacity: 0; transition: opacity 80ms'],

      // ---- Browser pane navigation: Harness draws Reload at 16px beside 14px Back and Forward; its circle
      // fills its box where the chevrons do not, so 11px makes the three read as one size.
      [`${c('tool')}[aria-label="Reload"] svg, ${c('tool')}[aria-label="Stop"] svg`, 'width: 11px !important; height: 11px !important'],

      // ---- calmer chrome ---------------------------------------------------------------------
      [c('header'), 'border-bottom-color: var(--dsw-alias-border-l1) !important'],
      // Composer: hairline edge, no glow.
      [`${c('composerSeat')} ${c('card')}`, 'box-shadow: var(--hs-panel-shadow) !important; background: var(--dsw-alias-bg-layer-1) !important'],
      // User message: soft fill rather than a raised chip.
      [c('bubble'), 'box-shadow: none !important'],
      // ---- right sidebar: a quiet pane header like Claude Code desktop's side panes ----------------
      // This pane uses `_name_hash_line` class names, so it gets its own matcher, scoped to the pane
      // so the conversation's Chat / Trajectory tabs are untouched.
      [p('tabHostHeader'), 'border-bottom: 1px solid var(--dsw-alias-border-l2) !important'],
      // The start inset stays Harness's published variable (10px by default) so a fullscreen pane under the
      // macOS window buttons keeps the wider inset Harness gives it.
      [p('tabStrip'), 'padding: 6px 8px 6px var(--dsh-dockkit-strip-inline-start, 10px) !important; align-items: center !important'],
      [p('slot'), 'width: 2px !important'],
      [p('tab'), 'height: 26px !important; padding: 0 8px !important; border-radius: 6px !important; background: transparent !important; color: var(--dsw-alias-label-tertiary) !important'],
      [`${p('tab')}:hover`, 'background: var(--dsw-alias-interactive-bg-hover) !important; color: var(--dsw-alias-label-secondary) !important'],
      [`${p('tab')}${m('tabActive')}`, 'background: var(--dsw-alias-interactive-bg-active) !important; color: var(--dsw-alias-label-primary) !important'],
      [p('tabTitle'), 'font-size: 13px !important'],
      [`${m('tabActive')} ${m('tabTitle')}`, 'font-weight: 500 !important'],
      [p('tabClose'), 'opacity: 0; transition: opacity 120ms'],
      [`${p('tab')}${m('tabActive')} ${m('tabClose')}`, 'position: static !important; transform: none !important; flex: none !important'],
      // The pane's × sits at the far right of its header (added by the Preview plugin), so the
      // title carries none — except browser tabs, which each keep their own.
      [`${p('tab')}${m('tabActive')}:not([data-studio-kind="browser"]):not([data-studio-kind="harness-studio-editor"]) ${m('tabClose')}`, 'display: none !important'],
      [`:is(${m('tab')}:hover, ${m('tabActive')}) ${m('tabClose')}`, 'opacity: 0.7'],
      // One control per pane: the conversation header's pane icons switch panes, so each pane header
      // shows only its own title (plus close, split, fullscreen, collapse) instead of a tab strip.
      [`${p('tab')}:not(${m('tabActive')})`, 'display: none !important'],
      [`${p('slot')}, ${p('addTab')}`, 'display: none !important'],
      // Except the browser: while a browser tab is showing, its sibling browser tabs and + stay, like
      // Claude's browser pane (the Preview plugin marks each tab with its kind).
      [`${m('tabStrip')}:has([aria-selected="true"][data-studio-kind="browser"]) [data-studio-kind="browser"]`, 'display: flex !important'],
      [`${m('tabStrip')}:has([aria-selected="true"][data-studio-kind="browser"]) ${m('addTab')}`, 'display: grid !important'],
      [`${m('tabStrip')}:has([aria-selected="true"][data-studio-kind="browser"]) [data-studio-kind="browser"]:not([aria-selected="true"]) ${m('tabTitle')}`, 'color: var(--dsw-alias-label-tertiary) !important'],
      [`${m('tabStrip')}:has([aria-selected="true"][data-studio-kind="browser"]) [data-studio-kind="browser"][aria-selected="true"]`, 'background: var(--dsw-alias-interactive-bg-active) !important; padding-left: 8px !important'],
      // And the Editor: a pane holding an Editor tab shows all its tabs (the Files or preview tab it was opened
      // from, and each open file), so you can move between them; each Editor tab keeps its own ×.
      [`${m('tabStrip')}:has([data-studio-kind="harness-studio-editor"]) ${m('tab')}`, 'display: flex !important'],
      [`${m('tabStrip')}:has([data-studio-kind="harness-studio-editor"]) ${m('tab')}:not([aria-selected="true"]) ${m('tabTitle')}`, 'color: var(--dsw-alias-label-tertiary) !important; font-weight: 400 !important'],
      [`${m('tabStrip')}:has([data-studio-kind="harness-studio-editor"]) ${m('tab')}[aria-selected="true"]`, 'background: var(--dsw-alias-interactive-bg-active) !important; padding-left: 8px !important'],
      [`${p('tab')}${m('tabActive')}`, 'background: transparent !important; padding-left: 4px !important; width: auto !important; min-width: 0 !important; max-width: none !important; flex: none !important'],
      [`${p('tab')}${m('tabActive')} ${m('tabTitle')}`, 'width: max-content !important; max-width: none !important; flex: none !important; mask-image: none !important; -webkit-mask-image: none !important; margin-right: 6px !important'],
      // No splitting: the right sidebar shows one pane at a time.
      [`${m('tabCell')} [aria-label="Split"], ${m('tabCell')} span:has(> [aria-label="Split"])`, 'display: none !important'],
      // Clicking the highlighted header icon already collapses the sidebar.
      [`${p('stripChrome')} [aria-label="Collapse right sidebar"]`, 'display: none !important'],
      [`${p('tab')}${m('tabActive')}:hover`, 'background: transparent !important'],
      [`${p('tab')}${m('tabActive')} ${m('tabTitle')}`, 'font-size: 13px !important; font-weight: 500 !important; color: var(--dsw-alias-label-primary) !important'],
      // Panes as cards, like Claude Code desktop's side panes: each pane is a rounded, bordered card
      // on the sidebar's own fill, so stacked and side-by-side panes read as separate surfaces.
      [m('tabCell'), 'padding: 6px !important; box-sizing: border-box !important; background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1)) !important'],
      // Full window, the panel leaves the right column and its fill behind, so the gap between stacked panes
      // would show the left sidebar through it; the panel carries the same fill itself.
      ['[data-sidebar-right-panel="fullscreen"]', 'background: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-layer-1)) !important'],
      [`${m('tabCell')} ${m('tabHost')}${m('pane')}`, 'border: 1px solid var(--dsw-alias-border-l2) !important; border-radius: 12px !important; overflow: hidden !important; ' +
        'box-shadow: var(--hs-panel-shadow) !important; background: var(--dsw-alias-bg-layer-1) !important'],
      // Browser pane: a roomier navigation row and a bordered, rounded address field.
      [`form${c('toolbar')}:has(${c('addressBox')})`, 'padding: 7px 8px !important; gap: 2px !important; border-bottom: 1px solid var(--dsw-alias-border-l2) !important'],
      [`form${c('toolbar')}:has(${c('addressBox')}) ${c('tool')}`, 'color: var(--dsw-alias-label-tertiary) !important'],
      [`${c('addressBox')} ${c('address')}`, 'height: 30px !important; border-radius: 8px !important; border: 1px solid var(--dsw-alias-border-l2) !important; ' +
        'background: var(--dsw-alias-bg-base) !important; font-size: 13px !important; padding-left: 10px !important'],
      [`${c('addressBox')} ${c('address')}:focus`, 'border-color: var(--dsw-alias-button-info-fill) !important; outline: none !important'],
      // No layout motion: sidebars open and close in one step instead of easing the centre column
      // sideways, sliding the right panes in, or fading the left sidebar's content.
      [`${m('frame')}, ${c('frame')}, ${c('frame')} *[class*="_handle"]`, 'transition: none !important'],
      ['[data-dockkit-host="dock"], [data-dockkit-empty], [data-dockkit-divider]', 'transition: none !important'],
      [`${c('sidebarCol')} > * > ${c('root')}`, 'transition: none !important; animation: none !important'],
      // Start page: a plain menu of rows rather than bordered cards.
      [`${c('guide')} ${c('entry')}`, 'border-color: transparent !important; background: transparent !important; box-shadow: none !important'],
      [`${c('guide')} ${c('entry')}:hover`, 'background: var(--dsw-alias-interactive-bg-hover) !important'],
      // Settings rows drawn by this plugin, with the values of Harness's own rows (Language, Font size, Permission),
      // so they match on every page, including the pages that have no Harness row to copy.
      ['.hs-setting', 'display: flex; align-items: center; gap: 8px; padding: 16px 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2)'],
      ['.hs-setting-text', 'flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; padding-right: 48px'],
      ['.hs-setting-title', 'font-size: 14px; font-weight: 400; line-height: 22px; color: var(--dsw-alias-label-primary)'],
      ['.hs-setting-desc', 'font-size: 12px; font-weight: 400; line-height: 18px; color: var(--dsw-alias-label-tertiary)'],
      ['.hs-setting-control', 'display: inline-flex; align-items: center; gap: 8px'],
      ['.hs-setting-select', 'display: inline-flex; align-items: center; gap: 12px; height: 36px; padding: 0 14px; border: none; ' +
        'border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); font: inherit; font-size: 14px; ' +
        'line-height: 22px; color: var(--dsw-alias-label-primary); cursor: pointer'],
      ['.hs-setting-select:hover', 'background: var(--dsw-alias-interactive-bg-hover)'],
      // Questions and approvals waiting in the conversation: Harness draws them on the message box's surface with only a
      // faint shadow, which disappears against the chat. They keep that surface and get a clear neutral border and a soft
      // shadow; an approval keeps its own amber border.
      [`[data-pending-seat] :is([data-question-key], [data-plan-review-key]) ${c('card')}:not(${c('card')} ${c('card')})`,
        'border: 1px solid var(--dsw-alias-border-l4) !important; box-shadow: 0 1px 2px rgba(0, 0, 0, .05), 0 6px 18px rgba(0, 0, 0, .06) !important'],
      [`[data-pending-seat] [data-approval-key] ${c('card')}:not(${c('card')} ${c('card')})`,
        'box-shadow: 0 1px 2px rgba(0, 0, 0, .05), 0 6px 18px rgba(0, 0, 0, .06) !important'],
      // A page's last row has no divider under it, as on Harness's pages: only a row that is the last thing in the
      // page's last entry (a row with a list under it keeps its divider).
      ['[data-slot$=".item"] > :last-child > .hs-setting:last-child', 'border-bottom: none'],
    ]

    // Rules that need an at-rule around them. When the box is too narrow for the usage readings between the
    // mode and model menus, the turns, steps and speed reading steps aside (the Session pane still shows it).
    const AT_RULES = `@container hs-composer (max-width: 420px) { ${c('composerSeat')} [data-composer-dock] [class*="_anchor"]:first-child { display: none !important } }`
    const CSS = [...RULES, ...LOOK_RULES].map(([selector, body]) => `${selector} { ${body} }`).join('\n') + '\n' + AT_RULES
    const STYLE_ID = 'harness-studio-compact'

    // ---- whole-app zoom (⌘+ / ⌘− / ⌘0), like Claude's desktop app ------------------------
    // Harness binds ⌘+/⌘− to conversation text size only and skips key presses another handler
    // already claimed, so a capture-phase listener that prevents default takes them over.
    const ZOOM_KEY = 'harness-studio.zoom'
    const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform)

    function readZoom() {
      try {
        const value = Number(localStorage.getItem(ZOOM_KEY))
        return ZOOM_STEPS.includes(value) ? value : 1
      } catch { return 1 }
    }

    function applyZoom(level) {
      zoomNow = level
      document.documentElement.style.zoom = level === 1 ? '' : String(level)
      document.documentElement.style.setProperty('--hs-zoom', String(level))
      try { localStorage.setItem(ZOOM_KEY, String(level)) } catch { /* storage unavailable: zoom lasts for this window only */ }
      remeasureFrame()
    }

    // ---- one coordinate system under zoom ----------------------------------------------------------
    // CSS zoom on the root lays the app out in "layout" pixels (a 90% zoom gives a 1600px-wide layout
    // in a 1440px window) while the browser reports element boxes, pointer positions and the window
    // size in on-screen pixels. Harness mixes the two — sizing columns from a measured box, dragging by
    // pointer movement, placing menus at a measured box — so under zoom its handles and popovers drift.
    // While zoom is not 100%, every on-screen reading is converted to layout pixels, and point lookups
    // convert back, so all of Harness (and this theme) works in one unit.
    let zoomNow = 1
    const currentZoom = () => zoomNow

    function installZoomCoordinates() {
      const restore = []
      const wrapMethod = (proto, name, wrap) => {
        const original = proto[name]
        if (typeof original !== 'function') return
        proto[name] = wrap(original)
        restore.push(() => { proto[name] = original })
      }
      const wrapGetter = (target, name, convert) => {
        let owner = target
        while (owner && !Object.getOwnPropertyDescriptor(owner, name)) owner = Object.getPrototypeOf(owner)
        const descriptor = owner && Object.getOwnPropertyDescriptor(owner, name)
        if (!descriptor || !descriptor.get) return
        Object.defineProperty(target, name, { configurable: true, enumerable: descriptor.enumerable, get() { return convert(descriptor.get.call(this)) } })
        restore.push(() => { if (target === owner) Object.defineProperty(target, name, descriptor); else delete target[name] })
      }
      const toLayout = value => (zoomNow === 1 ? value : value / zoomNow)
      const rectToLayout = rect => (zoomNow === 1 ? rect : new DOMRect(rect.x / zoomNow, rect.y / zoomNow, rect.width / zoomNow, rect.height / zoomNow))
      const listToLayout = list => {
        if (zoomNow === 1) return list
        const rects = Array.from(list, rectToLayout)
        rects.item = i => rects[i] ?? null
        return rects
      }
      for (const proto of [Element.prototype, Range.prototype]) {
        wrapMethod(proto, 'getBoundingClientRect', original => function () { return rectToLayout(original.call(this)) })
        wrapMethod(proto, 'getClientRects', original => function () { return listToLayout(original.call(this)) })
      }
      for (const name of ['clientX', 'clientY', 'x', 'y', 'pageX', 'pageY', 'offsetX', 'offsetY', 'movementX', 'movementY']) {
        wrapGetter(MouseEvent.prototype, name, toLayout)
      }
      for (const name of ['innerWidth', 'innerHeight']) wrapGetter(window, name, toLayout)
      for (const name of ['clientWidth', 'clientHeight']) wrapGetter(document.documentElement, name, toLayout)
      for (const name of ['width', 'height']) if (window.visualViewport) wrapGetter(window.visualViewport, name, toLayout)
      const toScreen = value => (zoomNow === 1 ? value : value * zoomNow)
      for (const name of ['elementFromPoint', 'elementsFromPoint', 'caretRangeFromPoint', 'caretPositionFromPoint']) {
        wrapMethod(Document.prototype, name, original => function (x, y, ...rest) { return original.call(this, toScreen(x), toScreen(y), ...rest) })
      }
      return () => { for (const undo of restore.reverse()) undo() }
    }

    /** Make Harness measure its frame again after a zoom change (it re-measures on resize). */
    function remeasureFrame() {
      window.dispatchEvent(new Event('resize'))
      const frame = document.querySelector('[class$="_frame"][style*="grid-template-columns"]')
      if (frame === null) return
      frame.style.marginRight = '1px'
      setTimeout(() => { frame.style.marginRight = '' }, 50) // a timer: animation frames pause in background windows
    }

    let badgeTimer
    /** Brief percentage badge, like a browser's zoom indicator. */
    function showZoomBadge(level) {
      let badge = document.getElementById('harness-studio-zoom-badge')
      if (badge === null) {
        badge = document.createElement('div')
        badge.id = 'harness-studio-zoom-badge'
        badge.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
          'padding:4px 12px;border-radius:8px;font:600 12px/18px system-ui,sans-serif;pointer-events:none;' +
          'background:var(--dsw-alias-bg-layer-2,#333);color:var(--dsw-alias-label-primary,#fff);' +
          'border:1px solid var(--dsw-alias-border-l2,#555);box-shadow:0 4px 16px rgba(0,0,0,.25);transition:opacity 200ms'
        document.body.append(badge)
      }
      badge.textContent = Math.round(level * 100) + '%'
      badge.style.opacity = '1'
      clearTimeout(badgeTimer)
      badgeTimer = setTimeout(() => { badge.style.opacity = '0' }, 900)
    }

    function onZoomKey(event) {
      const primary = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      if (!primary || event.altKey || event.isComposing) return
      // The level in effect, not the stored one: storage may be unavailable, and then every step would
      // start again from 100%.
      let index = ZOOM_STEPS.indexOf(zoomNow)
      if (event.code === 'Equal' || event.code === 'NumpadAdd') index = Math.min(ZOOM_STEPS.length - 1, index + 1)
      else if ((event.code === 'Minus' || event.code === 'NumpadSubtract') && !event.shiftKey) index = Math.max(0, index - 1)
      else if ((event.code === 'Digit0' || event.code === 'Numpad0') && !event.shiftKey) index = ZOOM_STEPS.indexOf(1)
      else return
      event.preventDefault()
      event.stopPropagation()
      const next = ZOOM_STEPS[index]
      applyZoom(next)
      showZoomBadge(next)
    }

    // ---- left sidebar width: draggable narrower than Harness allows ------------------------------
    // Harness clamps the sidebar drag to 264–420px. Claude's sidebar sits around 230px, so this
    // takes over the sidebar's drag handle with a 230–420px range, remembers the width, and keeps it
    // applied whenever Harness re-renders the frame. Double-click the handle to return to Harness's
    // own width. Collapsing and reopening still work; a collapsed column (0px, or the icon rail on
    // platforms that keep one) is left alone.
    const WIDTH_KEY = 'harness-studio.sidebar-width'
    const WIDTH_MIN = 230
    const WIDTH_MAX = 420

    function readWidth() {
      try { const value = Number(localStorage.getItem(WIDTH_KEY)); return value >= WIDTH_MIN && value <= WIDTH_MAX ? value : undefined } catch { return undefined }
    }
    function saveWidth(value) {
      try { if (value === undefined) localStorage.removeItem(WIDTH_KEY); else localStorage.setItem(WIDTH_KEY, String(value)) } catch { /* storage unavailable: the width lasts for this window only */ }
    }

    const frameEl = () => document.querySelector('[class$="_frame"][style*="grid-template-columns"]')
    // The parts of Harness's app frame (AppFrame) used below, all looked up inside the frame: the left
    // column and the drag handle are the frame's own children, the content root sits two levels down.
    const sidebarColumnIn = frame => frame.querySelector(':scope > [class$="_sidebarCol"]')
    const sidebarHandleIn = frame => frame.querySelector(':scope > [class*="_handle"][data-side="sidebar"]')
    const sidebarContentIn = column => column?.querySelector(':scope > * > [class*="_root"]') ?? null

    /**
     * Run `bind(frame)` against Harness's app frame (the three-column grid), and again whenever the frame
     * is replaced. Only while no frame is mounted does a document-wide watch look for one (at start-up);
     * once found, the watch narrows to the frame's parent, with a slow timer as the backstop for an
     * ancestor further up being swapped out.
     * @param {(frame: HTMLElement) => ((() => void) | void)} bind - attaches to one frame; returns its cleanup.
     * @returns {() => void} cleanup.
     */
    function withFrame(bind) {
      let frame = null
      let unbind = null
      let queued = 0
      const watch = new MutationObserver(() => {
        if (queued === 0) queued = requestAnimationFrame(() => { queued = 0; attach() })
      })
      const attach = () => {
        if (frame !== null && frame.isConnected) return
        unbind?.()
        unbind = null
        watch.disconnect()
        frame = frameEl()
        if (frame === null) { watch.observe(document.body, { childList: true, subtree: true }); return }
        if (frame.parentNode) watch.observe(frame.parentNode, { childList: true })
        unbind = bind(frame) ?? null
      }
      const backstop = setInterval(attach, 1000) // also covers start-up in a background window, where frames pause
      attach()
      return () => {
        clearInterval(backstop)
        cancelAnimationFrame(queued)
        watch.disconnect()
        unbind?.()
        unbind = null
        frame = null
      }
    }

    /**
     * Open the sidebar's "More" menu centred over its button; Harness pins it 12px from the window
     * edge. Re-centred whenever the menu appears (its position is set when it opens).
     * @returns {() => void} cleanup.
     */
    function centerMoreMenu() {
      const place = () => {
        const menu = document.querySelector('[role="menu"][class*="_signedOutMenu"]')
        const trigger = document.querySelector(`${c('trigger')}[data-signed-out="true"]`)
        if (!menu || !trigger) return
        const button = trigger.getBoundingClientRect()
        const width = menu.getBoundingClientRect().width
        const left = Math.max(8, Math.round(button.left + button.width / 2 - width / 2))
        if (menu.style.left !== left + 'px') menu.style.setProperty('left', left + 'px', 'important')
      }
      // Menus are portalled to the body: watch only the body's children, then the open menu's style.
      const menuWatch = new MutationObserver(place)
      let watched = null
      const bodyWatch = new MutationObserver(() => {
        const menu = document.querySelector('[role="menu"][class*="_signedOutMenu"]')
        if (menu === watched) return
        menuWatch.disconnect()
        watched = menu
        if (menu) { place(); menuWatch.observe(menu, { attributes: true, attributeFilter: ['style'] }) }
      })
      bodyWatch.observe(document.body, { childList: true })
      return () => { bodyWatch.disconnect(); menuWatch.disconnect() }
    }

    /**
     * Put a search field at the top of the left sidebar, where New session was, as in Claude Code
     * desktop. It drives the Workspaces header's own session search (kept mounted but hidden), so
     * results, ⌘K and opening a result behave as before.
     * @returns {() => void} cleanup.
     */
    function installSidebarSearch() {
      const ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="4.75" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 10.5 13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
      let column = null // the frame's left column, which holds the New session button and the Workspaces search
      const native = () => (column ?? document).querySelector(`${c('searchSlot')} input`)
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const drive = (value) => {
        const input = native()
        if (!input || input.value === value) return
        setValue.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const keysOf = (aria) => (aria ?? '').split(' ')[0].split('+').filter(Boolean)
        .map(k => ({ Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: '⇧' }[k] ?? k.toUpperCase())).join('')

      // A field left behind by an earlier load of this plugin would show as a second search box.
      for (const stale of document.querySelectorAll('[data-hs-sidebar-search]')) stale.remove()
      const bar = document.createElement('label')
      bar.setAttribute('data-hs-sidebar-search', '')
      bar.innerHTML = ICON + '<input type="text" placeholder="Search" aria-label="Search sessions" maxlength="500" spellcheck="false"><kbd></kbd>'
      const input = bar.querySelector('input')
      const hint = bar.querySelector('kbd')
      const sync = () => { bar.toggleAttribute('data-filled', input.value !== '') }
      input.addEventListener('input', () => { drive(input.value); sync() })
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { input.value = ''; drive(''); sync(); input.blur() }
        else if (event.key === 'Enter') {
          const first = document.querySelector(`${c('searchTree')} [role="treeitem"]`)
          if (!first) return
          first.click()
          input.value = ''
          sync()
          input.blur()
        }
      })

      const ensure = () => {
        if (column === null) return
        for (const stale of column.querySelectorAll('[data-hs-sidebar-search]')) if (stale !== bar) stale.remove()
        const button = column.querySelector(`${c('root')}:not(${c('collapsed')}) > ${c('newSession')}`)
        if (button && button.previousElementSibling !== bar) button.before(bar)
        const keys = keysOf(column.querySelector(`${c('searchSlot')} button`)?.getAttribute('aria-keyshortcuts'))
        if (hint.textContent !== keys) hint.textContent = keys
        // Opening a result clears the Workspaces search; clear this field with it.
        if (input.value !== '' && native()?.value === '' && document.activeElement !== input) { input.value = ''; sync() }
      }
      // Everything this needs lives in the left column, so only that column is watched (a streaming
      // reply in the centre never wakes it), at most once a frame.
      const unfollow = withFrame((frame) => {
        column = sidebarColumnIn(frame)
        if (column === null) return
        let queued = 0
        const observer = new MutationObserver(() => {
          if (queued === 0) queued = requestAnimationFrame(() => { queued = 0; ensure(); observer.takeRecords() })
        })
        observer.observe(column, { childList: true, subtree: true })
        ensure()
        observer.takeRecords() // the field's own insertion
        return () => { cancelAnimationFrame(queued); observer.disconnect(); column = null }
      })
      // ⌘K focuses the hidden Workspaces search; send it here instead.
      const onFocus = (event) => {
        if (bar.isConnected && event.target instanceof HTMLInputElement && event.target.closest(c('searchSlot'))) input.focus()
      }
      document.addEventListener('focusin', onFocus, true)
      return () => {
        drive('')
        unfollow()
        bar.remove()
        document.removeEventListener('focusin', onFocus, true)
      }
    }

    /**
     * Long messages you sent fold to about ten lines with "Show more" under them, and "Show less" folds
     * them again, as in Claude Code desktop. Measured once per message, and again when the window resizes.
     * @returns {() => void} cleanup.
     */
    function foldLongPrompts() {
      const LIMIT = 200 // px of message text before it folds (10 lines at 20px)
      const BUBBLE = `${c('userStack')} > ${c('bubble')}`
      const MESSAGE = `${c('userRow')}, ${c('userStack')}` // the nearest of these holds one sent message
      const buttons = new WeakMap() // bubble → its toggle
      const bubblesIn = root => (root.matches(BUBBLE) ? [root] : root.querySelectorAll(BUBBLE))
      // The toggle sits at the start of the message's own row of time and copy, so the three read as one line.
      const rowFor = bubble => bubble.closest(c('userRow'))?.querySelector(`:scope > ${c('actions')}`) ?? null
      const measure = (bubble, force) => {
        const existing = buttons.get(bubble)
        if (!force && bubble.hasAttribute('data-hs-fold') && (!existing || existing.isConnected)) return
        const long = bubble.scrollHeight > LIMIT + 40 // a fold that hides under two lines is not worth a button
        if (!long) {
          bubble.setAttribute('data-hs-fold', 'short')
          existing?.remove()
          buttons.delete(bubble)
          return
        }
        if (bubble.getAttribute('data-hs-fold') !== 'open') bubble.setAttribute('data-hs-fold', 'folded')
        let button = existing
        if (!button) {
          button = document.createElement('button')
          button.type = 'button'
          button.setAttribute('data-hs-fold-toggle', '')
          button.addEventListener('click', () => {
            const open = bubble.getAttribute('data-hs-fold') !== 'open'
            bubble.setAttribute('data-hs-fold', open ? 'open' : 'folded')
            button.textContent = open ? 'Show less' : 'Show more'
            if (!open) bubble.scrollIntoView({ block: 'nearest' })
          })
          buttons.set(bubble, button)
        }
        const row = rowFor(bubble)
        if (row && row.firstElementChild !== button) row.prepend(button)
        else if (!row && button.previousElementSibling !== bubble) bubble.after(button)
        button.textContent = bubble.getAttribute('data-hs-fold') === 'open' ? 'Show less' : 'Show more'
      }

      // Messages appear in the centre and right columns. Rather than rescanning the page on every change
      // (a streaming reply changes it many times a second), each change names the nodes it added: one
      // inside a sent message marks that message, one outside marks only its own subtree, and a leaf
      // outside any message cannot hold one. The marked places are measured once per frame.
      let scopes = []
      const pending = new Set()
      let queued = 0
      const flush = () => {
        queued = 0
        const roots = [...pending]
        pending.clear()
        for (const root of roots) if (root.isConnected) for (const bubble of bubblesIn(root)) measure(bubble, false)
      }
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE || node.hasAttribute('data-hs-fold-toggle')) continue // text, or our own toggle
            const message = node.closest(MESSAGE)
            if (message !== null) pending.add(message)
            else if (node.firstElementChild !== null) pending.add(node)
          }
        }
        // Frames pause in a background window while a reply may keep streaming: rather than hold on to
        // every added node until then, fall back to one scan of the columns.
        if (pending.size > 256) { pending.clear(); for (const scope of scopes) pending.add(scope) }
        if (pending.size > 0 && queued === 0) queued = requestAnimationFrame(flush)
      })
      const scan = (force) => { for (const scope of scopes) for (const bubble of bubblesIn(scope)) measure(bubble, force) }
      const unfollow = withFrame((frame) => {
        scopes = [...frame.querySelectorAll(`:scope > :is(${c('centerCol')}, [data-rightbar-col])`)]
        if (scopes.length === 0) scopes = [frame]
        for (const scope of scopes) observer.observe(scope, { childList: true, subtree: true })
        scan(false)
        return () => {
          observer.disconnect()
          cancelAnimationFrame(queued)
          queued = 0
          pending.clear()
          scopes = []
        }
      })
      let resizeTimer
      const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => scan(true), 150) }
      window.addEventListener('resize', onResize)
      return () => {
        unfollow()
        clearTimeout(resizeTimer)
        window.removeEventListener('resize', onResize)
        for (const button of document.querySelectorAll('[data-hs-fold-toggle]')) button.remove()
        for (const bubble of document.querySelectorAll('[data-hs-fold]')) bubble.removeAttribute('data-hs-fold')
      }
    }

    /**
     * While a column edge is dragged, cover the window with a transparent layer so the pointer never
     * passes over an embedded page (the Browser pane's webview), which would swallow the movement and
     * the release and leave the drag stuck.
     * @returns {() => void} cleanup.
     */
    function shieldColumnDrags() {
      let shield = null
      const end = () => { shield?.remove(); shield = null }
      const onDown = (event) => {
        if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest('[class*="_handle"][data-side]')) return
        end()
        shield = document.createElement('div')
        shield.setAttribute('data-studio-drag-shield', '')
        shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:col-resize;background:transparent'
        document.body.append(shield)
      }
      window.addEventListener('pointerdown', onDown, true)
      window.addEventListener('pointerup', end, true)
      window.addEventListener('pointercancel', end, true)
      window.addEventListener('blur', end)
      return () => {
        end()
        window.removeEventListener('pointerdown', onDown, true)
        window.removeEventListener('pointerup', end, true)
        window.removeEventListener('pointercancel', end, true)
        window.removeEventListener('blur', end)
      }
    }

    /**
     * Take over the left sidebar's drag handle (see the width notes above).
     * @returns {() => void} cleanup; it also puts Harness's own width back.
     */
    function controlSidebarWidth() {
      let width = readWidth()
      let drag = null
      let frame = null
      // Harness's own width as it last rendered it, kept so a double-click or turning the theme off can
      // put it back (Harness re-renders only when its own value changes, so it would not do so itself);
      // and the width last written here, to tell the two apart.
      let harnessPx = null
      let writtenPx = null

      /** Put `px` on the column track, the frozen content root and the drag handle. @returns whether anything changed. */
      const write = (px) => {
        if (frame === null) return false
        const columns = frame.style.gridTemplateColumns
        const first = columns.split(' ')[0]
        // Collapsed: a 0px column, or the icon rail on platforms that keep one.
        if (first === '0px' || first === '' || frame.hasAttribute('data-sidebar-collapsed')) return false
        let changed = false
        if (first !== px) {
          if (first !== writtenPx) harnessPx = first
          frame.style.gridTemplateColumns = px + columns.slice(first.length)
          changed = true
        }
        const content = sidebarContentIn(sidebarColumnIn(frame))
        if (content && content.style.width && content.style.width !== px) { content.style.width = px; changed = true }
        const handle = sidebarHandleIn(frame)
        if (handle && handle.style.left !== px) { handle.style.left = px; changed = true }
        writtenPx = px
        return changed
      }
      const restore = () => {
        if (harnessPx !== null) write(harnessPx)
        // Nothing of this theme's is left on the frame: the next override captures Harness's value afresh.
        harnessPx = null
        writtenPx = null
      }

      const unfollow = withFrame((bound) => {
        frame = bound
        const column = sidebarColumnIn(frame)
        // Harness rewrites these inline sizes when it re-renders the frame. Only the frame, the handle and
        // the content root are watched, only for their style, and the width goes back straight away, before
        // the frame paints; the records of these writes are dropped so they do not wake this again.
        const styles = new MutationObserver(() => {
          if (width !== undefined && write(width + 'px')) styles.takeRecords()
        })
        let content = null
        let handle = null
        const retarget = () => {
          const nextContent = sidebarContentIn(column)
          const nextHandle = sidebarHandleIn(frame)
          if (nextContent === content && nextHandle === handle) return false
          content = nextContent
          handle = nextHandle
          styles.disconnect()
          for (const target of [frame, content, handle]) if (target) styles.observe(target, { attributes: true, attributeFilter: ['style'] })
          return true
        }
        // The handle mounts and unmounts with the open sidebar, and the content root can be replaced:
        // follow them, at most once a frame.
        let queued = 0
        const structure = new MutationObserver(() => {
          if (queued === 0) {
            queued = requestAnimationFrame(() => {
              queued = 0
              if (retarget() && width !== undefined && write(width + 'px')) styles.takeRecords()
            })
          }
        })
        structure.observe(frame, { childList: true })
        if (column) structure.observe(column, { childList: true, subtree: true })
        retarget()
        if (width !== undefined) write(width + 'px')
        styles.takeRecords()
        return () => {
          cancelAnimationFrame(queued)
          styles.disconnect()
          structure.disconnect()
          frame = null
        }
      })

      const onPointerDown = (event) => {
        const handle = event.target instanceof Element ? event.target.closest('[class*="_handle"][data-side="sidebar"]') : null
        if (handle === null || event.button !== 0) return
        // Keep Harness's own drag (and its 264px floor) from starting.
        event.preventDefault()
        event.stopPropagation()
        const column = frame ? sidebarColumnIn(frame) : document.querySelector('[class$="_sidebarCol"]')
        // Capture the pointer so the release reaches the handle wherever it happens; losing the capture
        // (the handle unmounting, the window losing the pointer) ends the drag below.
        try { handle.setPointerCapture(event.pointerId) } catch { /* the pointer is already gone */ }
        drag = { startX: event.clientX, startWidth: column ? column.offsetWidth : 280, handle, pointerId: event.pointerId }
        document.documentElement.style.cursor = 'col-resize'
      }
      const endDrag = () => {
        if (drag === null) return
        const { handle, pointerId } = drag
        drag = null
        try { if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId) } catch { /* already released */ }
        document.documentElement.style.cursor = ''
        saveWidth(width)
      }
      /** A release, cancel or lost capture of the dragging pointer. */
      const onPointerEnd = (event) => { if (drag !== null && event.pointerId === drag.pointerId) endDrag() }
      const onPointerMove = (event) => {
        if (drag === null || event.pointerId !== drag.pointerId) return
        // No button held: the release happened where it never reached this window (⌘-Tab mid-drag).
        if (event.buttons === 0) { endDrag(); return }
        event.preventDefault()
        width = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, drag.startWidth + event.clientX - drag.startX)))
        write(width + 'px')
      }
      const onDoubleClick = (event) => {
        if (!(event.target instanceof Element) || event.target.closest('[class*="_handle"][data-side="sidebar"]') === null) return
        width = undefined
        saveWidth(undefined)
        restore() // Harness's own width, as it last rendered it
      }
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('pointermove', onPointerMove, true)
      window.addEventListener('pointerup', onPointerEnd, true)
      window.addEventListener('pointercancel', onPointerEnd, true)
      window.addEventListener('lostpointercapture', onPointerEnd, true)
      window.addEventListener('blur', endDrag) // ⌘-Tab or a window switch mid-drag
      window.addEventListener('dblclick', onDoubleClick, true)
      return () => {
        endDrag()
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('pointermove', onPointerMove, true)
        window.removeEventListener('pointerup', onPointerEnd, true)
        window.removeEventListener('pointercancel', onPointerEnd, true)
        window.removeEventListener('lostpointercapture', onPointerEnd, true)
        window.removeEventListener('blur', endDrag)
        window.removeEventListener('dblclick', onDoubleClick, true)
        // Put Harness's own width back while the frame is still bound (with no width of ours left for the
        // style watch to re-apply), then let go of the frame.
        width = undefined
        restore()
        unfollow()
      }
    }

    // ---- sidebar foot: Settings, then About --------------------------------------------------------
    // Harness puts an account menu (Settings, Feedback, Sign out) at the foot of the left sidebar. Like
    // Claude Code desktop's, the foot here is a Settings row that opens Settings directly, with an About row
    // below it that opens the About page (further down); signing in
    // and out stay on Settings' own Account page. The row takes Harness's settings-launcher seat at a
    // lower priority than the account menu, so the menu comes back when this plugin is turned off. It
    // borrows the class names of the sidebar's Plugins row so it looks and behaves like that row.
    const SETTINGS_GLYPH = 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM13.2 9.3l1.1.9-1.3 2.3-1.4-.5a5 5 0 0 1-1.2.7L10.2 14H7.6l-.3-1.3a5 5 0 0 1-1.2-.7l-1.4.5-1.3-2.3 1.1-.9a5 5 0 0 1 0-1.4l-1.1-.9 1.3-2.3 1.4.5a5 5 0 0 1 1.2-.7L7.6 2h2.6l.3 1.3a5 5 0 0 1 1.2.7l1.4-.5 1.3 2.3-1.1.9a5 5 0 0 1 0 1.4z'
    function panelRowClasses() {
      const row = document.querySelector('[class$="_sidebarCol"] button[class$="_panelRow"], [class$="_sidebarCol"] button[class*="_panelRow "]')
      return {
        row: row?.className ?? '',
        glyph: row?.querySelector('[class*="_panelGlyph"]')?.className ?? '',
        title: row?.querySelector('[class*="_panelTitle"]')?.className ?? '',
      }
    }
    function SettingsLauncher({ wide, settingsOpen, settingsShortcut, openSettings }) {
      const [classes, setClasses] = React.useState(panelRowClasses)
      // The sidebar may render its rows after this seat; pick their look up once they exist.
      React.useEffect(() => {
        if (classes.row) return undefined
        const timer = setInterval(() => { const next = panelRowClasses(); if (next.row) { setClasses(next); clearInterval(timer) } }, 250)
        return () => clearInterval(timer)
      }, [classes.row])
      const hint = settingsShortcut?.keys?.join('')
      const settings = h('button', {
        type: 'button', className: classes.row, 'data-studio-settings': '', 'aria-label': 'Settings', 'aria-haspopup': 'dialog', 'aria-expanded': settingsOpen,
        'aria-keyshortcuts': settingsShortcut?.aria, title: hint ? 'Settings (' + hint + ')' : 'Settings', onClick: () => openSettings(),
        style: classes.row ? { width: '100%' } : { display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 28, padding: '4px 8px', border: 'none', borderRadius: 12, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, cursor: 'pointer' },
      },
        h('span', { className: classes.glyph, 'aria-hidden': true },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round' }, h('path', { d: SETTINGS_GLYPH }))),
        wide ? h('span', { className: classes.title }, 'Settings') : null)
      const about = h('button', {
        type: 'button', className: classes.row, 'data-studio-about': '', 'aria-label': 'About Harness Studio', title: 'About Harness Studio',
        onClick: () => openAbout(),
        style: classes.row ? { width: '100%' } : { display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 28, padding: '4px 8px', border: 'none', borderRadius: 12, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, cursor: 'pointer' },
      },
        h('span', { className: classes.glyph, 'aria-hidden': true },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinecap: 'round' },
            h('circle', { cx: 8, cy: 8, r: 6 }), h('path', { d: 'M8 7.2v3.8' }), h('path', { d: 'M8 5.1v.1', strokeWidth: 1.4 }))),
        wide ? h('span', { className: classes.title }, 'About') : null)
      return h(React.Fragment, null, settings, about)
    }



    // ---- About page --------------------------------------------------------------------------------
    // What Harness Studio adds and how it works, grouped the way people ask about it. Kept to what the app
    // actually does; "Not yet" lists the known gaps so the page never promises more.
    const REPO = 'https://github.com/vigneshv1cky/harness-studio'
    // Who makes Harness Studio, shown at the head of the About page.
    const DEVELOPER = {
      name: 'Vignesh Murugan',
      device: 'Built on a 13-inch MacBook Air with the Apple M1 chip, 8 GB of memory and 512 GB of storage.',
      links: [
        ['Email', 'mailto:Muruganvignesh0810@gmail.com', 'Muruganvignesh0810@gmail.com'],
        ['GitHub', 'https://github.com/vigneshv1cky', 'vigneshv1cky'],
        ['LinkedIn', 'https://www.linkedin.com/in/vignesh-murugan-data/', 'vignesh-murugan-data'],
        ['Instagram', 'https://www.instagram.com/vignesh_v1cky/', 'vignesh_v1cky'],
        ['X', 'https://x.com/vigneshv1cky', 'vigneshv1cky'],
      ],
      // The same pages as the repository's Sponsor button (.github/FUNDING.yml) and the README's Support section.
      support: [
        ['GitHub Sponsors', 'https://github.com/sponsors/vigneshv1cky'],
        ['Ko-fi', 'https://ko-fi.com/vigneshmurugan'],
        ['PayPal', 'https://paypal.me/VigneshV1cky'],
      ],
    }
    // Harness Studio's release version, shown beside the name at the top of the sidebar in place of Harness's own
    // version and commit. Keep equal to desktop/VERSION (test/version.test.mjs checks it).
    const STUDIO_VERSION = '0.3.4'
    // The development copy names its window "Harness Studio Dev" (Harness's development-app script), so its
    // version reads "dev" too and the two copies can be told apart at a glance.
    const isDevCopy = () => /Harness Studio Dev\b/.test(document.title)
    // Same layout and values as Harness's local-build brand (SidebarRoot.module.css), with Studio's version.
    const BrandName = () => {
      const [dev, setDev] = React.useState(isDevCopy)
      React.useEffect(() => {
        const head = document.head
        const observer = new MutationObserver(() => setDev(isDevCopy()))
        observer.observe(head, { childList: true, subtree: true, characterData: true })
        return () => observer.disconnect()
      }, [])
      return h('span', { 'data-studio-brand': '', style: { flex: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: '1px', height: '24px', whiteSpace: 'nowrap' } },
      h('span', { style: { fontSize: '12px', lineHeight: '13px', letterSpacing: 0 } }, 'Harness Studio'),
      h('span', { style: { flex: 'none', display: 'inline-flex', alignItems: 'center', height: '10px', padding: '0 3px', borderRadius: '2px', color: 'var(--dsw-alias-label-primary-inverted)', background: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--ds-font-family-code)', fontSize: '6px', fontWeight: 500, lineHeight: '10px', whiteSpace: 'nowrap' } }, dev ? STUDIO_VERSION + ' dev' : STUDIO_VERSION))
    }
    let layout
    const openAbout = () => {
      try { layout?.selectPanel('about') } catch (error) { console.warn('[harness-studio] About page unavailable', error) }
    }
    // Each section: an id for the contents links, a title, a summary, and items. Each item says what the
    // feature does (`what`), how it works underneath (`how`, text or a list), and why it works that way
    // (`why`). Keep every statement true of the shipped app; gaps go in NOT_YET.
    const ABOUT = [
      { id: 'loop', title: '1. The agent loop and its tools', summary: 'Harness Studio does not stop at showing code in a reply. It runs a loop against your computer: gather context, act, verify, and repeat until the task is done.', items: [
        { name: 'The loop', what: 'Each message you send starts a turn. In every step of the turn the model reads the conversation so far, decides what to do, and calls tools; their results go back to the model for the next step. The turn ends when the model answers without calling a tool.',
          how: ['Up to 10 tool calls that are safe to run together (reads, searches) run at the same time in one step; calls that change things run in order.',
            'Every model request, tool call and result is written to the session log on disk before the next step starts, so a crash or restart loses no finished work and the session can continue where it stopped.'],
          why: 'Writing each step down first means everything the model saw can be reconstructed exactly, which is what makes resuming, branching and compaction reliable.' },
        { name: 'Gathering context', what: 'The agent finds and reads the code it needs itself; you rarely have to point it at files.',
          how: ['Finding files: path patterns across the whole project, newest first, including hidden and git-ignored files but not the .git folder.',
            'Searching contents: regular expressions in ripgrep syntax, with matches grouped by file and line number. Nothing needs installing.',
            'Reading: numbered lines, any range of lines (up to 2,000 per read), and images with a model that accepts them.',
            'Git history and diffs: through the shell, with ordinary git commands.'],
          why: 'Reading exact line ranges instead of whole files keeps each request small, which keeps it fast and cheap.' },
        { name: 'Changing files', what: 'Edits replace an exact piece of text; writes create or replace a whole file.',
          how: ['An edit must match its text exactly once, so it cannot land in the wrong place.',
            'A write replaces the file in one step, so it is never left half-written.',
            'A file must be read before it is changed, and if it changed on disk since that read, the change is refused until the agent reads it again.'],
          why: 'The read-before-write rule stops the agent from overwriting changes you made while it was working.' },
        { name: 'Running and verifying', what: 'Builds, test suites and linters (npm test, pytest, cargo check and so on) run in a shell. The agent reads the errors and stack traces they print, fixes the code, and runs them again until they pass.',
          how: ['Each command runs in a fresh shell in the session’s folder, inside the sandbox described under Safety.',
            'Long commands become background jobs: the agent keeps working, can check, wait for or cancel them, and is told when they finish.',
            'Output longer than about 12,500 tokens is saved to a file; the conversation keeps a preview, and the agent can read the rest from the file.',
            'A Stop hook can refuse to let the turn end while the tests fail (see Hooks).'],
          why: 'Verifying against the real build and tests, rather than trusting the model’s own judgement, is what makes the result dependable.' },
        { name: 'Full-screen programs', what: 'Programs that take over the terminal, such as vim, less, top, interactive prompts and installers that ask questions, run in a real terminal the agent can see and type into.',
          how: ['The agent starts a program in a terminal of its own, reads the screen as plain text (with the cursor position), and sends keystrokes: text, Enter, Escape, arrows, Ctrl combinations. After each keystroke it waits until the screen stops changing.',
            'The program runs under the same sandbox and network setting as every other command, and stops when the session ends, after 30 minutes without use, or when the sandbox setting changes. Up to four run at once per session.'],
          why: 'Ordinary commands cannot answer a prompt or drive an editor; a screen the model can read and type into covers the tools that were made for people.' },
        { name: 'Seeing what changed', what: 'Each turn ends with a card listing the files it changed, with lines added and removed. Clicking a file opens its diff in the right panel.',
          how: 'The list comes from the changes the tools actually made during the turn, not from what the model says it did.' },
        { name: 'Editing files yourself', what: 'Files you open in the right panel’s Files tab open ready to edit, in a code editor with syntax colours, search and replace, multiple cursors and folding; a file opened from a link in the conversation has an Edit button. ⌘S saves.',
          how: ['While the editor has no unsaved changes, changes on disk (the agent’s, for example) appear in place within about two seconds, keeping your cursor and undo history.',
            'If the file changes on disk while you have unsaved edits, a bar asks whether to use the disk version or keep yours; a save never overwrites a change it has not shown you.',
            'Only text files inside your workspace folders, up to 2 MB, open in the editor.'],
          why: 'Small fixes are quicker to make yourself than to describe, and the conflict check means you and the agent never silently overwrite each other.' },
      ] },
      { id: 'making', title: '2. Making things', summary: 'Besides code, the agent makes documents, designs, apps and dashboards, and works with recordings, all on this computer.', items: [
        { name: 'Documents, decks and spreadsheets', what: 'The agent writes PowerPoint, Word and Excel files, with editable charts in decks and spreadsheets, renders slides to check its own layout, and exports PDF. Results open in the side pane’s preview.',
          how: 'A Python, Node and office converter bundled with the app do the work, so nothing needs installing and it works offline.' },
        { name: 'Design boards', what: 'Ask for a design or a mock-up and the agent drafts it on one board: each screen and variant side by side at phone, tablet and desktop widths, in your project’s own colours and fonts, before any app code changes.',
          how: ['The board is one HTML file with pan and zoom. It opens in the Design pane, which reloads as the agent changes it; clicking a screen there adds it to your message as a reference.', 'Each screen is drawn in a frame of its real width, so the page’s own layout rules apply as they would on that device.'] },
        { name: 'Desktop and mobile apps', what: 'The agent builds Mac, Android and Linux desktop apps, and iPhone apps when Xcode is installed, then runs and checks them: Mac apps through computer use, Android apps in a headless emulator, and web-based ones in the Browser pane.',
          how: 'Every tool’s downloads stay in the project, inside the agent’s sandbox.' },
        { name: 'Live dashboards', what: 'Ask for a dashboard and the agent builds a page of charts with a small refresh script for each data source: a spreadsheet, a CSV file, a database or warehouse through your own login, or a web API.',
          how: ['The Dashboards pane fetches fresh data each time you open a dashboard, once you have approved its refresh scripts at their exact text. An edited script stops until you approve it again.', 'Keep fresh refreshes a dashboard while it is closed; Save snapshot writes one HTML file with today’s data that you can send.'],
          why: 'Approving the exact script text means a page can never run something you have not read.' },
        { name: 'Charts, icons and diagrams', what: 'Editable charts inside PowerPoint and Excel files, and SVG files for standalone charts, icon sets and flow or architecture diagrams, drawn from your data.' },
        { name: 'Speech to text', what: 'The microphone button between the model picker and Send dictates into your message; a menu in the recording bar picks the language. The agent can also transcribe an audio or video file, or a part you marked in the Files tab, with the time each piece was said.',
          how: ['Recognition runs on this computer with Harness’s local speech model (about 241 MB, downloaded once after you agree), in Chinese, English, Cantonese, Japanese or Korean, or detected automatically. No audio leaves the computer.', 'The model leaves memory after a minute without use. When the agent needs ffmpeg to read a recording and you have none, it asks once and downloads a pinned build, checked against its published checksum.'] },
      ] },
      { id: 'control', title: '3. Control and planning', summary: 'Keeping a capable agent from making unguided changes.', items: [
        { name: 'Sending while the agent works', what: 'Enter delivers your message at the agent’s next step, as in Claude Code, so it can change course mid-turn. Until the agent reads it, Unsend beside the message takes it back and puts its text into the message box. Cmd/Ctrl+Enter queues it for after the turn instead; Settings → General → Send behavior while busy swaps the two.' },
        { name: 'Long turns', what: 'Settings → Permissions → Long turns: when one request takes 60 steps (or 120, 200, or never), the agent asks before continuing, so a stuck agent cannot run on until you notice.',
          how: ['Halfway to the limit the agent is told to sum up what it has done and to ask you if it is going in circles or needs something only you can do, such as a restart.',
            'At the limit its next tool call shows an approval card: Allow gives it another full budget, Reject ends the turn. On the command line, where nothing can ask, the call is refused.',
            'Separately, when one tool returns exactly the same result three times in a request, the agent is told the calls are not showing anything new. Harness itself already reminds it when the same call is repeated with the same arguments.'],
          why: 'Each step resends the whole conversation to the model, so an agent that keeps probing without progress spends tokens fast; a reminder and a checkpoint stop that early without limiting real long work.' },
        { name: 'Plan mode', what: 'Type /plan, optionally followed by the task. The agent explores the code, then presents a plan on a card: approve it to let the agent start, or send feedback for another round. /plan off leaves plan mode.',
          how: ['The agent is told to explore, ask about real choices, and submit a complete plan: goal, changes by area, edge cases and tests.',
            'While plan mode is on, the session’s sandbox is held at read-only, so commands and file tools cannot change files, even with an approved step-up, until you approve the plan.'],
          why: 'Instructions alone can be ignored; holding the session read-only makes "plan first" something the model cannot skip.' },
        { name: 'Access modes', what: 'Each session runs in one of three modes, chosen from the message box; the default for new sessions is in Settings.',
          how: ['Read Only: nothing can change files.',
            'Workspace Write (default): changes are allowed only inside the workspace folder and a private temporary folder.',
            'Full access: no confinement and no approval prompts. Turning it on asks you to confirm.'],
          why: 'Inside its fence the agent works without interrupting you; you are asked only when it needs to step outside.' },
        { name: 'Approvals', what: 'When a command or edit needs more than the current mode allows, the sandbox refuses it and the agent may ask for a one-time step-up, with its reason, on a card.',
          how: 'Approving covers that single action only. Every request and answer is recorded in the session.',
          why: 'You see exactly what is being widened and why, at the moment it matters.' },
        { name: 'Undoing file changes', what: 'Under each turn that changed files, Undo file changes puts those files back the way they were before that turn; from an earlier turn it also undoes the turns after it. It asks first and lists the files.',
          how: ['Just before the agent first changes a file in a turn, through its write or edit tools, a copy of the file is kept in ~/.harness-studio/harness-studio/undo/. A file the agent created is noted, so Undo removes it.',
            'Undo restores the earliest copy of each file from that turn on, removes files that did not exist, and tells the agent which files changed so it reads them again.',
            'Changes made by shell commands are not covered, as in Claude Code, because a command can touch any file without saying which. Files over 10 MB are not copied.'],
          why: 'Keeping a copy before the first change in each turn is enough to return to any earlier turn, without storing every intermediate edit.' },
        { name: 'Branching a conversation', what: 'Any finished reply can be branched into a new conversation that starts from that point, leaving the original as it was.',
          how: 'The new session copies the history up to that reply. To also put files back, use Undo file changes.' },
      ] },
      { id: 'context', title: '4. Context and memory', summary: 'What the agent knows before you say anything, what it learns, and how long sessions stay within the model’s limit.', items: [
        { name: 'Instruction files (AGENTS.md)', what: 'Rules every new session reads before it starts: build and test commands, code style, architecture boundaries, anything you would otherwise repeat.',
          how: ['Read in this order, Claude Code’s three levels with Harness Studio’s own files: your personal rules for every project (~/.harness-studio/AGENTS.md), then the project’s AGENTS.md in each folder from the repository root down to the session’s folder, each followed by that folder’s AGENTS.local.md, which is just for you.',
            'Files written for other agent tools are not read: not CLAUDE.md, CLAUDE.local.md or ~/.agents/AGENTS.md. To use a project’s CLAUDE.md rules here, move them into AGENTS.md, or make CLAUDE.md a link to AGENTS.md so both tools read one file.',
            'A line @path brings in another file, as in Claude Code: a project’s files only from inside the project, your personal file from anywhere; at most five levels, no loops.',
            'When a file changes during a session, only its changed lines are sent again.'],
          why: 'Instructions are sent with every request, so reading each rule once and sending only changes keeps every message cheaper.' },
        { name: 'Reply style', what: 'Out of the box the agent replies the way Claude Code does: the answer first, as long as the request needs, lists and tables only when the content has that shape, linked files, a one-line note before each batch of tool calls, few steps (reads and commands batched, no re-reading after an edit), and a finish that says what changed and how it was checked.',
          how: ['It is ordinary text in your global instruction file, “Global, all projects” on the Instructions page, written there on the first start. Edit it like any instruction file.',
            'It is written only when you have no global instruction file yet, and never again: a file you already had is kept, and one you change or delete stays as you left it.',
            'Harness’s own system prompt says nothing about tone or format, so these defaults do not conflict with it; a direct request in a conversation still wins.'],
          why: 'A reply you can scan, that says plainly what failed or was not checked, is quicker to act on and safer to trust, and keeping the rule in your own file means you can see and change it.' },
        { name: 'Instruction size limit', what: 'Instructions have a size limit, 128 KB by default, adjustable from 64 KB to 1 MB or off on the Instructions page.',
          how: 'Files that do not fit are left out or shortened, and a row under your message names each one with its size, so nothing is dropped silently.',
          why: 'A very large instruction set slows and costs every request; the limit makes that trade-off visible and yours to choose.' },
        { name: 'Instructions page', what: 'Below Automation tasks in the sidebar. For a chosen workspace: Harness Studio’s own system prompt with Show for the full text, each of its sections with Open (edit your own copy of that section in the text editor) and Reset, and Your additions at its end; every instruction file with its size, estimated tokens and status (loaded, skipped, not created, left out or shortened), with Open; the size limit; the agent’s memories; and the remembered rules.' },
        { name: 'Auto memory', what: 'Like Claude Code’s: the agent keeps notes for itself as it works, without asking, when you correct it, state a lasting preference, or it finds something a later session would otherwise have to rediscover.',
          how: ['Each project has a folder in ~/.harness-studio/memory/ holding one small Markdown file per fact (a description, a type: user, feedback, project or reference, the date, and the fact with why and how to apply it) and a MEMORY.md index with one line per file.',
            'Every new session in the project reads the first 200 lines of the index and opens a full memory only when it is relevant.',
            'The agent updates a memory rather than duplicating it and deletes ones that turn out wrong. A memory holds up to 4,000 characters, a project up to 200 memories, and text that looks like a password, key or token is refused.',
            'Everything is plain files; the Instructions page lists them with Open and Delete.'],
          why: 'Reading only the short index keeps the cost of memory small however much it grows.' },
        { name: 'Remember', what: 'Ask the agent to add a rule to your instruction files and it proposes a one-line note. A card asks where it goes: this project (AGENTS.local.md), all your projects (your personal AGENTS.md), or nowhere.',
          how: 'Nothing is written until you choose, and the note is an ordinary dated line you can edit or delete.' },
        { name: 'Compaction', what: 'Long sessions keep working near the model’s context limit.',
          how: ['First, oversized old tool output is cut to its beginning and end; the full output stays in the session log.',
            'If that is not enough, the oldest history is summarised in one extra model request and recent messages are kept as they are.',
            'If the provider still reports the context is full, Harness summarises and retries. /compact does it whenever you ask.',
            'Images the agent looked at through a tool, such as screenshots or video frames, are sent to the model for five more steps and then replaced by a short note naming the file; with DeepSeek’s Flash model, the reasoning from earlier turns is not sent again. Both keep long visual sessions much smaller, and the chat still shows everything.'],
          why: 'Trimming tool output first is free and often enough; summarising costs a request, so it comes second.' },
        { name: 'Lean connectors', what: 'A connector with more than 10 tools is listed by name only; its tools are loaded when the agent needs them.',
          why: 'Tool descriptions are sent with every request, so loading a large connector’s tools only when needed keeps every request smaller.' },
        { name: 'Usage at a glance', what: 'Under the message box: turns and steps, tokens used, how much the provider served from its cache, and how full the context is.' },
      ] },
      { id: 'extend', title: '5. Extensibility and orchestration', summary: 'Reaching other services, dividing work, and adding your own checks.', items: [
        { name: 'Connectors (MCP)', what: 'Add Model Context Protocol servers to give the agent access to databases, issue trackers, design tools and anything else that offers one.',
          how: ['Add a server by URL or by command from Connectors in the sidebar or in Settings. Servers that need it sign in with OAuth. Each shows its status and can be turned on or off per session from the + menu in the message box.',
            'Each connector has Ask before calls: Never (the default), Before calls that can change things (tools its server does not mark read-only), or Before every call. A call that asks waits for your approval in the conversation.'] },
        { name: 'Helper agents', what: 'For larger tasks the agent starts helper agents that work in parallel, for example one auditing security while another writes tests.',
          how: ['A helper starts either from scratch with a written task or from the conversation so far. The main agent can message, interrupt and list its helpers, and is told when each finishes.', 'The agent is told when a helper is worth it, as in Claude Code: a self-contained piece whose files, search results or images are not needed afterwards, only its conclusion, or independent pieces that can run in parallel; not a single quick lookup.'] },
        { name: 'Workflows', what: 'When you ask for one, the agent writes a workflow: a short script that coordinates many helpers, in parallel, in stages, or one feeding the next.',
          how: 'It can run in the background while the conversation continues, and it returns one combined result.' },
        { name: 'Separate sessions', what: 'The agent can hand a piece of work to a new session in the sidebar with a written brief and get that session’s report back when it finishes.',
          how: 'Optionally the new session gets its own git worktree, so its changes stay apart from yours. When splitting the work is the agent’s own idea, it asks you first. Your own new sessions can start in a worktree too: turn on New worktree on the New Session screen before sending the first message.' },
        { name: 'Hooks', what: 'Your own shell commands that run at fixed points, in the same file format as Claude Code, so hooks can be copied between the two. Typical uses: format each edited file, refuse force-pushes, run the linter after edits, keep working until the tests pass.',
          how: ['Before a tool call (PreToolUse): block it with a reason the agent reads, or ask you on an approval card.',
            'After a successful call (PostToolUse): report a problem back to the agent or add context for its next step.',
            'When the agent is about to finish (Stop): send it back to work, at most three times per turn.',
            'A hook receives the call as JSON on standard input, blocks by exiting with code 2 or by printing a JSON decision, runs for up to 60 seconds by default (600 at most), and matches tools by Harness’s name or Claude Code’s, such as bash or Bash.',
            'Your hooks live in ~/.harness-studio/hooks.json; a project’s in .harness-studio/hooks.json (shared) and hooks.local.json (just you). A project’s hooks came with the repository, so they run only after you allow them on a card, and the answer holds until the file changes.'],
          why: 'Hooks turn your team’s rules into checks that always run, instead of instructions the model might forget.' },
        { name: 'Browser, previews and your Chrome', what: 'A browser in the right panel that the agent can use to open, read, click and type, with you watching and able to take over.',
          how: ['Detect and preview your dev server, then pick an element or annotate the page to show the agent exactly what to change.',
            'Clicks and typing are real mouse and keyboard input, not scripted events, so pages behave as they do for you.',
            'In the desktop app the agent can also read what DevTools would show: the page’s console with uncaught errors and their stack traces, its network requests with status codes and failures, and the body of any response. This works only on pages on this computer or your local network, such as your dev server; DevTools never attaches to public sites, which can detect it, and detaches when a page leaves a local address.',
            'An optional extension lets the agent work in your real Chrome, where you are signed in, and lets you pick elements on any page with ⌥⇧S.',
            'The agent is told to use the Browser pane for your own apps on this computer, and your Chrome for websites; it uses the pane for a website only when you ask.'],
          why: 'Front-end bugs usually show up as a console error or a failed request; reading those directly beats guessing from a screenshot.' },
      ] },
      { id: 'panes', title: '6. Panes and pages', summary: 'What sits around the conversation: the right panel’s panes, and the pages in the sidebar.', items: [
        { name: 'The right panel', what: 'Terminal, Browser and Files are icons in the session header, as in Claude Code desktop, and the Panes menu beside them opens every pane: Session details, Terminal, Changes, Browser, Files, Design and Dashboards, with Watches at its foot. Up to two show at once, stacked, with a bar between them you can drag.',
          how: ['Opening a third pane replaces the bottom one. Closing panes never brings back ones you closed earlier, and closing the last one closes the panel.',
            'Each pane header has a layout button that opens a menu to move the pane, fill the panel with it, or open it in a new window; the expand button fills the whole window with it; × closes it.',
            'A browser pane keeps its own tabs; + opens a new tab in that pane. Drag the panel’s edge to make it wider; it first opens at about a third of the window.'] },
        { name: 'Session pane', what: 'One place for the session’s state: where it runs (this computer, the folder and the branch), the uncommitted changes with a Review button, the usage readings from under the message box, and its background tasks.',
          how: ['Background tasks lists what is still working for the session: commands the agent left running in the background, workflows, helper agents, programs in the agent’s terminal and watches, each with how long it has run and a stop button.',
            'Finished ones sit behind an "N finished" row, newest first, with what ended them (program stopped, watch removed) and how long they ran.'],
          why: 'Background work otherwise shows up in several different places, or nowhere; one list makes it easy to see and stop.' },
        { name: 'Changes pane', what: 'The session folder’s uncommitted changes against its branch, like Claude Code desktop’s: each file with its lines added and removed, small diffs open, syntax colours, refreshed every few seconds.',
          how: 'Git runs in a small read-only helper with the repository’s hooks, filters and external programs switched off, so refreshing the pane can never start a program the repository names.' },
        { name: 'Files', what: 'A tree of the session folder beside tabs of open files, like Claude Code desktop’s. Type to filter by file name, or start with ? to search inside files and jump to the line.',
          how: ['A single click opens a preview tab (its name in italics) that the next file replaces; editing it or double-clicking keeps it open.',
            'Files open ready to edit (see Editing files yourself). The button at the left of the pane header hides or shows the tree; drag the tree’s edge to resize it.', 'Every file opens here, as in Claude Code: PDFs, images, Excel workbooks, and Word and PowerPoint documents in Harness’s own viewers, and text files in the editor. Markdown, web pages, CSV files and SVG images have a Rendered / Source switch that starts in the view you chose last; CSV files render as a table.', 'A file card, file link or reference in the conversation opens its file here too, with the tree hidden so the file has the room; the tree button brings it back.', 'Videos and audio play here. Under the player, Set start and Set end mark a part, and Add to message puts it in your message as a reference such as [clip.mp4, 1:10.4 to 1:25.0], so the agent can cut, change or transcribe exactly that part.'] },
        { name: 'Terminal', what: 'A terminal for you in the right panel, opened from the session header, next to the conversation.' },
        { name: 'Git page', what: 'Git, in the sidebar below Instructions, opens in the main area beside the sidebar, like the other sidebar pages. Pick All workspaces for an overview, or one workspace for its history.',
          how: ['Overview: each workspace’s branch, how far it is ahead of or behind its upstream (as git last saw it; nothing is fetched), its uncommitted files and its last commit.',
            'History: commits 100 at a time with a branch graph (the current branch or all branches), and search by message, author or changed code.',
            'A commit opens full width with its message, author, date and parents, and its files; each file shows its diff, or Blame: who last changed each line as of that commit.',
            'The Branch menu switches the workspace to another local branch in one click. It refuses while anything is uncommitted, while an agent is working in that workspace, and for a branch checked out in another worktree. Switching is the only change the page makes.'],
          why: 'Looking back through history is quicker on a page than through git commands in a terminal; refusing to switch with uncommitted work means a switch can never carry or lose it.' },
      ] },
      { id: 'sessions', title: '7. Sessions', summary: 'Picking work up again, running it on a schedule, and running it from a terminal.', items: [
        { name: 'Command line', what: 'A harness-studio command for the terminal: on macOS from App menu → Install Command-Line Tool, on Linux installed with the .deb. Give it a task, or pipe text into it, and it runs one session in the current folder, prints the answer and exits, for scripts and CI; with no task it opens a full-screen chat in the terminal, in the style of Claude Code: a welcome box, the conversation in the terminal’s scrollback, tool calls with their results, a spinner while the agent works, an input box with the status line under it, a / menu of commands, and approvals as a Yes/No box chosen with the arrow keys (--plain keeps plain lines).',
          how: ['It uses the app’s home folder, so it shares your settings, network setting, connectors, memory and hooks, and the model key you saved in the app; with no saved key it uses DEEPSEEK_API_KEY from the environment.',
            'Exit code 0 means the task finished and 1 means it failed; --json prints a stream of events for scripts, and --session-id continues an earlier session.',
            'In the chat, an action that needs your approval asks “Allow once? [y/N]” on the input line; a one-task run cannot ask, so it refuses those. A project’s hooks run only if you allowed them in the app.',
            'In the chat, /help lists commands: /compact, /plan, /permission and /goal as in the app, /clear for a new session and /model; each reply ends with a line showing the model, tokens, context use and permission mode.'],
          why: 'The same agent, rules and memory work both in the window and in automated jobs.' },
        { name: 'Every session is kept', what: 'Sessions stay in the sidebar under their workspace; open one to continue exactly where it stopped, even after quitting the app.',
          how: 'Each session is an append-only log on disk, compressed, holding every message, tool call and result.' },
        { name: 'Finding and organising', what: 'Search (⌘K) finds sessions by title. View options group sessions by workspace, by folder tree or in one list, and order or filter them. New Session (⌘N) starts one in the current workspace.' },
        { name: 'Automation tasks', what: 'Run a prompt on a schedule from Automation tasks in the sidebar, for example a daily check of a repository.' },
        { name: 'Watches', what: 'Cheap checks that wake the agent only when something changes: a command’s output (git status, a linter, a test run), a port on this computer going up or down, or files changing. Ask the agent to watch something, or add a watch from the eye button in the session header, which also lists and removes them.',
          how: ['A watch runs on your computer without the model: a command every few seconds (5 at least) under the session’s sandbox and network setting, a connection attempt for a port, or the operating system’s file events. Each result is compared with the last one the agent knew.',
            'Only an idle agent is woken, with a short notice of what changed. While it works, checks report nothing, and when a turn ends each watch takes the state then as its new starting point, so the agent’s own edits never wake it.',
            'Each watch waits at least a minute between notices by default (changes in between are merged), sends 20 notices at most, ends after a day unless given longer (a week at most), and is removed when its session is archived. They are kept in ~/.harness-studio/harness-studio/watches.json and resume when the app starts.'],
          why: 'A scheduled check costs a full model turn every time it runs; a watch costs nothing while nothing changes.' },
      ] },
      { id: 'safety', title: '8. Safety model', summary: 'What actually stops a command, and what it does not cover.', items: [
        { name: 'Operating-system sandbox', what: 'Every command the agent runs is confined by the operating system, not by the model’s good behaviour.',
          how: ['macOS: Seatbelt. Linux: bubblewrap, with Landlock as a fallback when bubblewrap is missing.',
            'The file tools follow the same rules as commands.',
            'If confinement cannot be set up, the command does not run at all rather than running unconfined.'],
          why: 'A web page or file can trick a model into running something harmful; the operating system enforces the boundary whatever the model decides, and that is what lets the agent work without asking about every command.' },
        { name: 'Secret files', what: 'Commands the agent runs and its file tools cannot read well-known secret files: SSH keys, cloud and registry credentials, password files, ~/.env, Harness Studio’s own API keys, and .env files outside the workspace.',
          how: ['Hidden: ~/.ssh (except known_hosts and config, so ssh can still connect through an ssh agent), ~/.aws, ~/.config/gcloud, ~/.netrc, ~/.git-credentials, ~/.npmrc, ~/.docker/config.json, ~/.env, the database logins (Snowflake\u2019s connections, ~/.databrickscfg and ~/.databricks, ~/.pgpass and ~/.pg_service.conf, ~/.my.cnf and ~/.mylogin.cnf), and ~/.harness-studio/.credentials.yaml and .env.',
            'macOS: the operating system refuses to read them (names and sizes stay visible), symlinks included. Linux: each one that exists is covered by an empty folder or an empty file; .env files in other projects cannot be named in advance and stay readable there, and without bubblewrap nothing is hidden from commands.',
            'The read, edit, write and search tools refuse the same files. The workspace’s own .env files stay readable, since the agent often needs them.',
            'The agent is told which files are hidden. A command that genuinely needs one, such as git over ssh without an ssh agent, fails until you approve it with full access, which lifts the list for that command.'],
          why: 'A README or web page can carry instructions for the model. If the agent can read your keys, such an injection can have it send them anywhere, by a command, a web fetch or a page it opens; files it cannot read cannot leak.' },
        { name: 'Cloud logins for commands', what: 'Settings → Permissions → Cloud logins for commands lets the agent’s commands use your existing Google Cloud, AWS, Azure, Kubernetes, Snowflake, Databricks, PostgreSQL or MySQL login, so gcloud, aws, az, kubectl, snow, databricks, psql or mysql run as you without signing in. Each is off by default; the first command using a login in a session asks you once.',
          how: ['Switched off, the sandbox hides that login’s files from commands, as it hides SSH keys and other credentials.', 'Switched on, its files are readable to commands and its folders also writable, so the CLI can refresh its tokens; a login kept in one file, such as ~/.pgpass or ~/.my.cnf, is only readable. Everything else stays hidden.'],
          why: 'Cloud and database work without signing in again in every session, and without turning the sandbox off.' },
        { name: 'Network for commands', what: 'Settings → Permissions → Network for commands decides whether commands the agent runs can reach the internet: On (the default), Off, or Only allowed sites with a list you edit. A change applies from the next command.',
          how: ['Off: the operating system refuses connections to other computers. On macOS commands can still reach this computer (local dev servers); on Linux each command gets an isolated network of its own.',
            'Only allowed sites: direct connections are refused the same way, and HTTP and HTTPS go through a small proxy built into the app that lets through only the listed sites. Other sites get a refusal that names them, so the agent knows why. An entry matches that exact name; *.example.com matches its subdomains. The list starts with common package and code hosts (npm, PyPI, GitHub).',
            'Programs that ignore the standard proxy settings cannot connect at all, and other protocols such as ssh only work with the network On.',
            'The agent is told the current setting, and can ask you to approve a single command with full access when it needs more.'],
          why: 'Blocking writes alone does not stop a tricked command from sending your files somewhere; limiting where commands can connect closes that gap, as Claude Code’s sandbox does.' },
        { name: 'Asking before new sites', what: 'Web fetch, Browser pane pages the agent opens and pages it opens in your Chrome ask you before reaching a site for the first time in a session. Once you allow a site, the session reaches it again without asking.',
          how: ['These reach the internet from the app itself, not through a command, so Network for commands cannot limit them. Instead, before one goes to a new site, the conversation shows an approval naming the site; rejecting it stops the request before anything is sent. Always allow for this website saves the site so it never asks again; Settings → Permissions → Always-allowed sites removes it.',
            'No question for this computer (localhost, 127.0.0.1) or, while Network for commands is set to Only allowed sites, for the sites on that list. Back, forward and reload never ask.',
            'Approvals last for the session while the app runs; a new session, a helper agent’s session, or a restart asks again. Full access lifts the check, as it lifts the sandbox.',
            'Once a page is open, the agent’s clicks and typing act inside it, and the page itself can load from or send to other sites. The Browser pane and your Chrome show everything the agent does there.'],
          why: 'A web address can carry anything the agent has read, so a prompt injection could have it fetch https://attacker.example/?key=… with no command involved. Asking the first time each site is reached puts you between a tricked agent and a new destination without a question for every page.' },
        { name: 'Command rules', what: 'Rules that block a tool call or ask you first, in Claude Code’s permission format, so rules can be copied between the two. For example: never run curl, ask before git push, never read ./.env, ask before editing migrations, never call a connector’s delete tool.',
          how: ['Yours live in ~/.harness-studio/permissions.json; a project’s in .harness-studio/permissions.json (shared) and permissions.local.json (just you). Rules only take away, so a project’s rules apply without asking you.',
            'Bash rules match a command or its prefix and check every part of a compound command (&&, ;, | and $(…)) on its own; they also cover programs started in the agent’s terminal and Watch commands. Read and Edit rules take .gitignore-style paths; WebFetch rules take a domain; connector rules name a server or one of its tools.',
            'Deny wins over ask. A denied call returns the rule and the file it came from to the agent; an asked call waits for your approval.'],
          why: 'The sandbox decides where things can happen; rules let you rule out specific actions everywhere, without writing a hook script.' },
        { name: 'What the sandbox does not cover', what: 'It limits where files can be changed, hides the secret files above, and, when you choose, limits where commands can connect. Anything else the agent can read, it can send out.',
          how: ['Commands and file tools can read files outside the workspace that are not on the secret list, and the workspace’s own .env files. With the network On, commands can send what they read anywhere.',
            'Network for commands covers commands only. Web fetch and the pages the agent opens ask before each new site (above), but a site you allow can receive what the agent puts in its addresses or types into its pages.',
            'Connectors do not ask by default: they reach services you added and signed in to, and a tricked agent can put what it read into a connector call, such as a message or an issue. Set Ask before calls on a connector that can send things where others can read them. Web search sends its queries to the search provider without asking.',
            'Full access turns the sandbox off for that session or command, network limits and hidden files included.',
            'On Linux without bubblewrap the network cannot be limited, so commands refuse to run while it is set to Off or Only allowed sites.',
            'Hooks are your own commands and run outside the sandbox, as in Claude Code.'] },
      ] },
      { id: 'app', title: '9. Look, privacy and updates', summary: 'The rest of the app.', items: [
        { name: 'Calmer interface', what: 'Denser rows, text sizes and a sidebar modelled on Claude Code desktop, in Harness’s own colours, in light and dark. Drag the sidebar’s edge to resize it; long messages fold with Show more.' },
        { name: 'Prompt history', what: 'Up in an empty message box brings back the prompts you sent in this chat, newest first; Down steps forward and returns what you were typing.' },
        { name: 'Colour themes', what: 'Settings → Appearance → Colour theme: Warm, Graphite, Nord, Solarized or High contrast on top of the default look. Each has a light and a dark version, so Light or dark still chooses light, dark or system.' },
        { name: 'Chat font and zoom', what: 'Settings → Appearance → Chat font: the system font by default, installed presets, or any font you name. ⌘+ and ⌘− zoom the whole app; ⌘0 resets.' },
        { name: 'No account, no telemetry', what: 'There is no sign-in, and usage reporting is turned off. Your conversations go only to the model provider you configured.' },
        { name: 'Your data', what: 'Settings → Data lists where Harness Studio keeps things on this computer, with each part’s size and an Open button: conversations, auto memory, Undo copies, settings and rules, keys (size only), and the window’s own browser data.' },
        { name: 'Updates', what: 'Check for Updates opens the Releases page, which lists each version’s changes and downloads for macOS and Linux. The app is not signed by Apple, so the first launch on a Mac needs the steps in the Guide.' },
      ] },
    ]
    const NOT_YET = [
      ['A full design canvas', 'design boards cover drafting; frames you drag by hand, comments and a design-system library are planned'],
      ['Image generation', 'there is no image model yet; graphics are drawn as code'],
      ['Slide and document templates', 'each file is styled from scratch for now'],
      ['Video making', 'planned as a separate app, to keep Harness Studio light'],
      ['The command-line tool from the AppImage', 'on Linux it comes with the .deb'],
      ['Windows', 'paused; macOS and Linux are supported'],
    ]
    const ABOUT_CSS = `
      .hsa-page { box-sizing: border-box; height: 100%; overflow: auto; padding: 0 clamp(24px, 4vw, 48px) 64px; color: var(--dsw-alias-label-primary); font-size: 14px; scroll-behavior: smooth; container-type: inline-size; }
      .hsa-layout { max-width: 1140px; margin: 0 auto; display: flex; align-items: flex-start; gap: 36px; }
      .hsa-inner { flex: 1; min-width: 0; max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; gap: 28px; }
      /* The index, beside the text while it scrolls (shown when there is room): every section with its number, and
         the features of the section being read, with the current one marked. */
      .hsa-index { display: none; flex: none; width: 224px; position: sticky; top: 0; max-height: 100vh; overflow-y: auto; box-sizing: border-box; padding: 28px 8px 32px 0; font-size: 13px; line-height: 18px; scrollbar-width: thin; }
      [data-platform="darwin"] .hsa-index { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      .hsa-index-title { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-tertiary); margin: 0 0 8px 8px; }
      .hsa-index button { display: block; width: 100%; text-align: left; border: none; background: transparent; font: inherit; cursor: pointer; border-radius: 6px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hsa-index button:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .hsa-index .hsa-index-section { display: flex; align-items: center; gap: 9px; padding: 5px 8px; font-weight: 500; }
      .hsa-index-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .hsa-index-num { flex: none; width: 18px; height: 18px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; font-size: 10.5px; font-weight: 600; line-height: 1; color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
      .hsa-index .hsa-index-section[data-open] { color: var(--dsw-alias-label-primary); }
      .hsa-index-section[data-open] .hsa-index-num { color: var(--dsw-alias-bg-layer-1, #fff); background: var(--dsw-alias-label-primary); }
      .hsa-index-items { margin: 1px 0 6px 17px; padding-left: 9px; border-left: 1px solid var(--dsw-alias-border-l2); }
      .hsa-index .hsa-index-item { position: relative; padding: 3px 8px; font-size: 12.5px; }
      .hsa-index .hsa-index-item[aria-current="true"] { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent); }
      .hsa-index-item[aria-current="true"]::before { content: ''; position: absolute; left: -10px; top: 4px; bottom: 4px; width: 2px; border-radius: 1px; background: var(--dsw-alias-label-primary); }
      .hsa-index-later { margin-top: 6px; padding-top: 6px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      /* Narrow windows: the same index as one menu above the text. */
      .hsa-jump { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .hsa-jump select { height: 30px; min-width: 0; max-width: 100%; padding: 0 28px 0 10px; border-radius: 8px; border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; }
      @container (min-width: 860px) {
        .hsa-index { display: block; }
        .hsa-jump { display: none !important; }
      }
      .hsa-card { scroll-margin-top: 20px; }
      .hsa-head { padding-top: 28px; }
      [data-platform="darwin"] .hsa-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      .hsa-title { margin: 0; font-size: 22px; font-weight: 500; line-height: 30px; }
      .hsa-intro { margin: 6px 0 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
      .hsa-links { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 12px; font-size: 13px; }
      .hsa-links a { color: var(--dsw-alias-label-link, var(--dsw-alias-accent-primary, #3b82f6)); text-decoration: none; }
      .hsa-links a:hover { text-decoration: underline; }
      .hsa-dev { margin-top: 20px; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; }
      .hsa-dev-name { font-size: 13px; color: var(--dsw-alias-label-secondary); }
      .hsa-dev-name strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
      .hsa-dev-device { margin-top: 2px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .hsa-dev-links { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; font-size: 13px; }
      .hsa-dev-item { display: inline-flex; align-items: baseline; gap: 5px; }
      .hsa-dev-label { color: var(--dsw-alias-label-tertiary); }
      .hsa-dev-support { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin-top: 8px; padding-top: 8px; border-top: 0.5px solid var(--dsw-alias-border-l2); font-size: 13px; }
      .hsa-dev-links a, .hsa-dev-support a { color: var(--dsw-alias-label-link, var(--dsw-alias-accent-primary, #3b82f6)); text-decoration: none; border-radius: 3px; }
      .hsa-dev-links a:hover, .hsa-dev-support a:hover { text-decoration: underline; }
      .hsa-dev-links a:focus, .hsa-dev-support a:focus { text-decoration: none; outline: none; }
      .hsa-dev-links a:focus-visible, .hsa-dev-support a:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
      .hsa-section { scroll-margin-top: 16px; margin-top: 16px; padding-top: 32px; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .hsa-h2 { margin: 0; display: flex; align-items: baseline; gap: 10px; font-size: 18px; font-weight: 600; line-height: 26px; }
      .hsa-num { flex: none; min-width: 26px; height: 26px; padding: 0 6px; box-sizing: border-box; border-radius: 13px; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); background: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent); }
      .hsa-summary { margin: 6px 0 22px; font-size: 13.5px; line-height: 21px; color: var(--dsw-alias-label-secondary); }
      .hsa-items { display: flex; flex-direction: column; gap: 24px; }
      .hsa-card { border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 20px 22px; }
      .hsa-name { font-size: 15px; font-weight: 600; line-height: 22px; }
      .hsa-text { margin-top: 4px; font-size: 13.5px; line-height: 21px; color: var(--dsw-alias-label-secondary); }
      .hsa-part { margin-top: 16px; }
      .hsa-part .hsa-text { margin-top: 2px; }
      .hsa-label { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--dsw-alias-label-tertiary); }
      .hsa-details { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }
      .hsa-details li { margin-top: 6px; }
      .hsa-later { color: var(--dsw-alias-label-tertiary); }
      .hsa-later-row { padding: 10px 0; border-top: 0.5px solid var(--dsw-alias-border-l2); }
      .hsa-later-row:first-child { border-top: none; padding-top: 0; }
      .hsa-later-row:last-child { padding-bottom: 0; }
      .hsa-foot { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
    `
    function AboutPage() {
      const page = React.useRef(null)
      const jump = id => page.current?.querySelector(`[data-about-section="${id}"]`)?.scrollIntoView({ block: 'start' })
      const jumpItem = key => page.current?.querySelector(`[data-about-item="${key}"]`)?.scrollIntoView({ block: 'start' })
      // The feature being read: the last one whose top has scrolled above a line near the top of the page.
      const [current, setCurrent] = React.useState(null)
      React.useEffect(() => {
        const root = page.current
        if (!root) return undefined
        let frame = 0
        const update = () => {
          frame = 0
          const line = root.getBoundingClientRect().top + 120
          let found = null
          for (const el of root.querySelectorAll('[data-about-item], [data-about-section="later"]')) {
            if (el.getBoundingClientRect().top <= line) found = el.getAttribute('data-about-item') ?? 'later'
            else break
          }
          setCurrent(found)
        }
        const onScroll = () => { if (!frame) frame = requestAnimationFrame(update) }
        root.addEventListener('scroll', onScroll, { passive: true })
        update()
        return () => { root.removeEventListener('scroll', onScroll); if (frame) cancelAnimationFrame(frame) }
      }, [])
      // Keep the highlighted line in view inside the index as the page scrolls.
      React.useEffect(() => {
        const index = page.current?.querySelector('.hsa-index')
        const active = index?.querySelector('[aria-current="true"]')
        if (!index || !active) return
        const box = index.getBoundingClientRect()
        const at = active.getBoundingClientRect()
        if (at.top < box.top + 40 || at.bottom > box.bottom - 24) index.scrollTop += at.top - box.top - box.height / 3
      }, [current])
      const split = title => ({ num: title.split('. ')[0], label: title.split('. ').slice(1).join('. ') })
      // The section being read: the current feature's, else the first.
      const open = current === 'later' ? 'later' : (current?.split(':')[0] ?? ABOUT[0].id)
      const index = h('nav', { className: 'hsa-index', 'aria-label': 'On this page' },
        h('div', { className: 'hsa-index-title' }, 'On this page'),
        ...ABOUT.map(section => {
          const { num, label } = split(section.title)
          return h(React.Fragment, { key: section.id },
            h('button', { type: 'button', className: 'hsa-index-section', 'data-open': open === section.id ? '' : undefined, title: label, onClick: () => jump(section.id) },
              h('span', { className: 'hsa-index-num', 'aria-hidden': 'true' }, num), h('span', { className: 'hsa-index-label' }, label)),
            open === section.id ? h('div', { className: 'hsa-index-items' },
              ...section.items.map((item, i) => {
                const key = `${section.id}:${i}`
                return h('button', { key, type: 'button', className: 'hsa-index-item', title: item.name, 'aria-current': current === key ? 'true' : undefined, onClick: () => jumpItem(key) }, item.name)
              })) : null)
        }),
        h('button', { type: 'button', className: 'hsa-index-section hsa-index-later', 'data-open': open === 'later' ? '' : undefined, 'aria-current': current === 'later' ? 'true' : undefined, onClick: () => jump('later') },
          h('span', { className: 'hsa-index-num', 'aria-hidden': 'true' }, '…'), h('span', { className: 'hsa-index-label' }, 'Not yet')))
      const jumpMenu = h('label', { className: 'hsa-jump' }, 'Jump to',
        h('select', { value: '', 'aria-label': 'Jump to a section or feature', onChange: e => {
          const value = e.target.value
          if (value.includes(':')) jumpItem(value)
          else if (value) jump(value)
        } },
          h('option', { value: '' }, 'Choose a section or feature…'),
          ...ABOUT.map(section => h('optgroup', { key: section.id, label: section.title },
            h('option', { value: section.id }, `${split(section.title).label}: overview`),
            ...section.items.map((item, i) => h('option', { key: i, value: `${section.id}:${i}` }, item.name)))),
          h('option', { value: 'later' }, 'Not yet')))
      return h('div', { className: 'hsa-page', ref: page },
        h('style', null, ABOUT_CSS),
        h('div', { className: 'hsa-layout' },
        index,
        h('div', { className: 'hsa-inner' },
          h('div', { className: 'hsa-head' },
            h('h1', { className: 'hsa-title' }, 'About Harness Studio'),
            h('p', { className: 'hsa-intro' }, 'Harness Studio is a desktop app for macOS and Linux that runs a coding agent on your own computer. It is built on DeepSeek Harness, an open-source agent runtime, and adds what people expect from Claude Code: an operating-system sandbox with approvals, enforced plan mode, undo for file changes, hooks, memory that carries across sessions, connectors, a browser with app previews, side panes for the session, its changes and files, a Git history page, and a calmer interface. It also makes documents, design boards, apps and live dashboards, and transcribes speech on this computer. You choose the model provider in Settings → Models and bring your own key.'),
            h('p', { className: 'hsa-intro' }, 'This page explains each part: what it does, how it works underneath, and why it works that way.'),
            h('div', { className: 'hsa-links' },
              h('a', { href: REPO + '/releases', target: '_blank', rel: 'noreferrer' }, 'Releases and updates'),
              h('a', { href: REPO + '#readme', target: '_blank', rel: 'noreferrer' }, 'Guide'),
              h('a', { href: REPO + '/issues', target: '_blank', rel: 'noreferrer' }, 'Report a problem')),
            h('div', { className: 'hsa-dev', 'data-about-developer': '' },
              h('div', { className: 'hsa-dev-name' }, 'Made by ', h('strong', null, DEVELOPER.name)),
              h('div', { className: 'hsa-dev-device' }, DEVELOPER.device),
              h('div', { className: 'hsa-dev-links' },
                ...DEVELOPER.links.map(([label, href, text]) => h('span', { key: label, className: 'hsa-dev-item' },
                  h('span', { className: 'hsa-dev-label' }, label),
                  h('a', { href, target: '_blank', rel: 'noreferrer', 'aria-label': label + ': ' + text }, text)))),
              h('div', { className: 'hsa-dev-support', 'data-about-support': '' },
                h('span', { className: 'hsa-dev-label' }, 'Support Harness Studio'),
                ...DEVELOPER.support.map(([label, href]) => h('a', { key: label, href, target: '_blank', rel: 'noreferrer' }, label))))),
          jumpMenu,
          ...ABOUT.map(section => h('section', { key: section.id, className: 'hsa-section', 'data-about-section': section.id },
            h('h2', { className: 'hsa-h2' }, h('span', { className: 'hsa-num' }, section.title.split('. ')[0]), section.title.split('. ').slice(1).join('. ')),
            h('p', { className: 'hsa-summary' }, section.summary),
            h('div', { className: 'hsa-items' },
              ...section.items.map((item, i) => h('article', { key: item.name, className: 'hsa-card', 'data-about-item': `${section.id}:${i}` },
                h('div', { className: 'hsa-name' }, item.name),
                h('div', { className: 'hsa-text' }, item.what),
                item.how ? h('div', { className: 'hsa-part' }, h('div', { className: 'hsa-label' }, 'How it works'),
                  Array.isArray(item.how)
                    ? h('ul', { className: 'hsa-details' }, ...item.how.map(line => h('li', { key: line }, line)))
                    : h('div', { className: 'hsa-text' }, item.how)) : null,
                item.why ? h('div', { className: 'hsa-part' }, h('div', { className: 'hsa-label' }, 'Why'), h('div', { className: 'hsa-text' }, item.why)) : null))))),
          h('section', { className: 'hsa-section', 'data-about-section': 'later' },
            h('h2', { className: 'hsa-h2' }, 'Not yet'),
            h('p', { className: 'hsa-summary' }, 'Known gaps compared with Claude Code, so nothing here promises more than the app does.'),
            h('div', { className: 'hsa-card' },
              ...NOT_YET.map(([name, state]) => h('div', { key: name, className: 'hsa-later-row' },
                h('span', { className: 'hsa-name' }, name), h('span', { className: 'hsa-later' }, ` — ${state}`))))),
          h('p', { className: 'hsa-foot' }, 'Harness Studio is an independent open-source project by ' + DEVELOPER.name + ', under the MIT licence. It is not affiliated with or endorsed by DeepSeek or Anthropic.'))))
    }

    // ---- chat font ---------------------------------------------------------------------------------
    const FONT_KEY = 'harness-studio.chat-font'
    // Presets, in groups. `probe` is the face looked for to decide whether the preset is offered: a preset
    // shows only when that font is installed (System and the generic families always show).
    const FONT_CHOICES = [
      { id: 'system', group: 'Sans-serif', label: 'System', stack: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif' },
      { id: 'helvetica', group: 'Sans-serif', label: 'Helvetica Neue', probe: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
      { id: 'avenir', group: 'Sans-serif', label: 'Avenir Next', probe: 'Avenir Next', stack: '"Avenir Next", Avenir, -apple-system, sans-serif' },
      { id: 'verdana', group: 'Sans-serif', label: 'Verdana', probe: 'Verdana', stack: 'Verdana, Geneva, -apple-system, sans-serif' },
      { id: 'gill', group: 'Sans-serif', label: 'Gill Sans', probe: 'Gill Sans', stack: '"Gill Sans", "Gill Sans MT", -apple-system, sans-serif' },
      { id: 'optima', group: 'Sans-serif', label: 'Optima', probe: 'Optima', stack: 'Optima, Candara, -apple-system, sans-serif' },
      { id: 'rounded', group: 'Sans-serif', label: 'Rounded', stack: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif' },
      { id: 'noto-sans', group: 'Sans-serif', label: 'Noto Sans', probe: 'Noto Sans', stack: '"Noto Sans", -apple-system, system-ui, sans-serif' },
      { id: 'dejavu-sans', group: 'Sans-serif', label: 'DejaVu Sans', probe: 'DejaVu Sans', stack: '"DejaVu Sans", -apple-system, system-ui, sans-serif' },
      { id: 'serif', group: 'Serif', label: 'New York', stack: 'ui-serif, "New York", Charter, Georgia, "Times New Roman", serif' },
      { id: 'georgia', group: 'Serif', label: 'Georgia', probe: 'Georgia', stack: 'Georgia, "Times New Roman", serif' },
      { id: 'charter', group: 'Serif', label: 'Charter', probe: 'Charter', stack: 'Charter, "Bitstream Charter", Georgia, serif' },
      { id: 'iowan', group: 'Serif', label: 'Iowan Old Style', probe: 'Iowan Old Style', stack: '"Iowan Old Style", Georgia, serif' },
      { id: 'palatino', group: 'Serif', label: 'Palatino', probe: 'Palatino', stack: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif' },
      { id: 'baskerville', group: 'Serif', label: 'Baskerville', probe: 'Baskerville', stack: 'Baskerville, "Libre Baskerville", Georgia, serif' },
      { id: 'noto-serif', group: 'Serif', label: 'Noto Serif', probe: 'Noto Serif', stack: '"Noto Serif", Georgia, serif' },
      { id: 'mono', group: 'Monospace', label: 'Fira Code', probe: 'Fira Code', stack: '"Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
      { id: 'sf-mono', group: 'Monospace', label: 'SF Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
      { id: 'menlo', group: 'Monospace', label: 'Menlo', probe: 'Menlo', stack: 'Menlo, Monaco, Consolas, monospace' },
      { id: 'jetbrains', group: 'Monospace', label: 'JetBrains Mono', probe: 'JetBrains Mono', stack: '"JetBrains Mono", ui-monospace, Menlo, monospace' },
      { id: 'dejavu-mono', group: 'Monospace', label: 'DejaVu Sans Mono', probe: 'DejaVu Sans Mono', stack: '"DejaVu Sans Mono", ui-monospace, monospace' },
      { id: 'comic', group: 'Playful', label: 'Comic Sans', probe: 'Comic Sans MS', stack: '"Comic Sans MS", "Comic Neue", "Chalkboard SE", "Comic Sans", cursive' },
      { id: 'chalkboard', group: 'Playful', label: 'Chalkboard', probe: 'Chalkboard SE', stack: '"Chalkboard SE", Chalkboard, "Comic Sans MS", cursive' },
      { id: 'marker', group: 'Playful', label: 'Marker Felt', probe: 'Marker Felt', stack: '"Marker Felt", "Comic Sans MS", cursive' },
      { id: 'trebuchet', group: 'Playful', label: 'Trebuchet', probe: 'Trebuchet MS', stack: '"Trebuchet MS", -apple-system, sans-serif' },
    ]
    /** Whether a font is installed: text drawn in it measures differently from both generic fallbacks. */
    const installedFonts = new Map()
    function isInstalled(name) {
      if (installedFonts.has(name)) return installedFonts.get(name)
      let found = true
      try {
        const context = document.createElement('canvas').getContext('2d')
        const sample = 'mmmmmmmmmmlli1WQ@#'
        found = ['monospace', 'serif'].some(fallback => {
          context.font = `72px ${fallback}`
          const base = context.measureText(sample).width
          context.font = `72px "${name}", ${fallback}`
          return context.measureText(sample).width !== base
        })
      } catch { /* no canvas: offer it */ }
      installedFonts.set(name, found)
      return found
    }
    const quoteFont = name => `"${name.replace(/["\\]/g, '')}", -apple-system, system-ui, sans-serif`
    /** The saved choice: a preset id, or `custom:<font name>`. Storage can be unavailable; the default applies then. */
    const readFont = () => { try { return localStorage.getItem(FONT_KEY) || 'system' } catch { return 'system' } }
    const fontStack = choice => choice.startsWith('custom:') && choice.length > 7
      ? quoteFont(choice.slice(7))
      : (FONT_CHOICES.find(f => f.id === choice) ?? FONT_CHOICES[0]).stack
    const fontListeners = new Set()
    function applyFont(choice) {
      document.documentElement.style.setProperty('--hs-chat-font', fontStack(choice))
    }
    function saveFont(choice) {
      try { localStorage.setItem(FONT_KEY, choice) } catch { /* not saved; still applied for this window */ }
      applyFont(choice)
      for (const listener of fontListeners) listener(choice)
    }

    /** The look of a settings row: this plugin's own classes, defined with the values of Harness's rows. */
    const ROW_CLASSES = { row: 'hs-setting', text: 'hs-setting-text', title: 'hs-setting-title', desc: 'hs-setting-desc', control: 'hs-setting-control', selector: 'hs-setting-select' }


    // ---- network for commands ----------------------------------------------------------------------
    // Settings → Permissions: whether commands the agent runs may reach the internet. The Host half (index.js)
    // saves the choice in <harness home>/harness-studio/network.json; the sandbox policy reads it before
    // each command, so a change applies to the next command without a restart.
    const NETWORK_ENDPOINT = 'harnessStudioSettings/call'
    const SUGGESTED_HOSTS = ['registry.npmjs.org', 'pypi.org', 'files.pythonhosted.org', 'github.com', '*.github.com', '*.githubusercontent.com']
    let settingsConnection
    async function settingsCall(request) {
      if (!settingsConnection?.rpc) throw new Error('Harness did not provide its connection. Reload Harness.')
      const result = await settingsConnection.rpc.call('/api', NETWORK_ENDPOINT, { args: { request } })
      if (!result?.ok) throw new Error(result?.error?.message ?? 'The settings service did not answer. Restart Harness Studio.')
      return result.value
    }
    const NETWORK_LABELS = { on: 'On', off: 'Off', allowlist: 'Only allowed sites' }
    const NETWORK_HELP = {
      on: 'Commands the agent runs can reach the internet.',
      off: 'Commands cannot reach the internet: downloads, package installs and git fetches fail.',
      allowlist: 'Commands reach only the sites listed below, through a proxy; everything else is refused.',
    }
    const splitHosts = text => text.split(/[\s,]+/).map(h => h.trim()).filter(Boolean)

    // ---- your data --------------------------------------------------------------------------------------
    // Settings → Data: where Harness Studio keeps your data on this computer and how large each part is, with
    // Open to show it in the file manager. Sizes come from the Host half (data.js); nothing is read or sent.
    const formatBytes = bytes => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`)
    const tildePath = file => file.replace(/^\/(?:Users|home)\/[^/]+/, '~')
    function DataRow() {
      const classes = ROW_CLASSES
      const [rows, setRows] = React.useState(null)
      const [error, setError] = React.useState('')
      React.useEffect(() => { settingsCall({ action: 'listData' }).then(setRows, e => setError(e.message)) }, [])
      const open = id => settingsCall({ action: 'revealData', id }).catch(e => setError(e.message))
      const button = { height: 24, padding: '0 9px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer', flex: 'none' }
      return h('div', { 'data-studio-data': '' },
        h('div', { className: classes.row, style: classes.row ? undefined : { padding: '12px 0' } },
          h('div', { className: classes.text },
            h('div', { className: classes.title }, 'Your data'),
            h('div', { className: classes.desc }, error || 'Kept on this computer. What leaves it is what the agent sends while working: requests to your model provider (your messages and what the agent reads), calls to your connectors, and the sites it fetches or opens.'))),
        // One row per place, with the same divider and breathing room as the setting rows above.
        rows ? h('div', { style: { display: 'flex', flexDirection: 'column', padding: '0 0 12px' } }, rows.filter(r => r.present).map(r =>
          h('div', { key: r.id, style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: 14, fontSize: 13, padding: '12px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
            h('div', { style: { minWidth: 0 }, title: r.what },
              h('div', { style: { lineHeight: '20px' } }, r.label),
              h('div', { style: { fontSize: 12, lineHeight: '18px', marginTop: 2, color: 'var(--dsw-alias-label-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, tildePath(r.path))),
            h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' } }, `${r.partial ? 'over ' : ''}${formatBytes(r.bytes)}`),
            h('button', { type: 'button', style: button, onClick: () => void open(r.id), 'aria-label': `Open ${r.label}` }, 'Open')))) : null)
    }

    // ---- computer use -----------------------------------------------------------------------------------
    // Settings → Computer use: the two macOS permissions computer use needs (read from its helper, never by opening a
    // system prompt), the apps saved with "Always allow" (Remove), and the apps it never controls (editable).
    const PERMISSION_ROWS = [
      ['accessibility', 'Accessibility', 'Lets the agent click and type in the apps you approve.'],
      ['screenRecording', 'Screen Recording', 'Lets the agent see the windows of the apps you approve.'],
    ]
    function ComputerRow() {
      const classes = ROW_CLASSES
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState('')
      const [refusedText, setRefusedText] = React.useState('')
      const [note, setNote] = React.useState('')
      const load = React.useCallback(() => settingsCall({ action: 'computerStatus' }).then((next) => {
        setState(next); setError('')
        if (next.refusedApps) setRefusedText(next.refusedApps.join(', '))
      }, e => setError(e.message)), [])
      React.useEffect(() => {
        load()
        // Permissions change in System Settings, outside the app: check again when the window regains focus.
        window.addEventListener('focus', load)
        return () => window.removeEventListener('focus', load)
      }, [load])
      const button = { height: 24, padding: '0 9px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer', flex: 'none' }
      const small = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
      const listRow = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', alignItems: 'center', gap: 10, fontSize: 13 }
      const act = request => settingsCall(request).then(load, e => setError(e.message))
      const saveRefused = () => settingsCall({ action: 'setRefusedApps', apps: refusedText.split(/[,\n]/) })
        .then(() => { setNote('Saved'); setTimeout(() => setNote(''), 2000); return load() }, e => setError(e.message))
      // One settings row per part, in the same row style (and dividers) as Permission and Network above.
      const row = (key, title, desc, control, below) => h('div', { key, 'data-studio-computer-row': key },
        h('div', { className: classes.row, style: classes.row ? undefined : { padding: '12px 0' } },
          h('div', { className: classes.text },
            h('div', { className: classes.title }, title),
            desc ? h('div', { className: classes.desc }, desc) : null),
          control ? h('div', { className: classes.control, style: { display: 'flex', alignItems: 'center', gap: 10 } }, control) : null),
        below ? h('div', { style: { padding: '0 0 16px' } }, below) : null)
      const rows = [row('intro', 'Computer use', error || 'The agent can see and control apps on your Mac, one approved app at a time. It asks before each new app, and the Stop bar at the top of the window ends it at once.')]
      if (state && state.supported === false) rows.push(row('unsupported', 'Not available', state.reason))
      else if (state && !state.enabled) rows.push(row('off', 'Not set up', 'Computer use is not set up in this copy of Harness Studio.'))
      else if (state) {
        const granted = state.permissions ?? {}
        PERMISSION_ROWS.forEach(([key, label, what], index) => rows.push(row(key, label,
          what + (index === PERMISSION_ROWS.length - 1 ? ` ${state.permissionError || 'Turn on Harness Studio in this list. macOS may ask again after an update, since this copy is not signed by Apple.'}` : ''),
          [h('span', { key: 's', style: { fontSize: 13, fontWeight: 500, color: granted[key] ? 'var(--dsw-alias-state-success-primary, #1f9d55)' : 'var(--dsw-alias-state-warning-primary, #c27c0e)' } }, state.permissions ? (granted[key] ? 'Allowed' : 'Not allowed') : 'Unknown'),
            h('button', { key: 'b', type: 'button', style: button, onClick: () => void act({ action: 'openPermission', permission: key }) }, 'Open System Settings')])))
        rows.push(row('allowed', 'Always allowed apps',
          state.allowedApps.length === 0 ? 'None yet. When the agent asks to use an app, Always allow saves it here.' : 'Apps the agent may use in any task without asking.',
          null,
          state.allowedApps.length === 0 ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } }, state.allowedApps.map(app => h('div', { key: app.id, style: listRow },
            h('div', { style: { minWidth: 0 }, title: app.path }, app.name),
            h('span'),
            h('button', { type: 'button', style: button, onClick: () => void act({ action: 'forgetApp', id: app.id }), 'aria-label': `Remove ${app.name}` }, 'Remove'))))))
        rows.push(row('refused', 'Apps the agent never controls',
          'App names, separated by commas. Terminals, System Settings and password managers are on it by default.' + (state.taskOnlyApps.length ? ' Browsers can be allowed for one task at a time, never always.' : ''),
          null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('textarea', { value: refusedText, rows: 4, onChange: e => setRefusedText(e.target.value), 'aria-label': 'Apps the agent never controls',
              style: { boxSizing: 'border-box', width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, lineHeight: '20px', resize: 'vertical' } }),
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 } },
              note ? h('span', { style: small }, note) : null,
              h('button', { type: 'button', style: { ...button, height: 28, padding: '0 14px' }, onClick: () => void saveRefused() }, 'Save')))))
      }
      return h('div', { 'data-studio-computer': '' }, rows)
    }

    /** Settings → Computer use and Settings → Data: one column each, like Harness's own pages. */
    const ComputerPage = () => h('div', { 'data-hs-page': 'computer-use', style: { display: 'flex', flexDirection: 'column', width: '100%' } }, h(ComputerRow))
    const DataPage = () => h('div', { 'data-hs-page': 'data', style: { display: 'flex', flexDirection: 'column', width: '100%' } }, h(DataRow))

    // The Stop bar: while a session controls an app, a bar at the top of the window names the app and stops it.
    /**
     * Messages sent while the agent works: Harness keeps them in a panel above the message box and, once there are two
     * or more, folds them behind an "N queued messages" header. Like Claude Code desktop, each one shows as a faded
     * message at the end of the conversation instead (the styles above hide the header), so the list is opened each
     * time the panel appears.
     */
    function watchQueue() {
      const opened = new WeakSet()
      const scan = () => {
        for (const dock of document.querySelectorAll('[data-queue-dock]')) {
          if (opened.has(dock)) continue
          const header = dock.querySelector('button[aria-expanded]')
          if (header === null) continue
          opened.add(dock)
          if (header.getAttribute('aria-expanded') === 'false' && !header.disabled) header.click()
        }
      }
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      scan()
      return () => observer.disconnect()
    }

    // A message sent while the agent works says whether the agent has it yet. Waiting: a queued row, already labelled
    // "Queued" (taken when the turn ends), or a steered bubble (taken at the agent's next step, Unsend still works), which
    // gets a "Waiting" label in the same place, under the message. Read: a tick once the message is in
    // the session itself, which Harness shows only after the Host has logged it: a steered message's delivered bubble,
    // or the chat message a queued row turned into when the queue drained. Matching a drained row to its chat message
    // goes by text, so it covers messages queued while this window was open.
    function watchReadTicks() {
      const queued = new Map() // session → texts seen in its queue and not yet in its chat
      const known = new Map() // session → user message keys already in its chat
      const readKeys = new Set() // `${session} ${key}` of chat messages that came from the queue
      const norm = text => text.replace(/\s+/g, ' ').trim()
      const TICK = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style="flex: none"><path d="M2.5 6.3l2.3 2.2 4.7-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      // Placed under the message, left of its time and buttons (the compact stylesheet lays the row out as a grid).
      const label = (host, read, title) => {
        let tag = host.querySelector(':scope > .hs-read-state')
        const state = read ? 'read' : 'waiting'
        if (tag?.dataset.state === state) return
        tag?.remove()
        tag = document.createElement('span')
        tag.className = 'hs-read-state'
        tag.dataset.state = state
        tag.title = title
        tag.setAttribute('aria-label', title)
        tag.style.cssText = 'display: inline-flex; align-items: center; gap: 3px; flex: none; font-size: 11px; line-height: 16px; white-space: nowrap; color: var(--dsw-alias-label-tertiary);'
        tag.innerHTML = read ? TICK + '<span>Read</span>' : '<span>Waiting</span>'
        host.append(tag)
      }
      const userRow = item => item.querySelector(c('userRow')) ?? (item.matches(c('userRow')) ? item : null)
      const scan = () => {
        for (const view of document.querySelectorAll('[data-conversation-session]')) {
          const session = view.dataset.conversationSession
          if (!queued.has(session)) queued.set(session, new Set())
          const waiting = queued.get(session)
          for (const row of view.querySelectorAll('[data-queue-dock] li:not([data-submission-echo])')) {
            const text = norm(row.querySelector(c('preview'))?.innerText ?? '')
            if (text) waiting.add(text)
            row.title = 'Waiting: the agent takes this message when the current turn ends. You can still edit, steer or remove it.'
          }
          for (const row of view.querySelectorAll('[data-pending-steering]')) {
            label(row, false, 'Waiting: the agent takes this message at its next step. Unsend still takes it back.')
          }
          for (const item of view.querySelectorAll('[data-chat-flow-kind="steering"]')) {
            const row = userRow(item)
            if (row && !row.hasAttribute('data-pending-steering')) label(row, true, 'Read by the agent')
          }
          const first = !known.has(session)
          if (first) known.set(session, new Set())
          const seen = known.get(session)
          for (const item of view.querySelectorAll('[data-chat-flow-kind="user"][data-chat-node-key]')) {
            const key = item.dataset.chatNodeKey
            if (!seen.has(key)) {
              seen.add(key)
              const text = norm((item.querySelector(c('bubble')) ?? item).innerText)
              if (!first && waiting.delete(text)) readKeys.add(`${session} ${key}`)
            }
            const row = readKeys.has(`${session} ${key}`) && userRow(item)
            if (row) label(row, true, 'Read by the agent')
          }
        }
      }
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      scan()
      return () => {
        observer.disconnect()
        document.querySelectorAll('.hs-read-state').forEach(node => node.remove())
        document.querySelectorAll('[data-queue-dock] li[title]').forEach(row => row.removeAttribute('title'))
      }
    }

    function watchComputerUse() {
      const bar = document.createElement('div')
      bar.setAttribute('data-studio-computer-bar', '')
      bar.setAttribute('role', 'status')
      bar.style.cssText = 'position:fixed;top:calc(var(--dsh-frame-top-clearance, 0px) + 8px);left:50%;transform:translateX(-50%);z-index:2147483000;display:none;align-items:center;gap:10px;' +
        'padding:5px 6px 5px 12px;border-radius:999px;background:var(--dsw-alias-bg-layer-1, #fff);box-shadow:var(--hs-popup-shadow, 0 4px 16px rgba(0,0,0,.15));font-size:12.5px;color:var(--dsw-alias-label-primary)'
      const dot = document.createElement('span')
      dot.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#e5484d;flex:none'
      const label = document.createElement('span')
      const stop = document.createElement('button')
      stop.type = 'button'
      stop.textContent = 'Stop'
      stop.style.cssText = 'height:24px;padding:0 12px;border-radius:999px;border:none;background:#e5484d;color:#fff;font:inherit;font-weight:500;cursor:pointer'
      bar.append(dot, label, stop)
      document.body.append(bar)
      let sessions = []
      stop.addEventListener('click', () => {
        for (const s of sessions) settingsCall({ action: 'stopComputer', sessionId: s.sessionId }).catch(() => {})
        bar.style.display = 'none'
      })
      const poll = async () => {
        try { sessions = (await settingsCall({ action: 'computerActivity' })).sessions } catch { sessions = [] }
        if (sessions.length === 0) { bar.style.display = 'none'; return }
        const apps = [...new Set(sessions.map(s => s.app).filter(Boolean))]
        label.textContent = apps.length === 1 ? `The agent is using ${apps[0]}` : apps.length > 1 ? `The agent is using ${apps.join(', ')}` : 'The agent is using computer use'
        bar.style.display = 'flex'
      }
      const timer = setInterval(() => { if (settingsConnection) void poll() }, 1000)
      return () => { clearInterval(timer); bar.remove() }
    }

    // ---- always-allowed sites ------------------------------------------------------------------------
    // The new-site approval (site-approval.js) gets a third button, "Always allow for this website", between Reject
    // and Allow once. Harness's approval has one grant (allowed once), so the button saves the site through the
    // Host first, which only accepts a site a card is asking about, and then answers the card with Allow once.
    const SITE_QUESTION = /^Let the agent .+ (\S+)\? Each new site asks once per session/
    function addAlwaysAllow(card) {
      const headline = card.querySelector(c('headline'))
      const match = headline && SITE_QUESTION.exec(headline.textContent.trim())
      const row = card.querySelector(c('actionRow'))
      if (!match || !row || row.querySelector('[data-hs-always-allow]')) return
      const [reject, once] = row.querySelectorAll('button')
      if (!reject || !once) return
      const host = match[1]
      const button = document.createElement('button')
      button.type = 'button'
      button.className = reject.className.split(' ').filter(name => !/_reject$/.test(name)).join(' ')
      button.dataset.hsAlwaysAllow = host
      button.textContent = 'Always allow for this website'
      button.title = `Never ask again for ${host}. Remove it in Settings → Permissions → Always-allowed sites.`
      button.addEventListener('click', async () => {
        button.disabled = true
        try {
          await settingsCall({ action: 'alwaysAllowSite', host })
          once.click()
        } catch (error) {
          button.disabled = false
          button.title = String(error?.message ?? error)
        }
      })
      row.insertBefore(button, once)
    }
    function watchApprovalCards() {
      const scan = () => { for (const card of document.querySelectorAll('[data-approval-key]')) addAlwaysAllow(card) }
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true })
      scan()
      return () => observer.disconnect()
    }

    // Settings → Permissions: the always-allowed sites, each with Remove.
    function SitesRow() {
      const classes = ROW_CLASSES
      const [hosts, setHosts] = React.useState(null)
      const [error, setError] = React.useState('')
      React.useEffect(() => { settingsCall({ action: 'listSites' }).then(r => setHosts(r.hosts), e => setError(e.message)) }, [])
      const forget = host => settingsCall({ action: 'forgetSite', host }).then(r => setHosts(r.hosts), e => setError(e.message))
      const button = { height: 24, padding: '0 9px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer', flex: 'none' }
      return h('div', { 'data-studio-sites': '' },
        h('div', { className: classes.row, style: classes.row ? undefined : { padding: '12px 0' } },
          h('div', { className: classes.text },
            h('div', { className: classes.title }, 'Always-allowed sites'),
            h('div', { className: classes.desc }, error || 'Sites you chose "Always allow for this website" for. The agent fetches and opens pages from them without asking. Remove one to be asked again.'))),
        hosts && hosts.length ? h('div', { style: { display: 'flex', flexDirection: 'column', padding: '0 0 12px' } }, hosts.map(host =>
          h('div', { key: host, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, fontSize: 13, padding: '10px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
            h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, host),
            h('button', { type: 'button', style: button, onClick: () => void forget(host), 'aria-label': `Remove ${host}` }, 'Remove')))) :
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)', padding: '0 0 12px' } }, hosts ? 'None yet.' : ''))
    }

    // Settings → Permissions → Long turns: how many steps a turn may take before it pauses for approval (turn-guard.js).
    const TURN_BUDGETS = [[60, 'Ask after 60 steps'], [120, 'Ask after 120 steps'], [200, 'Ask after 200 steps'], [0, 'Never ask']]
    function LongTurnsRow() {
      const classes = ROW_CLASSES
      const [value, setValue] = React.useState(null)
      const [message, setMessage] = React.useState('')
      React.useEffect(() => {
        settingsCall({ action: 'getTurnBudget' }).then(v => setValue(v.pauseAfter), e => setMessage(e.message))
      }, [])
      const help = value === 0
        ? 'Turns run until the agent finishes or you stop it. It is still reminded when a tool keeps returning the same result.'
        : `When one request takes ${value ?? 60} steps, the agent asks before continuing; halfway there it is reminded to take stock and ask you if it is stuck.`
      return h('div', { className: classes.row, style: classes.row ? undefined : { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '12px 0' } },
        h('div', { className: classes.text },
          h('div', { className: classes.title }, 'Long turns'),
          h('div', { className: classes.desc }, message || help)),
        h('div', { className: classes.control },
          h('select', {
            'aria-label': 'Long turns', value: value ?? 60, disabled: value === null,
            onChange: async (e) => {
              const next = Number(e.target.value)
              try { setValue((await settingsCall({ action: 'setTurnBudget', pauseAfter: next })).pauseAfter); setMessage('Saved. Applies from the next step.'); setTimeout(() => setMessage(''), 2500) }
              catch (error) { setMessage(error.message) }
            },
            style: { height: 32, padding: '0 10px', borderRadius: 8, border: 'none', font: 'inherit', fontSize: 13, cursor: 'pointer', background: 'var(--dsw-alias-button-floating-fill, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))', color: 'var(--dsw-alias-label-primary)' },
          }, ...TURN_BUDGETS.map(([n, label]) => h('option', { key: n, value: n }, label)))))
    }

    // ---- cloud logins for commands -----------------------------------------------------------------------
    // Settings → Permissions: which cloud command-line logins the agent's commands may use. The Host half
    // (cloud-logins.js) saves the choice in <harness home>/harness-studio/cloud-logins.json, which Harness's
    // sandbox reads before each command; the first command using a login in a session asks once.
    function CloudLoginsRow() {
      const classes = ROW_CLASSES
      const [state, setState] = React.useState(null)
      const [message, setMessage] = React.useState('')
      React.useEffect(() => {
        settingsCall({ action: 'getCloudLogins' }).then(setState, e => setMessage(e.message))
      }, [])
      const toggle = async (id, on) => {
        const enabled = state.logins.filter(login => (login.id === id ? on : login.enabled)).map(login => login.id)
        try { setState(await settingsCall({ action: 'setCloudLogins', enabled })); setMessage('Saved. Applies from the next command.'); setTimeout(() => setMessage(''), 2500) }
        catch (error) { setMessage(error.message) }
      }
      const help = 'Lets the agent\u2019s commands use your existing cloud and database logins, so these CLIs run as you without signing in. The first such command in a session asks you once. Off, their login files stay hidden from commands.'
      return h('div', { className: classes.row, style: { ...classes.row ? {} : { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 0' }, alignItems: 'flex-start' } },
        h('div', { className: classes.text },
          h('div', { className: classes.title }, 'Cloud logins for commands'),
          h('div', { className: classes.desc }, message || help)),
        h('div', { className: classes.control, style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6 } },
          ...(state?.logins ?? []).map(login => h('label', {
            key: login.id, title: `${login.path}${login.present ? '' : ' (not found: not signed in on this computer)'}`,
            style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' },
          },
            h('input', { type: 'checkbox', checked: login.enabled, 'aria-label': `${login.label} login for commands`, onChange: e => toggle(login.id, e.target.checked) }),
            `${login.label} (${login.cli})`,
            login.present ? null : h('span', { style: { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 } }, 'not signed in')))))
    }

    function NetworkRow() {
      const classes = ROW_CLASSES
      const [state, setState] = React.useState(null)
      const [hostsText, setHostsText] = React.useState('')
      const [error, setError] = React.useState('')
      const [savedNote, setSavedNote] = React.useState('')
      React.useEffect(() => {
        settingsCall({ action: 'getNetwork' })
          .then(value => { setState(value); setHostsText(value.allowedHosts.join('\n')) })
          .catch(e => setError(e.message))
      }, [])
      const save = async (network, hosts) => {
        setError('')
        try {
          const value = await settingsCall({ action: 'setNetwork', network, allowedHosts: hosts })
          setState(value)
          setSavedNote('Saved. Applies to the next command.')
          setTimeout(() => setSavedNote(''), 2500)
        } catch (e) {
          setError(e.message)
        }
      }
      const control = {
        height: 32, padding: '0 10px', borderRadius: 8, border: 'none', font: 'inherit', fontSize: 13, cursor: 'pointer',
        background: 'var(--dsw-alias-button-floating-fill, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))',
        color: 'var(--dsw-alias-label-primary)',
      }
      const mode = state?.network ?? 'on'
      const hostsDirty = state && splitHosts(hostsText).join(',') !== state.allowedHosts.join(',')
      return h('div', { 'data-studio-network': '' },
        h('div', { className: classes.row, style: classes.row ? undefined : { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '12px 0' } },
          h('div', { className: classes.text },
            h('div', { className: classes.title }, 'Network for commands'),
            h('div', { className: classes.desc }, error || savedNote || NETWORK_HELP[mode])),
          h('div', { className: classes.control },
            h('select', {
              'aria-label': 'Network for commands', value: mode, disabled: state === null,
              onChange: (e) => {
                const next = e.target.value
                let hosts = state?.allowedHosts ?? []
                if (next === 'allowlist' && hosts.length === 0) { hosts = SUGGESTED_HOSTS; setHostsText(hosts.join('\n')) }
                void save(next, hosts)
              },
              className: classes.selector,
              style: classes.selector
                ? { appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', border: 'none', paddingRight: 36, minWidth: 170,
                  backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', backgroundSize: '12px 12px' }
                : { ...control, minWidth: 170 },
            }, ...Object.entries(NETWORK_LABELS).map(([value, label]) => h('option', { key: value, value }, label))))),
        mode === 'allowlist' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 0 14px' } },
          h('textarea', {
            'aria-label': 'Allowed sites', value: hostsText, rows: Math.min(8, Math.max(3, splitHosts(hostsText).length + 1)),
            placeholder: 'One site per line, such as registry.npmjs.org or *.github.com',
            onChange: e => setHostsText(e.target.value),
            style: { ...control, height: 'auto', padding: '8px 10px', cursor: 'text', resize: 'vertical', fontFamily: 'var(--dsw-font-markdown-code-font-family, ui-monospace, monospace)', fontSize: 12, lineHeight: '18px' },
          }),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } },
            h('button', { type: 'button', disabled: !hostsDirty, onClick: () => void save('allowlist', splitHosts(hostsText)), style: { ...control, height: 28, opacity: hostsDirty ? 1 : 0.5, cursor: hostsDirty ? 'pointer' : 'default' } }, 'Save sites'),
            'An entry matches that exact name; *.example.com matches its subdomains. Programs that ignore the HTTP_PROXY and HTTPS_PROXY variables cannot connect.')) : null)
    }

    const CUSTOM = '__custom'
    const CHEVRON = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="#81858c" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>')}")`
    function ChatFontRow() {
      const [choice, setChoice] = React.useState(readFont)
      const classes = ROW_CLASSES
      const [custom, setCustom] = React.useState(() => (readFont().startsWith('custom:') ? readFont().slice(7) : ''))
      const [editing, setEditing] = React.useState(() => readFont().startsWith('custom:'))
      React.useEffect(() => { fontListeners.add(setChoice); return () => { fontListeners.delete(setChoice) } }, [])
      const groups = [...new Set(FONT_CHOICES.map(f => f.group))]
      const offered = f => f.probe === undefined || isInstalled(f.probe) || choice === f.id
      const control = {
        height: 32, padding: '0 10px', borderRadius: 8, border: 'none', font: 'inherit', fontSize: 13, cursor: 'pointer',
        background: 'var(--dsw-alias-button-floating-fill, color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent))',
        color: 'var(--dsw-alias-label-primary)',
      }
      const useCustom = () => { const name = custom.trim(); if (name) saveFont('custom:' + name) }
      return h('div', { className: classes.row, 'data-studio-chat-font': '', style: classes.row ? undefined : { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '12px 0' } },
        h('div', { className: classes.text },
          h('div', { className: classes.title }, 'Chat font'),
          h('div', { className: classes.desc }, 'Typeface for messages and replies')),
        h('div', { className: classes.control, style: { display: 'flex', gap: 8, alignItems: 'center' } },
          editing ? h('input', {
            type: 'text', value: custom, autoFocus: !choice.startsWith('custom:'), placeholder: 'Installed font name', 'aria-label': 'Custom chat font',
            onChange: e => setCustom(e.target.value), onKeyDown: e => { if (e.key === 'Enter') useCustom() }, onBlur: useCustom,
            className: classes.selector,
            style: classes.selector ? { cursor: 'text', width: 160, border: 'none', outline: 'none' } : { ...control, cursor: 'text', width: 150 },
          }) : null,
          h('select', {
            'aria-label': 'Chat font', value: editing ? CUSTOM : choice,
            onChange: e => {
              if (e.target.value === CUSTOM) { setEditing(true); return }
              setEditing(false); saveFont(e.target.value)
            },
            className: classes.selector,
            style: classes.selector
              ? { appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer', border: 'none', paddingRight: 36, minWidth: 150, fontFamily: editing ? 'inherit' : fontStack(choice),
                backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', backgroundSize: '12px 12px' }
              : { ...control, fontFamily: editing ? 'inherit' : fontStack(choice), minWidth: 150 },
          },
          ...groups.map(group => h('optgroup', { key: group, label: group },
            FONT_CHOICES.filter(f => f.group === group && offered(f)).map(f => h('option', { key: f.id, value: f.id }, f.label)))),
          h('option', { value: CUSTOM }, 'Other font…'))))
    }

    // ---- colour themes ------------------------------------------------------------------------------------
    // Settings → Appearance, after Light or dark: a colour theme on top of Harness's light and dark palettes. Each theme
    // gives base colours for both schemes; they are spread over Harness's colour tokens and applied as one override
    // layer through Harness's theme service, so Appearance (Light, Dark, System) still picks the scheme. The choice
    // is remembered in this window's storage.
    const COLOR_THEME_KEY = 'harness-studio.color-theme'
    const COLOR_THEME_LAYER = '@harness-studio/compact/color-theme'
    // The theme's colours as a boot style: the desktop page adds styles stored under this key before its first paint
    // (Harness patch 26), so the app starts in the theme instead of switching to it once this plugin loads.
    const COLOR_THEME_BOOT_KEY = 'dsh.boot-style:harness-studio-color-theme'
    const COLOR_THEME_BOOT_SELECTOR = 'style[data-dsh-boot-style="harness-studio-color-theme"]'
    // Harness's own dark page colour (its pre-plugin palette), for the default theme in dark mode.
    const DEFAULT_DARK_BACKGROUND = '#151517'
    const COLOR_THEMES = [
      { id: 'default', name: 'Default' },
      {
        id: 'warm', name: 'Warm',
        light: { bg: '#faf9f5', l1: '#ffffff', l2: '#f5f4ee', l3: '#efede4', side: '#f0eee6', overlay: '#ffffff', text: '#1f1e1d', text2: '#5e5d59', text3: '#7c7a73', text4: '#a3a199', text5: '#d4d1c6', accent: '#c96442', accentHover: '#b5583a', accentSoft: '#f6e3db', code: '#f3f1ea', tooltip: '#2b2a27' },
        dark: { bg: '#262624', l1: '#30302e', l2: '#3a3a37', l3: '#43433f', side: '#1f1e1d', overlay: '#30302e', text: '#faf9f5', text2: '#c2c0b6', text3: '#9c9a92', text4: '#75736c', text5: '#4d4c48', accent: '#d97757', accentHover: '#e48b6e', accentSoft: '#4a3128', code: '#1f1e1d', tooltip: '#43433f' },
      },
      {
        id: 'graphite', name: 'Graphite',
        light: { bg: '#f6f7f8', l1: '#ffffff', l2: '#f0f1f3', l3: '#e8eaed', side: '#eceef1', overlay: '#ffffff', text: '#1c1f24', text2: '#4f5662', text3: '#737b88', text4: '#9aa1ab', text5: '#cdd1d7', accent: '#4a6a8a', accentHover: '#3d5a77', accentSoft: '#dde5ee', code: '#eef0f2', tooltip: '#23262b' },
        dark: { bg: '#1b1d21', l1: '#222429', l2: '#2a2d32', l3: '#32353b', side: '#16181b', overlay: '#25282d', text: '#e6e8eb', text2: '#a9aeb7', text3: '#848a95', text4: '#646a74', text5: '#41454c', accent: '#7f9fc4', accentHover: '#93b0d1', accentSoft: '#26303c', code: '#16181b', tooltip: '#32353b' },
      },
      {
        id: 'nord', name: 'Nord',
        light: { bg: '#eceff4', l1: '#f5f7fa', l2: '#e5e9f0', l3: '#d8dee9', side: '#e5e9f0', overlay: '#f5f7fa', text: '#2e3440', text2: '#434c5e', text3: '#4c566a', text4: '#7b8496', text5: '#c4cbd8', accent: '#5e81ac', accentHover: '#4c6d96', accentSoft: '#d6e0ec', code: '#e5e9f0', tooltip: '#3b4252' },
        dark: { bg: '#2e3440', l1: '#3b4252', l2: '#434c5e', l3: '#4c566a', side: '#292e39', overlay: '#3b4252', text: '#eceff4', text2: '#d8dee9', text3: '#a7b0c0', text4: '#7b8496', text5: '#4c566a', accent: '#88c0d0', accentHover: '#9fcdda', accentSoft: '#334555', code: '#292e39', tooltip: '#4c566a' },
      },
      {
        id: 'solarized', name: 'Solarized',
        light: { bg: '#fdf6e3', l1: '#fffbee', l2: '#f5eedb', l3: '#eee8d5', side: '#eee8d5', overlay: '#fffbee', text: '#073642', text2: '#586e75', text3: '#657b83', text4: '#93a1a1', text5: '#d3cdb9', accent: '#268bd2', accentHover: '#1f78b6', accentSoft: '#dbe8ec', code: '#eee8d5', tooltip: '#073642' },
        dark: { bg: '#002b36', l1: '#073642', l2: '#0d3c48', l3: '#14444f', side: '#00212b', overlay: '#073642', text: '#eee8d5', text2: '#93a1a1', text3: '#839496', text4: '#657b83', text5: '#2f505a', accent: '#268bd2', accentHover: '#3c9ae0', accentSoft: '#0b3a52', code: '#00212b', tooltip: '#14444f' },
      },
      {
        id: 'contrast', name: 'High contrast', ink: 0.4,
        light: { bg: '#ffffff', l1: '#ffffff', l2: '#f2f2f2', l3: '#e6e6e6', side: '#f2f2f2', overlay: '#ffffff', text: '#000000', text2: '#1a1a1a', text3: '#333333', text4: '#4d4d4d', text5: '#8c8c8c', accent: '#0047ab', accentHover: '#003580', accentSoft: '#d6e4f7', code: '#f0f0f0', tooltip: '#000000' },
        dark: { bg: '#000000', l1: '#0d0d0d', l2: '#171717', l3: '#212121', side: '#000000', overlay: '#0d0d0d', text: '#ffffff', text2: '#f0f0f0', text3: '#d6d6d6', text4: '#b3b3b3', text5: '#6b6b6b', accent: '#66b3ff', accentHover: '#8cc6ff', accentSoft: '#0f2a45', code: '#121212', tooltip: '#2b2b2b' },
      },
    ]
    /** Harness colour tokens for one theme: each token's light and dark value from the theme's base colours. */
    function colorThemeTokens(theme) {
      // Borders and hover fills are the text colour at small opacities, as Harness's own palettes do; high contrast
      // raises the borders a lot and the fills only a little.
      const lines = theme.ink ?? 0
      const mix = (mode, alpha) => `color-mix(in srgb, ${theme[mode].text} ${Math.round(alpha * 100)}%, transparent)`
      const ink = (mode, alpha) => mix(mode, alpha + lines * (mode === 'light' ? 1 : 0.9))
      const fill = (mode, alpha) => mix(mode, alpha + lines * 0.15)
      const pick = (light, dark) => ({ light, dark })
      const both = key => pick(theme.light[key], theme.dark[key])
      const t = name => '--dsw-alias-' + name
      return {
        [t('bg-base')]: both('bg'), [t('bg-layer-1')]: both('l1'), [t('bg-layer-2')]: both('l2'), [t('bg-layer-3')]: both('l3'),
        [t('bg-overlay')]: both('overlay'), [t('bg-module-platform')]: both('side'), [t('bg-multi-select')]: both('side'),
        [t('border-l1')]: pick(ink('light', 0.05), ink('dark', 0.06)), [t('border-l2')]: pick(ink('light', 0.1), ink('dark', 0.12)),
        [t('border-l3')]: pick(ink('light', 0.13), ink('dark', 0.16)), [t('border-l4')]: pick(ink('light', 0.17), ink('dark', 0.2)),
        [t('label-primary')]: both('text'), [t('label-secondary')]: both('text2'), [t('label-tertiary')]: both('text3'),
        [t('label-caption')]: both('text4'), [t('label-dimmed')]: both('text5'), [t('label-primary-inverted')]: both('bg'),
        [t('brand-primary')]: both('text'), [t('button-primary-hover')]: both('text2'),
        [t('interactive-bg-hover')]: pick(fill('light', 0.06), fill('dark', 0.08)), [t('interactive-bg-active')]: pick(fill('light', 0.1), fill('dark', 0.14)),
        [t('interactive-bg-hover-solid')]: both('l2'),
        [t('button-info-fill')]: both('accent'), [t('button-info-hover')]: both('accentHover'), [t('link')]: both('accent'),
        [t('state-business-primary')]: both('accent'), [t('state-business-tertiary')]: both('accentSoft'),
        [t('markdown-code-block')]: both('code'), [t('markdown-code-block-banner')]: both('code'), [t('markdown-inline-code')]: both('code'),
        [t('menu-group-header-fill')]: both('overlay'), [t('tooltip-bg')]: both('tooltip'),
        [t('button-elevated-fill')]: both('l1'), [t('button-floating-fill')]: both('l1'),
        [t('switch-thumb')]: pick(theme.light.l1, theme.dark.text3),
      }
    }
    const readColorTheme = () => { try { const id = localStorage.getItem(COLOR_THEME_KEY); return COLOR_THEMES.some(t => t.id === id) ? id : 'default' } catch { return 'default' } }
    let colorTheme = readColorTheme()
    let themeService
    let removeColorTheme
    const colorThemeListeners = new Set()
    /**
     * The boot style for a theme and an Appearance preference: the scheme's tokens, page colour and left sidebar, or
     * both schemes switched by the system's setting for System. Its rules outrank Harness's token sheet (which loads
     * later) but not the inline values of its theme layer. The default theme only needs Harness's dark page colour,
     * which Harness itself sets too late to avoid a white start in dark mode.
     */
    function colorThemeBootCss(theme, preference) {
      const scheme = mode => {
        if (!theme?.light) return mode === 'dark' ? `html body{background-color:${DEFAULT_DARK_BACKGROUND};--dsh-boot-bg:${DEFAULT_DARK_BACKGROUND}}` : ''
        const tokens = Object.entries(colorThemeTokens(theme)).map(([name, modes]) => `${name}:${modes[mode]}`).join(';')
        return `html body,html body[data-ds-dark-theme]{${tokens};background-color:${theme[mode].bg};--dsh-boot-bg:${theme[mode].bg}}`
      }
      const sidebar = theme?.light ? 'html body :is([class$="_sidebarCol"],[class*="_sidebarCol "]){background:var(--dsw-alias-bg-module-platform)!important}' : ''
      if (preference === 'light' || preference === 'dark') return scheme(preference) + sidebar
      return scheme('light') + `@media(prefers-color-scheme:dark){${scheme('dark')}}` + sidebar
    }
    function saveColorThemeBoot() {
      const theme = COLOR_THEMES.find(t => t.id === colorTheme)
      const css = colorThemeBootCss(theme, themeService?.getTheme?.().preference)
      try {
        if (css) localStorage.setItem(COLOR_THEME_BOOT_KEY, css)
        else localStorage.removeItem(COLOR_THEME_BOOT_KEY)
      } catch { /* storage unavailable: the theme appears once the plugin loads */ }
    }
    function applyColorTheme() {
      removeColorTheme?.()
      removeColorTheme = undefined
      document.documentElement.dataset.hsColorTheme = colorTheme
      const theme = COLOR_THEMES.find(t => t.id === colorTheme)
      if (themeService && theme?.light) removeColorTheme = themeService.overrideTokens(COLOR_THEME_LAYER, colorThemeTokens(theme))
      if (themeService) {
        saveColorThemeBoot()
        // Harness's theme layer now carries the theme (or Default is chosen): the boot copy would only go stale.
        for (const style of document.querySelectorAll(COLOR_THEME_BOOT_SELECTOR)) style.remove()
      }
    }
    function saveColorTheme(id) {
      colorTheme = id
      try { localStorage.setItem(COLOR_THEME_KEY, id) } catch { /* storage unavailable: the choice lasts for this window */ }
      applyColorTheme()
      for (const listener of colorThemeListeners) listener(id)
    }

    /** A small picture of the theme: its sidebar, page, two lines of text and the accent, in the current scheme. */
    function ThemeSwatch({ theme, dark }) {
      const fallback = dark
        ? { bg: '#1e1f24', side: '#17181c', text: '#e8e9ed', text3: '#7d808a', accent: '#5a8dee' }
        : { bg: '#ffffff', side: '#f3f5f8', text: '#16181d', text3: '#9a9fa8', accent: '#3b6fe0' }
      const c = (theme.light ? theme[dark ? 'dark' : 'light'] : fallback)
      return h('div', { style: { display: 'flex', width: 76, height: 48, borderRadius: 7, overflow: 'hidden', background: c.bg, boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 14%)' } },
        h('div', { style: { width: 20, background: c.side } }),
        h('div', { style: { flex: 1, padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: 5 } },
          h('div', { style: { height: 4, width: '80%', borderRadius: 2, background: c.text } }),
          h('div', { style: { height: 4, width: '55%', borderRadius: 2, background: c.text3 } }),
          h('div', { style: { height: 6, width: 18, borderRadius: 3, background: c.accent, marginTop: 'auto' } })))
    }

    function ColorThemeRow() {
      const [choice, setChoice] = React.useState(colorTheme)
      const classes = ROW_CLASSES
      const [dark, setDark] = React.useState(() => document.body.hasAttribute('data-ds-dark-theme'))
      React.useEffect(() => { colorThemeListeners.add(setChoice); return () => { colorThemeListeners.delete(setChoice) } }, [])
      React.useEffect(() => {
        const observer = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')))
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
        return () => observer.disconnect()
      }, [])
      return h('div', { 'data-studio-color-theme': '', style: { display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' } },
        h('div', { className: classes.text },
          h('div', { className: classes.title }, 'Colour theme'),
          h('div', { className: classes.desc }, 'Colours for the whole app. Light or dark above still applies, and every theme has both.')),
        h('div', { role: 'radiogroup', 'aria-label': 'Colour theme', style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          COLOR_THEMES.map(theme => h('button', {
            key: theme.id, type: 'button', role: 'radio', 'aria-checked': choice === theme.id, onClick: () => saveColorTheme(theme.id),
            style: { width: 84, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 4, border: 'none', borderRadius: 10, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer',
              boxShadow: choice === theme.id ? '0 0 0 2px var(--dsw-alias-button-info-fill)' : 'none' },
          }, h(ThemeSwatch, { theme, dark }),
          h('span', { style: { fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', color: choice === theme.id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)' } }, theme.name)))))
    }

    // ---- prompt history -------------------------------------------------------------------------------
    // Up and Down in the message box step through the prompts sent in this chat, newest first, like a shell or Claude
    // Code: Up starts when the box is empty or the cursor is at its very start; while a recalled prompt is unchanged,
    // Up and Down keep stepping, and Down past the newest brings back what you were typing. Any edit ends the stepping.
    // Nothing is taken while the / or @ menu is open, or while an input method is composing. The prompts are read from
    // the conversation the box belongs to (its own one in a split view), so other chats' prompts never come up and nothing
    // is stored; older turns count once they are loaded.
    const COMPOSER_INPUT = '[data-composer-input][contenteditable="true"]'
    // An earlier version kept one list for every chat in this window's storage; it is no longer used.
    const OLD_PROMPT_HISTORY_KEY = 'harness-studio.prompt-history'
    try { localStorage.removeItem(OLD_PROMPT_HISTORY_KEY) } catch { /* storage unavailable: nothing to clear */ }
    /** The prompts sent in the chat this message box belongs to, newest first, without repeats in a row. */
    function chatPrompts(input) {
      // The conversation's own body holds both its chat and this box, and is marked with its session.
      const view = input.closest('[data-conversation-session]')
      if (!view) return []
      const prompts = []
      for (const item of view.querySelectorAll(':is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])')) {
        const text = (item.querySelector(c('bubble')) ?? item).innerText.replace(/\u00a0/g, ' ').trim()
        if (text && prompts[0] !== text) prompts.unshift(text)
      }
      return prompts
    }
    /**
     * Replace the box's text through its editor (Lexical, which ignores the browser's editing commands): one paragraph
     * per line, then the cursor at the end.
     */
    function setComposerText(input, text) {
      const editor = input.__lexicalEditor
      if (!editor) return
      const paragraph = line => ({
        children: line ? [{ detail: 0, format: 0, mode: 'normal', style: '', text: line, type: 'text', version: 1 }] : [],
        direction: null, format: '', indent: 0, type: 'paragraph', version: 1, textFormat: 0, textStyle: '',
      })
      const state = { root: { children: text.split('\n').map(paragraph), direction: null, format: '', indent: 0, type: 'root', version: 1 } }
      editor.setEditorState(editor.parseEditorState(JSON.stringify(state)))
      input.focus()
      requestAnimationFrame(() => {
        const range = document.createRange()
        range.selectNodeContents(input)
        range.collapse(false)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
      })
    }
    function caretAtStart(input) {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false
      const range = document.createRange()
      range.selectNodeContents(input)
      range.setEnd(selection.anchorNode, selection.anchorOffset)
      return range.toString().length === 0
    }
    // ---- Settings search -------------------------------------------------------------------------------
    // A search field at the top of the Settings page list. Typing lists matching rows from every page as
    // "row · page"; choosing one opens its page, scrolls to the row and highlights it. Harness renders only the
    // open page, so the index starts from the rows each page had when this was written and adds whatever a page
    // shows each time it is opened (kept in this window's storage), so new rows and plugin cards become findable.
    const SETTINGS_SEARCH_KEY = 'harness-studio.settings-index'
    const SETTINGS_SEED = {
      General: [['Work details', 'How much detail to show for tool calls'], ['When to collapse work details', 'When to collapse work details automatically'], ['Show coding view', 'Trajectory, code diffs and all agent presets'], ['Keyboard shortcuts', 'View and edit shortcuts and input actions'], ['Open chat links in', 'Where to open web links'], ['Send behavior while busy', 'Steer or queue messages sent while the agent works'], ['Performance & usage', 'How much performance and usage information to show'], ['Current version', 'Updates']],
      Appearance: [['Language', ''], ['Light or dark', 'Theme'], ['Colour theme', 'Default, Warm, Graphite, Nord, Solarized, High contrast'], ['Font size', 'Conversation text size'], ['Chat font', 'Typeface for messages and replies']],
      Permissions: [['Permission', 'Default permission mode for new sessions'], ['Network for commands', 'Internet access for commands the agent runs'], ['Cloud logins for commands', 'Google Cloud, AWS, Azure, Kubernetes, Snowflake, Databricks, PostgreSQL, MySQL'], ['Long turns', 'Ask after a number of steps'], ['Always-allowed sites', 'Websites the agent may open without asking']],
      'Computer use': [['Computer use', 'Let the agent click and type in apps'], ['Accessibility', 'macOS permission'], ['Screen Recording', 'macOS permission'], ['Always allowed apps', ''], ['Apps the agent never controls', '']],
      Models: [['Models', 'Model providers and API keys']],
      Connectors: [['Connectors', 'MCP servers'], ['Add connector', 'MCP server by URL or command']],
      'Built-in plugins': [['Built-in plugins', 'Plugins this app ships'], ['Voice Input', 'Dictation and speech-to-text']],
      'Agent presets': [['Agent presets', ''], ['Standard mode', ''], ['PTC mode', ''], ['Minimal mode', ''], ['Creator mode', '']],
      Data: [['Your data', 'Where Harness Studio keeps things'], ['Conversations', ''], ['Auto memory', ''], ['Undo copies', ''], ['Separate-session worktrees', ''], ['ffmpeg', ''], ['Speech model', ''], ['Settings and rules', ''], ['Plugin settings', ''], ['Workspaces and schedules', ''], ['Keys and sign-ins', ''], ['Plugin lists', ''], ['Window data', '']],
    }
    const SETTINGS_SEARCH_CSS = `
      .hs-ss { position: relative; display: flex; align-items: center; margin: 0 0 -6px; color: var(--dsw-alias-label-tertiary); }
      .hs-ss > svg { position: absolute; left: 10px; pointer-events: none; }
      .hs-ss input { width: 100%; height: 32px; box-sizing: border-box; border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 12px);
        padding: 0 10px 0 32px; outline: none; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
      .hs-ss input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .hs-ss input:focus-visible { border-color: var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)) 18%, transparent); }
      .hs-ss input::-webkit-search-cancel-button { cursor: pointer; }
      .hs-ss-results { display: flex; flex-direction: column; gap: 2px; overflow-y: auto; min-height: 0; }
      .hs-ss-hit { display: flex; flex-direction: column; align-items: flex-start; gap: 0; width: 100%; padding: 6px 12px; border: none; border-radius: var(--dsw-radius-md, 12px);
        background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 18px; text-align: left; cursor: pointer; }
      .hs-ss-hit:hover, .hs-ss-hit[data-selected] { background: var(--dsw-alias-interactive-bg-hover); }
      .hs-ss-hit span { max-width: 100%; overflow-wrap: anywhere; }
      .hs-ss-hit .hs-ss-page { font-size: 11px; line-height: 15px; color: var(--dsw-alias-label-tertiary); }
      .hs-ss-none { padding: 6px 12px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .hs-ss-flash { border-radius: 10px; animation: hs-ss-flash 1.8s ease-out; }
      @keyframes hs-ss-flash { 0%, 35% { background: color-mix(in srgb, var(--dsw-alias-button-info-fill, #3b82f6) 18%, transparent); } 100% { background: transparent; } }
    `
    const SETTINGS_TITLE = '[class*="_title"], [class*="settingTitle"], [class*="rowName"], [class*="cardTitle"], [class*="cardName"], [class*="heading"], .hs-setting-title, .hsc-title'
    const SETTINGS_DESC = '[class*="_desc"], [class*="settingDescription"], [class*="cardDescription"], .hs-setting-desc, .hsc-desc'
    function settingsIndex() {
      let learned = {}
      try { learned = JSON.parse(localStorage.getItem(SETTINGS_SEARCH_KEY) || '{}') } catch (error) { console.warn('[harness-studio] settings index unreadable', error) }
      const rows = new Map()
      for (const [page, list] of [...Object.entries(SETTINGS_SEED), ...Object.entries(learned)]) {
        for (const [title, desc] of list) {
          const key = page + '\u0000' + title
          if (!rows.has(key) || (desc && !rows.get(key).desc)) rows.set(key, { page, title, desc: desc || '' })
        }
      }
      return [...rows.values()]
    }
    function learnSettingsPage(page, options) {
      const leaf = el => (el.children.length === 0 ? el.textContent : el.innerText || '').trim()
      const list = []
      for (const el of options.querySelectorAll(SETTINGS_TITLE)) {
        const title = leaf(el)
        if (!title || title.length > 60 || /^\d/.test(title)) continue
        const box = el.closest('.hs-setting, [class*="row" i], [class*="card" i], [class*="item" i]') || el.parentElement
        const descEl = box?.querySelector(SETTINGS_DESC)
        const desc = descEl && descEl !== el ? leaf(descEl).slice(0, 120) : ''
        if (!list.some(([t]) => t === title)) list.push([title, desc])
      }
      if (!list.length) return
      try {
        const learned = JSON.parse(localStorage.getItem(SETTINGS_SEARCH_KEY) || '{}')
        learned[page] = list
        localStorage.setItem(SETTINGS_SEARCH_KEY, JSON.stringify(learned))
      } catch (error) { console.warn('[harness-studio] settings index not saved', error) }
    }
    function searchSettings(query, pages) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      if (!words.length) return []
      const all = [...pages.map(page => ({ page, title: page, desc: '', isPage: true })), ...settingsIndex().filter(row => pages.includes(row.page))]
      const scored = []
      for (const row of all) {
        const title = row.title.toLowerCase(), hay = (row.title + ' ' + row.desc + ' ' + row.page).toLowerCase()
        if (!words.every(word => hay.includes(word))) continue
        const score = (title.startsWith(words[0]) ? 0 : title.includes(words[0]) ? 1 : 2) + (row.isPage ? -0.5 : 0)
        scored.push({ ...row, score })
      }
      return scored.sort((a, b) => a.score - b.score || a.title.localeCompare(b.title)).slice(0, 40)
    }
    // Closes any open menu, opens Settings and selects its Models page once the page list has rendered.
    function openModelsSettings() {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      document.querySelector('[data-studio-settings]')?.click()
      const started = Date.now()
      const tick = () => {
        const cell = [...document.querySelectorAll('[data-shortcut-modal="settings"] nav [class*="_navCell"]')].find(c => c.innerText.trim() === 'Models')
        if (cell) cell.click()
        else if (Date.now() - started < 3000) setTimeout(tick, 80)
      }
      tick()
    }
    // An empty model list (Harness's "No models available.") says where models come from and offers a button that
    // opens Settings → Models. The hint goes inside the list's own status line, so it leaves with it and with a search.
    function watchEmptyModels() {
      const EMPTY = 'No models available.'
      const scan = () => {
        for (const status of document.querySelectorAll('[role="status"][class*="_empty"]')) {
          const own = [...status.childNodes].filter(node => !(node instanceof Element && node.classList.contains('hs-models-hint'))).map(node => node.textContent).join('').trim()
          const hint = status.querySelector(':scope > .hs-models-hint')
          if (own !== EMPTY) { hint?.remove(); continue }
          if (hint) continue
          const box = document.createElement('div')
          box.className = 'hs-models-hint'
          box.style.cssText = 'margin-top: 4px;'
          box.append('Add a model provider and its API key in Settings → Models.')
          const button = document.createElement('button')
          button.type = 'button'
          button.textContent = 'Open Settings → Models'
          button.dataset.studioAddModel = ''
          button.style.cssText = 'display: block; margin-top: 6px; padding: 0; border: none; background: none; font: inherit; cursor: pointer; color: var(--dsw-alias-label-link, var(--dsw-alias-accent-primary, #3b82f6));'
          button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openModelsSettings() })
          box.append(button)
          status.append(box)
        }
      }
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      scan()
      return () => { observer.disconnect(); document.querySelectorAll('.hs-models-hint').forEach(node => node.remove()) }
    }
    // Harness's exact accessible name for the model button with nothing chosen (English and Chinese); a chosen model
    // reads "Select model, current …", and "Loading models…" is never held back.
    const MODEL_UNSET = new Set(['Select model', '请选择模型'])
    const SEND_LABELS = new Set(['Send message', '发送消息'])
    function noModelTrigger(card) {
      return [...card.querySelectorAll('button[aria-label]')].find(button => MODEL_UNSET.has(button.getAttribute('aria-label'))) ?? null
    }
    function composerSendButton(card) {
      return [...card.querySelectorAll('button[aria-label]')].find(button => SEND_LABELS.has(button.getAttribute('aria-label'))) ?? null
    }
    function textLink(text, onClick) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      button.style.cssText = 'padding: 0; border: none; background: none; font: inherit; cursor: pointer; color: var(--dsw-alias-label-link, var(--dsw-alias-accent-primary, #3b82f6));'
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); onClick() })
      return button
    }
    function showNoModelNotice(card, trigger) {
      if (card.querySelector(':scope > .hs-no-model')) return
      const box = document.createElement('div')
      box.className = 'hs-no-model'
      box.setAttribute('role', 'alert')
      box.style.cssText = 'padding: 10px 14px 0; font-size: 12.5px; line-height: 1.45; color: var(--dsw-alias-label-secondary);'
      box.append('No model is chosen, so this message was not sent. Add a model provider and its API key in Settings → Models, then choose a model here.')
      const actions = document.createElement('div')
      actions.style.cssText = 'display: flex; gap: 14px; margin-top: 4px;'
      const settingsButton = textLink('Open Settings → Models', openModelsSettings)
      settingsButton.dataset.studioAddModel = ''
      actions.append(settingsButton, textLink('Choose a model', () => trigger.isConnected ? trigger.click() : noModelTrigger(card)?.click()))
      box.append(actions)
      card.insertBefore(box, card.querySelector(':scope > [data-input-scroll]'))
    }
    // With no usable model the composer's model button reads "Select model", and Harness would still send the message to
    // its built-in default route, which fails with a credential error the user cannot act on. Enter and the Send button
    // are held back instead, and a notice in the message box says to add a provider in Settings → Models or pick a model.
    // The notice leaves once the model button names a model.
    function watchSendWithoutModel() {
      const hold = (event, card) => {
        const trigger = noModelTrigger(card)
        if (!trigger) return
        event.preventDefault()
        event.stopImmediatePropagation()
        showNoModelNotice(card, trigger)
      }
      const onKeyDown = (event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
        const input = event.target instanceof Element ? event.target.closest(COMPOSER_INPUT) : null
        if (!input || !input.innerText.trim() || document.querySelector('[data-trigger-menu]')) return
        const card = input.closest('[data-composer-card]')
        if (card) hold(event, card)
      }
      const onClick = (event) => {
        const button = event.target instanceof Element ? event.target.closest('[data-composer-card] button[aria-label]') : null
        if (!button || !SEND_LABELS.has(button.getAttribute('aria-label'))) return
        hold(event, button.closest('[data-composer-card]'))
      }
      const observer = new MutationObserver(() => {
        for (const notice of document.querySelectorAll('.hs-no-model')) if (!noModelTrigger(notice.parentElement)) notice.remove()
      })
      document.addEventListener('keydown', onKeyDown, true)
      document.addEventListener('click', onClick, true)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
        document.removeEventListener('click', onClick, true)
        observer.disconnect()
        document.querySelectorAll('.hs-no-model').forEach(node => node.remove())
      }
    }
    // Harness offers no way to run a failed turn again, so after fixing the cause (such as adding a key in Settings →
    // Models) the user had to retype. The latest turn, when it ends in "This turn failed", gets a Retry button that sends
    // that turn's own message text again in the same chat with the model chosen now. Only the message's text goes;
    // attachments do not. A draft in the message box is put back once the retry has gone.
    function watchFailedTurnRetry() {
      const FAILED = new Set(['This turn failed', '本轮运行失败'])
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
      const retry = async (item) => {
        const view = item.closest('[data-conversation-session]')
        const input = view?.querySelector(COMPOSER_INPUT)
        const card = input?.closest('[data-composer-card]')
        const asked = view?.querySelector(`:is([data-chat-flow-kind="user"], [data-chat-flow-kind="steering"])[data-chat-turn="${item.dataset.chatTurn}"]`)
        const text = asked && (asked.querySelector(c('bubble')) ?? asked).innerText.replace(/\u00a0/g, ' ').trim()
        if (!text || !card) return
        const trigger = noModelTrigger(card)
        if (trigger) { showNoModelNotice(card, trigger); return }
        const draft = input.innerText.replace(/\n$/, '')
        setComposerText(input, text)
        // The editor commits the text and Harness enables Send a frame or two later.
        let sent = false
        for (const started = Date.now(); Date.now() - started < 2000; await wait(50)) {
          const send = composerSendButton(card)
          if (send && !send.disabled) { send.click(); sent = true; break }
        }
        if (!sent || !draft.trim()) return
        for (const started = Date.now(); Date.now() - started < 3000; await wait(50)) {
          if (!input.isConnected) return
          if (!input.innerText.trim()) { setComposerText(input, draft); return }
        }
      }
      const scan = () => {
        for (const view of document.querySelectorAll('[data-conversation-session]')) {
          if (!view.querySelector('[data-chat-flow-kind="turn-error"]')) continue
          const turns = [...view.querySelectorAll('[data-chat-flow-kind][data-chat-turn]')].map(node => Number(node.dataset.chatTurn)).filter(Number.isFinite)
          const latest = turns.length ? Math.max(...turns) : NaN
          for (const item of view.querySelectorAll('[data-chat-flow-kind="turn-error"]')) {
            const row = item.querySelector(c('turnErrorRow'))
            const button = item.querySelector('.hs-turn-retry')
            const wanted = row && Number(item.dataset.chatTurn) === latest && FAILED.has(row.querySelector(c('turnErrorTitle'))?.textContent.trim())
            if (!wanted) { button?.remove(); continue }
            if (button) continue
            // A small outlined button with a circular arrow, as in Claude Code, on its own line under the error text
            // (the row is a three-column grid: dot, text, code).
            const link = document.createElement('button')
            link.type = 'button'
            link.className = 'hs-turn-retry'
            link.title = 'Send this turn\'s message again with the model chosen now'
            link.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg><span>Retry</span>'
            link.style.cssText = 'grid-column: 2 / -1; justify-self: start; display: inline-flex; align-items: center; gap: 5px; height: 24px; margin-top: 10px; padding: 0 9px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;'
            link.addEventListener('mouseenter', () => { link.style.background = 'var(--dsw-alias-interactive-bg-hover)'; link.style.color = 'var(--dsw-alias-label-primary)' })
            link.addEventListener('mouseleave', () => { link.style.background = 'transparent'; link.style.color = 'var(--dsw-alias-label-secondary)' })
            link.addEventListener('click', () => retry(item))
            row.append(link)
          }
        }
      }
      const observer = new MutationObserver(scan)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      scan()
      return () => { observer.disconnect(); document.querySelectorAll('.hs-turn-retry').forEach(node => node.remove()) }
    }

    function watchSettingsSearch() {
      const style = document.createElement('style')
      style.id = 'hs-settings-search'
      style.dataset.plugin = '@harness-studio/compact'
      style.textContent = SETTINGS_SEARCH_CSS
      document.head.append(style)
      let query = ''
      let selected = 0
      const modal = () => document.querySelector('[data-shortcut-modal="settings"]')
      const navCells = () => [...(modal()?.querySelectorAll('nav [class*="_navCell"]') ?? [])]
      const pages = () => navCells().map(cell => cell.innerText.trim()).filter(Boolean)
      const activePage = () => navCells().find(cell => /_active/.test(cell.className))?.innerText.trim()
      const options = () => modal()?.querySelector('[class*="_options"]')
      const flash = (title) => {
        const started = Date.now()
        const tick = () => {
          const box = options()
          const el = box && [...box.querySelectorAll(SETTINGS_TITLE + ', label, span, div')].find(node => node.children.length === 0 && node.textContent.trim() === title)
          if (el) {
            const row = el.closest('.hs-setting, [class*="row" i], [class*="card" i], [class*="item" i]') || el.parentElement
            row.scrollIntoView({ block: 'center', behavior: 'smooth' })
            row.classList.remove('hs-ss-flash'); void row.offsetWidth; row.classList.add('hs-ss-flash')
            setTimeout(() => row.classList.remove('hs-ss-flash'), 2000)
          } else if (Date.now() - started < 1500) setTimeout(tick, 80)
        }
        tick()
      }
      const open = (hit) => {
        navCells().find(cell => cell.innerText.trim() === hit.page)?.click()
        if (!hit.isPage) flash(hit.title)
      }
      const render = () => {
        const root = modal()
        const nav = root?.querySelector('nav')
        const list = nav?.querySelector('[class*="_navList"]')
        if (!nav || !list) return
        let field = nav.querySelector('.hs-ss')
        if (!field) {
          field = document.createElement('label')
          field.className = 'hs-ss'
          field.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.6 11.9a5.4 5.4 0 1 0 0-10.8 5.4 5.4 0 0 0 0 10.8zM10.3 10.4l4.5 4.5" stroke="currentColor"/></svg>'
          const input = document.createElement('input')
          input.type = 'search'; input.placeholder = 'Search settings'; input.setAttribute('aria-label', 'Search settings'); input.spellcheck = false
          input.value = query
          input.addEventListener('input', () => { query = input.value; selected = 0; render() })
          input.addEventListener('keydown', (event) => {
            const hits = searchSettings(query, pages())
            if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); input.value = ''; query = ''; render(); return }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); selected = Math.max(0, Math.min(hits.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1))); render() }
            if (event.key === 'Enter' && hits[selected]) { event.preventDefault(); open(hits[selected]) }
          })
          field.append(input)
          list.before(field)
        }
        let results = nav.querySelector('.hs-ss-results')
        if (!query.trim()) { results?.remove(); list.style.display = ''; return }
        if (!results) { results = document.createElement('div'); results.className = 'hs-ss-results'; results.setAttribute('role', 'listbox'); results.setAttribute('aria-label', 'Matching settings'); list.after(results) }
        list.style.display = 'none'
        const hits = searchSettings(query, pages())
        results.replaceChildren(...(hits.length ? hits.map((hit, i) => {
          const button = document.createElement('button')
          button.type = 'button'; button.className = 'hs-ss-hit'; button.setAttribute('role', 'option')
          if (i === selected) button.setAttribute('data-selected', '')
          const name = document.createElement('span'); name.textContent = hit.title
          const where = document.createElement('span'); where.className = 'hs-ss-page'; where.textContent = hit.isPage ? 'Page' : hit.page
          button.append(name, where)
          button.addEventListener('click', () => { selected = i; open(hit); render() })
          return button
        }) : [Object.assign(document.createElement('div'), { className: 'hs-ss-none', textContent: 'No settings match' })]))
      }
      // Learn the open page's rows a moment after it renders, and keep the field in place across re-renders.
      let learnTimer = 0
      let shownPage
      const observer = new MutationObserver(() => {
        const root = modal()
        if (!root) { query = ''; shownPage = undefined; return }
        if (!root.querySelector('nav .hs-ss') || (query && !root.querySelector('nav .hs-ss-results'))) render()
        const page = activePage()
        if (page && page !== shownPage) {
          shownPage = page
          clearTimeout(learnTimer)
          learnTimer = setTimeout(() => { const box = options(); if (box && activePage() === page) learnSettingsPage(page, box) }, 700)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      const onKey = (event) => {
        if (!modal() || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
        const input = modal().querySelector('nav .hs-ss input')
        if (input) { event.preventDefault(); input.focus(); input.select() }
      }
      document.addEventListener('keydown', onKey, true)
      return () => {
        observer.disconnect(); clearTimeout(learnTimer); document.removeEventListener('keydown', onKey, true); style.remove()
        modal()?.querySelectorAll('nav .hs-ss, nav .hs-ss-results').forEach(el => el.remove())
        const list = modal()?.querySelector('nav [class*="_navList"]')
        if (list) list.style.display = ''
      }
    }

    function watchPromptHistory() {
      // Stepping state: the position in the history (-1 = the draft), the draft, and the text last put in the box.
      let step = -1
      let draft = ''
      let shown = null
      const onKeyDown = (event) => {
        const input = event.target instanceof Element ? event.target.closest(COMPOSER_INPUT) : null
        if (!input) return
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !document.querySelector('[data-trigger-menu]')) {
          step = -1; shown = null
          return
        }
        if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.isComposing || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return
        if (document.querySelector('[data-trigger-menu]')) return
        const text = input.innerText.replace(/\n$/, '')
        const stepping = shown !== null && text === shown
        if (!stepping) { step = -1; shown = null }
        const list = chatPrompts(input)
        if (event.key === 'ArrowUp') {
          if (!stepping && !(text.trim() === '' || caretAtStart(input))) return
          if (step + 1 >= list.length) return
          if (step === -1) draft = text
          step += 1
        } else {
          if (!stepping) return
          step -= 1
        }
        event.preventDefault()
        event.stopPropagation()
        shown = step === -1 ? null : list[step]
        setComposerText(input, step === -1 ? draft : list[step])
        if (step === -1) draft = ''
      }
      document.addEventListener('keydown', onKeyDown, true)
      return () => {
        document.removeEventListener('keydown', onKeyDown, true)
      }
    }

    return {
      inject: ['slots', 'layout', 'connection'],
      apply(ctx) {
        layout = ctx.layout
        settingsConnection = ctx.connection
        ctx.effect(() => () => { settingsConnection = undefined }, 'Network setting connection')
        ctx.effect(() => ctx.slots.inject('settings.permissions.item', () => ctx.slots.register({
          name: 'settings.permissions.item', id: 'network-for-commands', order: -19, inject: () => ({}),
        }, NetworkRow)), 'Network for commands row in Settings → Permissions, after Permission')
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'data', order: 30, label: () => 'Data', inject: () => ({}),
        }, DataPage)), 'Data page, last in Settings')
        ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'computer-use', order: 3, label: () => 'Computer use', inject: () => ({}),
        }, ComputerPage)), 'Computer use page in Settings, after Permissions')
        ctx.effect(() => ctx.slots.inject('settings.permissions.item', () => ctx.slots.register({
          name: 'settings.permissions.item', id: 'cloud-logins', order: -18.9, inject: () => ({}),
        }, CloudLoginsRow)), 'Cloud logins row in Settings → Permissions, after Network for commands')
        ctx.effect(() => ctx.slots.inject('settings.permissions.item', () => ctx.slots.register({
          name: 'settings.permissions.item', id: 'long-turns', order: -18.8, inject: () => ({}),
        }, LongTurnsRow)), 'Long turns row in Settings → Permissions, after Cloud logins')
        ctx.effect(watchComputerUse, 'computer use Stop bar')
        ctx.effect(watchQueue, 'queued messages listed one row each')
        ctx.effect(watchReadTicks, 'Waiting and Read on messages sent while the agent works')
        ctx.effect(watchPromptHistory, 'Up and Down recall sent prompts in the message box')
        ctx.effect(watchSettingsSearch, 'Search field at the top of the Settings page list')
        ctx.effect(watchEmptyModels, 'Empty model list points to Settings → Models')
        ctx.effect(watchSendWithoutModel, 'Send held back while no model is chosen')
        ctx.effect(watchFailedTurnRetry, 'Retry on the latest failed turn')
        ctx.effect(watchApprovalCards, 'Always allow for this website on new-site approvals')
        ctx.effect(() => ctx.slots.inject('settings.permissions.item', () => ctx.slots.register({
          name: 'settings.permissions.item', id: 'always-allowed-sites', order: -18.5, inject: () => ({}),
        }, SitesRow)), 'Always-allowed sites row in Settings → Permissions, after Long turns')
        ctx.effect(() => () => { layout = undefined }, 'About row target')
        ctx.effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
          name: 'sidebar.brand.name', inject: () => ({}),
        }, BrandName)), 'Harness Studio and its release version beside the sidebar logo')
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'about', inject: () => ({}),
        }, AboutPage)), 'About page')
        ctx.effect(() => ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: -10, inject: () => ({}),
        }, SettingsLauncher)), 'Settings alone at the foot of the left sidebar')
        ctx.effect(() => ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
          name: 'settings.appearance.item', id: 'chat-font', order: 11.5, inject: () => ({}),
        }, ChatFontRow)), 'Chat font row in Settings → Appearance, after Font size')
        ctx.effect(() => ctx.slots.inject('settings.appearance.item', () => ctx.slots.register({
          name: 'settings.appearance.item', id: 'color-theme', order: 10.5, inject: () => ({}),
        }, ColorThemeRow)), 'Colour theme row in Settings → Appearance, after Light or dark')
        // Enter while the agent works delivers at its next step (Steer), as in Claude Code, unless the person has
        // chosen in Settings → General → Send behavior while busy. Harness's own default is Queue (wait until the
        // turn ends). The form's user layer shows whether a choice was ever made, so a later Queue choice sticks.
        ctx.inject(['configForms'], (scope) => {
          const form = scope.configForms.get('ui-conversation')
          let settled = false
          const adopt = () => {
            const snapshot = form.getSnapshot()
            if (settled || snapshot.status !== 'ready' || !snapshot.writable) return
            settled = true
            if (snapshot.user?.busyEnter === undefined) void form.set('busyEnter', 'steer')
          }
          scope.effect(() => form.subscribe(adopt), 'Steer by default while busy')
          adopt()
        })
        ctx.inject(['theme'], (scope) => {
          themeService = scope.theme
          applyColorTheme()
          // Appearance changes which scheme the next start should paint.
          scope.on('theme/change', () => saveColorThemeBoot())
          scope.effect(() => () => {
            removeColorTheme?.()
            removeColorTheme = undefined
            themeService = undefined
            delete document.documentElement.dataset.hsColorTheme
          }, 'chosen colour theme')
        })
        ctx.effect(() => {
          applyFont(readFont())
          return () => document.documentElement.style.removeProperty('--hs-chat-font')
        }, 'chosen chat font')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.id = STYLE_ID
          style.dataset.plugin = '@harness-studio/compact'
          style.textContent = CSS
          document.head.append(style)
          return () => style.remove()
        }, 'compact density stylesheet')

        ctx.effect(installZoomCoordinates, 'one coordinate system under zoom')

        ctx.effect(() => {
          applyZoom(readZoom())
          window.addEventListener('keydown', onZoomKey, true)
          return () => {
            window.removeEventListener('keydown', onZoomKey, true)
            zoomNow = 1 // the coordinate patches stop converting even if they outlive this effect
            clearTimeout(badgeTimer)
            document.documentElement.style.zoom = ''
            document.documentElement.style.removeProperty('--hs-zoom')
            document.getElementById('harness-studio-zoom-badge')?.remove()
          }
        }, 'whole-app zoom shortcuts')

        ctx.effect(controlSidebarWidth, 'draggable left sidebar width')
        ctx.effect(shieldColumnDrags, 'drags pass over embedded pages')
        ctx.effect(centerMoreMenu, 'More menu centred over its button')
        ctx.effect(installSidebarSearch, 'session search at the top of the left sidebar')
        ctx.effect(foldLongPrompts, 'long messages fold with Show more')

      },
      css: CSS,
    }
  },
})
