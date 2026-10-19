'use strict';

// ---------- Constantes ----------
const CLE = 'loto.v1';
const TOURS = [null, 'Quine', 'Double quine', 'Carton plein'];
const NB_PARTIES = 18;

// ---------- Données (stockage local, pas de base) ----------
// Les cartons appartiennent à la partie en cours (db.soiree.cartons) et disparaissent avec elle.
function charger() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE));
    if (d && typeof d === 'object') {
      // Ancien format : cartons partagés entre les parties → on garde ceux de la partie en cours
      if (Array.isArray(d.cartons)) {
        if (d.soiree) d.soiree.cartons = d.cartons.filter(c => d.soiree.cartonIds?.includes(c.id));
        delete d.cartons;
      }
      if (d.soiree) {
        delete d.soiree.cartonIds;
        d.soiree.cartons ??= [];
        // Partie commencée avant les modes : fictive si ses cartons ont été générés
        d.soiree.mode ??= d.soiree.cartons.some(c => c.serie) ? 'fictif' : 'reel';
      }
      return d;
    }
  } catch {}
  return { soiree: null, prefs: {} };
}
const db = charger();
db.prefs ??= {};

function sauver() {
  localStorage.setItem(CLE, JSON.stringify(db));
  // Partie à plusieurs : l'organisateur envoie le nouvel état aux joueurs (multi.js)
  if (db.soiree?.role === 'hote' && typeof diffuserEtat === 'function') diffuserEtat();
}

// ---------- Utilitaires ----------
const $ = sel => document.querySelector(sel);
const carton = id => db.soiree?.cartons.find(c => c.id === id);
// Cartons du joueur de cet appareil (chez l'organisateur, on écarte ceux des invités)
const mesCartons = () => db.soiree.cartons.filter(c => !c.joueur);
const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const echapper = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Carton français : colonne 1 = 1–9, colonne 2 = 10–19, …, colonne 9 = 80–90
const colonneDe = n => (n === 90 ? 8 : Math.floor(n / 10));

// État d'une carte pour le tour en cours : lignes complètes, victoire, numéros manquants
function analyser(c, sortis, tour) {
  const lignes = c.grille.map(ligne => {
    const nums = ligne.filter(n => n != null);
    return { nums, manque: nums.filter(n => !sortis.has(n)) };
  });
  const completes = lignes.filter(l => l.manque.length === 0).length;
  const gagne = completes >= tour;
  // « Il me manque » : les `tour` lignes les plus avancées
  const manque = gagne ? [] : [...lignes]
    .sort((a, b) => a.manque.length - b.manque.length)
    .slice(0, tour)
    .flatMap(l => l.manque)
    .sort((a, b) => a - b);
  return { lignes, completes, gagne, manque };
}

// ---------- Génération de cartons ----------
// Règles des cartons français :
// - 3 lignes × 9 colonnes, 5 numéros par ligne, soit 15 numéros par carton ;
// - colonne 1 = 1–9, colonne 2 = 10–19, …, colonne 9 = 80–90 ;
// - 1 ou 2 numéros par colonne (6 colonnes à deux numéros, 3 à un seul), croissants de haut en bas ;
// - les cartons vont par séries de 6 : une série contient chacun des 90 numéros une seule fois.
const TOUS_LES_NUMEROS = Array.from({ length: 90 }, (_, i) => i + 1);

const melanger = t => {
  for (let i = t.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [t[i], t[j]] = [t[j], t[i]];
  }
  return t;
};

// Répartit les numéros `restants` d'une série sur `m` cartons (tous les numéros servent).
// Renvoie les m grilles, ou null si c'est impossible.
function repartirSerie(restants, m) {
  const parColonne = Array.from({ length: 9 }, (_, c) => restants.filter(n => colonneDe(n) === c));
  if (restants.length !== 15 * m) return null;
  // Dans chaque colonne, combien de cartons auront deux numéros (les autres en auront un)
  const doubles = parColonne.map(p => p.length - m);
  if (doubles.some(d => d < 0 || d > m)) return null;

  for (let essai = 0; essai < 50; essai++) {
    const aPlacer = [...doubles];
    const choix = [];
    let ok = true;
    for (let t = 0; t < m && ok; t++) {
      const cartonsRestants = m - t;
      // Colonnes à servir sur chacun des cartons restants : obligatoires pour celui-ci
      const obligatoires = aPlacer.flatMap((d, c) => (d === cartonsRestants ? [c] : []));
      const possibles = melanger(aPlacer.flatMap((d, c) => (d > 0 && d < cartonsRestants ? [c] : [])));
      const pris = [...obligatoires, ...possibles].slice(0, 6);
      if (obligatoires.length > 6 || pris.length < 6) { ok = false; break; }
      pris.forEach(c => aPlacer[c]--);
      choix.push(pris);
    }
    if (!ok) continue;
    for (const p of parColonne) melanger(p);
    return choix.map(colonnesDoubles => {
      const compte = Array.from({ length: 9 }, (_, c) => (colonnesDoubles.includes(c) ? 2 : 1));
      const lignes = placerLignes(compte);
      const grille = [0, 1, 2].map(() => Array(9).fill(null));
      compte.forEach((k, c) => {
        const nums = parColonne[c].splice(0, k).sort((a, b) => a - b);
        lignes[c].forEach((r, i) => { grille[r][c] = nums[i]; });
      });
      return grille;
    });
  }
  return null;
}

