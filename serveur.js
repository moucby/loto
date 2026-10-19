// Petit serveur local pour utiliser l'appli sur ce PC (aucune dépendance, Node.js suffit).
// Nécessaire pour l'import de photos : ouvert en double-cliquant sur index.html,
// le navigateur bloque le module de lecture des numéros.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = 8080;
const RACINE = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
  '.png': 'image/png', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8',
};

http.createServer((req, res) => {
  let chemin = decodeURIComponent(req.url.split('?')[0]);
  if (chemin.endsWith('/')) chemin += 'index.html';
  const fichier = path.join(RACINE, path.normalize(chemin));
  if (!fichier.startsWith(RACINE)) { res.writeHead(403); return res.end(); }
  fs.readFile(fichier, (err, contenu) => {
    if (err) { res.writeHead(404); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream' });
    res.end(contenu);
  });
}).listen(PORT, '0.0.0.0', () => {
  const adresse = `http://localhost:${PORT}/`;
  console.log(`Loto est lancé sur ce PC : ${adresse}`);
  // Adresses à taper sur les téléphones connectés au même Wi-Fi (partie à plusieurs)
  const reseau = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal).map(i => `http://${i.address}:${PORT}/`);
  if (reseau.length) {
    console.log('Sur un téléphone connecté au même Wi-Fi, ouvre :');
    for (const a of reseau) console.log(`  ${a}`);
  }
  console.log('Garde cette fenêtre ouverte pendant que tu utilises l\'appli.');
  exec(process.platform === 'win32' ? `start "" "${adresse}"` : `open "${adresse}"`);
});
