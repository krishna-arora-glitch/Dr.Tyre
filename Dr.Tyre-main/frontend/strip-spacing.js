const fs = require('fs');
const path = require('path');

const files = [
  'src/style.css',
  'src/race-control.css',
  'src/ghostpace/index.css'
];

files.forEach(f => {
  const fullPath = path.join(__dirname, f);
  if (fs.existsSync(fullPath)) {
    let content = fs.readFileSync(fullPath, 'utf8');
    content = content.replace(/letter-spacing:\s*[^;]+;/g, '');
    fs.writeFileSync(fullPath, content);
    console.log(`Removed letter-spacing from ${f}`);
  }
});
