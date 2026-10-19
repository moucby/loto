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

function barreMulti() {
  const s = db.soiree;
  if (!s?.role) return '';
  const reseau = {
    'en-ligne': 'en ligne', connexion: 'connexion…', deconnecte: 'hors ligne', introuvable: 'partie introuvable',
  }[etatReseau];
  if (estHote()) {
    const connectes = [...connexions.values()].filter(c => c.open).length;
    return `
      <button class="barre-multi" data-action="joueurs">
        <span class="reseau ${etatReseau}" title="${reseau}"></span>
        <span>Code <b>${s.code}</b> · ${s.joueurs.length} joueur${s.joueurs.length > 1 ? 's' : ''}
          (${connectes} connecté${connectes > 1 ? 's' : ''})</span>
        <span class="voir">Inviter ›</span>
      </button>`;
  }
  return `
    <div class="barre-multi">
      <span class="reseau ${etatReseau}"></span>
      <span>${echapper(s.nom)} · partie <b>${s.code}</b> · ${reseau}${etatReseau === 'introuvable' ? ' (vérifie le code)' : ''}</span>
    </div>`;
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
  const s = db.soiree;
  if (!estHote() || m?.type !== 'rejoindre') return;
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

function ouvrirJoueurs() {
  const s = db.soiree;
  if (!estHote()) return;
  const lien = `${location.origin}${location.pathname}?partie=${s.code}`;
  const sortis = new Set(s.tirage);
  const lignes = s.joueurs.map(j => {
    const cs = s.cartons.filter(c => c.joueur === j.id);
    const manque = cs.length ? Math.min(...cs.map(c => analyser(c, sortis, s.tour).manque.length)) : null;
    const enLigne = connexions.get(j.id)?.open;
    const avance = manque === null ? '' : manque === 0 ? ` · ${TOURS[s.tour]} !` : ` · il lui manque ${manque}`;
    return `
      <li>
        <span class="reseau ${enLigne ? 'en-ligne' : 'deconnecte'}" title="${enLigne ? 'connecté' : 'déconnecté'}"></span>
        <b>${echapper(j.nom)}</b>
        <span>${cs.length} carton${cs.length > 1 ? 's' : ''}${avance}</span>
      </li>`;
  }).join('');
  $('#options-titre').textContent = 'Joueurs de la partie';
  $('#options-contenu').innerHTML = `
    <div class="code-partie"><span>Code de la partie</span><b>${s.code}</b></div>
    <p class="aide">Chaque joueur ouvre l'appli sur son téléphone, choisit « Rejoindre une partie » et tape ce code.
      Tu peux aussi lui envoyer le lien.</p>
    <button type="button" class="btn principal" data-action="partager">Partager le lien d'invitation</button>
    <p class="lien-partie">${echapper(lien)}</p>
    <ul class="liste-joueurs">${lignes || '<li class="aide">Personne n\'a encore rejoint la partie.</li>'}</ul>`;
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
  Object.assign(s, { partie: m.partie, tour: m.tour, tirage: m.tirage, cartons: m.cartons, victoires: m.victoires });
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

function alerterJoueur(victoires) {
  const s = db.soiree;
  const miennes = victoires.filter(v => v.joueur === s.joueurId);
  const autres = victoires.filter(v => v.joueur !== s.joueurId);
  const phrases = [];
  if (miennes.length) {
    phrases.push(`Tu gagnes avec ${miennes.length > 1 ? 'les cartons' : 'le carton'} `
      + miennes.map(v => `« ${v.carton} »`).join(', ') + ' !');
  }
  for (const v of autres) phrases.push(`${v.gagnant} gagne avec « ${v.carton} ».`);
  afficherAlerte(`${TOURS[s.tour]} !`, phrases.join(' '), false, miennes.length > 0);
  if (miennes.length) document.querySelector(`[data-carton="${miennes[0].cartonId}"]`)?.scrollIntoView({ block: 'nearest' });
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