// Choisit les lignes de chaque colonne (1 ou 2 lignes) pour avoir 5 numéros sur chaque ligne
function placerLignes(compte) {
  for (;;) {
    const parLigne = [0, 0, 0];
    const lignes = compte.map(k => melanger([0, 1, 2]).slice(0, k).sort((a, b) => a - b));
    lignes.flat().forEach(r => parLigne[r]++);
    if (parLigne.every(n => n === 5)) return lignes;
  }
}

// « Carton N » : N suit le plus grand numéro déjà utilisé dans la partie
function nomSuivant(cartons) {
  const pris = cartons.map(c => Number(/^Carton (\d+)$/.exec(c.nom)?.[1] ?? 0));
  return `Carton ${Math.max(0, ...pris) + 1}`;
}

// Génère n cartons au moment du clic. On complète d'abord une série entamée (avec les numéros
// qu'elle n'a pas encore distribués), puis on ouvre de nouvelles séries de 6.
function genererCartons(n, joueur = null) {
  const s = db.soiree;
  while (n > 0) {
    const series = new Map();
    for (const c of s.cartons) if (c.serie) series.set(c.serie, [...(series.get(c.serie) ?? []), c]);
    let serie = null, grilles = null;
    for (const [id, membres] of series) {
      if (membres.length >= 6) continue;
      const pris = new Set(membres.flatMap(c => c.grille.flat()));
      grilles = repartirSerie(TOUS_LES_NUMEROS.filter(x => !pris.has(x)), 6 - membres.length);
      if (grilles) { serie = id; break; }
    }
    if (!grilles) {
      serie = nouvelId();
      do grilles = repartirSerie(TOUS_LES_NUMEROS, 6); while (!grilles);
    }
    // Seuls les cartons demandés sont gardés : le reste de la série n'est pas fabriqué d'avance
    for (const grille of grilles.slice(0, n)) {
      const siens = s.cartons.filter(c => (c.joueur ?? null) === joueur);
      s.cartons.push({ id: nouvelId(), nom: nomSuivant(siens), serie, grille, ...(joueur ? { joueur } : {}) });
    }
    n -= Math.min(n, grilles.length);
  }
}

// Numéro de série affiché (1, 2, …) dans l'ordre d'apparition
function numeroSerie(c) {
  if (!c.serie) return null;
  const ordre = [...new Set(db.soiree.cartons.map(x => x.serie).filter(Boolean))];
  return ordre.indexOf(c.serie) + 1;
}

// ---------- Navigation ----------
let ecran = 'jeu';
let edition = null;   // carton en cours de saisie
let partieDepart = 1;
// Deux modes de partie (choisis au départ, rien par défaut) :
// - 'reel'   : en salle, le joueur saisit ses cartons et tape les numéros annoncés ;
// - 'fictif' : sans salle, l'appli génère les cartons et tire les numéros.
let modeDepart = null;
let nbAGenerer = 6;   // nombre de cartons générés au départ en mode fictif
let multiDepart = false; // mode fictif : partie à plusieurs, chacun sur son téléphone
const modeFictif = () => db.soiree?.mode === 'fictif';

function aller(nom) {
  ecran = nom;
  rendre();
  window.scrollTo(0, 0);
}

function rendre() {
  const vue = ecran === 'jeu' && !db.soiree ? 'accueil' : ecran;
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== 'ecran-' + vue;
  const onglet = vue === 'edition' || vue === 'scan' ? 'cartons' : ecran;
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('actif', b.dataset.nav === onglet));
  document.body.classList.toggle('mode-jeu', vue === 'jeu');
  $('.bouton-options').hidden = vue !== 'jeu';
  majBoutonSon(vue === 'jeu');
  ({ accueil: rendreAccueil, jeu: rendreJeu, cartons: rendreCartons, edition: rendreEdition, scan: () => rendreScan() })[vue]();
  gererVeille(vue === 'jeu');
}

// ---------- Écran : nouvelle partie (F3) ----------
const NB_MAX_GENERES = 50;
const borner = n => Math.min(NB_MAX_GENERES, Math.max(0, Math.round(Number(n) || 0)));

function rendreAccueil() {
  $('#ecran-accueil').innerHTML = `
    <div class="panneau">
      <h2>Nouvelle partie</h2>
      <p class="aide">Les cartons appartiennent à la partie : ils sont créés pour elle et supprimés quand elle se termine.</p>
      <p class="question">Comment joues-tu ?</p>
      <div class="choix-mode" role="radiogroup">
        <button class="mode ${modeDepart === 'reel' ? 'actif' : ''}" data-action="mode" data-id="reel"
          role="radio" aria-checked="${modeDepart === 'reel'}">
          <b>Mode réel</b><span>En salle : tu saisis tes cartons et tu tapes les numéros annoncés</span>
        </button>
        <button class="mode ${modeDepart === 'fictif' ? 'actif' : ''}" data-action="mode" data-id="fictif"
          role="radio" aria-checked="${modeDepart === 'fictif'}">
          <b>Mode fictif</b><span>Sans salle : l'appli génère les cartons et tire les numéros</span>
        </button>
      </div>
      ${modeDepart === 'fictif' ? `
        <label class="choix">
          <input type="checkbox" id="multi-depart" ${multiDepart ? 'checked' : ''}>
          <span>Jouer à plusieurs, chacun sur son téléphone (tu organises la partie)</span>
        </label>
        <label class="champ">${multiDepart ? 'Combien de cartons pour toi ? (0 si tu ne fais qu\'organiser)' : 'Combien de cartons ?'}
          <input id="nb-depart" type="number" inputmode="numeric" min="${multiDepart ? 0 : 1}" max="${NB_MAX_GENERES}" value="${nbAGenerer}">
        </label>` : ''}
      <label class="champ">Commencer au tour
        <select id="partie-depart">
          ${Array.from({ length: NB_PARTIES }, (_, i) => `<option value="${i + 1}" ${i + 1 === partieDepart ? 'selected' : ''}>${i + 1}</option>`).join('')}
        </select>
      </label>
      <button class="btn principal large" data-action="demarrer" id="btn-demarrer" ${modeDepart ? '' : 'disabled'}>
        ${libelleDemarrer()}
      </button>
    </div>
    <div class="panneau rejoindre" id="rejoindre">
      <h2>Rejoindre une partie</h2>
      <p class="aide">Quelqu'un organise une partie fictive à plusieurs ? Entre son code pour jouer sur ton téléphone.</p>
      <label class="champ">Code de la partie
        <input id="code-rejoindre" type="text" maxlength="5" autocapitalize="characters" autocomplete="off"
          placeholder="ex. K7Q2M" value="${echapper(codeRejoindre)}">
      </label>
      <label class="champ">Ton prénom
        <input id="nom-rejoindre" type="text" maxlength="20" autocomplete="given-name" value="${echapper(nomRejoindre)}">
      </label>
      <label class="champ">Combien de cartons ?
        <input id="nb-rejoindre" type="number" inputmode="numeric" min="1" max="${NB_MAX_CARTONS_JOUEUR}" value="${nbRejoindre}">
      </label>
      <button class="btn principal large" data-action="rejoindre">Rejoindre la partie</button>
    </div>`;
  // Arrivé par un lien d'invitation : on amène le joueur sur le formulaire
  if (codeRejoindre) $('#rejoindre').scrollIntoView();
}

