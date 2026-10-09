/*
 * Live previews for the content manager (/admin).
 * The right-hand pane draws each entry with the site's own stylesheet, so editors
 * see a blog post (and its card in the blog list) or a job card the way visitors will.
 * Markup mirrors blog.html, build.js (post pages) and careers.html — keep them in step.
 * Decap provides the `CMS` and `h` (React.createElement) globals; `lucide` is loaded
 * by admin/index.html. Classes used here are compiled into assets/css/tailwind.css
 * (tailwind.config.js scans admin/*.js), so always write full class names.
 */
(function () {
  CMS.registerPreviewStyle('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
  CMS.registerPreviewStyle('/assets/css/tailwind.css');
  CMS.registerPreviewStyle("body { font-family: 'Inter', sans-serif; background: #f8fafc; }", { raw: true });

  function formatDate(value) {
    if (!value) return '';
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function icon(name, className) {
    var lib = window.lucide;
    if (!lib) return null;
    var pascal = String(name || '').replace(/(\w)(\w*)(_|-|\s*)/g, function (all, first, rest) {
      return first.toUpperCase() + rest.toLowerCase();
    });
    var svg = lib.createElement(lib.icons[pascal] || lib.icons.Briefcase);
    svg.setAttribute('class', className);
    return h('span', { className: 'contents', dangerouslySetInnerHTML: { __html: svg.outerHTML } });
  }

  function label(text) {
    return h('p', { className: 'text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4' }, text);
  }

  function notice(text) {
    return h('div', { className: 'mb-8 rounded-2xl bg-yellow-400 text-[#1b1e2b] px-5 py-4 text-sm font-bold' }, text);
  }

  function BlogPreview(props) {
    var get = function (key) { return props.entry.getIn(['data', key]); };
    var title = get('title') || 'Untitled post';
    var description = get('description') || '';
    var date = formatDate(get('date'));
    var image = get('image') ? props.getAsset(get('image')).toString() : '';
    var alt = get('image_alt') || title;
    var tooLong = description.length > 160;

    var card = h('div', { className: 'bg-white rounded-3xl overflow-hidden border-2 border-slate-100 flex flex-col max-w-sm' },
      image
        ? h('img', { src: image, alt: alt, className: 'w-full h-48 object-cover' })
        : h('div', { className: 'w-full h-48 bg-[#1b1e2b] flex items-center justify-center' }, icon('book-open', 'w-12 h-12 text-yellow-400')),
      h('div', { className: 'p-8 flex flex-col flex-1' },
        date ? h('p', { className: 'text-xs font-black text-slate-400 uppercase tracking-widest mb-3' }, date) : null,
        h('h2', { className: 'font-black text-[#1b1e2b] text-xl leading-tight mb-3' }, title),
        description ? h('p', { className: 'text-slate-500 text-sm font-medium leading-relaxed flex-1' }, description) : null,
        h('div', { className: 'flex items-center gap-2 mt-6 text-[#1b1e2b] font-black text-sm uppercase tracking-widest' },
          'Read More', icon('arrow-right', 'w-4 h-4 text-yellow-500'))
      )
    );

    var counter = h('p', { className: tooLong ? 'mt-3 text-xs font-bold text-amber-600' : 'mt-3 text-xs font-bold text-slate-400' },
      'Summary: ' + description.length + ' characters' + (tooLong ? ' (Google cuts off around 160)' : ''));

    var article = h('article', { className: 'bg-white rounded-3xl border-2 border-slate-100 px-6 py-12 sm:px-12' },
      image ? h('div', { className: 'mb-10 rounded-3xl overflow-hidden shadow-xl' },
        h('img', { src: image, alt: alt, className: 'w-full max-h-96 object-cover' })) : null,
      date ? h('p', { className: 'text-xs font-black text-slate-400 uppercase tracking-widest mb-4' }, date) : null,
      h('h1', { className: 'text-4xl lg:text-5xl font-black text-[#1b1e2b] leading-tight tracking-tight mb-6' }, title),
      description ? h('p', { className: 'text-xl text-slate-500 font-medium leading-relaxed mb-10 pb-10 border-b border-slate-100' }, description) : null,
      h('div', { className: 'prose' }, props.widgetFor('body'))
    );

    return h('div', { className: 'max-w-3xl mx-auto px-6 py-10' },
      get('draft') ? notice('Draft: saved but hidden from the website. Turn off “Draft” and click Publish when it’s ready.') : null,
      label('In the blog list'),
      card,
      counter,
      h('div', { className: 'h-12' }),
      label('Post page'),
      article
    );
  }

  function JobPreview(props) {
    var get = function (key) { return props.entry.getIn(['data', key]); };
    var status = get('status') || 'Open';
    var isOpen = String(status).toLowerCase() === 'open';
    var skills = get('skills') ? get('skills').toJS().filter(Boolean) : [];

    var card = h('div', { className: isOpen
        ? 'relative overflow-hidden bg-white border-2 border-slate-100 rounded-3xl p-8 flex flex-col'
        : 'relative overflow-hidden bg-slate-50 border-2 border-slate-100 rounded-3xl p-8 flex flex-col' },
      h('div', { className: isOpen
        ? 'absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-400'
        : 'absolute inset-x-0 top-0 h-1 bg-slate-200' }),
      h('div', { className: 'flex items-start justify-between mb-6' },
        h('div', { className: 'bg-[#1b1e2b] w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg' },
          icon(get('icon') || 'briefcase', 'w-7 h-7 text-yellow-400')),
        h('span', { className: isOpen
          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-full border'
          : 'bg-slate-100 text-slate-600 border-slate-200 text-xs font-black uppercase tracking-wider px-3 py-1.5 rounded-full border' }, status)
      ),
      h('h3', { className: 'font-black text-[#1b1e2b] text-xl mb-2' }, get('title') || 'Untitled role'),
      h('div', { className: 'flex flex-wrap items-center gap-4 mb-4' },
        h('span', { className: 'text-xs font-bold text-slate-500 flex items-center gap-1' }, icon('globe', 'w-3 h-3'), get('location') || 'Remote'),
        h('span', { className: 'text-xs font-bold text-slate-500 flex items-center gap-1' }, icon('clock', 'w-3 h-3'), get('schedule') || 'Full / Part-time')
      ),
      h('p', { className: 'text-slate-500 text-sm font-medium leading-relaxed mb-6 flex-1' }, get('description') || 'New opportunity now available.'),
      h('div', { className: 'space-y-2 mb-6' },
        h('p', { className: 'text-xs font-black text-slate-400 uppercase tracking-widest' }, 'Key Skills'),
        h('div', { className: 'flex flex-wrap gap-2' }, skills.length
          ? skills.map(function (skill, i) {
            return h('span', { key: i, className: 'bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full' }, skill);
          })
          : h('span', { className: 'bg-slate-100 text-slate-500 text-xs font-bold px-3 py-1 rounded-full' }, 'Generalist'))
      ),
      h('div', { className: isOpen
        ? 'w-full bg-[#1b1e2b] text-white py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2'
        : 'w-full bg-slate-200 text-slate-500 py-4 rounded-2xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-2' },
        isOpen ? 'Apply Now' : 'Applications Closed', icon(isOpen ? 'arrow-right' : 'lock', 'w-4 h-4'))
    );

    return h('div', { className: 'max-w-md mx-auto px-6 py-10' },
      get('featured') && isOpen ? notice('Highlighted in the box at the top of the Careers page.') : null,
      label('On the Careers page'),
      card
    );
  }

  CMS.registerPreviewTemplate('blog', BlogPreview);
  CMS.registerPreviewTemplate('jobs', JobPreview);
})();
