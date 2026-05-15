const fs = require('fs');
const path = require('path');

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

const posts = readCollection(
  postsDir,
  (frontmatter, file) => ({
    slug: file.replace('.md', ''),
    title: frontmatter.title || 'Untitled',
    date: frontmatter.date || '',
    description: frontmatter.description || '',
    image: frontmatter.image || ''
  }),
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

// Generate sitemap.xml
const BASE_URL = 'https://yvastaffing.agency';
const today = new Date().toISOString().split('T')[0];

const staticPages = [
  { url: '/',             changefreq: 'weekly',  priority: '1.0', lastmod: today },
  { url: '/blog.html',    changefreq: 'weekly',  priority: '0.9', lastmod: today },
  { url: '/careers.html', changefreq: 'monthly', priority: '0.8', lastmod: today },
];

const postPages = posts.map(post => ({
  url: `/blog-post.html?slug=${post.slug}`,
  changefreq: 'monthly',
  priority: '0.7',
  lastmod: post.date ? post.date.split('T')[0] : today
}));

const allPages = [...staticPages, ...postPages];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allPages.map(p => `  <url>
    <loc>${BASE_URL}${p.url}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

fs.writeFileSync(path.join(__dirname, 'sitemap.xml'), sitemap);
console.log(`Built sitemap.xml — ${allPages.length} URL(s)`);
