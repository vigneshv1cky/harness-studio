/**
 * Skills Harness Studio adds to the agent's skill catalog: the design board (screens drafted side by side at phone,
 * tablet and desktop widths in one self-contained HTML file), desktop and mobile apps (building and checking them inside
 * the command sandbox), and charts, icons and diagrams
 * (native Office charts, SVG otherwise), and live dashboards (a page with refresh scripts the Dashboards pane runs). They are registered in memory through Harness's skill registry, so only
 * their name and description reach every request; the body loads when the agent picks the skill.
 */
import { readFileSync } from 'node:fs'

const read = file => readFileSync(new URL(`./skills/${file}`, import.meta.url), 'utf8')

/** The skills, with the routing text the model sees in its catalog. */
export const STUDIO_SKILLS = [
  {
    name: 'design-board',
    description: 'Draft app or web screens as a design board: one HTML file showing each screen and variant side by side at phone, tablet and desktop widths, using the project\'s real colours and fonts.',
    whenToUse: 'When the user asks to design, mock up, sketch or explore the look of screens or pages, or to compare layout directions, before the real code changes.',
    content: () => read('design-board.md').replace('{{BOARD_RUNTIME}}', read('board-runtime.html').trimEnd()),
  },
  {
    name: 'native-apps',
    description: 'Build, run and check desktop and mobile apps (macOS, iOS, Android, Linux desktop, Electron, Tauri, React Native, Flutter) inside Harness Studio\'s command sandbox: where each toolchain must keep its files, how to run and check the app, and what this computer cannot do.',
    whenToUse: 'When the user asks to build, run or test a desktop app, a phone or tablet app, or an emulator or simulator build.',
    content: () => read('native-apps.md'),
  },
  {
    name: 'dashboards',
    description: 'Build a live dashboard: a page of charts and numbers with a small refresh script per data source (spreadsheet, CSV, a database or warehouse through the user\'s cloud login, or a web API), shown in the Dashboards pane, which fetches fresh data each time it opens once the user approves the scripts.',
    whenToUse: 'When the user asks for a dashboard, a live report, a page of metrics or KPIs, or charts that should stay current with their data.',
    content: () => read('dashboards.md').replace('{{DASHBOARD_RUNTIME}}', read('dashboard-runtime.html').trimEnd()),
  },
  {
    name: 'charts-and-diagrams',
    description: 'Make charts, icons and diagrams: native editable charts inside PowerPoint and Excel files, and SVG files for standalone charts, icon sets and flow or architecture diagrams.',
    whenToUse: 'When the user asks for a chart or graph, an icon or icon set, or a flowchart, architecture or other diagram.',
    content: () => read('charts-and-diagrams.md'),
  },
]

/**
 * Register the skills with Harness's skill registry once it is available. Each registration is removed with the
 * plugin. A composition without a skill registry gets nothing.
 * @param {object} ctx - the Host plugin context.
 */
export function applyStudioSkills(ctx) {
  if (typeof ctx.inject !== 'function') return
  ctx.inject(['skills'], (scope) => {
    for (const skill of STUDIO_SKILLS) {
      scope.skills.register({ name: skill.name, description: skill.description, whenToUse: skill.whenToUse, content: skill.content(), source: 'runtime' })
    }
  })
}
