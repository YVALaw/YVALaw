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
  return value.trim().replace(/^["']|["']$/g, '');
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

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const data = {};
  let currentKey = null;

  match[1].split(/\r?\n/).forEach(rawLine => {
    if (!rawLine.trim()) return;

    const arrayItemMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (arrayItemMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) {
        data[currentKey] = [];
      }
      data[currentKey].push(parseScalar(arrayItemMatch[1]));
      return;
    }

    const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      currentKey = null;
      return;
    }

    const [, key, rawValue] = keyMatch;
    if (rawValue === '') {
      data[key] = [];
      currentKey = key;
      return;
    }

    data[key] = parseScalar(rawValue);
    currentKey = key;
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: isoDate,
    dateModified: isoDate,
    image: post.image || undefined,
    mainEntityOfPage: url,
    author: { '@type': 'Organization', name: 'YVA Law Staffing', url: BASE_URL },
    publisher: { '@type': 'Organization', name: 'YVA Law Staffing', url: BASE_URL }
  };

  const meta = `  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(post.description)}">
  <link rel="canonical" href="${url}">
  <meta name="robots" content="index, follow">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(post.title)}">
  <meta property="og:description" content="${escapeHtml(post.description)}">
  <meta property="og:url" content="${url}">
  <meta property="og:site_name" content="YVA Law Staffing">
${post.image ? `  <meta property="og:image" content="${escapeHtml(post.image)}">\n` : ''}${isoDate ? `  <meta property="article:published_time" content="${isoDate}">\n` : ''}  <meta name="twitter:card" content="${post.image ? 'summary_large_image' : 'summary'}">
  <meta name="twitter:title" content="${escapeHtml(post.title)}">
  <meta name="twitter:description" content="${escapeHtml(post.description)}">
${post.image ? `  <meta name="twitter:image" content="${escapeHtml(post.image)}">\n` : ''}  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

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
