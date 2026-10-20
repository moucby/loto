'use strict';

// ==========================================================
// Multijoueur (mode fictif) : chaque joueur sur son téléphone.
// Les téléphones se parlent directement (WebRTC, via la bibliothèque PeerJS) ; le service
// public de PeerJS sert seulement à les mettre en relation. Rien n'est stocké en ligne.
// L'organisateur fait foi : il tire les numéros, détient tous les cartons (les siens et
// ceux des invités) et calcule les victoires ; il envoie à chaque joueur l'état de la partie.
// ==========================================================

const PREFIXE_PAIR = 'loto-fr-partie-';
const CARACTERES_CODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sans I, L, O, 0, 1 (trop proches)
const NB_MAX_CARTONS_JOUEUR = 12;
const OPTIONS_PAIR = {
  debug: 0,
  config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] },
};

let pair = null;               // notre point de connexion PeerJS
const connexions = new Map();  // organisateur : joueurId → connexion avec ce joueur
let liaison = null;            // joueur : connexion avec l'organisateur
let etatReseau = 'deconnecte'; // 'connexion' | 'en-ligne' | 'deconnecte' | 'introuvable'
let premierEtat = true;        // joueur : le premier état reçu ne déclenche ni annonce ni alerte
let relance = null;
let panneauJoueurs = false;    // le panneau ⚙ affiche-t-il la liste des joueurs ?

// Formulaire « Rejoindre une partie » (le lien ?partie=CODE le préremplit)
let codeRejoindre = (new URLSearchParams(location.search).get('partie') ?? '').toUpperCase().slice(0, 5);
let nomRejoindre = '';
let nbRejoindre = 2;

const estHote = () => db.soiree?.role === 'hote';
const estJoueur = () => db.soiree?.role === 'joueur';
const bornerJoueur = n => Math.min(NB_MAX_CARTONS_JOUEUR, Math.max(1, Math.round(Number(n) || 1)));

function genererCode() {
  const hasard = new Uint32Array(5);
  crypto.getRandomValues(hasard);
  return [...hasard].map(x => CARACTERES_CODE[x % CARACTERES_CODE.length]).join('');
}

async function chargerPeerJS() {
  if (!window.Peer) await chargerScript('vendor/peerjs.min.js');
}

function majReseau(etat) {
  etatReseau = etat;
  rafraichirMulti();
}

// Met à jour la barre multijoueur (et la liste des joueurs si elle est ouverte) sans tout redessiner
function rafraichirMulti() {
  const barre = $('#j-multi');
  if (barre) barre.innerHTML = barreMulti();
  if (panneauJoueurs && $('#options').open) ouvrirJoueurs();
}

const TEXTE_RESEAU = { 'en-ligne': 'en ligne', connexion: 'connexion…', deconnecte: 'hors ligne', introuvable: 'introuvable' };

// Les membres de la salle : l'organisateur puis les invités, avec leurs victoires.
// L'organisateur la calcule ; les joueurs la reçoivent avec l'état de la partie.
function salle() {
  const s = db.soiree;
  if (!estHote()) return s.salle ?? [];
  const gains = joueurId => s.victoires.filter(v => (carton(v.cartonId)?.joueur ?? null) === joueurId).length;
  return [
    { id: null, nom: 'Organisateur', enLigne: etatReseau === 'en-ligne', gains: gains(null), cartons: mesCartons().length },
    ...s.joueurs.map(j => ({
      id: j.id, nom: j.nom, enLigne: !!connexions.get(j.id)?.open, gains: gains(j.id),
      cartons: s.cartons.filter(c => c.joueur === j.id).length,
    })),
  ];
}

// Couleur stable pour chaque prénom
const teinte = nom => [...nom].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17);

