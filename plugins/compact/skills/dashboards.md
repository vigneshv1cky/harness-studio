# Dashboards

Build a live dashboard: a page of charts and numbers whose data the app fetches fresh every time the user opens it, without you. It shows in the Dashboards pane beside the chat. Each data source has a small refresh script that the user approves once; the app runs those scripts when the dashboard opens, when the user presses Refresh, and on a schedule if the user asks to keep it fresh.

## Layout

Make one folder per dashboard, `dashboards/<name>/` in the session folder (lowercase words joined by hyphens):

- `dashboard.html`: the page.
- `refresh/<source>.sh`, `.py`, `.mjs` or `.js`: one script per data source, named for the source (for example `refresh/sales.py`, `refresh/signups.sh`). It prints the source's data as JSON on standard output and nothing else, and exits with a non-zero status on failure, with the reason on standard error. Files it uses, such as a `.sql` query, go in `refresh/` too.
- `data/<source>.json`: written by the app after each refresh. Do not write these yourself except to test.

## Refresh scripts

- The app runs each script as `sh refresh/x.sh`, `python3 refresh/x.py` or `node refresh/x.mjs`, in the dashboard folder, with the same sandbox and network setting as your own commands, a 60-second limit and 2 MB of output. Keep them fast: aggregate in the query, not in the page.
- Keep everything a script needs inside `refresh/` (no subfolders, no links). The user approves the exact content of every file there, and any edit, yours included, needs their approval again before the app runs anything. A script that runs files from elsewhere in the workspace runs whatever those files hold when it runs, so do not.
- Never write a password, token or key into a script, the page or the data. Use what the user is already signed in to:
  - spreadsheets and CSV files in the workspace: read them directly (Python's `csv` module; `openpyxl` for Excel when it is available);
  - BigQuery, Snowflake, Databricks, PostgreSQL, MySQL, AWS and other services through their command-line tools (`bq`, `snow sql`, `databricks`, `psql`, `mysql`, `aws`), which use the logins the user turned on in Settings → Permissions → Cloud logins for commands; if a login is off, say which one to turn on rather than asking for a password;
  - a web API that needs a key: read it from a git-ignored `.env` file in the workspace, never from the page.
- Print only what the page shows (rows and numbers), never credentials, connection strings or personal data the dashboard does not need.
- Test each script yourself with the same command before handing over, and check it prints valid JSON.

## The page

`dashboard.html` is one self-contained HTML file: a `<title>`, a `<style>`, the dashboard runtime below copied unchanged as the first thing in `<body>`, then the layout, then a `<script>` that draws it:

```html
<div id="hs-dashboard-status"></div>
<button data-hs-refresh onclick="hsDashboard.refresh()">Refresh</button>
<div id="revenue"></div>
<script>
  hsDashboard.onData(({ data }) => {
    const sales = data.sales && data.sales.value
    if (!sales) return
    hsDashboard.kpi('#total', { label: 'Revenue this month', value: sales.total, delta: sales.change, format: v => '$' + v.toLocaleString() })
    hsDashboard.line('#revenue', { labels: sales.days, series: [{ name: 'Revenue', values: sales.revenue }] })
  })
</script>
```

- `hsDashboard.onData(fn)` calls `fn` with `{ data, errors }` when data arrives and after every refresh. `data.<source>` is `{ value, updated }` (the script's JSON and when it was saved) or `{ error }`; `errors.<source>` holds the last refresh's error for a source that failed. Draw from whatever is there and show a short note for a missing source instead of failing.
- Charts: `hsDashboard.line`, `hsDashboard.bar`, `hsDashboard.kpi` and `hsDashboard.table` draw into an element, matching light and dark mode. Draw others as SVG yourself.
- An element with id `hs-dashboard-status` shows when the data was updated and which sources failed.
- Mark refresh buttons with `data-hs-refresh`: a saved snapshot hides them, since it cannot refresh.
- The page runs in a frame with no network: it cannot fetch, load scripts from the internet or post anything. Inline everything except web fonts and images. It can only ask for a refresh (`hsDashboard.refresh()`).
- Use the user's real names, units and number formats; lead with the few numbers that matter; read the project's colours and fonts first when it has a brand.

## Hand over

- Say that the Dashboards pane shows it, that the first refresh asks the user to approve the refresh scripts (they see every file's full text), and that it then refreshes on its own each time it opens.
- To keep it current while closed, the user presses **Keep fresh** in the pane, or you create a watch with `watch_create` (kind `dashboard`, the folder name, `interval_seconds` at least 60) once its scripts are approved. It refreshes without waking you and stops after 7 days unless renewed.
- To share it, the user presses **Save snapshot** in the pane: one HTML file with the data as it is at that moment and no refresh, which they can send. There is no hosted link.

## Dashboard runtime

Copy everything between the two marker lines, without changes:

----- dashboard runtime start -----
{{DASHBOARD_RUNTIME}}
----- dashboard runtime end -----
