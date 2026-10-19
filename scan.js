'use strict';

// ==========================================================
// F1 — Scanner un carton
// photo → cadrage des 4 coins de la grille → redressement → lecture case par case
// ==========================================================

const LARGEUR_GRILLE = 900;  // grille redressée : 9 × 3 cases de 100 px
const HAUTEUR_GRILLE = 300;
const MARGE_GRILLE = 30;     // marge autour de la grille redressée, si le cadrage est un peu juste
const DOSSIER_OCR = new URL('vendor/tesseract/', location.href).href;

// { image: canvas, url, coins: [{x, y}] (haut-gauche, haut-droit, bas-droit, bas-gauche), detecte, lecture }
let scan = null;
let coinActif = null;

// Photos importées en attente : elles passent une par une (cadrage → lecture → enregistrement)
let attentePhotos = [];
let importRang = 0;
let importTotal = 0;

function choisirPhoto() {
  const champ = $('#fichier-photo');
  champ.value = '';
  champ.click();
}

$('#fichier-photo').addEventListener('change', e => {
  const fichiers = [...e.target.files];
  if (!fichiers.length) return;
  importTotal = fichiers.length;
  importRang = 1;
  attentePhotos = fichiers.slice(1);
  chargerPhoto(fichiers[0]);
});

// Après l'enregistrement d'un carton importé : on enchaîne sur la photo suivante
function photoSuivante() {
  if (!attentePhotos.length) return false;
  importRang++;
  ouvrirEdition(null);
  chargerPhoto(attentePhotos.shift());
  return true;
}

function arreterImport() {
  attentePhotos = [];
  importTotal = 0;
}