function libelleDemarrer() {
  if (modeDepart === 'fictif' && multiDepart) {
    return nbAGenerer ? `Créer la partie (${nbAGenerer} carton${nbAGenerer > 1 ? 's' : ''} pour toi)` : 'Créer la partie';
  }
  if (modeDepart === 'fictif') return `Générer ${nbAGenerer} carton${nbAGenerer > 1 ? 's' : ''} et démarrer`;
  if (modeDepart === 'reel') return 'Démarrer et saisir mes cartons';
  return 'Choisis d\'abord un mode';
}

function demarrer() {
  const multi = modeDepart === 'fictif' && multiDepart;
  if (!modeDepart || (modeDepart === 'fictif' && !multi && !nbAGenerer)) return;
  db.soiree = {
    debut: new Date().toISOString(),
    mode: modeDepart,
    ...(multi ? { role: 'hote', code: genererCode(), joueurs: [] } : {}),
    cartons: [],
    partie: partieDepart,
    tour: 1,
    tirage: [],
    victoires: [],
  };
  const fictif = modeDepart === 'fictif';
  if (fictif) genererCartons(nbAGenerer);
  modeDepart = null;
  sauver();
  debloquerSon();
  // Mode réel : on va directement là où le joueur saisit ses cartons
  aller(fictif ? 'jeu' : 'cartons');
  if (multi) {
    multiDepart = false;
    demarrerHote();
    ouvrirJoueurs(); // affiche tout de suite le code à communiquer
  }
}

// ---------- Écran : partie en cours (F4 à F10) ----------
let retour = null;      // message affiché dans la zone de saisie : { texte, type }
let retourMinuteur = null;
let animerBoule = false;

// La zone de saisie est construite une seule fois :
// la reconstruire à chaque numéro fermerait le clavier du téléphone.
function squeletteJeu() {
  $('#ecran-jeu').innerHTML = `
    <div class="statut" id="j-statut"></div>
    <ol class="etapes" id="j-etapes" aria-label="Sous-tours"></ol>
    <div class="multi" id="j-multi"></div>
    <form class="saisie" id="form-saisie" autocomplete="off" novalidate>
      <input id="champ-numero" class="champ-numero" type="text" inputmode="numeric" pattern="[0-9]*"
        maxlength="2" enterkeyhint="go" aria-label="Numéro annoncé" placeholder="Numéro annoncé">
      <button type="submit" class="btn principal ok" data-garde-focus>OK</button>
      <button type="button" class="btn tirer" data-action="tirer" data-garde-focus
        aria-label="Tirer un numéro au hasard">🎲<small>Tirer</small></button>
      <button type="button" class="btn annuler" data-action="annuler" data-garde-focus
        aria-label="Annuler le dernier numéro">↶<small></small></button>
    </form>
    <div id="j-pave"></div>
    <div class="historique" id="j-histo" aria-label="Numéros sortis dans l'ordre"></div>
    <div class="cartons-jeu" id="j-cartons"></div>`;
  if (matchMedia('(pointer: fine)').matches) $('#champ-numero').focus();
}

