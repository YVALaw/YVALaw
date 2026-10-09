const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { execFileSync } = require('child_process');

const postsDir = path.join(__dirname, 'posts');
const jobsDir = path.join(__dirname, 'jobs');

if (!fs.existsSync(postsDir)) {
  fs.mkdirSync(postsDir);
}

if (!fs.existsSync(jobsDir)) {
  fs.mkdirSync(jobsDir);
}

function cleanValue(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed;
}

function parseScalar(value) {
  const cleaned = cleanValue(value);

  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  if (cleaned !== '' && !Number.isNaN(Number(cleaned)) && /^-?\d+(\.\d+)?$/.test(cleaned)) {
    return Number(cleaned);
  }

  return cleaned;
}

// Parses the small YAML subset Decap CMS writes: `key: value`, values that wrap
// onto indented continuation lines, `>` / `|` block scalars, and `- item` lists.
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const data = {};
  const scalars = {};
  let currentKey = null;
  let mode = null; // 'scalar' | 'list' | 'block'
  let blockStyle = '>';
  let blockLines = [];

  const finishBlock = () => {
    if (mode !== 'block' || !currentKey) return;
    data[currentKey] = blockStyle === '|'
      ? blockLines.join('\n').trim()
      : blockLines.join('\n').trim().split(/\n{2,}/).map(p => p.replace(/\n/g, ' ')).join('\n');
  };

  match[1].split(/\r?\n/).forEach(rawLine => {
    const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):(?:\s+(.*))?$/);
    if (keyMatch) {
      finishBlock();
      const key = keyMatch[1];
      const rawValue = (keyMatch[2] || '').trim();
      currentKey = key;
      blockLines = [];

      if (rawValue === '') {
        data[key] = [];
        mode = 'list';
        return;
      }

      const blockMatch = rawValue.match(/^([>|])[+-]?$/);
      if (blockMatch) {
        blockStyle = blockMatch[1];
        mode = 'block';
        return;
      }

      scalars[key] = rawValue;
      mode = 'scalar';
      return;
    }

    if (!currentKey) return;

    if (mode === 'block') {
      blockLines.push(rawLine.trim());
      return;
    }

    if (!rawLine.trim()) return;

    const arrayItemMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (mode === 'list' && arrayItemMatch) {
      data[currentKey].push(parseScalar(arrayItemMatch[1]));
      return;
    }

    // A long value the CMS wrapped onto the next (indented) line.
    if (mode === 'scalar' && /^\s/.test(rawLine)) {
      scalars[currentKey] += ' ' + rawLine.trim();
      return;
    }

    currentKey = null;
    mode = null;
  });
  finishBlock();

  Object.keys(scalars).forEach(key => {
    data[key] = parseScalar(scalars[key]);
  });
  // `key:` with nothing under it means "empty", not "list"
  Object.keys(data).forEach(key => {
    if (Array.isArray(data[key]) && data[key].length === 0) data[key] = '';
  });

  return data;
}

function readCollection(dir, mapper, sorter) {
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.md'));
  return files
    .map(file => {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const frontmatter = parseFrontmatter(content);
      if (!frontmatter) return null;
      return mapper(frontmatter, file, content);
    })
    .filter(Boolean)
    .sort(sorter);
}

const postBodies = {};
const draftPosts = [];
const scheduledPosts = []; // { slug, date } — publish date still in the future
const buildTime = new Date();

const posts = readCollection(
  postsDir,
  (frontmatter, file, content) => {
    const slug = file.replace('.md', '');
    // "Draft" switch in the content manager: saved to the repo, but not listed,
    // given a page or put in the sitemap until it's switched off.
    if (frontmatter.draft === true) {
      draftPosts.push(slug);
      return null;
    }
    // Scheduled: hidden the same way until its publish date. The hourly
    // publish-scheduled-posts function rebuilds the site once that date passes.
    const publishAt = frontmatter.date ? new Date(frontmatter.date) : null;
    if (publishAt && !Number.isNaN(publishAt.getTime()) && publishAt > buildTime) {
      scheduledPosts.push({ slug, date: publishAt.toISOString() });
      return null;
    }
    postBodies[slug] = (content.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)[1] || '').trim();
    return {
      slug,
      title: frontmatter.title || 'Untitled',
      date: frontmatter.date || '',
      description: frontmatter.description || '',
      image: frontmatter.image || '',
      imageAlt: frontmatter.image_alt || ''
    };
  },
  (a, b) => new Date(b.date) - new Date(a.date)
);

fs.writeFileSync(
  path.join(postsDir, 'index.json'),
  JSON.stringify(posts, null, 2)
);

// Only the dates, so unpublished titles aren't listed anywhere.
fs.writeFileSync(
  path.join(postsDir, 'scheduled.json'),
  JSON.stringify({ dates: scheduledPosts.map(p => p.date).sort() }, null, 2) + '\n'
);