async function chargerPhoto(fichier) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // On réduit les grandes photos : plus rapide, et largement assez précis
    const echelle = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const image = document.createElement('canvas');
    image.width = Math.round(img.naturalWidth * echelle);
    image.height = Math.round(img.naturalHeight * echelle);
    image.getContext('2d').drawImage(img, 0, 0, image.width, image.height);

    // On cherche la grille sur la photo ; à défaut, un rectangle centré au format d'un carton
    const detectes = detecterGrille(image);
    const w = image.width, h = image.height;
    const lc = w * 0.8, hc = Math.min(h * 0.8, lc * 0.4);
    const x0 = (w - lc) / 2, y0 = (h - hc) / 2;
    scan = {
      image,
      url: image.toDataURL('image/jpeg', 0.85),
      coins: detectes ?? [{ x: x0, y: y0 }, { x: x0 + lc, y: y0 }, { x: x0 + lc, y: y0 + hc }, { x: x0, y: y0 + hc }],
      detecte: !!detectes,
      lecture: false,
    };
    aller('scan');
  } catch {
    alert(`Impossible d'ouvrir l'image « ${fichier.name} ».`);
    if (!photoSuivante()) aller('edition');
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- Écran de cadrage ----------
function rendreScan() {
  if (!scan) return aller('edition');
  const { image } = scan;
  $('#ecran-scan').innerHTML = `
    <div class="panneau">
      <h2>Cadre la grille</h2>
      ${importTotal > 1 ? `<p class="badge-import">Photo ${importRang} sur ${importTotal}</p>` : ''}
      ${location.protocol === 'file:' ? `
        <p class="alerte-fichier">L'appli est ouverte comme un simple fichier : la lecture des photos ne peut pas
          fonctionner. Ferme cette page et lance l'appli avec <b>Lancer Loto.bat</b>.</p>` : ''}
      <p class="aide">${scan.detecte
        ? 'La grille a été repérée automatiquement. Vérifie que le quadrillage tombe bien sur les <b>3 rangées de cases</b> ; sinon, ajuste les 4 ronds.'
        : 'Fais glisser les 4 ronds sur les <b>4 coins de la grille des numéros</b> (les 3 rangées). Le quadrillage doit tomber sur les cases.'}</p>
      <div class="zone-photo" id="zone-photo">
        <img src="${scan.url}" alt="Photo du carton" draggable="false">
        <svg id="cadre" viewBox="0 0 ${image.width} ${image.height}" preserveAspectRatio="none"></svg>
        ${[0, 1, 2, 3].map(i => `<div class="poignee" data-coin="${i}"></div>`).join('')}
        <div class="loupe" id="loupe" hidden></div>
      </div>
      <p class="aide scan-etat" id="scan-etat" aria-live="polite"></p>
      <button class="btn principal large" data-action="lire-scan" id="btn-lire">Lire les numéros</button>
      <div class="ligne-btn">
        <button class="btn" data-action="annuler-scan">${attentePhotos.length ? 'Passer cette photo' : 'Annuler'}</button>
        <button class="btn" data-action="choisir-photo">Choisir une autre photo</button>
      </div>
    </div>`;
  majCadre();
}

function majCadre() {
  const { coins, image } = scan;
  const M = homographie([[0, 0], [9, 0], [9, 3], [0, 3]], coins.map(c => [c.x, c.y]));
  const traits = [];
  for (let c = 0; c <= 9; c++) traits.push([appliquer(M, c, 0), appliquer(M, c, 3), c === 0 || c === 9]);
  for (let r = 0; r <= 3; r++) traits.push([appliquer(M, 0, r), appliquer(M, 9, r), r === 0 || r === 3]);
  $('#cadre').innerHTML = traits.map(([a, b, bord]) =>
    `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${bord ? 'bord' : ''}" vector-effect="non-scaling-stroke"/>`).join('');
  document.querySelectorAll('.poignee').forEach(p => {
    const c = coins[p.dataset.coin];
    p.style.left = `${c.x / image.width * 100}%`;
    p.style.top = `${c.y / image.height * 100}%`;
  });
}

// Déplacement des coins au doigt, avec une loupe pour viser juste
document.addEventListener('pointerdown', e => {
  const p = e.target.closest('.poignee');
  if (!p || !scan) return;
  coinActif = Number(p.dataset.coin);
  p.setPointerCapture(e.pointerId);
  e.preventDefault();
  deplacerCoin(e);
});

document.addEventListener('pointermove', e => {
  if (coinActif !== null) deplacerCoin(e);
});

for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, () => {
    if (coinActif === null) return;
    coinActif = null;
    $('#loupe')?.setAttribute('hidden', '');
  });
}

function deplacerCoin(e) {
  const zone = $('#zone-photo');
  if (!zone) return;
  const r = zone.getBoundingClientRect();
  const dx = Math.min(Math.max(e.clientX - r.left, 0), r.width);
  const dy = Math.min(Math.max(e.clientY - r.top, 0), r.height);
  scan.coins[coinActif] = { x: dx / r.width * scan.image.width, y: dy / r.height * scan.image.height };
  majCadre();

  const loupe = $('#loupe');
  const zoom = 3, taille = 110;
  loupe.hidden = false;
  loupe.style.backgroundImage = `url(${scan.url})`;
  loupe.style.backgroundSize = `${r.width * zoom}px ${r.height * zoom}px`;
  loupe.style.backgroundPosition = `${taille / 2 - dx * zoom}px ${taille / 2 - dy * zoom}px`;
  loupe.style.left = `${Math.min(Math.max(dx - taille / 2, 0), r.width - taille)}px`;
  loupe.style.top = `${dy - taille - 40 < 0 ? dy + 40 : dy - taille - 40}px`;
}

