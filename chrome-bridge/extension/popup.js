const $ = id => document.getElementById(id)
const STATES = { connected: 'Connected', waiting: 'Waiting for Harness Studio', denied: 'Pairing refused' }
const MASK = '•••• •••• •••• ••••'
let code = ''
let revealed = false

async function render() {
  ;({ code = '' } = await chrome.storage.local.get('code'))
  const { status = 'waiting', detail = '' } = await chrome.storage.session.get(['status', 'detail'])
  $('state').className = 'state ' + status
  $('stateText').textContent = STATES[status] || status
  $('state').title = detail
  const connected = status === 'connected'
  $('pick').disabled = !connected
  $('pickHint').textContent = connected
    ? 'Click anything on this page to send it to Harness Studio.'
    : status === 'denied' ? 'Harness Studio has a different pairing code. Copy this one into the connector.' : 'Start Harness Studio with the Chrome extension connector on.'
  // Setup steps only matter until the bridge has paired.
  $('steps').hidden = connected
  showCode()
}

function showCode() {
  $('code').textContent = revealed ? (code || 'Created when the extension starts') : MASK
  $('code').classList.toggle('hidden', !revealed)
  $('reveal').textContent = revealed ? 'Hide' : 'Show'
}

$('reveal').onclick = () => { revealed = !revealed; showCode() }
$('copy').onclick = async () => {
  if (!code) return
  await navigator.clipboard.writeText(code)
  $('copy').textContent = 'Copied'
  setTimeout(() => { $('copy').textContent = 'Copy' }, 1200)
}
$('pick').onclick = () => { chrome.runtime.sendMessage({ type: 'pick' }); window.close() }
$('reconnect').onclick = () => chrome.runtime.sendMessage({ type: 'reconnect' }).then(() => setTimeout(render, 600))
$('new').onclick = async () => {
  if (!confirm('Make a new pairing code? Paste it into the Chrome extension connector in Harness Studio afterwards.')) return
  await chrome.runtime.sendMessage({ type: 'new-code' })
  revealed = true
  render()
}

chrome.commands.getAll().then((all) => {
  const shortcut = all.find(c => c.name === 'select-element')?.shortcut
  if (shortcut) {
    $('kbd').textContent = shortcut
    $('kbd').hidden = false
    return
  }
  const set = document.createElement('a')
  set.textContent = 'Set a shortcut'
  set.onclick = () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
  $('shortcutHint').append(' ', set)
})

$('version').textContent = 'v' + chrome.runtime.getManifest().version
chrome.storage.onChanged.addListener(render)
render()