function pastilleHtml(m) {
  return `
    <span class="pastille ${m.enLigne ? 'en-ligne' : ''}" style="--teinte:${teinte(m.nom)}">
      ${m.id === null ? '👑' : echapper(m.nom.charAt(0).toUpperCase())}
      ${m.gains ? `<i class="gains" title="${m.gains} victoire${m.gains > 1 ? 's' : ''}">★${m.gains > 1 ? m.gains : ''}</i>` : ''}
    </span>`;
}

const estMoi = m => (estHote() ? m.id === null : m.id === db.soiree.joueurId);
const enAttente = () => db.soiree.enPause && !db.soiree.tirage.length;

// Bandeau de l'écran de jeu : le code de la partie et les joueurs autour de la table
function barreMulti() {
  const s = db.soiree;
  if (!s?.role) return '';
  const hote = estHote();
  const membres = salle();
  const puce = `
    <span class="reseau ${etatReseau}" title="${TEXTE_RESEAU[etatReseau]}"></span>
    <span class="code-mini">${s.code}</span>
    <span class="code-legende">${hote ? 'Inviter' : TEXTE_RESEAU[etatReseau]}</span>`;
  const attente = !enAttente() ? '' : hote
    ? `<div class="attente"><span>${membres.length - 1 ? `${membres.length - 1} joueur${membres.length > 2 ? 's' : ''} dans la salle.` : 'La salle est ouverte : en attente des joueurs.'}</span>
        <button class="btn principal" data-action="lancer">▶ Lancer la partie</button></div>`
    : '<div class="attente"><span class="sablier" aria-hidden="true"></span><span>En attente du lancement par l\'organisateur…</span></div>';
  return `
    <div class="table-joueurs">
      ${hote ? `<button class="code-puce" data-action="joueurs" aria-label="Inviter des joueurs">${puce}</button>`
        : `<div class="code-puce">${puce}</div>`}
      <ul class="avatars" aria-label="Joueurs de la partie">
        ${membres.map(m => `
          <li class="avatar ${estMoi(m) ? 'moi' : ''}" title="${echapper(m.nom)}${m.enLigne ? '' : ' (hors ligne)'}">
            ${pastilleHtml(m)}<small>${estMoi(m) ? 'Toi' : m.id === null ? 'Orga' : echapper(m.nom)}</small>
          </li>`).join('')}
      </ul>
    </div>
    ${etatReseau === 'introuvable' && !hote ? '<p class="attente erreur">Partie introuvable : vérifie le code avec l\'organisateur.</p>' : attente}`;
}

// L'organisateur lance le tirage quand tout le monde est là
function lancerPartie() {
  const s = db.soiree;
  if (!estHote()) return;
  s.enPause = false;
  prochainTirage = null;
  sauver();
  fermerOptions();
  rendre();
  signaler('C\'est parti !', 'ok');
}

// ---------- Organisateur ----------
async function demarrerHote() {
  const s = db.soiree;
  if (!estHote()) return;
  try { await chargerPeerJS(); } catch { return majReseau('deconnecte'); }
  pair?.destroy();
  majReseau('connexion');
  pair = new Peer(PREFIXE_PAIR + s.code, OPTIONS_PAIR);
  pair.on('open', () => majReseau('en-ligne'));
  pair.on('connection', conn => {
    conn.on('data', m => recevoirHote(conn, m));
    conn.on('close', () => {
      if (connexions.get(conn.joueurId) === conn) connexions.delete(conn.joueurId);
      diffuserEtat(); // les autres voient le joueur passer hors ligne
      rafraichirMulti();
    });
  });
  pair.on('disconnected', () => {
    majReseau('connexion');
    try { pair.reconnect(); } catch {}
  });
  pair.on('error', err => {
    // Après un rechargement, le code peut rester réservé quelques instants : on réessaie
    if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
      majReseau('connexion');
      clearTimeout(relance);
      relance = setTimeout(demarrerHote, 4000);
    }
  });
}