console.log(`Built posts/index.json — ${posts.length} post(s)` +
  (draftPosts.length ? `, skipped ${draftPosts.length} draft(s): ${draftPosts.join(', ')}` : '') +
  (scheduledPosts.length ? `, ${scheduledPosts.length} scheduled: ${scheduledPosts.map(p => `${p.slug} (${p.date})`).join(', ')}` : ''));

const jobs = readCollection(
  jobsDir,
  (frontmatter, file, content) => {
    const body = content.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)[1] || '';
    return {
      slug: file.replace('.md', ''),
      title: frontmatter.title || 'Untitled Role',
      date: frontmatter.date || '',
      status: frontmatter.status || 'Open',
      featured: Boolean(frontmatter.featured),
      location: frontmatter.location || 'Remote',
      schedule: frontmatter.schedule || 'Full / Part-time',
      icon: frontmatter.icon || 'briefcase',
      description: frontmatter.description || '',
      skills: Array.isArray(frontmatter.skills) ? frontmatter.skills : [],
      body: body.trim()
    };
  },
  (a, b) => {
    const statusWeight = (status) => cleanValue(String(status || '')).toLowerCase() === 'open' ? 0 : 1;
    if (statusWeight(a.status) !== statusWeight(b.status)) {
      return statusWeight(a.status) - statusWeight(b.status);
    }
    if (Boolean(a.featured) !== Boolean(b.featured)) {
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    }
    return new Date(b.date) - new Date(a.date);
  }
);

fs.writeFileSync(
  path.join(jobsDir, 'index.json'),
  JSON.stringify(jobs, null, 2)
);

console.log(`Built jobs/index.json — ${jobs.length} job post(s)`);

// Website content edited in /admin ("Website Content": content/*.json).
// Written into the pages between `CMS:<name> START` / `CMS:<name> END` marker
// lines (or inline <!-- CMS:<name> -->…<!-- /CMS:<name> -->), replacing whatever
// is there, so the committed HTML always matches the JSON. Runs before the blog
// pages are generated (blog-post.html has markers) and before Tailwind/Lucide
// scan the pages for classes and icons.
const contentDir = path.join(__dirname, 'content');
const readContent = name => JSON.parse(fs.readFileSync(path.join(contentDir, `${name}.json`), 'utf8'));
const escapeText = value => String(value == null ? '' : value).trim()
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlToText = html => html
  .replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const filledBlocks = new Set();