// ---------- Lecture ----------
async function lireScan() {
  if (!scan || scan.lecture) return;
  scan.lecture = true;
  const bouton = $('#btn-lire');
  bouton.disabled = true;
  const etat = texte => { const el = $('#scan-etat'); if (el) el.textContent = texte; };
  let lecteurOcr = null;
  try {
    etat('Redressement de la photo…');
    const grille = redresser(scan.image, scan.coins);
    const cases = decouper(grille);
    const aLire = cases.filter(c => c.vignette);

    etat('Préparation de la lecture… (la première fois, ça peut prendre quelques secondes)');
    lecteurOcr = await creerLecteur();
    for (const [i, c] of aLire.entries()) {
      etat(`Lecture des numéros… ${i + 1}/${aLire.length}`);
      const { data } = await lecteurOcr.recognize(c.vignette);
      c.texte = data.text.replace(/\D/g, '');
      c.confiance = data.confidence;
      if (!c.texte) await relire(lecteurOcr, c);
    }
    remplirEdition(assembler(cases), grille);
  } catch (err) {
    console.error(err);
    etat(location.protocol === 'file:'
      ? 'La lecture ne peut pas fonctionner quand l\'appli est ouverte comme un fichier. Lance-la avec « Lancer Loto.bat ».'
      : 'La lecture a échoué. Réessaie avec une photo plus nette, ou saisis les numéros à la main.');
    bouton.disabled = false;
  } finally {
    lecteurOcr?.terminate();
    if (scan) scan.lecture = false;
  }
}

// Un chiffre seul échappe parfois à Tesseract. Rattrapages :
// 1) le recopier deux fois côte à côte (« 8 8 ») et vérifier que les deux lectures concordent ;
// 2) le lire en mode « caractère unique ». Une lecture de rattrapage est toujours à vérifier.
async function relire(lecteurOcr, c) {
  const v = c.vignette;
  const double = document.createElement('canvas');
  double.width = v.width * 2;
  double.height = v.height;
  const ctx = double.getContext('2d');
  ctx.drawImage(v, 0, 0);
  ctx.drawImage(v, v.width, 0);
  const t = (await lecteurOcr.recognize(double)).data.text.replace(/\D/g, '');
  const moitie = t.slice(0, t.length / 2);
  if (t.length % 2 === 0 && t && moitie === t.slice(t.length / 2)) {
    c.texte = moitie;
    c.confiance = 70;
    return;
  }
  await lecteurOcr.setParameters({ tessedit_pageseg_mode: '10' });
  const seul = (await lecteurOcr.recognize(v)).data;
  await lecteurOcr.setParameters({ tessedit_pageseg_mode: '7' });
  c.texte = seul.text.replace(/\D/g, '');
  c.confiance = Math.min(seul.confidence, 70);
}

function chargerScript(src) {
  return new Promise((ok, echec) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = echec;
    document.head.append(s);
  });
}

// Tesseract.js est servi par l'appli elle-même (dossier vendor/) : pas de serveur externe
async function creerLecteur() {
  if (!window.Tesseract) await chargerScript(DOSSIER_OCR + 'tesseract.min.js');
  const lecteurOcr = await Tesseract.createWorker('eng', 1, {
    workerPath: DOSSIER_OCR + 'worker.min.js',
    corePath: DOSSIER_OCR,
    langPath: DOSSIER_OCR,
    workerBlobURL: false,
    gzip: true,
  });
  await lecteurOcr.setParameters({
    tessedit_char_whitelist: '0123456789',
    tessedit_pageseg_mode: '7', // une seule ligne de texte
  });
  return lecteurOcr;
}

// Le résultat ouvre l'écran de saisie, prérempli : le joueur vérifie avant d'enregistrer
function remplirEdition(resultat, grille) {
  edition.lignes = resultat.lignes.map(l => l.join(' '));
  edition.douteux = resultat.douteux;
  edition.photo = grille.toDataURL('image/jpeg', 0.8);
  const nb = resultat.lignes.flat().length;
  edition.bilan = `${nb} numéro${nb > 1 ? 's' : ''} lu${nb > 1 ? 's' : ''} sur 15`
    + (resultat.douteux.length ? `, dont ${resultat.douteux.length} à vérifier (en orange)` : '')
    + '. Compare avec la photo avant d\'enregistrer.';
  scan = null;
  aller('edition');
}

// ---------- Traitement d'image ----------