function rendreJeu() {
  if (!$('#champ-numero')) squeletteJeu();
  const s = db.soiree;
  const sortis = new Set(s.tirage);
  const dernier = s.tirage.at(-1);
  const cartons = mesCartons().map(c => ({ c, a: analyser(c, sortis, s.tour) }));
  if (db.prefs.tri) cartons.sort((x, y) => x.a.manque.length - y.a.manque.length);

  // Vocabulaire : une partie = 18 tours ; un tour = 3 sous-tours (quine, double quine, carton plein)
  const suivantTitre = s.tour < 3 ? 'Sous-tour fini' : s.partie < NB_PARTIES ? 'Tour fini' : 'Fin de partie';
  const suivantDetail = s.tour < 3 ? `→ ${TOURS[s.tour + 1]}` : s.partie < NB_PARTIES ? `→ Tour ${s.partie + 1}` : 'Terminer';
  const mesIds = new Set(mesCartons().map(c => c.id));
  const gagnes = new Set(s.victoires.filter(v => v.partie === s.partie && mesIds.has(v.cartonId)).map(v => v.tour));
  const joueur = estJoueur();
  const libelleMode = joueur ? 'à plusieurs · joueur' : estHote() ? 'à plusieurs · organisateur' : modeFictif() ? 'fictif' : 'réel';

  $('#j-statut').innerHTML = `
    <div class="infos">
      <div class="partie">Tour ${s.partie}<span>/${NB_PARTIES}</span></div>
      <div class="sous-titre">Sous-tour ${s.tour} sur 3 · ${libelleMode}</div>
    </div>
    ${joueur ? '' : `<button class="btn suivant" data-action="suivant">${suivantTitre}<small>${suivantDetail}</small></button>`}
    <div class="boule ${dernier ? '' : 'vide'} ${animerBoule ? 'roule' : ''}" aria-label="Dernier numéro">
      <span>${dernier ?? '?'}</span>
    </div>`;

  $('#j-etapes').innerHTML = [1, 2, 3].map(t => `
    <li class="${t < s.tour ? 'passe' : t === s.tour ? 'actuel' : ''} ${gagnes.has(t) ? 'gagne' : ''}">
      ${gagnes.has(t) ? '✓ ' : ''}${TOURS[t]}
    </li>`).join('');

  $('#j-multi').innerHTML = barreMulti();
  // Joueur invité : les numéros viennent de l'organisateur, pas de saisie ici
  $('#form-saisie').hidden = joueur;
  $('#j-pave').innerHTML = db.prefs.grille && !joueur ? paveHtml(sortis, dernier) : '';

  const h = $('#j-histo');
  h.innerHTML = `
    <span class="compte">${s.tirage.length} sorti${s.tirage.length > 1 ? 's' : ''}</span>
    ${s.tirage.map(n => `<span class="h-num">${n}</span>`).join('')}`;
  h.scrollLeft = h.scrollWidth;

  $('#j-cartons').innerHTML = `
    ${cartons.length ? cartons.map(({ c, a }) => carteJeuHtml(c, a, sortis, dernier)).join('')
      : joueur ? `<div class="vide-jeu"><p class="aide">En attente de tes cartons : ils arrivent dès que tu es connecté à l'organisateur.</p></div>`
      : `<div class="vide-jeu">
          <p class="aide">Aucun carton dans cette partie pour l'instant.</p>
          <button class="btn principal" data-action="gerer-cartons">Ajouter des cartons</button>
        </div>`}`;

  const boutonTirer = $('#form-saisie .tirer');
  boutonTirer.hidden = !modeFictif();
  boutonTirer.disabled = s.tirage.length >= 90;
  const annul = $('#form-saisie .annuler');
  annul.disabled = !dernier;
  annul.querySelector('small').textContent = dernier ?? '';
  majAffichage();
  animerBoule = false;
}

function paveHtml(sortis, dernier) {
  return `
    <div class="pave">
      ${Array.from({ length: 90 }, (_, i) => i + 1).map(n =>
        `<button class="n ${sortis.has(n) ? 'sorti' : ''} ${n === dernier ? 'dernier' : ''}" data-num="${n}">${n}</button>`).join('')}
    </div>`;
}

// Le retour (« 45 ✓ sur 2 cartons ») s'affiche dans le champ vide, à la place du texte d'aide
function majAffichage() {
  const el = $('#champ-numero');
  if (!el) return;
  el.placeholder = retour?.texte ?? 'Numéro annoncé';
  el.dataset.retour = retour?.type ?? '';
}

function signaler(texte, type) {
  retour = { texte, type };
  clearTimeout(retourMinuteur);
  retourMinuteur = setTimeout(() => { retour = null; majAffichage(); }, 2500);
  majAffichage();
  if (type === 'erreur') {
    navigator.vibrate?.([60, 40, 60]);
    const el = $('#champ-numero');
    el.classList.remove('secoue');
    void el.offsetWidth;
    el.classList.add('secoue');
  }
}

// 2 chiffres valident tout seuls ; 1 chiffre se valide avec OK ou Entrée
function surFrappe(el) {
  debloquerSon();
  el.value = el.value.replace(/\D/g, '').slice(0, 2);
  if (el.value.length === 2) validerChamp();
}

function validerChamp() {
  const el = $('#champ-numero');
  const v = el.value;
  el.value = '';
  if (!v) return;
  const n = Number(v);
  if (!(n >= 1 && n <= 90)) return signaler(`${v} ? Entre 1 et 90`, 'erreur');
  saisir(n);
}

// Tirage au sort : un numéro de 1 à 90 pas encore sorti (aucun doublon dans le tour)
function tirer() {
  const s = db.soiree;
  if (!s || !modeFictif()) return;
  const restants = Array.from({ length: 90 }, (_, i) => i + 1).filter(n => !s.tirage.includes(n));
  if (!restants.length) return signaler('Les 90 numéros sont sortis', 'neutre');
  const hasard = new Uint32Array(1);
  crypto.getRandomValues(hasard);
  const n = restants[hasard[0] % restants.length];
  annoncer(n);
  saisir(n);
}

// ---------- Son (annonce vocale + musique de victoire) : coupé par défaut ----------
const sonActif = () => db.prefs.son === true;

function majBoutonSon(visible) {
  const b = $('.bouton-son');
  b.hidden = !visible;
  b.textContent = sonActif() ? '🔊' : '🔇';
  b.setAttribute('aria-pressed', String(sonActif()));
  b.setAttribute('aria-label', sonActif() ? 'Couper le son' : 'Activer le son');
  b.classList.toggle('actif', sonActif());
}

function basculerSon(actif = !sonActif()) {
  db.prefs.son = actif;
  sauver();
  if (actif) {
    debloquerSon();
    parler('Son activé');
  } else if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  rendre();
  if ($('#champ-numero') && ecran === 'jeu') signaler(actif ? 'Son activé 🔊' : 'Son coupé 🔇', 'neutre');
}

// Annonce vocale du numéro tiré
function annoncer(n) {
  parler(`Le ${n}`);
}

// Synthèse vocale du téléphone, en français
function parler(texte) {
  if (!sonActif() || !('speechSynthesis' in window)) return;
  const phrase = new SpeechSynthesisUtterance(texte);
  phrase.lang = 'fr-FR';
  const voixFr = speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith('fr'));
  phrase.voice = voixFr.find(v => v.localService) ?? voixFr[0] ?? null;
  phrase.rate = 0.9;
  speechSynthesis.cancel(); // on coupe une annonce précédente encore en cours
  speechSynthesis.speak(phrase);
}
// Certains navigateurs chargent la liste des voix en différé
if ('speechSynthesis' in window) speechSynthesis.getVoices();

function carteJeuHtml(c, a, sortis, dernier) {
  const cases = c.grille.map((ligne, i) => ligne.map(n => {
    if (n == null) return '<span class="case vide"></span>';
    const cls = ['case'];
    if (sortis.has(n)) cls.push('coche');
    if (a.lignes[i].manque.length === 0) cls.push('ligne-ok');
    if (n === dernier) cls.push('dernier');
    return `<span class="${cls.join(' ')}">${n}</span>`;
  }).join('')).join('');

  let etat;
  if (a.gagne) etat = `<span class="ruban">${TOURS[db.soiree.tour]} !</span>`;
  else if (a.manque.length <= 6) etat = `Il manque <b>${a.manque.join(' · ')}</b>`;
  else etat = `Il manque ${a.manque.length} numéros`;

  // Sous-tours déjà gagnés par ce carton pendant ce tour
  const s = db.soiree;
  const palmares = s.victoires
    .filter(v => v.partie === s.partie && v.cartonId === c.id && v.tour < s.tour)
    .map(v => TOURS[v.tour]);

  const classe = a.gagne ? 'gagnant' : a.manque.length <= 2 ? 'presque' : '';
  return `
    <article class="carton-jeu ${classe}" data-carton="${c.id}">
      <header>
        <span class="nom">${echapper(c.nom)}</span><span class="etat">${etat}</span>
        ${estJoueur() ? '' : `<button class="retirer" data-action="supprimer" data-id="${c.id}" aria-label="Supprimer ce carton">✕</button>`}
      </header>
      ${palmares.length ? `<div class="palmares">★ Déjà gagné : ${palmares.join(' · ')}</div>` : ''}
      <div class="grille">${cases}</div>
    </article>`;
}

function saisir(n) {
  const s = db.soiree;
  debloquerSon();
  if (!s || estJoueur()) return;
  if (s.tirage.includes(n)) return signaler(`Le ${n} est déjà sorti`, 'neutre');
  s.tirage.push(n);
  const nouveaux = verifierVictoires();
  sauver();
  navigator.vibrate?.(15);

  const touches = mesCartons().filter(c => c.grille.flat().includes(n)).length;
  animerBoule = true;
  rendre();
  if (touches) signaler(`${n} ✓ sur ${touches} carton${touches > 1 ? 's' : ''}`, 'ok');
  else signaler(`${n} · aucun de tes cartons`, 'neutre');
  if (nouveaux.length) alerter(nouveaux);
}

function annuler() {
  const s = db.soiree;
  if (!s.tirage.length) return;
  const retire = s.tirage.pop();
  // Une victoire n'est plus valable si le numéro retiré la provoquait
  const sortis = new Set(s.tirage);
  s.victoires = s.victoires.filter(v => {
    if (v.partie !== s.partie || v.tour !== s.tour) return true;
    const c = carton(v.cartonId);
    return c && analyser(c, sortis, s.tour).gagne;
  });
  sauver();
  rendre();
  signaler(`${retire} retiré`, 'neutre');
}

function verifierVictoires() {
  const s = db.soiree;
  const sortis = new Set(s.tirage);
  const nouveaux = [];
  for (const c of s.cartons) {
    if (!analyser(c, sortis, s.tour).gagne) continue;
    if (s.victoires.some(v => v.partie === s.partie && v.tour === s.tour && v.cartonId === c.id)) continue;
    s.victoires.push({ partie: s.partie, tour: s.tour, cartonId: c.id, heure: new Date().toISOString() });
    nouveaux.push(c);
  }
  return nouveaux;
}

// F8 : fin d'un sous-tour (gagné par moi ou par quelqu'un d'autre).
// Les numéros sont conservés d'un sous-tour à l'autre, et remis à zéro au tour suivant.
function suivant(demander = true) {
  const s = db.soiree;
  if (s.tour < 3) {
    if (demander && !confirm(`Le sous-tour « ${TOURS[s.tour]} » est terminé ?\n\nOn passe à : ${TOURS[s.tour + 1]}.\nTes numéros sont conservés.`)) return;
    s.tour++;
  } else if (s.partie < NB_PARTIES) {
    if (demander && !confirm(`Le carton plein est terminé ?\n\nOn passe au tour ${s.partie + 1}.\nLes numéros seront remis à zéro.`)) return;
    s.partie++;
    s.tour = 1;
    s.tirage = [];
  } else {
    terminer();
    return;
  }
  retour = null;
  // Un carton peut déjà remplir l'objectif du nouveau sous-tour : on l'annonce tout de suite
  const nouveaux = verifierVictoires();
  sauver();
  rendre();
  if (nouveaux.length) alerter(nouveaux);
}

function terminer() {
  const question = estJoueur()
    ? 'Quitter la partie ?\n\nTu ne recevras plus les numéros, et tes cartons seront supprimés de ce téléphone.'
    : estHote()
      ? 'Terminer la partie ?\n\nLa partie s\'arrêtera aussi pour tous les joueurs.'
      : 'Terminer la partie ?\n\nLe tirage et les cartons de cette partie seront supprimés.';
  if (!confirm(question)) return;
  fermerOptions();
  if (estHote()) finirHote();
  if (estJoueur()) deconnecter();
  db.soiree = null;
  sauver();
  rendre();
}

// ---------- Options de la partie (bouton ⚙ en haut à droite) ----------
function ouvrirOptions() {
  panneauJoueurs = false;
  $('#options-titre').textContent = 'Options de la partie';
  $('#options-contenu').innerHTML = `
    <label class="choix"><input type="checkbox" id="pref-son" ${sonActif() ? 'checked' : ''}>
      <span>Son : annonce vocale des numéros tirés et musique de victoire</span></label>
    <label class="choix"><input type="checkbox" data-pref="tri" ${db.prefs.tri ? 'checked' : ''}>
      <span>Trier les cartons du plus proche au plus loin de la victoire</span></label>
    <label class="choix"><input type="checkbox" data-pref="grille" ${db.prefs.grille ? 'checked' : ''}>
      <span>Afficher aussi la grille 1–90</span></label>
    <div class="ligne-btn">
      ${estHote() ? '<button type="button" class="btn" data-action="joueurs">Joueurs et invitation</button>' : ''}
      <button type="button" class="btn" data-action="gerer-cartons">${estJoueur() ? 'Mes cartons' : 'Cartons de la partie'}</button>
      <button type="button" class="btn danger" data-action="terminer">${estJoueur() ? 'Quitter la partie' : 'Terminer la partie'}</button>
    </div>`;
  $('#options').showModal();
}

function fermerOptions() {
  if ($('#options').open) $('#options').close();
}

// Toucher le fond grisé autour du panneau le referme
$('#options').addEventListener('click', e => { if (e.target.id === 'options') fermerOptions(); });

// ---------- Alerte de victoire (F7) ----------
function alerter(cartons) {
  const s = db.soiree;
  const miens = cartons.filter(c => !c.joueur);
  const phrases = [];
  if (miens.length) {
    phrases.push((miens.length > 1 ? 'Tu gagnes avec les cartons ' : 'Tu gagnes avec le carton ')
      + miens.map(c => `« ${c.nom} »`).join(', ') + (estHote() ? ' !' : '. Annonce-le !'));
  }
  // Partie à plusieurs : cartons des invités
  for (const c of cartons.filter(c => c.joueur)) phrases.push(`${nomDuJoueur(c.joueur)} gagne avec « ${c.nom} ».`);
  afficherAlerte(TOURS[s.tour] + ' !', phrases.join(' '), true, true);
  if (miens.length) document.querySelector(`[data-carton="${miens[0].id}"]`)?.scrollIntoView({ block: 'nearest' });
}

// `peutPasser` : bouton « Passer à … » (l'organisateur ou le joueur seul, pas un invité)
function afficherAlerte(titre, texte, peutPasser, fete) {
  const s = db.soiree;
  $('#alerte-titre').textContent = titre;
  $('#alerte-texte').textContent = texte;
  $('#alerte-suivant').hidden = !peutPasser;
  $('#alerte-suivant').textContent = s.tour < 3 ? `Passer à : ${TOURS[s.tour + 1]}`
    : s.partie < NB_PARTIES ? `Passer au tour ${s.partie + 1}` : 'Terminer la partie';
  $('#alerte .secondaire').textContent = peutPasser ? 'Rester sur ce sous-tour' : 'OK';
  const d = $('#alerte');
  if (!d.open) d.showModal();
  if (fete) {
    navigator.vibrate?.([300, 100, 300, 100, 600]);
    bip();
  }
}

// Bouton « Passer à … » de l'alerte : on clôt le sous-tour sans redemander
$('#alerte').addEventListener('close', () => {
  const d = $('#alerte');
  if (d.returnValue === 'suivant') suivant(false);
  d.returnValue = '';
});

let audio = null;
function debloquerSon() {
  try {
    audio ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {}
}

function bip() {
  if (!audio || !sonActif()) return;
  const t0 = audio.currentTime;
  [880, 1175, 1568, 1568].forEach((f, i) => {
    const t = t0 + i * 0.18;
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = 'square';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.17);
  });
}

// ---------- Écran maintenu allumé pendant la partie ----------
let verrou = null;
let veilleVoulue = false;
let demandeEnCours = false;

async function gererVeille(actif) {
  veilleVoulue = actif;
  if (!('wakeLock' in navigator) || demandeEnCours) return;
  try {
    if (actif && !verrou && document.visibilityState === 'visible') {
      demandeEnCours = true;
      verrou = await navigator.wakeLock.request('screen');
      verrou.addEventListener('release', () => { verrou = null; });
    } else if (!actif && verrou) {
      await verrou.release();
      verrou = null;
    }
  } catch {} finally {
    demandeEnCours = false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') gererVeille(veilleVoulue);
});

// ---------- Écran : cartons de la partie (F2) ----------
// `douteux` : numéros lus par le scan qu'il faut vérifier (surlignés en orange)
function grilleHtml(c, douteux = []) {
  return c.grille.flat().map(n => n == null
    ? '<span class="case vide"></span>'
    : `<span class="case ${douteux.includes(n) ? 'douteux' : ''}">${n}</span>`).join('');
}

function rendreCartons() {
  const el = $('#ecran-cartons');
  const s = db.soiree;
  if (!s) {
    el.innerHTML = `
      <div class="panneau">
        <h2>Cartons</h2>
        <p class="aide">Les cartons appartiennent à une partie. Démarre une partie pour en générer ou ajouter les tiens.</p>
        <button class="btn principal large" data-nav="jeu">Nouvelle partie</button>
      </div>`;
    return;
  }
  el.innerHTML = `
    <div class="panneau">
      <div class="entete">
        <h2>${estJoueur() ? 'Mes cartons' : 'Cartons de la partie'} (${mesCartons().length})</h2>
      </div>
      ${estJoueur() ? '<p class="aide">Tes cartons ont été générés par l\'organisateur de la partie.</p>'
      : modeFictif() ? `<div class="generer">
        <label class="champ">Générer des cartons
          <input id="nb-generer" type="number" inputmode="numeric" min="1" max="${NB_MAX_GENERES}" value="1">
        </label>
        <button class="btn principal" data-action="generer">Générer</button>
      </div>` : `<div class="ligne-btn">
        <button class="btn principal" data-action="nouveau-carton">+ Saisir un carton</button>
        <button class="btn" data-action="scanner">Importer des photos</button>
      </div>`}
      ${mesCartons().length ? '' : '<p class="aide">Aucun carton dans cette partie.</p>'}
      <div class="liste-cartons">
        ${mesCartons().map(c => `
          <article class="carton-fiche">
            <header>
              <strong>${echapper(c.nom)}</strong>
              ${c.serie ? `<span class="badge serie">Série ${numeroSerie(c)}</span>` : ''}
            </header>
            <div class="grille">${grilleHtml(c)}</div>
            <div class="ligne-btn">
              ${modeFictif() ? '' : `<button class="btn" data-action="modifier" data-id="${c.id}">Modifier</button>`}
              ${estJoueur() ? '' : `<button class="btn danger" data-action="supprimer" data-id="${c.id}">Supprimer</button>`}
            </div>
          </article>`).join('')}
      </div>
    </div>`;
}

// Génère des cartons supplémentaires dans la partie en cours
function generer() {
  const n = borner($('#nb-generer')?.value);
  if (!n || !modeFictif()) return;
  genererCartons(n);
  // Les numéros déjà sortis peuvent suffire à faire gagner un carton tout neuf
  const nouveaux = verifierVictoires();
  sauver();
  rendre();
  if (nouveaux.length) alerter(nouveaux);
}

// Supprime un carton de la partie (depuis le jeu, la liste ou l'écran de modification)
function supprimer(id) {
  const s = db.soiree;
  const c = carton(id);
  if (!c || !confirm(`Supprimer « ${c.nom} » de la partie ?`)) return;
  s.cartons = s.cartons.filter(x => x.id !== id);
  s.victoires = s.victoires.filter(v => v.cartonId !== id);
  sauver();
  if (ecran === 'edition') {
    edition = null;
    aller('cartons');
  } else {
    rendre();
  }
}

// ---------- Écran : saisie / modification d'un carton ----------
function ouvrirEdition(id) {
  const c = id ? carton(id) : null;
  edition = {
    id: c?.id ?? null,
    nom: c?.nom ?? nomSuivant(db.soiree.cartons),
    lignes: c ? c.grille.map(l => l.filter(n => n != null).join(' ')) : ['', '', ''],
    retour: ecran === 'edition' || ecran === 'scan' ? 'cartons' : ecran,
  };
  aller('edition');
}

// Place les numéros saisis dans la grille 3 × 9 et contrôle le format
function analyserSaisie(lignes) {
  const vus = new Set();
  const grille = [];
  const erreurs = lignes.map(txt => {
    const ligne = Array(9).fill(null);
    const errs = [];
    for (const n of (txt.match(/\d+/g) || []).map(Number)) {
      if (n < 1 || n > 90) { errs.push(`${n} n'est pas entre 1 et 90`); continue; }
      if (vus.has(n)) { errs.push(`${n} est en double`); continue; }
      const col = colonneDe(n);
      if (ligne[col] != null) { errs.push(`${ligne[col]} et ${n} sont dans la même colonne`); continue; }
      ligne[col] = n;
      vus.add(n);
    }
    const nb = ligne.filter(n => n != null).length;
    if (nb !== 5) errs.push(`${nb}/5 numéros`);
    grille.push(ligne);
    return errs;
  });
  return { grille, erreurs, valide: erreurs.every(e => !e.length) };
}

