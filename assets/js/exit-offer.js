// Exit offer: the free Legal Staffing Checklist in exchange for a name + email.
// Shown once per visitor every 14 days, never on the ad landing pages (not included there) and never to someone who
// already sent a form in this visit.
//   Desktop: when the mouse leaves through the top of the window (heading for the tab bar / close button),
//            after at least 8 seconds on the page.
//   Phones:  no "leaving" signal exists, so after 40 seconds on the page and half the page read; shown as a small
//            bottom card that doesn't cover the page (Google penalises pop-ups that block content on arrival).
// The lead goes to YVA OS → Leads (lead-intake, source "Checklist pop-up" — listed in
// "YVALAW OS/netlify/functions/_lib/leadForms.cjs"); then the checklist opens. GA: exit_offer_shown,
// download_checklist (event_category lead_magnet).
(function () {
    var KEY = 'yva_exit_offer', DAYS = 14, SOURCE = 'Checklist pop-up', SERVICE = 'Free checklist';
    var shownAt = Date.now(), shown = false;

    function get(k, store) { try { return (store || localStorage).getItem(k); } catch (e) { return null; } }
    function set(k, v, store) { try { (store || localStorage).setItem(k, v); } catch (e) { /* private mode */ } }
    function recentlyShown() { var t = Number(get(KEY)); return t && Date.now() - t < DAYS * 86400000; }
    function busy() {
        // A form already sent this visit, or a modal / menu is open
        if (get('yva_lead', sessionStorage)) return true;
        return !!document.querySelector('#calendly-modal.open, #mobile-menu.open, #mobile-service-modal.open, #faq-modal.open, #privacy-modal.open, #email-picker.open');
    }
    function track(action, label) { if (typeof gtag === 'function') gtag('event', action, { event_category: 'lead_magnet', event_label: label }); }
    function es() { return (get('yva_lang') || '') === 'es' && document.getElementById('lang-es'); }

    var T = {
        en: { kicker: 'Free download', title: 'Before you go: the Legal Staffing Checklist', text: 'The 10 questions to answer before you hire legal support staff: roles, bilingual coverage, tools, vetting, replacement terms and cost.', name: 'First name', email: 'Work email', send: 'Get the checklist', no: 'No thanks', err: 'Please enter your name and a valid email.', done: 'Opening your checklist…', privacy: 'We’ll email you about legal staffing now and then. No spam.' },
        es: { kicker: 'Descarga gratis', title: 'Antes de irte: la Lista de Contratación Legal', text: 'Las 10 preguntas que debes responder antes de contratar personal de apoyo legal: roles, cobertura bilingüe, herramientas, evaluación, reemplazos y costo.', name: 'Nombre', email: 'Correo de trabajo', send: 'Obtener la lista', no: 'No, gracias', err: 'Escribe tu nombre y un correo válido.', done: 'Abriendo tu lista…', privacy: 'Te escribiremos sobre personal legal de vez en cuando. Sin spam.' }
    };

    var css = '' +
        '.yxo-back{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:95;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;transition:opacity .2s}' +
        '.yxo-back.yxo-in{opacity:1}' +
        '.yxo{position:relative;width:100%;max-width:440px;background:#fff;border-radius:24px;box-shadow:0 30px 60px -20px rgba(15,23,42,.45);padding:28px;font-family:Inter,system-ui,sans-serif;color:#1b1e2b;transform:translateY(12px);transition:transform .2s}' +
        '.yxo-in .yxo{transform:none}' +
        '.yxo-k{display:inline-block;background:#facc15;color:#1b1e2b;font-size:11px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;padding:5px 10px;border-radius:999px;margin-bottom:12px}' +
        '.yxo h2{font-size:22px;line-height:1.2;font-weight:900;margin:0 40px 8px 0;letter-spacing:-.01em}' +
        '.yxo p{font-size:14px;line-height:1.5;color:#475569;margin:0 0 16px}' +
        '.yxo input{display:block;width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:12px;padding:12px 14px;font-size:16px;margin-bottom:10px;font-family:inherit;color:#1b1e2b;background:#fff}' +
        '.yxo input:focus{outline:2px solid #facc15;outline-offset:1px;border-color:#eab308}' +
        '.yxo .yxo-go{width:100%;border:0;border-radius:12px;background:#1b1e2b;color:#fff;font-weight:900;font-size:15px;padding:14px;cursor:pointer;font-family:inherit}' +
        '.yxo .yxo-go:hover{background:#2b3046}' +
        '.yxo .yxo-go[disabled]{opacity:.6;cursor:default}' +
        '.yxo .yxo-no{display:block;margin:10px auto 0;background:none;border:0;color:#64748b;font-size:13px;cursor:pointer;text-decoration:underline;font-family:inherit}' +
        '.yxo .yxo-x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:999px;border:0;background:#f1f5f9;color:#334155;font-size:20px;line-height:36px;cursor:pointer}' +
        '.yxo .yxo-err{color:#b91c1c;font-size:13px;margin:-4px 0 10px;display:none}' +
        '.yxo .yxo-small{font-size:11.5px;color:#94a3b8;margin:10px 0 0;text-align:center}' +
        '.yxo-hp{position:absolute!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important}' +
        '@media (max-width:639px){.yxo-back{align-items:flex-end;padding:0;background:rgba(15,23,42,.35)}' +
        '.yxo{max-width:none;border-radius:20px 20px 0 0;padding:22px 18px calc(18px + env(safe-area-inset-bottom));max-height:88dvh;overflow:auto}' +
        '.yxo h2{font-size:19px}}';

    function show(reason) {
        if (shown || recentlyShown() || busy()) return;
        shown = true; set(KEY, String(Date.now()));
        var t = es() ? T.es : T.en;
        var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
        var back = document.createElement('div');
        back.className = 'yxo-back';
        back.innerHTML =
            '<div class="yxo" role="dialog" aria-modal="true" aria-labelledby="yxo-title">' +
            '<button type="button" class="yxo-x" aria-label="Close">×</button>' +
            '<span class="yxo-k"></span><h2 id="yxo-title"></h2><p class="yxo-t"></p>' +
            '<form novalidate>' +
            '<input name="name" autocomplete="given-name" required>' +
            '<input name="email" type="email" autocomplete="email" required>' +
            '<input name="company_url" class="yxo-hp" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<div class="yxo-err" role="alert"></div>' +
            '<button type="submit" class="yxo-go"></button>' +
            '</form>' +
            '<button type="button" class="yxo-no"></button><p class="yxo-small"></p></div>';
        var box = back.querySelector('.yxo'), form = back.querySelector('form'), fName = form.elements.namedItem('name'), fEmail = form.elements.namedItem('email'), fHp = form.elements.namedItem('company_url'), err = back.querySelector('.yxo-err'), go = back.querySelector('.yxo-go');
        back.querySelector('.yxo-k').textContent = t.kicker;
        back.querySelector('#yxo-title').textContent = t.title;
        back.querySelector('.yxo-t').textContent = t.text;
        fName.placeholder = t.name; fName.setAttribute('aria-label', t.name);
        fEmail.placeholder = t.email; fEmail.setAttribute('aria-label', t.email);
        go.textContent = t.send; err.textContent = t.err;
        back.querySelector('.yxo-no').textContent = t.no;
        back.querySelector('.yxo-small').textContent = t.privacy;
        document.body.appendChild(back);
        if (window.yvaBotCheck) window.yvaBotCheck.watch(go);   // Cloudflare check above the button (assets/js/bot-check.js)
        requestAnimationFrame(function () { back.classList.add('yxo-in'); });
        track('exit_offer_shown', reason);
        var before = document.activeElement;
        function close() { back.remove(); document.removeEventListener('keydown', onKey); if (before && before.focus) before.focus(); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        back.addEventListener('click', function (e) { if (e.target === back) close(); });
        back.querySelector('.yxo-x').onclick = close;
        back.querySelector('.yxo-no').onclick = close;
        if (window.matchMedia('(min-width: 640px)').matches) fName.focus();
        form.onsubmit = function (e) {
            e.preventDefault();
            var name = fName.value.trim(), email = fEmail.value.trim();
            if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.style.display = 'block'; return; }
            err.style.display = 'none'; go.disabled = true; go.textContent = t.done;
            var utm = {};
            new URLSearchParams(location.search).forEach(function (v, k) { if (/^utm_|^gclid$|^fbclid$/.test(k)) utm[k] = v; });
            utm.ref = location.pathname;   // the page the visitor was reading
            var body = JSON.stringify({ name: name, email: email, service: SERVICE, source: SOURCE, message: 'Downloaded the Legal Staffing Checklist (pop-up on ' + location.pathname + ')', utm: utm, hp: fHp.value });
            var went = false, done = function () { if (went) return; went = true; track('download_checklist', 'exit_popup'); location.href = '/checklist.html'; };
            try {
                (window.yvaBotCheck ? window.yvaBotCheck.token(go) : Promise.resolve(null))
                    .then(function (turnstile) { var b = JSON.parse(body); b.turnstile = turnstile; return fetch('/.netlify/functions/lead-intake', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (d) { if (d && d.id) set('yva_lead', JSON.stringify({ id: d.id, token: d.token }), sessionStorage); })
                    .catch(function () {}).then(done);
            } catch (x) { done(); }
            setTimeout(done, 9000);   // never leave the visitor waiting (the person check can take a few seconds)
        };
        box.addEventListener('click', function (e) { e.stopPropagation(); });
    }

    window.yvaShowExitOffer = show;   // for testing
    if (recentlyShown()) return;
    var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fine) {
        document.addEventListener('mouseout', function (e) {
            if (e.relatedTarget || e.clientY > 8 || Date.now() - shownAt < 8000) return;
            show('exit_intent');
        });
    } else {
        var onScroll = function () {
            var h = document.documentElement.scrollHeight - window.innerHeight;
            if (Date.now() - shownAt < 40000 || h <= 0 || window.scrollY / h < 0.5) return;
            window.removeEventListener('scroll', onScroll);
            show('phone_read_half');
        };
        window.addEventListener('scroll', onScroll, { passive: true });
    }
})();