// Homographie qui envoie les 4 points `de` sur les 4 points `vers`
function homographie(de, vers) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = de[i], [X, Y] = vers[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  return [...resoudre(A, b), 1];
}

function appliquer(M, x, y) {
  const w = M[6] * x + M[7] * y + M[8];
  return [(M[0] * x + M[1] * y + M[2]) / w, (M[3] * x + M[4] * y + M[5]) / w];
}

// Pivot de Gauss
function resoudre(A, b) {
  const n = b.length;
  const m = A.map((ligne, i) => [...ligne, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(m[i][col]) > Math.abs(m[pivot][col])) pivot = i;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const f = m[i][col] / m[col][col];
      for (let j = col; j <= n; j++) m[i][j] -= f * m[col][j];
    }
  }
  return m.map((ligne, i) => ligne[n] / ligne[i]);
}

// Remet la grille « à plat » (photo prise de biais) dans un rectangle 900 × 300, plus une marge
function redresser(source, coins) {
  const P = MARGE_GRILLE;
  const W = LARGEUR_GRILLE + 2 * P, H = HAUTEUR_GRILLE + 2 * P;
  const sw = source.width, sh = source.height;
  const src = source.getContext('2d').getImageData(0, 0, sw, sh).data;
  const M = homographie(
    [[P, P], [P + LARGEUR_GRILLE, P], [P + LARGEUR_GRILLE, P + HAUTEUR_GRILLE], [P, P + HAUTEUR_GRILLE]],
    coins.map(c => [c.x, c.y]));
  const sortie = new ImageData(W, H);
  const d = sortie.data;
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const i = (v * W + u) * 4;
      const [x, y] = appliquer(M, u, v);
      const x0 = Math.floor(x), y0 = Math.floor(y);
      d[i + 3] = 255;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { d[i] = d[i + 1] = d[i + 2] = 255; continue; }
      const fx = x - x0, fy = y - y0, p = (y0 * sw + x0) * 4, l = sw * 4;
      for (let k = 0; k < 3; k++) {
        const haut = src[p + k] * (1 - fx) + src[p + 4 + k] * fx;
        const bas = src[p + l + k] * (1 - fx) + src[p + l + 4 + k] * fx;
        d[i + k] = haut * (1 - fy) + bas * fy;
      }
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d').putImageData(sortie, 0, 0);
  return canvas;
}

// Découpe les 27 cases ; chaque case non vide donne une vignette noir sur blanc prête à lire
function decouper(grille) {
  const W = grille.width, H = grille.height;
  const px = grille.getContext('2d').getImageData(0, 0, W, H).data;
  const gris = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) gris[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  const P = MARGE_GRILLE, lc = LARGEUR_GRILLE / 9, hc = HAUTEUR_GRILLE / 3;
  // Chaque case est découpée un peu plus large que sa place théorique : un chiffre mal
  // cadré n'est pas coupé. On ne garde ensuite que ce qui est centré dans la case.
  const deborde = 0.15;
  const cases = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const x0 = Math.round(P + (c - deborde) * lc), x1 = Math.round(P + (c + 1 + deborde) * lc);
      const y0 = Math.round(P + (r - deborde) * hc), y1 = Math.round(P + (r + 1 + deborde) * hc);
      const coeur = { x0: (deborde + 0.08) * lc, x1: (1 + deborde - 0.08) * lc, y0: (deborde + 0.08) * hc, y1: (1 + deborde - 0.08) * hc };
      cases.push({ r, c, vignette: vignette(gris, W, x0, y0, x1, y1, coeur) });
    }
  }
  return cases;
}