// Prices (content/prices.json, hourly rates). Whole dollars show without cents ($10),
// others with two decimals ($7.50); {price} in hero/FAQ text is the lowest rate.
const prices = readContent('prices');
const money = value => {
  const n = Number(value);
  return '$' + (Number.isInteger(n)
    ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
};
const startingPrice = money(Math.min(prices.intake, prices.assistants, prices.demand, prices.case));
const withPrice = text => String(text || '').replace(/\{price\}/g, startingPrice);

// Wraps the first occurrence of `phrase` in a highlight span (text is escaped first).
function highlight(text, phrase, className) {
  const html = escapeText(text);
  const mark = escapeText(phrase);
  const at = mark ? html.indexOf(mark) : -1;
  return at === -1 ? html : `${html.slice(0, at)}<span class="${className}">${mark}</span>${html.slice(at + mark.length)}`;
}
const stripQuotes = text => String(text || '').trim().replace(/^["“”]+|["“”]+$/g, '');

function fillBlock(source, name, lines) {
  const start = source.indexOf(`CMS:${name} START`);
  if (start === -1) return source;
  const end = source.indexOf(`CMS:${name} END`, start);
  if (end === -1) throw new Error(`CMS:${name} START marker has no matching END marker`);
  filledBlocks.add(name);
  const bodyStart = source.indexOf('\n', start) + 1;
  const bodyEnd = source.lastIndexOf('\n', end) + 1;
  const indent = source.slice(bodyEnd, end).match(/^[ \t]*/)[0];
  return source.slice(0, bodyStart) + lines.map(line => (line ? indent + line : '') + '\n').join('') + source.slice(bodyEnd);
}

function fillInline(source, name, html) {
  return source.replace(new RegExp(`(<!-- CMS:${name} -->)[\\s\\S]*?(<!-- /CMS:${name} -->)`, 'g'), (all, open, close) => {
    filledBlocks.add(name);
    return open + html + close;
  });
}

// Testimonials slider (home)
const testimonials = (readContent('testimonials').testimonials || []).filter(t => t.quote && t.name);
const testimonialSlides = testimonials.flatMap((t, i) => [
  `<!-- Slide ${i + 1} -->`,
  '<div class="testimonial-slide px-2">',
  '    <div class="bg-[#1b1e2b] rounded-[2rem] p-7 sm:p-10 lg:p-14 relative overflow-hidden h-full">',
  '        <div class="absolute top-0 right-0 w-64 h-64 bg-yellow-400/10 rounded-full blur-[80px] -z-0"></div>',
  '        <div class="relative z-10">',
  '            <div class="flex gap-1 mb-6">',
  ...Array(5).fill('                <i data-lucide="star" class="w-5 h-5 text-yellow-400 fill-yellow-400"></i>'),
  '            </div>',
  `            <p class="text-white text-lg sm:text-xl lg:text-2xl font-bold leading-relaxed italic mb-6 sm:mb-8 max-w-3xl" data-i18n="testimonial${i + 1}">`,
  // Quotation marks are added here, so strip any the editor typed.
  `                "${escapeText(stripQuotes(t.quote))}"`,
  '            </p>',
  '            <div class="flex items-center gap-4">',
  `                <div class="w-12 h-12 rounded-2xl bg-yellow-400 flex items-center justify-center font-black text-[#1b1e2b] text-lg">${escapeText(String(t.name).trim().charAt(0).toUpperCase())}</div>`,
  '                <div>',
  `                    <p class="text-white font-black">${escapeText(t.name)}</p>`,
  `                    <p class="text-yellow-400 text-sm font-bold uppercase tracking-widest">${escapeText(t.company)}</p>`,
  '                </div>',
  '            </div>',
  '        </div>',
  '    </div>',
  '</div>',
  ''
]);
const testimonialDots = testimonials.map((t, i) => (i === 0
  ? `<button class="testimonial-dot relative w-8 h-2 rounded-full bg-[#1b1e2b] transition-all after:absolute after:-inset-3" data-index="${i}" aria-label="Show testimonial ${i + 1}"></button>`
  : `<button class="testimonial-dot relative w-2 h-2 rounded-full bg-slate-300 transition-all after:absolute after:-inset-3" data-index="${i}" aria-label="Show testimonial ${i + 1}"></button>`));

// FAQ (home modal + FAQPage structured data, from the same text so they always match)
const faqs = (readContent('faq').questions || []).filter(f => f.question && f.answer);
const faqAnswerHtml = answer => marked.parseInline(withPrice(answer).trim())
  .replace(/&#39;/g, "'")
  .replace(/\n{2,}/g, '<br><br>')
  .replace(/<strong>/g, '<span class="font-black text-[#1b1e2b]">').replace(/<\/strong>/g, '</span>')
  .replace(/<a href=/g, '<a class="font-bold text-[#1b1e2b] underline decoration-yellow-400 underline-offset-2" href=');
const faqItems = faqs.flatMap((f, i) => [
  '<div class="faq-item border border-slate-200 rounded-2xl overflow-hidden">',
  '    <button class="faq-trigger w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors">',
  `        <span class="font-black text-[#1b1e2b] text-sm pr-4" data-i18n="faqQ${i + 1}">${escapeText(f.question)}</span>`,
  '        <i data-lucide="chevron-down" class="faq-chevron w-4 h-4 text-yellow-500 flex-shrink-0"></i>',
  '    </button>',
  '    <div class="faq-answer">',
  `        <p class="px-6 pb-5 text-slate-600 text-sm font-medium leading-relaxed" data-i18n="faqA${i + 1}">${faqAnswerHtml(f.answer)}</p>`,
  '    </div>',
  '</div>',
  ''
]);
const faqJsonLd = [
  '<script type="application/ld+json">',
  '{',
  '  "@context": "https://schema.org",',
  '  "@type": "FAQPage",',
  '  "mainEntity": [',
  ...faqs.map((f, i) => '    ' + JSON.stringify({
    '@type': 'Question',
    name: String(f.question).trim(),
    acceptedAnswer: { '@type': 'Answer', text: htmlToText(faqAnswerHtml(f.answer)) }
  }).replace(/</g, '\\u003c') + (i < faqs.length - 1 ? ',' : '')),
  '  ]',
  '}',
  '</script>'
];

// About numbers (home). Card colours follow the position in the grid; the text,
// number and icon come from the admin. Labels/hover text are also given to the
// EN/ES switch through the translations block below.
const STAT_STYLES = {
  navy: {
    card: 'group bg-[#1b1e2b] rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 flex flex-col justify-between cursor-default hover:-translate-y-2 hover:shadow-2xl hover:shadow-[#1b1e2b]/30 hover:z-10 transition-all duration-300',
    iconBox: 'w-10 h-10 bg-yellow-400/20 rounded-xl flex items-center justify-center mb-4 sm:mb-6',
    icon: 'w-5 h-5 text-yellow-400',
    value: 'text-4xl sm:text-5xl font-black text-white leading-none mb-2',
    label: 'text-slate-400 font-bold text-[11px] sm:text-sm uppercase tracking-wider sm:tracking-widest',
    hover: 'text-slate-500 hidden lg:block text-xs font-medium leading-relaxed mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300'
  },
  yellow: {
    card: 'group bg-yellow-400 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 flex flex-col justify-between cursor-default hover:-translate-y-2 hover:shadow-2xl hover:shadow-yellow-400/40 hover:z-10 transition-all duration-300',
    iconBox: 'w-10 h-10 bg-[#1b1e2b]/10 rounded-xl flex items-center justify-center mb-4 sm:mb-6',
    icon: 'w-5 h-5 text-[#1b1e2b]',
    value: 'text-4xl sm:text-5xl font-black text-[#1b1e2b] leading-none mb-2',
    label: 'text-[#1b1e2b]/70 font-bold text-[11px] sm:text-sm uppercase tracking-wider sm:tracking-widest',
    hover: 'text-[#1b1e2b]/60 hidden lg:block text-xs font-medium leading-relaxed mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300'
  },
  light: {
    card: 'group bg-slate-50 border border-slate-100 rounded-3xl sm:rounded-[2rem] p-5 sm:p-8 flex flex-col justify-between cursor-default hover:-translate-y-2 hover:border-yellow-400 hover:shadow-2xl hover:z-10 transition-all duration-300',
    iconBox: 'w-10 h-10 bg-yellow-400/20 rounded-xl flex items-center justify-center mb-4 sm:mb-6',
    icon: 'w-5 h-5 text-yellow-500',
    value: 'text-4xl sm:text-5xl font-black text-[#1b1e2b] leading-none mb-2',
    label: 'text-slate-500 font-bold text-[11px] sm:text-sm uppercase tracking-wider sm:tracking-widest',
    hover: 'text-slate-400 hidden lg:block text-xs font-medium leading-relaxed mt-3 opacity-0 group-hover:opacity-100 transition-opacity duration-300'
  }
};
const STAT_ORDER = ['navy', 'yellow', 'light', 'light', 'navy', 'yellow'];
const stats = readContent('stats').stats || [];
const statCards = stats.flatMap((stat, i) => {
  const style = STAT_STYLES[STAT_ORDER[i % STAT_ORDER.length]];
  return [
    `<div class="${style.card}">`,
    `    <div class="${style.iconBox}">`,
    `        <i data-lucide="${escapeHtml(String(stat.icon || 'star').trim())}" class="${style.icon}"></i>`,
    '    </div>',
    '    <div>',
    `        <p class="${style.value}">${escapeText(stat.value)}</p>`,
    `        <p class="${style.label}" data-i18n="stat${i + 1}Label">${escapeText(stat.label_en)}</p>`,
    `        <p class="${style.hover}" data-i18n="stat${i + 1}Hover">${escapeText(stat.hover_en)}</p>`,
    '    </div>',
    '</div>',
    ''
  ];
});

// Contact details: hours (every page), location (home footer), phone / WhatsApp
// (home + blog footers) and social links (home footer). Empty fields are left out.
const contact = readContent('contact');
const phone = String(contact.phone || '').trim();
const whatsapp = String(contact.whatsapp || '').replace(/\D/g, '');
const contactLink = (href, newTab) =>
  `<a href="${escapeHtml(href)}"${newTab ? ' target="_blank" rel="noopener"' : ''} class="flex items-start gap-3 text-slate-400 text-sm font-medium hover:text-yellow-400 transition-colors">`;
const contactLinks = [
  phone && { href: `tel:${phone.replace(/[^\d+]/g, '')}`, icon: 'phone', text: phone, newTab: false },
  whatsapp && { href: `https://wa.me/${whatsapp}`, icon: 'message-circle', text: 'WhatsApp', newTab: true }
].filter(Boolean);
const footerContactItems = [
  ...contactLinks.flatMap(link => [
    '<li>',
    '    ' + contactLink(link.href, link.newTab),
    `        <i data-lucide="${link.icon}" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>`,
    `        ${escapeText(link.text)}`,
    '    </a>',
    '</li>'
  ]),
  '<li>',
  '    <div class="flex items-start gap-3 text-slate-400 text-sm font-medium">',
  '        <i data-lucide="clock" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>',
  `        <span data-i18n="footerHours">${escapeText(contact.hours_en)}</span>`,
  '    </div>',
  '</li>',
  '<li>',
  '    <div class="flex items-start gap-3 text-slate-400 text-sm font-medium">',
  '        <i data-lucide="map-pin" class="w-4 h-4 mt-0.5 flex-shrink-0"></i>',
  `        <span data-i18n="footerLocation">${escapeText(contact.location_en)}</span>`,
  '    </div>',
  '</li>'
];
const compactContactItems = contactLinks.map(link =>
  `<li>${contactLink(link.href, link.newTab)}<i data-lucide="${link.icon}" class="w-4 h-4 mt-0.5 flex-shrink-0"></i> ${escapeText(link.text)}</a></li>`);
const socialLinks = [
  ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['facebook', 'Facebook']
].filter(([key]) => /^https?:\/\//.test(String(contact[key] || '').trim())).flatMap(([key, label]) => [
  `<a href="${escapeHtml(String(contact[key]).trim())}" target="_blank" rel="noopener" aria-label="${label}" class="w-9 h-9 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center text-slate-400 hover:bg-yellow-400 hover:text-[#1b1e2b] hover:border-yellow-400 transition-all">`,
  `    <i data-lucide="${key}" class="w-4 h-4"></i>`,
  '</a>'
]);

// EN/ES text for the language switch on the home page (merged into `translations`).
const i18n = { en: {}, es: {} };
stats.forEach((stat, i) => {
  i18n.en[`stat${i + 1}Label`] = escapeText(stat.label_en);
  i18n.es[`stat${i + 1}Label`] = escapeText(stat.label_es || stat.label_en);
  i18n.en[`stat${i + 1}Hover`] = escapeText(stat.hover_en);
  i18n.es[`stat${i + 1}Hover`] = escapeText(stat.hover_es || stat.hover_en);
});
i18n.en.footerHours = escapeText(contact.hours_en);
i18n.es.footerHours = escapeText(contact.hours_es || contact.hours_en);
i18n.en.footerLocation = escapeText(contact.location_en);
i18n.es.footerLocation = escapeText(contact.location_es || contact.location_en);
testimonials.forEach((t, i) => {
  i18n.en[`testimonial${i + 1}`] = `"${escapeText(stripQuotes(t.quote))}"`;
  i18n.es[`testimonial${i + 1}`] = `"${escapeText(stripQuotes(t.quote_es || t.quote))}"`;
});
faqs.forEach((f, i) => {
  i18n.en[`faqQ${i + 1}`] = escapeText(f.question);
  i18n.es[`faqQ${i + 1}`] = escapeText(f.question_es || f.question);
  i18n.en[`faqA${i + 1}`] = faqAnswerHtml(f.answer);
  i18n.es[`faqA${i + 1}`] = faqAnswerHtml(f.answer_es || f.answer);
});

// Top of the home page (content/hero.json), EN + ES.
const hero = readContent('hero');
const heroText = lang => {
  const priceClass = 'text-[#1b1e2b] font-black underline decoration-yellow-400 decoration-8 underline-offset-4';
  const pick = key => hero[`${key}_${lang}`] || hero[`${key}_en`] || '';
  const price = hero.show_price === false ? ''
    : lang === 'es' ? ` Desde <span class="${priceClass}">${startingPrice}/hora</span>.`
      : ` Starting at <span class="${priceClass}">${startingPrice}/hour</span>.`;
  return {
    heroBadge: escapeText(pick('badge')),
    heroH1: highlight(pick('headline'), pick('highlight'), 'text-yellow-500'),
    heroH2: escapeText(pick('text')) + price,
    heroCta: escapeText(pick('button')),
    heroVas: escapeText(pick('count')),
    heroVasSub: escapeText(pick('count_sub')),
    heroReview: `"${escapeText(stripQuotes(pick('review_quote')))}"`,
    heroReviewRole: escapeText(pick('review_role'))
  };
};
const heroEn = heroText('en');
Object.assign(i18n.en, heroEn);
Object.assign(i18n.es, heroText('es'));

// Contact email: each page records the address it currently shows in a
// <!-- CMS:email … --> comment; when the admin's address differs, every occurrence
// on that page (links included) is swapped, the comment too.
const contactEmail = String(contact.email || '').trim();
const validEmail = /^[^\s@<>"'&]+@[^\s@<>"'&]+\.[a-z]{2,}$/i.test(contactEmail);
if (contactEmail && !validEmail) console.warn(`WARNING: contact email "${contactEmail}" doesn't look valid; pages keep their current address`);

const i18nLines = ['en', 'es'].flatMap(lang =>
  `Object.assign(translations.${lang}, ${JSON.stringify(i18n[lang], null, 4).replace(/</g, '\\u003c')});`.split('\n'));

// Pictures (content/pictures-*.json): build-images.js resizes them into assets/img/site/
// (not committed) and lists the results; here they go into the <img> tags wrapped in
// <!-- CMS:img:<spot> --> markers, keeping each tag's own class/sizes/width/height,
// and into the phone service pop-up data (/* CMS:imgurl:<spot> */, /* CMS:imgpos:<spot> */).
let pictures;
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build-images.js')], { stdio: 'inherit' });
  pictures = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/img/site/manifest.json'), 'utf8'));
} catch (error) {
  // Never let picture resizing stop a deploy (e.g. sharp needs Node 20.9+):
  // fall back to the uploaded files as they are, without resized versions.
  console.warn(`WARNING: resizing pictures failed (${error.message.split('\n')[0]}); using the original uploads`);
  const FOCUS_CSS = { center: '50% 50%', top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%' };
  pictures = {};
  ['pictures-home', 'pictures-landing'].forEach(name => {
    if (!fs.existsSync(path.join(contentDir, `${name}.json`))) return;
    Object.entries(readContent(name)).forEach(([spot, entry]) => {
      if (entry && entry.image) pictures[spot] = { src: entry.image, alt: String(entry.alt || '').trim(), position: FOCUS_CSS[entry.focus] || FOCUS_CSS.center };
    });
  });
}

function fillPictures(source) {
  source = source.replace(/<!-- CMS:img:([a-z0-9_]+) -->(<img\b[^>]*>)<!-- \/CMS:img:\1 -->/g, (all, spot, tag) => {
    filledBlocks.add('img');
    const picture = pictures[spot];
    if (!picture) return all;
    const attrs = []; // { name, value, raw }: raw values are copied as they are in the page
    tag.replace(/^<img\b|\/?>$/g, '').replace(/([^\s=]+)(?:="([^"]*)")?/g, (match, name, value) => {
      attrs.push({ name, value: value === undefined ? null : value, raw: true });
      return '';
    });
    const set = (name, value) => {
      const attr = attrs.find(a => a.name === name);
      if (attr) Object.assign(attr, { value, raw: false }); else attrs.push({ name, value, raw: false });
    };
    set('src', picture.src);
    set('alt', picture.alt);
    // srcset/style always go last, so the tag reads the same whatever was there before.
    attrs.splice(0, attrs.length, ...attrs.filter(a => a.name !== 'srcset' && a.name !== 'style'));
    if (picture.srcset) set('srcset', picture.srcset);
    set('style', `object-position: ${picture.position}`);
    const html = attrs.map(a => (a.value === null ? a.name : `${a.name}="${a.raw ? a.value : escapeHtml(a.value)}"`)).join(' ');
    return `<!-- CMS:img:${spot} --><img ${html}><!-- /CMS:img:${spot} -->`;
  });
  return source.replace(/\/\* CMS:(imgurl|imgpos):([a-z0-9_]+) \*\/[\s\S]*?\/\* \/CMS:\1:\2 \*\//g, (all, kind, spot) => {
    filledBlocks.add(kind);
    const picture = pictures[spot];
    if (!picture) return all;
    const value = kind === 'imgurl' ? picture.src : picture.position;
    return `/* CMS:${kind}:${spot} */${JSON.stringify(value)}/* /CMS:${kind}:${spot} */`;
  });
}