function recevoirHote(conn, m) {
  if (!estHote()) return;
  if (m?.type === 'victoire') return recevoirVictoire(conn, m);
  if (m?.type !== 'rejoindre') return;
  const s = db.soiree;
  const joueurId = String(m.joueurId ?? '').slice(0, 40);
  if (!joueurId) return;
  let joueur = s.joueurs.find(j => j.id === joueurId);
  let nouveaux = [];
  if (!joueur) {
    // Nouveau joueur : ses cartons sont générés ici, dans les séries de la partie (pas de doublon)
    joueur = { id: joueurId, nom: String(m.nom ?? '').trim().slice(0, 20) || 'Joueur' };
    s.joueurs.push(joueur);
    genererCartons(bornerJoueur(m.nbCartons), joueur.id);
    nouveaux = verifierVictoires();
  }
  conn.joueurId = joueur.id;
  const ancienne = connexions.get(joueur.id);
  connexions.set(joueur.id, conn);
  if (ancienne && ancienne !== conn) ancienne.close();
  sauver(); // envoie l'état à tout le monde, y compris au nouveau venu
  rafraichirMulti();
  if (nouveaux.length) alerter(nouveaux);
}

// Un joueur annonce une victoire : l'organisateur la vérifie avec les numéros réellement sortis
function recevoirVictoire(conn, m) {
  const s = db.soiree;
  if (m.partie !== s.partie || m.tour !== s.tour) return; // sous-tour déjà terminé
  const sortis = new Set(s.tirage);
  const gagnants = [];
  for (const id of Array.isArray(m.cartonIds) ? m.cartonIds : []) {
    const c = carton(id);
    if (!c || c.joueur !== conn.joueurId) continue;
    if (!analyser(c, sortis, s.tour).gagne) continue;
    if (s.victoires.some(v => v.partie === s.partie && v.tour === s.tour && v.cartonId === id)) continue;
    s.victoires.push({ partie: s.partie, tour: s.tour, cartonId: id, heure: new Date().toISOString() });
    gagnants.push(c);
  }
  if (!gagnants.length) return;
  sauver(); // la victoire part chez tous les joueurs
  rendre();
  alerter(gagnants);
}

function nomDuJoueur(joueurId) {
  if (!joueurId) return 'L\'organisateur';
  return db.soiree.joueurs.find(j => j.id === joueurId)?.nom ?? 'Un joueur';
}

// Ce que voit un joueur : la partie, ses propres cartons, et toutes les victoires (avec le gagnant)
function etatPour(joueurId) {
  const s = db.soiree;
  return {
    type: 'etat',
    partie: s.partie,
    tour: s.tour,
    tirage: s.tirage,
    enPause: s.enPause,
    salle: salle().map(({ cartons, ...m }) => m),
    cartons: s.cartons.filter(c => c.joueur === joueurId).map(({ joueur, ...c }) => c),
    victoires: s.victoires.map(v => {
      const c = carton(v.cartonId);
      return { ...v, carton: c?.nom ?? '', joueur: c?.joueur ?? null, gagnant: nomDuJoueur(c?.joueur) };
    }),
  };
}

// Appelée à chaque sauvegarde de l'organisateur
function diffuserEtat() {
  for (const [joueurId, conn] of connexions) {
    if (conn.open) conn.send(etatPour(joueurId));
  }
}

function finirHote() {
  for (const conn of connexions.values()) if (conn.open) conn.send({ type: 'fin' });
  const p = pair;
  setTimeout(() => p?.destroy(), 500); // le temps que le message parte
  pair = null;
  connexions.clear();
  clearTimeout(relance);
}

// QR code de l'invitation (bibliothèque qrcode-generator, chargée à la demande)
function qrInvitation(lien) {
  if (!window.qrcode) return '<span class="qr-attente">QR code…</span>';
  const qr = qrcode(0, 'M');
  qr.addData(lien);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true, alt: 'QR code pour rejoindre la partie' });
}