function vignette(gris, W, x0, y0, x1, y1, coeur) {
  const w = x1 - x0, h = y1 - y0, n = w * h;
  const v = new Uint8Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[y * w + x] = gris[(y0 + y) * W + x0 + x];

  // Case uniforme (blanche ou colorée) : pas de numéro
  const { seuil, ecart } = otsu(v);
  if (ecart < 45) return null;

  let encre = new Uint8Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) total += encre[i] = v[i] < seuil ? 1 : 0;
  // Chiffres clairs sur fond foncé : on inverse
  if (total > n / 2) for (let i = 0; i < n; i++) encre[i] ^= 1;

  effacerBords(encre, w, h);   // traits isolés, en entier
  effacerTraits(encre, w, h);  // traits collés à un chiffre
  effacerBords(encre, w, h);   // petits restes
  garderCentre(encre, w, h, coeur);
  garderGrandsChiffres(encre, w, h);

  let minX = w, minY = h, maxX = -1, maxY = -1;
  total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!encre[y * w + x]) continue;
      total++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  // Trop peu d'encre, ou tache trop petite pour être un chiffre
  if (total < n * 0.015 || maxY - minY < h * 0.25) return null;

  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const petit = document.createElement('canvas');
  petit.width = bw;
  petit.height = bh;
  const img = petit.getContext('2d').createImageData(bw, bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = (y * bw + x) * 4, couleur = encre[(minY + y) * w + minX + x] ? 0 : 255;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = couleur;
      img.data[k + 3] = 255;
    }
  }
  petit.getContext('2d').putImageData(img, 0, 0);

  // Tesseract lit mieux des chiffres d'environ 60 px de haut, entourés de blanc
  const hauteur = 60, marge = 24;
  const largeur = Math.max(1, Math.round(bw * hauteur / bh));
  const vignetteCanvas = document.createElement('canvas');
  vignetteCanvas.width = largeur + marge * 2;
  vignetteCanvas.height = hauteur + marge * 2;
  const ctx = vignetteCanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, vignetteCanvas.width, vignetteCanvas.height);
  ctx.drawImage(petit, marge, marge, largeur, hauteur);
  return vignetteCanvas;
}

// Seuil d'Otsu ; `ecart` = différence entre la moyenne des pixels sombres et celle des clairs
function otsu(v) {
  const histo = new Array(256).fill(0);
  for (const g of v) histo[g]++;
  const n = v.length;
  let somme = 0;
  for (let i = 0; i < 256; i++) somme += i * histo[i];
  let sommeB = 0, poidsB = 0, meilleur = -1, seuil = 128, ecart = 0;
  for (let t = 0; t < 256; t++) {
    poidsB += histo[t];
    if (!poidsB) continue;
    const poidsF = n - poidsB;
    if (!poidsF) break;
    sommeB += t * histo[t];
    const mB = sommeB / poidsB, mF = (somme - sommeB) / poidsF;
    const variance = poidsB * poidsF * (mB - mF) ** 2;
    if (variance > meilleur) { meilleur = variance; seuil = t + 1; ecart = mF - mB; }
  }
  return { seuil, ecart };
}

// Morceaux d'encre reliés entre eux, avec leur boîte englobante
function composantes(encre, w, h) {
  const vu = new Uint8Array(w * h);
  const liste = [];
  for (let depart = 0; depart < w * h; depart++) {
    if (!encre[depart] || vu[depart]) continue;
    const pixels = [], pile = [depart];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    vu[depart] = 1;
    while (pile.length) {
      const i = pile.pop();
      pixels.push(i);
      const x = i % w, y = (i - x) / w;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && encre[i - 1] && !vu[i - 1]) { vu[i - 1] = 1; pile.push(i - 1); }
      if (x < w - 1 && encre[i + 1] && !vu[i + 1]) { vu[i + 1] = 1; pile.push(i + 1); }
      if (y > 0 && encre[i - w] && !vu[i - w]) { vu[i - w] = 1; pile.push(i - w); }
      if (y < h - 1 && encre[i + w] && !vu[i + w]) { vu[i + w] = 1; pile.push(i + w); }
    }
    liste.push({ pixels, minX, maxX, minY, maxY, largeur: maxX - minX + 1, hauteur: maxY - minY + 1 });
  }
  return liste;
}

