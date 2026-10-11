import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PUBLIC chat widget for the owner's shop site — a real drop-in script:
 *
 *   <script src="https://<base-url>/api/agent-pub/widget.js?key=<SITE_KEY>" defer></script>
 *
 * Renders a floating support button + chat box (RTL, dark, vanilla JS, no
 * dependencies) that talks to /api/agent-pub/support.
 */
export async function GET(_req: NextRequest) {
  const js = `(function () {
  'use strict'
  var script = document.currentScript || (function () {
    var all = document.getElementsByTagName('script')
    return all[all.length - 1]
  })()
  var src = script && script.src ? script.src : ''
  var key = ''
  try { key = new URL(src, location.href).searchParams.get('key') || '' } catch (e) {}
  var base = ''
  try {
    var u = new URL(src, location.href)
    base = u.origin
  } catch (e) { base = '' }
  var API = base + '/api/agent-pub/support'

  var SID_KEY = 'z-support-session'
  var sessionId = ''
  try { sessionId = localStorage.getItem(SID_KEY) || '' } catch (e) {}

  var css = document.createElement('style')
  css.textContent = [
    '.zw-btn{position:fixed;bottom:20px;left:20px;z-index:99998;width:56px;height:56px;border-radius:50%;',
    'background:#0f9d6a;color:#fff;border:none;cursor:pointer;font-size:24px;line-height:1;',
    'box-shadow:0 6px 20px rgba(0,0,0,.35);transition:transform .15s}',
    '.zw-btn:hover{transform:scale(1.07)}',
    '.zw-box{position:fixed;bottom:88px;left:20px;z-index:99999;width:min(340px,calc(100vw - 32px));height:440px;max-height:calc(100vh - 120px);',
    'background:#101413;color:#e8ede9;border:1px solid #263028;border-radius:14px;display:none;flex-direction:column;overflow:hidden;',
    'font-family:Tahoma,"Segoe UI",sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '.zw-box.open{display:flex}',
    '.zw-head{padding:12px 14px;background:#141a17;border-bottom:1px solid #263028;font-weight:bold;font-size:14px;color:#f5c66b}',
    '.zw-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;font-size:13px}',
    '.zw-m{max-width:85%;padding:8px 12px;border-radius:12px;white-space:pre-wrap;line-height:1.7;word-break:break-word}',
    '.zw-u{align-self:flex-start;background:#1b241f;border:1px solid #2a362d;border-top-right-radius:4px}',
    '.zw-a{align-self:flex-end;background:#14532d;border-top-left-radius:4px}',
    '.zw-form{display:flex;gap:8px;padding:10px;background:#141a17;border-top:1px solid #263028}',
    '.zw-in{flex:1;background:#0c100e;border:1px solid #2a362d;border-radius:9px;color:#e8ede9;padding:9px 12px;font-size:13px;outline:none;font-family:inherit}',
    '.zw-send{background:#0f9d6a;color:#fff;border:none;border-radius:9px;padding:9px 14px;cursor:pointer;font-size:13px;font-family:inherit}',
    '.zw-send:disabled{opacity:.55;cursor:default}',
    '.zw-hint{padding:6px 12px 10px;font-size:10px;color:#7d8a7f;background:#141a17;text-align:center}'
  ].join('')
  document.head.appendChild(css)

  var btn = document.createElement('button')
  btn.className = 'zw-btn'
  btn.setAttribute('aria-label', 'پشتیبانی')
  btn.innerHTML = '&#128172;'
  btn.onclick = function () { toggle() }
  document.body.appendChild(btn)

  var box = document.createElement('div')
  box.className = 'zw-box'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', 'گفتگو با پشتیبانی')
  box.innerHTML =
    '<div class="zw-head">&#128172; پشتیبانی آنلاین</div>' +
    '<div class="zw-msgs" id="zw-msgs"></div>' +
    '<form class="zw-form" id="zw-form">' +
    '<input class="zw-in" id="zw-in" placeholder="سوالت را بنویس..." autocomplete="off" maxlength="900"/>' +
    '<button class="zw-send" id="zw-send" type="submit">ارسال</button></form>' +
    '<div class="zw-hint">پاسخ‌ها توسط دستیار هوشمند داده می‌شود</div>'
  document.body.appendChild(box)

  var msgs = box.querySelector('#zw-msgs')
  var form = box.querySelector('#zw-form')
  var input = box.querySelector('#zw-in')
  var send = box.querySelector('#zw-send')

  function toggle() {
    var open = box.classList.toggle('open')
    if (open) {
      input.focus()
      if (!msgs.childElementCount) addMsg('a', 'سلام! چطور می‌تونم کمکتون کنم؟')
    }
  }

  function addMsg(who, text) {
    var d = document.createElement('div')
    d.className = 'zw-m ' + (who === 'u' ? 'zw-u' : 'zw-a')
    d.textContent = text
    msgs.appendChild(d)
    msgs.scrollTop = msgs.scrollHeight
    return d
  }

  form.onsubmit = function (ev) {
    ev.preventDefault()
    var text = (input.value || '').trim()
    if (!text) return
    input.value = ''
    addMsg('u', text)
    var typing = addMsg('a', '...')
    send.disabled = true
    fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteKey: key, sessionId: sessionId, message: text })
    }).then(function (r) { return r.json() }).then(function (j) {
      typing.remove()
      if (j && j.ok) {
        sessionId = j.sessionId || sessionId
        try { localStorage.setItem(SID_KEY, sessionId) } catch (e) {}
        addMsg('a', j.reply || 'پاسخی نرسید؛ دوباره تلاش کن')
      } else {
        addMsg('a', (j && j.error) || 'الان جواب نمی‌ده؛ کمی بعد دوباره بنویس')
      }
    }).catch(function () {
      typing.remove()
      addMsg('a', 'ارتباط قطع شد؛ کمی بعد دوباره بنویس')
    }).finally(function () { send.disabled = false })
  }
})()`
  return new NextResponse(js, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  })
}