// La salle de jeu : billet d'invitation (code + QR code), lancement, liste des joueurs
function ouvrirJoueurs() {
  const s = db.soiree;
  if (!estHote()) return;
  const lien = `${location.origin}${location.pathname}?partie=${s.code}`;
  if (!window.qrcode) chargerScript('vendor/qrcode.js').then(() => panneauJoueurs && $('#options').open && ouvrirJoueurs()).catch(() => {});
  const membres = salle();
  const invites = membres.length - 1;
  $('#options-titre').textContent = enAttente() ? 'Salle d\'attente' : 'Salle de jeu';
  $('#options-contenu').innerHTML = `
    <div class="billet">
      <div class="billet-code">
        <span>Code de la partie</span>
        <b>${s.code}</b>
        <small>« Rejoindre » sur l'accueil de l'appli</small>
      </div>
      <div class="billet-qr">${qrInvitation(lien)}<small>ou scanner ici</small></div>
    </div>
    <div class="ligne-btn">
      <button type="button" class="btn" data-action="partager">Partager le lien</button>
      ${enAttente() ? '<button type="button" class="btn principal pousse" data-action="lancer">▶ Lancer la partie</button>' : ''}
    </div>
    <h3 class="titre-liste">Joueurs <span>${invites ? `${invites} invité${invites > 1 ? 's' : ''}` : 'en attente…'}</span></h3>
    <ul class="liste-joueurs">
      ${membres.map(m => `
        <li class="${estMoi(m) ? 'moi' : ''}">
          ${pastilleHtml(m)}
          <div class="infos-joueur">
            <b>${estMoi(m) ? 'Toi (organisateur)' : echapper(m.nom)}</b>
            <span>${m.cartons} carton${m.cartons > 1 ? 's' : ''}${m.gains ? ` · ★ ${m.gains} victoire${m.gains > 1 ? 's' : ''}` : ''}</span>
          </div>
          <span class="etat-ligne ${m.enLigne ? 'en-ligne' : ''}">${m.enLigne ? 'en ligne' : 'hors ligne'}</span>
        </li>`).join('')}
    </ul>
    ${invites ? '' : '<p class="aide">Les joueurs apparaissent ici dès qu\'ils rejoignent la partie.</p>'}`;
  panneauJoueurs = true;
  if (!$('#options').open) $('#options').showModal();
}

async function partager() {
  const s = db.soiree;
  const lien = `${location.origin}${location.pathname}?partie=${s.code}`;
  const texte = `Rejoins ma partie de loto ! Code : ${s.code}`;
  try {
    if (navigator.share) return await navigator.share({ title: 'Loto', text: texte, url: lien });
    await navigator.clipboard.writeText(lien);
    alert('Lien copié : colle-le dans un message aux joueurs.');
  } catch {}
}

// ---------- Joueur ----------
async function rejoindre() {
  const code = codeRejoindre.trim().toUpperCase();
  const nom = nomRejoindre.trim();
  if (!/^[A-Z0-9]{5}$/.test(code)) return alert('Le code de la partie compte 5 caractères (lettres et chiffres).');
  if (!nom) return alert('Indique ton prénom : il s\'affiche chez les autres joueurs quand tu gagnes.');
  db.soiree = {
    mode: 'fictif',
    role: 'joueur',
    code,
    joueurId: nouvelId(),
    nom: nom.slice(0, 20),
    nbCartons: bornerJoueur(nbRejoindre),
    cartons: [],
    marques: [], // numéros que le joueur a cochés lui-même
    partie: 1,
    tour: 1,
    tirage: [],
    victoires: [],
  };
  premierEtat = true;
  sauver();
  debloquerSon();
  history.replaceState(null, '', location.pathname); // on retire ?partie=… de l'adresse
  aller('jeu');
  connecterJoueur();
}