// Traits de la grille : longues suites de pixels d'encre, horizontales ou verticales.
// On n'efface que ces suites : un chiffre collé à un trait reste intact.
function effacerTraits(encre, w, h) {
  const aEffacer = [];
  const balayer = (lignes, longueur, idx) => {
    for (let a = 0; a < lignes; a++) {
      let debut = -1;
      for (let b = 0; b <= longueur; b++) {
        const allume = b < longueur && encre[idx(a, b)];
        if (allume && debut < 0) debut = b;
        if (!allume && debut >= 0) {
          if (b - debut > longueur * 0.6) for (let k = debut; k < b; k++) aEffacer.push(idx(a, k));
          debut = -1;
        }
      }
    }
  };
  balayer(h, w, (y, x) => y * w + x);
  balayer(w, h, (x, y) => y * w + x);
  for (const i of aEffacer) encre[i] = 0;
}

// Supprime ce qui touche le bord de la case et ressemble à un reste de trait de grille
// (très long) ou à du bruit (minuscule). Un chiffre qui déborde un peu, lui, est gardé.
function effacerBords(encre, w, h) {
  for (const m of composantes(encre, w, h)) {
    if (m.minX > 0 && m.minY > 0 && m.maxX < w - 1 && m.maxY < h - 1) continue;
    const trait = m.largeur > w * 0.7 || m.hauteur > h * 0.8
      || (m.largeur < w * 0.1 && m.hauteur > h * 0.4)
      || (m.hauteur < h * 0.1 && m.largeur > w * 0.4);
    const bruit = m.pixels.length < w * h * 0.004 || m.hauteur < h * 0.2;
    if (trait || bruit) for (const i of m.pixels) encre[i] = 0;
  }
}

// Écarte ce qui déborde des cases voisines : on ne garde que les morceaux centrés dans la case
function garderCentre(encre, w, h, coeur) {
  for (const m of composantes(encre, w, h)) {
    const cx = (m.minX + m.maxX) / 2, cy = (m.minY + m.maxY) / 2;
    if (cx < coeur.x0 || cx > coeur.x1 || cy < coeur.y0 || cy > coeur.y1) for (const i of m.pixels) encre[i] = 0;
  }
}

// Certains cartons répètent le numéro en petit sous le grand : on ne garde que les grands chiffres
function garderGrandsChiffres(encre, w, h) {
  const morceaux = composantes(encre, w, h);
  const plusGrand = Math.max(0, ...morceaux.map(m => m.hauteur));
  for (const m of morceaux) if (m.hauteur < plusGrand * 0.55) for (const i of m.pixels) encre[i] = 0;
}

// Filtre carré (2r+1) en deux passes : `garder(compte, taille)` décide pour chaque pixel.
// n === taille → érosion (ne reste que l'intérieur des zones épaisses) ; n > 0 → dilatation.
function filtreCarre(m, w, h, r, garder) {
  const passe = (src, horizontal) => {
    const out = new Uint8Array(w * h);
    const [lignes, longueur] = horizontal ? [h, w] : [w, h];
    for (let a = 0; a < lignes; a++) {
      const idx = b => horizontal ? a * w + b : b * w + a;
      let somme = 0;
      for (let b = 0; b < Math.min(r, longueur); b++) somme += src[idx(b)];
      for (let b = 0; b < longueur; b++) {
        if (b + r < longueur) somme += src[idx(b + r)];
        if (b - r - 1 >= 0) somme -= src[idx(b - r - 1)];
        out[idx(b)] = garder(somme, 2 * r + 1) ? 1 : 0;
      }
    }
    return out;
  };
  return passe(passe(m, true), false);
}

