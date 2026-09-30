// Sends a booking-form lead. EmailJS runs in the visitor's browser, so ad/privacy
// blockers (Brave, uBlock, some antivirus) can stop it. When the notification to
// YVA fails for any reason, the lead is posted to Netlify Forms instead — that
// request goes to this site's own domain, which blockers leave alone. Netlify
// stores it (Forms tab in the dashboard) and emails a notification.
//
// yvaSendLead(params, { source, replyParams }) → true if the lead reached YVA by
// either route. The auto-reply to the visitor is best-effort (EmailJS only).
(function () {
    var SERVICE = 'service_d485bxr';
    var TO_YVA = 'template_8gftonr';
    var AUTO_REPLY = 'template_9r6xtuw';

    function track(action, label) {
        if (typeof gtag === 'function') gtag('event', action, { event_category: 'lead_delivery', event_label: label });
    }

    // Field names must match the hidden "lead-backup" form in index.html —
    // Netlify drops any field that form doesn't declare.
    function backup(params, source, err) {
        var p = params || {};
        var fields = {
            'form-name': 'lead-backup',
            name: p.name || [p.first_name, p.last_name].filter(Boolean).join(' '),
            email: p.email || '',
            phone: p.phone || '',
            company: p.company || p.firm_name || '',
            website: p.website || '',
            service: p.service || '',
            message: p.message || '',
            sms_consent: p.sms_consent || '',
            source: source || p.source || location.pathname,
            error: String((err && (err.text || err.message)) || err || '')
        };
        return fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(fields).toString()
        }).then(function (res) {
            if (!res.ok) throw new Error('Netlify Forms returned ' + res.status);
            track('lead_backup_used', fields.error);
            return true;
        }).catch(function (e) {
            console.error('Lead backup failed:', e);
            track('lead_lost', fields.error + ' / ' + e.message);
            return false;
        });
    }

    window.yvaSendLead = async function (params, opts) {
        opts = opts || {};
        try {
            if (!window.emailjs) throw new Error('EmailJS script did not load (likely blocked)');
            await emailjs.send(SERVICE, TO_YVA, params);
        } catch (err) {
            console.error('EmailJS error:', err);
            return backup(params, opts.source, err);
        }
        try {
            await emailjs.send(SERVICE, AUTO_REPLY, opts.replyParams || params);
        } catch (err) {
            console.error('EmailJS auto-reply error:', err);
        }
        return true;
    };
})();
