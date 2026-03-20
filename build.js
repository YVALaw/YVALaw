const fs = require('fs');
const path = require('path');

const postsDir = path.join(__dirname, 'posts');

if (!fs.existsSync(postsDir)) {
  fs.mkdirSync(postsDir);
}

const files = fs.readdirSync(postsDir).filter(f => f.endsWith('.md'));

const posts = files.map(file => {
  const content = fs.readFileSync(path.join(postsDir, file), 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = {};
  match[1].split('\n').forEach(line => {
    const colonIndex = line.indexOf(': ');
    if (colonIndex === -1) return;
    const key = line.slice(0, colonIndex).trim();
    const val = line.slice(colonIndex + 2).trim().replace(/^["']|["']$/g, '');
    frontmatter[key] = val;
  });

  return {
    slug: file.replace('.md', ''),
    title: frontmatter.title || 'Untitled',
    date: frontmatter.date || '',
    description: frontmatter.description || '',
    image: frontmatter.image || ''
  };
}).filter(Boolean).sort((a, b) => new Date(b.date) - new Date(a.date));

fs.writeFileSync(
  path.join(postsDir, 'index.json'),
  JSON.stringify(posts, null, 2)
);

console.log(`Built posts/index.json — ${posts.length} post(s)`);

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
