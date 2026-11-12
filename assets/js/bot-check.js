// Cloudflare Turnstile — the "are you a person?" check for the website forms (no puzzles for normal visitors:
// it runs in the background and only shows a box when Cloudflare is unsure).
// The token goes with the lead to lead-intake / application-intake, which check it with Cloudflare
// ("YVALAW OS/netlify/functions/_lib/turnstile.cjs"; on once TURNSTILE_SECRET_KEY is set on Netlify).
// The email routes (EmailJS / Netlify Forms) don't use it, so a visitor whose browser blocks Cloudflare still reaches YVA.
//
//   yvaBotCheck.watch(buttonOrId) — put the check just above that submit button; it starts when the visitor
//                                   first clicks into a field near it (so it's done by the time they submit)
//   yvaBotCheck.token(buttonOrId?) → Promise<token | null>  (waits up to 8 s; null if it couldn't run)
// The booking buttons below are watched automatically on every page that loads this script.
(function () {
    var SITE_KEY = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        ? '1x00000000000000000000AA'            // Cloudflare's always-pass test key (the real one only works on our domains)
        : (window.YVA_TURNSTILE_SITEKEY || '0x4AAAAAAF95E8vaxwx4YGHq');
    var BUTTONS = ['form-submit', 'lp-form-submit', 'lp-submit', 'submit-btn', 'apply-submit'];
    var API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=yvaTurnstileReady';
    var spots = [], last = null, loading = null;

    function load() {
        if (loading) return loading;
        loading = new Promise(function (resolve) {
            if (window.turnstile) return resolve(window.turnstile);
            window.yvaTurnstileReady = function () { resolve(window.turnstile); };
            var s = document.createElement('script');
            s.src = API; s.async = true; s.defer = true;
            s.onerror = function () { resolve(null); };
            document.head.appendChild(s);
        });
        return loading;
    }
    function el(x) { return typeof x === 'string' ? document.getElementById(x) : x; }
    function areaOf(btn) { return btn.closest('form, [role="dialog"], .modal-panel, .yxo') || btn.parentElement; }
    function spotFor(x) {
        var btn = el(x);
        for (var i = 0; i < spots.length; i++) if (spots[i].btn === btn) return spots[i];
        return null;
    }
    function render(spot) {
        if (spot.started) return spot.ready;
        spot.started = true;
        spot.ready = load().then(function (ts) {
            if (!ts) { spot.failed = true; return; }
            try {
                spot.id = ts.render(spot.box, {
                    sitekey: SITE_KEY, appearance: 'interaction-only', size: 'flexible', action: 'website-form',
                    callback: function (t) { spot.token = t; flush(spot); },
                    'expired-callback': function () { spot.token = null; },
                    'error-callback': function () { spot.failed = true; flush(spot); return true; }
                });
            } catch (e) { spot.failed = true; }
        });
        return spot.ready;
    }
    function flush(spot) { var w = spot.waiting; spot.waiting = []; w.forEach(function (f) { f(); }); }

    function watch(x) {
        var btn = el(x);
        if (!btn || spotFor(btn)) return;
        var box = document.createElement('div');
        box.className = 'yva-bot-check';
        box.style.cssText = 'display:flex;justify-content:center;max-width:100%;overflow:hidden';
        btn.parentNode.insertBefore(box, btn);
        var spot = { btn: btn, box: box, token: null, waiting: [], started: false, failed: false };
        spots.push(spot);
        var area = areaOf(btn);
        area.addEventListener('focusin', function () { last = spot; render(spot); });
        area.addEventListener('pointerdown', function () { last = spot; });
    }

    function token(x) {
        var spot = (x && spotFor(x)) || last || spots[0];
        if (!spot) return Promise.resolve(null);
        return render(spot).then(function () {
            if (spot.token || spot.failed) return take(spot);
            return new Promise(function (resolve) {
                var done = false, finish = function () { if (!done) { done = true; resolve(take(spot)); } };
                spot.waiting.push(finish);
                setTimeout(finish, 8000);
            });
        });
    }
    // A token can be used once: hand it out, then get a fresh one for a second submission
    function take(spot) {
        var t = spot.token || null;
        spot.token = null;
        if (t && window.turnstile && spot.id !== undefined) { try { window.turnstile.reset(spot.id); } catch (e) { /* ignore */ } }
        if (!t && typeof gtag === 'function') gtag('event', 'bot_check_unavailable', { event_category: 'lead_delivery' });
        return t;
    }

    window.yvaBotCheck = { watch: watch, token: token };
    function auto() { BUTTONS.forEach(function (id) { if (document.getElementById(id)) watch(id); }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', auto); else auto();
})();