fs.readdirSync(__dirname).filter(file => file.endsWith('.html')).forEach(file => {
  const filePath = path.join(__dirname, file);
  const before = fs.readFileSync(filePath, 'utf8');
  if (!before.includes('CMS:')) return;
  let html = before;
  html = fillBlock(html, 'testimonials', testimonialSlides);
  html = fillBlock(html, 'testimonial-dots', testimonialDots);
  html = fillBlock(html, 'faq', faqItems);
  html = fillBlock(html, 'faq-jsonld', faqJsonLd);
  html = fillBlock(html, 'stats', statCards);
  html = fillBlock(html, 'contact', footerContactItems);
  html = fillBlock(html, 'contact-compact', compactContactItems);
  html = fillBlock(html, 'social', socialLinks);
  html = fillBlock(html, 'i18n', i18nLines);
  html = fillInline(html, 'hours', escapeText(contact.hours_en));
  html = fillInline(html, 'hero-badge', heroEn.heroBadge);
  html = fillInline(html, 'hero-h1', heroEn.heroH1);
  html = fillInline(html, 'hero-h2', heroEn.heroH2);
  html = fillInline(html, 'hero-cta', heroEn.heroCta);
  html = fillInline(html, 'hero-count', heroEn.heroVas);
  html = fillInline(html, 'hero-count-sub', heroEn.heroVasSub);
  html = fillInline(html, 'hero-review', heroEn.heroReview);
  html = fillInline(html, 'hero-review-name', escapeText(hero.review_name));
  html = fillInline(html, 'hero-review-role', heroEn.heroReviewRole);
  const shownEmail = (html.match(/<!-- CMS:email (\S+) /) || [])[1];
  if (shownEmail) {
    filledBlocks.add('email');
    if (validEmail && shownEmail !== contactEmail) html = html.split(shownEmail).join(contactEmail);
  }
  html = fillPictures(html);
  if (html !== before) fs.writeFileSync(filePath, html);
});
['testimonials', 'testimonial-dots', 'faq', 'faq-jsonld', 'stats', 'contact', 'contact-compact', 'social', 'i18n', 'hours', 'img', 'imgurl', 'imgpos', 'email',
  'hero-badge', 'hero-h1', 'hero-h2', 'hero-cta', 'hero-count', 'hero-count-sub', 'hero-review', 'hero-review-name', 'hero-review-role'].forEach(name => {
  if (!filledBlocks.has(name)) throw new Error(`No page has the CMS:${name} markers — they were removed or renamed`);
});
console.log(`Built website content — ${testimonials.length} testimonial(s), ${faqs.length} FAQ(s), ${stats.length} stat(s)`);

