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

      // ---- conversation header -----------------------------------------------------------
      [c('crumb'), 'padding: 2px 6px !important; border-radius: 6px !important'],
      // Title row and Chat / Trajectory tabs keep Harness's 10px breathing room; the tabs sit a little
      // closer to each other.
      [c('tabs'), 'gap: 28px !important'],

      // ---- conversation body -------------------------------------------------------------
      [c('scroll'), 'padding-top: 8px !important'],
      [shownItem, 'margin-top: 10px !important'],
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
      [`${c('composerSeat')} ${c('card')}`, 'border-radius: 14px !important; padding-top: 4px !important; gap: 4px !important'],
      [`${c('composerSeat')} ${c('input')}`, 'padding: 4px 8px 0 12px !important; min-height: 28px !important'],
      [`${c('composerSeat')} ${c('row')}`, 'padding: 0 6px 4px !important'],
      [`${c('composerSeat')} ${c('dock')}`, 'padding-top: 2px !important; font-size: 11px !important; opacity: 0.8'],
      [`${c('composerSeat')} ${c('dock')} *`, 'font-size: 11px !important'],
      [`${c('composerSeat')} ${c('primary')}`, 'width: 28px !important; height: 28px !important; min-width: 28px !important'],

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
      // The question panel (the agent asking you to choose): Claude Code desktop's sizes — a 14px title,
      // 30px choices with 13px labels and 12px descriptions, 28px footer buttons. Scoped to the card that
      // holds the choices, since "card", "header" and "title" are common class names in Harness.
      ...(() => {
        const Q = `${c('card')}:has(${c('optionCopy')})`
        return [
          [`${Q} ${c('header')}`, 'padding: 12px 10px 0 14px !important; gap: 12px !important'],
          [`${Q} ${c('eyebrow')}`, 'margin-bottom: 2px !important; font-size: 11px !important; line-height: 16px !important'],
          [`${Q} ${c('title')}`, 'font-size: 14px !important; line-height: 20px !important; font-weight: 600 !important'],
          [`${Q} ${c('options')}`, 'margin: 6px 0 0 !important; padding: 2px 6px !important; gap: 1px !important'],
          [`${Q} ${c('option')}, ${Q} ${c('customRow')}`, 'min-height: 30px !important; padding: 5px 8px 5px 6px !important; gap: 8px !important; border-radius: 8px !important'],
          [`${Q} ${c('number')}`, 'width: 18px !important; height: 18px !important; margin-top: 1px !important; font-size: 11px !important; line-height: 18px !important'],
          [`${Q} ${c('optionLine')}`, 'gap: 0 6px !important'],
          [`${Q} ${c('optionLabel')}`, 'font-size: 13px !important; line-height: 20px !important'],
          [`${Q} ${c('description')}`, 'font-size: 12px !important; line-height: 18px !important'],
          [`${Q} ${c('badge')}`, 'font-size: 10.5px !important; line-height: 16px !important'],
          [`${Q} ${c('fieldInput')}, ${Q} ${c('fieldMirror')}, ${Q} ${c('field')} > *`, 'font-size: 13px !important; line-height: 20px !important'],
          [`${Q} ${c('footer')}`, 'margin-top: 6px !important; padding: 0 8px 0 14px !important'],
          [`${Q} ${c('footer')} button:not(${c('iconButton')})`, 'height: 28px !important; min-height: 28px !important; padding: 0 12px !important; font-size: 13px !important; border-radius: 8px !important'],
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
    const CHAT_SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif'

    // Panels and popups that stand apart, like Claude Code desktop's: Harness draws menus 58%
    // transparent with almost no shadow, so they melt into the white behind them. Popups here are
    // solid with Claude's popover shadow, and the side panes and message box carry its panel shadow.
    const LIGHT = 'body:not([data-ds-dark-theme])'
    const DARK = 'body[data-ds-dark-theme]'
    const POPUPS = ':is([class*="_material_"], [role="menu"], [role="listbox"], [class*="_dialog_"], [data-studio-menu])'
    const LAYER_RULES = [
      [LIGHT, '--dsw-specific-menu: #fff !important; --dsw-menu-surface-fill: #fff !important; ' +
        '--hs-popup-shadow: 0 0 0 0.5px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.08); ' +
        '--hs-panel-shadow: 0 0 0 0.5px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06), 0 2px 8px rgba(0,0,0,0.05)'],
      [DARK, '--hs-popup-shadow: 0 0 0 0.5px rgba(255,255,255,0.12), 0 8px 24px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.2); ' +
        '--hs-panel-shadow: 0 0 0 0.5px rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.3)'],
      [POPUPS, 'box-shadow: var(--hs-popup-shadow) !important'],
    ]

    const TABLE = `${c('body')} [class*="_markdown_"]`
    const TABLE_LINE = 'color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent)'
    const TABLE_FILL = 'color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent)'

    const LOOK_RULES = [
      ...LAYER_RULES,
      // ---- conversation typography and column, like Claude Code desktop ------------------------
      // Regular weight with the app's antialiased smoothing, as Claude Code desktop draws all its text.
      [`${c('body')} [class*="_markdown_"]`, `font-family: ${CHAT_SANS} !important; font-size: 14px !important; line-height: 20px !important; letter-spacing: 0; ` +
        'font-weight: 400; color: var(--dsw-alias-label-primary) !important'],
      [`${c('body')} [class*="_markdown_"] :is(h1,h2,h3,h4)`, `font-family: ${CHAT_SANS} !important; font-weight: 600 !important`],
      [`${c('body')} [class*="_markdown_"] :is(strong,b)`, 'font-weight: 600 !important'],
      [`${c('body')} [class*="_markdown_"] :is(code,pre,pre *)`, 'font-family: var(--dsw-font-markdown-code-font-family) !important; letter-spacing: 0'],
      [`${c('body')} [class*="_markdown_"] p`, 'margin: 0 0 16px !important'],
      [`${c('body')} [class*="_markdown_"] :is(ul,ol)`, 'margin: 0 0 16px !important'],
      [`${c('body')} [class*="_markdown_"] li`, 'margin: 4px 0 !important'],
      [`${c('body')} [class*="_markdown_"] > :last-child`, 'margin-bottom: 0 !important'],
      // Tables like Claude Code desktop's (measured from its rendering): 15px text on a 20px line, cells
      // padded 6px by 11px with the text at the top, columns sized to their content (Harness caps each
      // cell at 320px), a 1px rounded border and 1px row lines at 10% of the text colour, and a header
      // in the cells' weight on a 5% fill. Mixing from the text colour keeps both themes right.
      [`${TABLE} table`, 'border-collapse: separate !important; border-spacing: 0 !important; border-radius: 8px !important; ' +
        `border: 1px solid ${TABLE_LINE} !important`],
      [`${TABLE} :is(th,td)`, `font-family: ${CHAT_SANS} !important; font-size: 14px !important; line-height: 20px !important; font-weight: 400 !important; ` +
        `color: var(--dsw-alias-label-primary) !important; padding: 6px 11px !important; vertical-align: top !important; text-align: left !important; ` +
        `max-width: none !important; border: none !important; border-bottom: 1px solid ${TABLE_LINE} !important`],
      [`${TABLE} tr:last-child td`, 'border-bottom: none !important'],
      // Claude keeps a table inside the text column and wraps its cells; Harness widens wide tables
      // past the column and scrolls them sideways. The table fills the column instead, and the wrapper
      // drops Harness's widening (it only scrolls if a single word cannot fit).
      [`${TABLE} [class*="_tableScroll_"] > table`, 'width: 100% !important; max-width: 100% !important; table-layout: auto !important'],
      [`${TABLE} .md-table-wide`, 'width: 100% !important; margin-left: 0 !important; padding-left: 0 !important; padding-bottom: 0 !important; overflow-x: auto !important'],
      [`${TABLE} [class*="_tableScroll_"]`, 'margin: 12px 0 16px !important'],
      [`${TABLE} th`, `background: ${TABLE_FILL} !important`],
      [`${TABLE} tr:first-child th:first-child`, 'border-top-left-radius: 7px !important'],
      [`${TABLE} tr:first-child th:last-child`, 'border-top-right-radius: 7px !important'],
      [`${TABLE} :is(th,td) code`, 'font-size: 13px !important'],
      // Plain inline code flows as text, like Claude's: Harness makes each chip one inline-flex box,
      // so a path that wraps becomes a two-line block filling the cell. Inline, every wrapped line
      // gets its own chip and the line spacing stays even. Chips holding an icon (file links) keep
      // Harness's layout.
      [`${TABLE} :not(pre) > code:not(:has(*))`, 'display: inline !important; box-decoration-break: clone; -webkit-box-decoration-break: clone; ' +
        'padding: 1px 5px !important; overflow-wrap: anywhere'],
      // Code: Harness sets fenced blocks at 11px, well under the text around them; Claude uses 13/19px
      // for blocks and inline code alike.
      [`${c('body')} [class*="_markdown_"] pre, ${c('body')} [class*="_markdown_"] pre *`, 'font-size: 13px !important; line-height: 19px !important'],
      [`${c('body')} [class*="_markdown_"] :not(pre) > code`, 'font-size: 13px !important'],
      [c('bubble'), 'font-size: 14px !important; line-height: 20px !important; font-weight: 400'],
      // Tighter vertical rhythm: 12px between transcript items, the reply's action row pulled up to
      // its text, and less padding around the "Completed in …" summary row.
      [shownItem, 'margin-top: 12px !important'],
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
      // Text and row sizes measured from Claude Code desktop at 100%: 13px sidebar, title and controls text,
      // about 28px rows (Harness: 14px on 32–36px rows).
      [`${c('root')}:not(${c('collapsed')}) ${c('panelList')}`, 'gap: 0 !important'],
      [`${c('root')}:not(${c('collapsed')}) ${c('panelRow')}`, 'min-height: 28px !important; height: 28px !important; padding: 4px 8px !important; font-size: 13px !important; line-height: 20px !important'],
      [c('sessionRow'), 'height: 28px !important'],
      [c('projectRow'), 'height: 28px !important; font-size: 13px !important'],
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
      [`${c('root')}:not(${c('collapsed')}) > ${c('newSession')}`, 'justify-content: flex-start !important; height: 28px !important; padding: 4px 8px !important; margin: 0 2px !important; font-size: 13px !important; border-color: transparent !important; background: transparent !important; font-weight: 400 !important'],
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
      ['[data-hs-sidebar-search] > kbd', 'flex: 0 0 auto; font: inherit; font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-tertiary)'],
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
      [p('tabTitle'), 'font-size: 12.5px !important'],
      [`${m('tabActive')} ${m('tabTitle')}`, 'font-weight: 500 !important'],
      [p('tabClose'), 'opacity: 0; transition: opacity 120ms'],
      [`${p('tab')}${m('tabActive')} ${m('tabClose')}`, 'position: static !important; transform: none !important; flex: none !important'],
      // The pane's × sits at the far right of its header (added by the Preview plugin), so the
      // title carries none — except browser tabs, which each keep their own.
      [`${p('tab')}${m('tabActive')}:not([data-studio-kind="browser"]) ${m('tabClose')}`, 'display: none !important'],
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
    ]

    const CSS = [...RULES, ...LOOK_RULES].map(([selector, body]) => `${selector} { ${body} }`).join('\n')
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

    // ---- sidebar foot: just Settings -------------------------------------------------------------
    // Harness puts an account menu (Settings, Feedback, Sign out) at the foot of the left sidebar. Like
    // Claude Code desktop's, the foot here is one Settings row that opens Settings directly; signing in
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
      return h('button', {
        type: 'button', className: classes.row, 'data-studio-settings': '', 'aria-label': 'Settings', 'aria-haspopup': 'dialog', 'aria-expanded': settingsOpen,
        'aria-keyshortcuts': settingsShortcut?.aria, title: hint ? 'Settings (' + hint + ')' : 'Settings', onClick: () => openSettings(),
        style: classes.row ? { width: '100%' } : { display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 28, padding: '4px 8px', border: 'none', borderRadius: 12, background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 13, cursor: 'pointer' },
      },
        h('span', { className: classes.glyph, 'aria-hidden': true },
          h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1, strokeLinejoin: 'round' }, h('path', { d: SETTINGS_GLYPH }))),
        wide ? h('span', { className: classes.title }, 'Settings') : null)
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('settings.launcher', () => ctx.slots.register({
          name: 'settings.launcher', priority: -10, inject: () => ({}),
        }, SettingsLauncher)), 'Settings alone at the foot of the left sidebar')
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