async function connecterJoueur() {
  const s = db.soiree;
  if (!estJoueur()) return;
  try { await chargerPeerJS(); } catch { return majReseau('deconnecte'); }
  pair?.destroy();
  if (etatReseau !== 'introuvable') majReseau('connexion');
  pair = new Peer(OPTIONS_PAIR);
  pair.on('open', () => {
    liaison = pair.connect(PREFIXE_PAIR + s.code, { reliable: true });
    liaison.on('open', () => {
      majReseau('en-ligne');
      liaison.send({ type: 'rejoindre', joueurId: s.joueurId, nom: s.nom, nbCartons: s.nbCartons });
    });
    liaison.on('data', recevoirJoueur);
    liaison.on('close', reessayer);
  });
  pair.on('error', err => {
    if (err.type === 'peer-unavailable') majReseau('introuvable');
    reessayer();
  });
}

function reessayer() {
  if (!estJoueur()) return;
  if (etatReseau === 'en-ligne') majReseau('connexion');
  clearTimeout(relance);
  relance = setTimeout(connecterJoueur, 4000);
}

function recevoirJoueur(m) {
  const s = db.soiree;
  if (!estJoueur()) return;
  if (m?.type === 'fin') {
    deconnecter();
    db.soiree = null;
    sauver();
    aller('jeu');
    alert('L\'organisateur a terminé la partie.');
    return;
  }
  if (m?.type !== 'etat') return;
  if (etatReseau !== 'en-ligne') majReseau('en-ligne');

  const cle = v => `${v.partie}-${v.tour}-${v.cartonId}`;
  const connues = new Set(s.victoires.map(cle));
  const nouveauNumero = !premierEtat && m.partie === s.partie && m.tirage.length === s.tirage.length + 1
    ? m.tirage.at(-1) : null;
  // Nouveau tour : on repart avec des cartons vierges
  if (m.partie !== s.partie) s.marques = [];
  // Mes victoires pas encore confirmées par l'organisateur : on les garde en attendant
  const recues = new Set(m.victoires.map(cle));
  const mesIds = new Set(m.cartons.map(c => c.id));
  const nonConfirmees = s.victoires.filter(v => !recues.has(cle(v)) && mesIds.has(v.cartonId) && v.partie === m.partie);
  Object.assign(s, {
    partie: m.partie, tour: m.tour, tirage: m.tirage, cartons: m.cartons, victoires: [...m.victoires, ...nonConfirmees],
    enPause: !!m.enPause, salle: Array.isArray(m.salle) ? m.salle : [],
  });
  s.marques ??= [];
  sauver();

  if (nouveauNumero) {
    annoncer(nouveauNumero);
    animerBoule = true;
    navigator.vibrate?.(15);
  }
  if (['jeu', 'cartons'].includes(ecran)) rendre();
  const nouvelles = premierEtat ? [] : m.victoires.filter(v => !connues.has(cle(v)) && v.partie === m.partie && v.tour === m.tour);
  premierEtat = false;
  if (nouvelles.length) alerterJoueur(nouvelles);
}

// Victoires des autres joueurs (les miennes, je les ai déjà vues en cochant mes numéros)
function alerterJoueur(victoires) {
  const s = db.soiree;
  const autres = victoires.filter(v => v.joueur !== s.joueurId);
  if (!autres.length) return;
  const phrases = autres.map(v => `${v.gagnant} gagne avec « ${v.carton} ».`);
  afficherAlerte(`${TOURS[s.tour]} !`, phrases.join(' '), false, false);
}

// Le joueur a gagné en cochant ses numéros : il prévient l'organisateur, qui vérifie et l'annonce à tous
function signalerVictoires(cartons) {
  const s = db.soiree;
  if (!liaison?.open) return;
  liaison.send({ type: 'victoire', partie: s.partie, tour: s.tour, cartonIds: cartons.map(c => c.id) });
}

function deconnecter() {
  clearTimeout(relance);
  liaison?.close();
  liaison = null;
  pair?.destroy();
  pair = null;
  etatReseau = 'deconnecte';
}

// Retour sur l'appli (téléphone déverrouillé) : le joueur se reconnecte s'il a été coupé
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && estJoueur() && !liaison?.open) connecterJoueur();
});

// ---------- Démarrage ----------
if (estHote()) demarrerHote();
else if (estJoueur()) connecterJoueur();