function rendreEdition() {
  $('#ecran-edition').innerHTML = `
    <div class="panneau">
      <h2>${edition.id ? 'Modifier le carton' : 'Nouveau carton'}</h2>
      <label class="champ">Nom
        <input id="nom-carton" type="text" maxlength="40" value="${echapper(edition.nom)}">
      </label>
      ${edition.photo ? `
        <figure class="photo-scan">
          <img src="${edition.photo}" alt="Grille lue sur la photo">
          <figcaption>${edition.bilan}</figcaption>
        </figure>` : `
        <button class="btn scanner" data-action="choisir-photo">Remplir depuis une photo importée</button>`}
      <p class="aide">Tape les 5 numéros de chaque ligne, séparés par un espace, une virgule ou un point.
        Ils se placent tout seuls dans la bonne colonne.</p>
      ${edition.lignes.map((txt, i) => `
        <label class="champ">Ligne ${i + 1}
          <input data-ligne="${i}" type="text" inputmode="decimal" autocomplete="off"
            placeholder="ex. 4 17 35 62 88" value="${echapper(txt)}">
          <span class="erreur" id="err-${i}"></span>
        </label>`).join('')}
      <div class="grille apercu" id="apercu"></div>
      <div class="ligne-btn">
        <button class="btn" data-action="annuler-edition">Annuler</button>
        <button class="btn principal" data-action="enregistrer" id="btn-enregistrer">Enregistrer</button>
        ${edition.id ? `<button class="btn danger pousse" data-action="supprimer" data-id="${edition.id}">Supprimer</button>` : ''}
      </div>
    </div>`;
  majApercu();
}

