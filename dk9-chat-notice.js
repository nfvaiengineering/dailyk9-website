/* Daily K9 — sensitive-data notice for the Handler chat widget.
 *
 * Why this exists: the widget is on every page of a psychiatric service dog
 * site, so visitors volunteer diagnoses into it because they believe it is
 * relevant to the enquiry. Reducing how much health data is collected in the
 * first place is worth more than disclosing it well after the fact.
 *
 * handler-chat.js exposes only data-handler-{key,name,api,color,accent} — no
 * hook for this — so the notice is injected here. It renders into the light
 * DOM (no shadow root), so this works, but it is coupled to the widget's class
 * names. DELETE THIS FILE once handler-chat.js supports a notice attribute of
 * its own; that is the durable fix.
 */
(function () {
  'use strict';

  var TEXT = 'Please don’t share medical details or diagnoses in chat. ' +
             'Tell us what you’re looking for and we’ll take the rest to a private intake call.';

  var STYLE =
    '.dk9-chat-notice{margin:0 0 10px;padding:9px 11px;border-radius:10px;' +
    'background:#fdf3e3;border:1px solid #f0d9ae;color:#6b5426;' +
    'font-size:12px;line-height:1.45;font-family:inherit}';

  function addStyle() {
    if (document.getElementById('dk9-chat-notice-style')) return;
    var s = document.createElement('style');
    s.id = 'dk9-chat-notice-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function makeNotice() {
    var p = document.createElement('p');
    p.className = 'dk9-chat-notice';
    p.textContent = TEXT;
    return p;
  }

  // Two placements: the pre-chat gate (read before they start) and directly
  // above the composer (the first field where free text is actually typed).
  function inject() {
    var done = 0;

    var gate = document.querySelector('.hc-gate');
    if (gate && !gate.querySelector('.dk9-chat-notice')) {
      gate.insertBefore(makeNotice(), gate.firstChild);
      done++;
    }

    var foot = document.querySelector('.hc-foot');
    if (foot && foot.parentNode &&
        !foot.parentNode.querySelector('.hc-foot ~ .dk9-chat-notice, .dk9-chat-notice + .hc-foot')) {
      foot.parentNode.insertBefore(makeNotice(), foot);
      done++;
    }

    return done === 2;
  }

  function start() {
    addStyle();
    if (inject()) return;
    // handler-chat.js is deferred and builds its panel on load; poll briefly,
    // then give up quietly rather than run forever.
    var tries = 0;
    var timer = setInterval(function () {
      if (inject() || ++tries > 100) clearInterval(timer); // ~20s
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