// Generate static blog post pages (/blog/<slug>/index.html)
// Uses blog-post.html as the template so the design stays in one place.
// Each page ships with its own <title>, description, canonical, Open Graph
// tags, BlogPosting JSON-LD and the fully rendered article so Google can
// index it without running JavaScript.
const BASE_URL = 'https://yvastaffing.agency';
const blogOutDir = path.join(__dirname, 'blog');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function replaceBetween(source, startMarker, endMarker, replacement) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`Template markers ${startMarker} / ${endMarker} not found in blog-post.html`);
  }
  return source.slice(0, start) + replacement + source.slice(end + endMarker.length);
}

const template = fs.readFileSync(path.join(__dirname, 'blog-post.html'), 'utf8');
fs.rmSync(blogOutDir, { recursive: true, force: true });
fs.mkdirSync(blogOutDir, { recursive: true });

posts.forEach(post => {
  const url = `${BASE_URL}/blog/${post.slug}/`;
  const title = `${post.title} | YVA Law Staffing`;
  const isoDate = post.date ? new Date(post.date).toISOString() : '';

  // Posts without a featured image still get a share image (the site-wide card)
  const shareImage = post.image || `${BASE_URL}/assets/img/og-image.jpg`;
  const organization = {
    '@type': 'Organization',
    '@id': `${BASE_URL}/#organization`,
    name: 'YVA Law Staffing',
    url: `${BASE_URL}/`,
    logo: { '@type': 'ImageObject', url: `${BASE_URL}/logo/img2.png`, width: 1080, height: 1080 }
  };

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.description,
      datePublished: isoDate || undefined,
      dateModified: isoDate || undefined,
      image: shareImage,
      mainEntityOfPage: url,
      author: organization,
      publisher: organization
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE_URL}/` },
        { '@type': 'ListItem', position: 2, name: 'Blog', item: `${BASE_URL}/blog.html` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url }
      ]
    }
  ];

  const meta = `  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(post.description)}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(post.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="YVA Law Staffing">
  <meta property="og:image" content="${escapeHtml(shareImage)}">
${isoDate ? `  <meta property="article:published_time" content="${isoDate}">\n` : ''}  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.description)}">
  <meta name="twitter:image" content="${escapeHtml(shareImage)}">
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

  const body = `    <div id="post-content">
${post.image ? `      <div id="post-image-wrap" class="mb-10 rounded-3xl overflow-hidden shadow-xl">
        <img id="post-image" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.imageAlt || post.title)}" class="w-full max-h-96 object-cover">
      </div>
