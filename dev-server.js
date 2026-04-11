const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT = 4000
const ROOT = __dirname

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.md': 'text/markdown',
}

http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0]

  // SPA rewrite: any /os/* path → /os/index.html
  if (urlPath.startsWith('/os/') && !urlPath.match(/\.\w+$/)) {
    urlPath = '/os/index.html'
  }

  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath)
  const ext = path.extname(filePath)

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Try adding .html
      fs.readFile(filePath + '.html', (err2, data2) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('404 Not Found: ' + urlPath)
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(data2)
        }
      })
    } else {
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(data)
    }
  })
}).listen(PORT, () => {
  console.log(`✓ LegalWebs running at http://localhost:${PORT}`)
  console.log(`  Marketing site: http://localhost:${PORT}/`)
  console.log(`  YVA LawOS:      http://localhost:${PORT}/os/login`)
})