function majApercu() {
  const r = analyserSaisie(edition.lignes);
  $('#apercu').innerHTML = grilleHtml({ grille: r.grille }, edition.douteux);
  r.erreurs.forEach((errs, i) => {
    // On n'affiche pas d'erreur sur une ligne encore vide
    $('#err-' + i).textContent = edition.lignes[i].trim() ? errs.join(' · ') : '';
  });
  $('#btn-enregistrer').disabled = !r.valide;
}

function enregistrer() {
  const r = analyserSaisie(edition.lignes);
  if (!r.valide) return;
  const nom = edition.nom.trim() || 'Carton';
  if (edition.id) {
    const c = carton(edition.id);
    // Numéros modifiés à la main : le carton ne fait plus partie de sa série
    if (JSON.stringify(c.grille) !== JSON.stringify(r.grille)) delete c.serie;
    Object.assign(c, { nom, grille: r.grille });
  }
  else db.soiree.cartons.push({ id: nouvelId(), nom, grille: r.grille });
  // Le carton ajouté ou modifié peut déjà gagner avec les numéros sortis
  const nouveaux = verifierVictoires();
  sauver();
  const retour = edition.retour;
  edition = null;
  aller(retour);
  if (nouveaux.length) alerter(nouveaux);
  photoSuivante();
}