` : ''}${post.date ? `      <p id="post-date" class="text-xs font-black text-slate-400 uppercase tracking-widest mb-4"><time datetime="${isoDate}">${formatDate(post.date)}</time></p>
` : ''}      <h1 id="post-title" class="text-4xl lg:text-5xl font-black text-[#1b1e2b] leading-tight tracking-tight mb-6">${escapeHtml(post.title)}</h1>
${post.description ? `      <p id="post-description" class="text-xl text-slate-500 font-medium leading-relaxed mb-10 pb-10 border-b border-slate-100">${escapeHtml(post.description)}</p>
` : ''}      <div id="post-body" class="prose">
${marked.parse(postBodies[post.slug] || '')}
      </div>
    </div>`;

  let html = template;
  html = replaceBetween(html, '<!-- POST_META_START -->', '<!-- POST_META_END -->', meta);
  html = replaceBetween(html, '<!-- POST_BODY_START -->', '<!-- POST_BODY_END -->', body);
  html = replaceBetween(html, '// POST_SCRIPT_START', '// POST_SCRIPT_END', '');
  // Static pages live one level deeper than the template; make relative links absolute.
  html = html
    .replace(/href="index\.html/g, 'href="/index.html')
    .replace(/href="blog\.html"/g, 'href="/blog.html"')
    .replace(/href="careers\.html"/g, 'href="/careers.html"')
    .replace(/src="logo\//g, 'src="/logo/');
  // marked and DOMPurify are only needed by the client-side loader.
  html = html
    .replace(/\s*<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/marked\/marked\.min\.js"><\/script>/, '')
    .replace(/\s*<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/dompurify\/[^"]+"><\/script>/, '');

  const dir = path.join(blogOutDir, post.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
});

console.log(`Built blog/ — ${posts.length} static post page(s)`);

// Generate sitemap.xml
// All landing-*.html pages are paid-ad landing pages, intentionally noindex,
// and therefore left out.
// Static pages carry no <lastmod>: stamping them with the build date on every
// deploy is misleading and Google ignores unreliable lastmod values.
const staticPages = [
  { url: '/',                          changefreq: 'weekly',  priority: '1.0' },
  { url: '/blog.html',                 changefreq: 'weekly',  priority: '0.9' },
  { url: '/careers.html',              changefreq: 'monthly', priority: '0.8' },
  { url: '/checklist.html',            changefreq: 'monthly', priority: '0.7' },
  { url: '/privacy-policy',            changefreq: 'yearly',  priority: '0.5' },
  { url: '/sms-terms',                 changefreq: 'yearly',  priority: '0.5' },
];

const postPages = posts.map(post => ({
  url: `/blog/${post.slug}/`,
  changefreq: 'monthly',
  priority: '0.7',
  lastmod: post.date ? new Date(post.date).toISOString().split('T')[0] : undefined
}));

const allPages = [...staticPages, ...postPages];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${BASE_URL}${p.url}</loc>
${p.lastmod ? `    <lastmod>${p.lastmod}</lastmod>\n` : ''}    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
console.log(`Built sitemap.xml — ${allPages.length} URL(s)`);

// Compile Tailwind CSS (assets/css/tailwind.src.css -> assets/css/tailwind.css).
// Pages link the compiled file instead of loading Tailwind's in-browser compiler,
// which is slow on phones and not meant for production.
execFileSync(process.execPath, [
  require.resolve('tailwindcss/lib/cli.js'),
  '--config', path.join(__dirname, 'tailwind.config.js'),
  '--input', path.join(__dirname, 'assets/css/tailwind.src.css'),
  '--output', path.join(__dirname, 'assets/css/tailwind.css'),
  '--minify',
], { cwd: __dirname, stdio: 'inherit', env: { ...process.env, BROWSERSLIST_IGNORE_OLD_DATA: '1' } });
console.log('Built assets/css/tailwind.css');

// Generate assets/js/lucide.js — only the Lucide icons this site uses.
// Replaces the full 358 KB library from unpkg. Same API: lucide.createIcons()
// swaps every <i data-lucide="name"> for its <svg>, exactly like the library.
// Icons are found as data-lucide="…" or any quoted icon name in the pages
// (e.g. icons chosen in JS) plus the `icon` field of each job post.
const lucide = require('lucide');
const toPascalCase = name => name.replace(/(\w)(\w*)(_|-|\s*)/g, (g0, g1, g2) => g1.toUpperCase() + g2.toLowerCase());
const usedIcons = new Set(['briefcase']);
fs.readdirSync(__dirname).filter(file => file.endsWith('.html')).forEach(file => {
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  for (const match of source.matchAll(/["']([a-z][a-z0-9-]*)["']/g)) usedIcons.add(match[1]);
});
jobs.forEach(job => usedIcons.add(String(job.icon || '')));

const iconChildren = {};
[...usedIcons].sort().forEach(name => {
  const node = lucide.icons[toPascalCase(name)];
  if (node) iconChildren[toPascalCase(name)] = node[2];
});
const defaultIconAttributes = lucide.icons.ArrowRight[1];
const iconScript = `/*! Lucide v${require('lucide/package.json').version} icon subset (ISC license, https://lucide.dev) — generated by build.js, do not edit. */
(function () {
  var defaultAttributes = ${JSON.stringify(defaultIconAttributes)};
  var icons = ${JSON.stringify(iconChildren)};
  function toPascalCase(s) {
    return s.replace(/(\\w)(\\w*)(_|-|\\s*)/g, function (g0, g1, g2) { return g1.toUpperCase() + g2.toLowerCase(); });
  }
  function createElement(tag, attrs, children) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs).forEach(function (name) { el.setAttribute(name, String(attrs[name])); });
    (children || []).forEach(function (child) { el.appendChild(createElement(child[0], child[1], child[2])); });
    return el;
  }
  function replaceElement(element) {
    var name = element.getAttribute('data-lucide');
    if (name == null) return;
    var children = icons[toPascalCase(name)];
    if (!children) {
      console.warn(element.outerHTML + ' icon name was not found in the provided icons object.');
      return;
    }
    var attrs = {};
    Object.keys(defaultAttributes).forEach(function (key) { attrs[key] = defaultAttributes[key]; });
    attrs['data-lucide'] = name;
    Array.prototype.forEach.call(element.attributes, function (attr) { attrs[attr.name] = attr.value; });
    attrs['class'] = ['lucide', 'lucide-' + name].concat((element.getAttribute('class') || '').split(' '))
      .map(function (c) { return c.trim(); })
      .filter(function (c, i, all) { return c && all.indexOf(c) === i; })
      .join(' ');
    if (element.parentNode) element.parentNode.replaceChild(createElement('svg', attrs, children), element);
  }
  function createIcons() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-lucide]'), replaceElement);
  }
  window.lucide = { createIcons: createIcons, icons: icons };
})();
`;
fs.mkdirSync(path.join(__dirname, 'assets/js'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'assets/js/lucide.js'), iconScript);
console.log(`Built assets/js/lucide.js — ${Object.keys(iconChildren).length} icon(s)`);
