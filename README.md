# Loto

Application web pour jouer au loto (format français : cartons de 3 lignes × 9 colonnes,
15 numéros, parties de 18 tours en quine, double quine et carton plein).
Elle fonctionne sans base de données : tout est enregistré sur l'appareil.

## Deux modes de partie

- **Mode réel** — en salle : tu saisis tes cartons (à la main ou en important une photo)
  et tu tapes les numéros annoncés. L'appli coche tes cartons et te prévient quand tu gagnes.
- **Mode fictif** — sans salle : l'appli génère les cartons (par séries de 6 qui contiennent
  chacun des 90 numéros une seule fois) et tire les numéros au sort, avec annonce vocale.
  Il peut se jouer **à plusieurs, chacun sur son téléphone** : un organisateur crée la partie
  et partage un code ; les téléphones se connectent directement entre eux (WebRTC via PeerJS).

## Lancer l'appli sur un PC

Il faut [Node.js](https://nodejs.org). Double-cliquer sur `Lancer Loto.bat`
(ou `node serveur.js`) : l'appli s'ouvre sur `http://localhost:8080/`, et l'adresse à
utiliser depuis un téléphone du même Wi-Fi s'affiche dans la fenêtre.

> Ouvrir `index.html` directement (double-clic) ne suffit pas : le navigateur bloque alors
> la lecture des photos.

## Publier sur un serveur

L'appli est un ensemble de fichiers statiques à servir **en HTTPS** (indispensable pour
l'installation sur téléphone et le fonctionnement hors ligne).

- `deploiement/loto.nginx.conf` : site Nginx prêt à l'emploi (remplacer `DOMAINE`).
- `deploiement/publier.sh utilisateur@serveur` : envoie l'appli dans `/var/www/loto`.

À chaque mise à jour, changer la version du cache dans `sw.js` (`loto-vNN`) pour que les
téléphones où l'appli est installée la reçoivent.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html`, `styles.css` | Page et apparence |
| `app.js` | Parties, cartons, saisie, tirage, victoires, son |
| `scan.js` | Lecture d'un carton à partir d'une photo (Tesseract.js) |
| `multi.js` | Partie à plusieurs (PeerJS) |
| `sw.js`, `manifest.webmanifest` | Appli installable et hors ligne |
| `vendor/` | Bibliothèques embarquées : Tesseract.js, PeerJS (licences incluses) |
| `fonts/` | Polices Alfa Slab One et Atkinson Hyperlegible |