// Repère la grille : les traits sombres du quadrillage (cadre + séparations).
// Leurs 4 points extrêmes donnent les coins, même sur une photo prise de biais.
function detecterGrille(image) {
  const echelle = Math.min(1, 700 / Math.max(image.width, image.height));
  const w = Math.round(image.width * echelle), h = Math.round(image.height * echelle);
  const petit = document.createElement('canvas');
  petit.width = w;
  petit.height = h;
  petit.getContext('2d').drawImage(image, 0, 0, w, h);
  const px = petit.getContext('2d').getImageData(0, 0, w, h).data;
  const gris = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gris[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  const { seuil } = otsu(gris);
  const encre = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) encre[i] = gris[i] < seuil ? 1 : 0;

  // On retire les zones sombres épaisses (fond, table, ombre) pour ne garder que les traits fins
  const epais = filtreCarre(filtreCarre(encre, w, h, 4, (n, t) => n === t), w, h, 4, n => n > 0);
  for (let i = 0; i < w * h; i++) if (epais[i]) encre[i] = 0;

  // On garde les traits : longs et fins (un bord, une séparation de colonnes),
  // ou de grands morceaux de quadrillage déjà reliés. Les chiffres, courts et trapus, sont écartés.
  // Les traits peuvent être coupés (séparations pâles) : on les réunit tous.
  const cote = Math.max(w, h);
  const traits = composantes(encre, w, h).filter(m => {
    const long = Math.max(m.largeur, m.hauteur), court = Math.min(m.largeur, m.hauteur);
    const fin = long > cote * 0.12 && long / court > 6;
    const quadrillage = m.largeur > w * 0.3 && m.hauteur > h * 0.1 && m.pixels.length < m.largeur * m.hauteur * 0.35;
    return fin || quadrillage;
  });
  if (!traits.length) return null;

  let hg, hd, bd, bg;
  for (const i of traits.flatMap(m => m.pixels)) {
    const x = i % w, y = (i - x) / w;
    if (!hg || x + y < hg[0] + hg[1]) hg = [x, y];
    if (!bd || x + y > bd[0] + bd[1]) bd = [x, y];
    if (!hd || x - y > hd[0] - hd[1]) hd = [x, y];
    if (!bg || x - y < bg[0] - bg[1]) bg = [x, y];
  }
  // Trop petit pour être la grille d'un carton : on laisse le joueur cadrer
  if (bd[0] - hg[0] < w * 0.25 || bd[1] - hg[1] < h * 0.08) return null;
  return [hg, hd, bd, bg].map(([x, y]) => ({ x: (x + 0.5) / echelle, y: (y + 0.5) / echelle }));
}

// ---------- Interprétation ----------

// La colonne impose les dizaines (1–9, 10–19, …, 80–90) : ça permet de valider et de corriger
function interpreter(texte, col, confiance) {
  const valide = n => n >= 1 && n <= 90 && colonneDe(n) === col;
  const essais = texte.length <= 2 ? [texte] : Array.from({ length: texte.length - 1 }, (_, i) => texte.slice(i, i + 2));
  for (const t of essais) {
    const n = Number(t);
    if (valide(n)) return { n, douteux: confiance < 75 || texte.length > 2 };
  }
  const unite = Number(texte.at(-1));
  const n = col === 0 ? unite : col * 10 + unite;
  return valide(n) ? { n, douteux: true } : null;
}

function assembler(cases) {
  const lignes = [[], [], []];
  for (const c of cases) {
    if (!c.texte) continue;
    const lu = interpreter(c.texte, c.c, c.confiance);
    if (lu) lignes[c.r].push({ ...lu, c: c.c, confiance: c.confiance });
  }
  const douteux = new Set();
  const vus = new Set();
  const resultat = lignes.map(ligne => {
    // 5 numéros par ligne au plus : on garde les lectures les plus sûres
    const garde = ligne.length > 5
      ? [...ligne].sort((a, b) => b.confiance - a.confiance).slice(0, 5).sort((a, b) => a.c - b.c)
      : ligne;
    for (const x of garde) {
      if (x.douteux || vus.has(x.n)) douteux.add(x.n);
      vus.add(x.n);
    }
    return garde.map(x => x.n);
  });
  return { lignes: resultat, douteux: [...douteux] };
}