// ---------- Événements ----------
const actions = {
  'demarrer': demarrer,
  'mode': mode => { modeDepart = mode; rendre(); },
  'nouveau-carton': () => ouvrirEdition(null),
  'scanner': () => { ouvrirEdition(null); choisirPhoto(); },
  'choisir-photo': () => choisirPhoto(),
  'annuler-scan': () => { scan = null; if (!photoSuivante()) aller('edition'); },
  'lire-scan': () => lireScan(),
  'modifier': id => ouvrirEdition(id),
  'supprimer': supprimer,
  'generer': generer,
  'gerer-cartons': () => { fermerOptions(); aller('cartons'); },
  'options': ouvrirOptions,
  'joueurs': () => ouvrirJoueurs(),
  'partager': () => partager(),
  'rejoindre': () => rejoindre(),
  'son': () => basculerSon(),
  'enregistrer': enregistrer,
  'annuler-edition': () => { arreterImport(); const r = edition.retour; edition = null; aller(r); },
  'annuler': annuler,
  'tirer': tirer,
  'suivant': suivant,
  'terminer': terminer,
};

document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.num) return saisir(Number(b.dataset.num));
  if (b.dataset.nav) return aller(b.dataset.nav);
  actions[b.dataset.action]?.(b.dataset.id);
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'multi-depart') {
    multiDepart = t.checked;
    if (!multiDepart && !nbAGenerer) nbAGenerer = 6;
    rendre();
  } else if (t.id === 'pref-son') {
    basculerSon(t.checked);
  } else if (t.id === 'partie-depart') {
    partieDepart = Number(t.value);
  } else if (t.dataset.pref) {
    db.prefs[t.dataset.pref] = t.checked;
    sauver();
    rendre();
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.ligne) {
    edition.lignes[Number(t.dataset.ligne)] = t.value;
    majApercu();
  } else if (t.id === 'champ-numero') {
    surFrappe(t);
  } else if (t.id === 'nom-carton') {
    edition.nom = t.value;
  } else if (t.id === 'nb-depart') {
    nbAGenerer = borner(t.value);
    $('#btn-demarrer').textContent = libelleDemarrer();
    $('#btn-demarrer').disabled = !nbAGenerer && !multiDepart;
  } else if (t.id === 'code-rejoindre') {
    t.value = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    codeRejoindre = t.value;
  } else if (t.id === 'nom-rejoindre') {
    nomRejoindre = t.value;
  } else if (t.id === 'nb-rejoindre') {
    nbRejoindre = t.value;
  }
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'form-saisie') return;
  e.preventDefault();
  validerChamp();
});

// OK et ↶ ne doivent pas retirer le focus du champ : le clavier du téléphone reste ouvert
document.addEventListener('mousedown', e => {
  if (e.target.closest('[data-garde-focus]') && document.activeElement?.id === 'champ-numero') e.preventDefault();
});

// PC : un chiffre tapé n'importe où sur l'écran de jeu part dans la zone de saisie
document.addEventListener('keydown', e => {
  if (!db.soiree || estJoueur() || ecran !== 'jeu' || $('#alerte').open || $('#options').open) return;
  if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const champ = $('#champ-numero');
  if (!champ || !/^[0-9]$/.test(e.key)) return;
  e.preventDefault();
  champ.focus();
  champ.value += e.key;
  surFrappe(champ);
});

// ---------- Démarrage ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js');
}
navigator.storage?.persist?.();
// Premier affichage une fois tous les scripts chargés (scan.js, multi.js)
window.addEventListener('DOMContentLoaded', rendre);
