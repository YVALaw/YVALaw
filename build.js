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
