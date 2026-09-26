const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

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

const posts = readCollection(
  postsDir,
  (frontmatter, file, content) => {
    const slug = file.replace('.md', '');
    postBodies[slug] = (content.split(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)[1] || '').trim();
    return {
      slug,
      title: frontmatter.title || 'Untitled',
      date: frontmatter.date || '',
      description: frontmatter.description || '',
      image: frontmatter.image || ''
    };
  },
  (a, b) => new Date(b.date) - new Date(a.date)
);

fs.writeFileSync(
  path.join(postsDir, 'index.json'),
  JSON.stringify(posts, null, 2)
);

console.log(`Built posts/index.json — ${posts.length} post(s)`);

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
        <img id="post-image" src="${escapeHtml(post.image)}" alt="${escapeHtml(post.title)}" class="w-full max-h-96 object-cover">
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
const { execFileSync } = require('child_process');
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
