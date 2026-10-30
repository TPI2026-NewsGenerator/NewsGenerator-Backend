# Démo NewsGenerator : le parcours d'une nouvelle

Une page locale pour montrer ce que NewsGenerator fait d'une nouvelle :
1. Tu écris un profil, puis tu cliques sur **Générer profil**. L'IA le découpe en intérêts et note ce que le lecteur refuse.
2. Tu colles des nouvelles. La page montre chaque étape d'un briefing et ce qu'elle a pris en compte :
   - la lecture ;
   - les vecteurs bge-m3, dense et creux ;
   - le regroupement en histoires ;
   - le classement ;
   - le choix de l'IA ;
   - les passages et la relecture ;
   - les cartes finales.

La démo n'utilise pas la base de données et n'enregistre rien.

## Ce qu'il faut

- Le portable Windows, avec `server/.env`. La démo y prend la clé d'Ollama et la liste des embedders.
- Internet, pour l'IA (gemma4:31b sur Ollama cloud) et pour lire les pages.
- Un embedder bge-m3 qui répond. Ce sera celui de l'Ubuntu à la maison, et celui du portable ailleurs (voir plus bas).

## À la maison

Sur le portable Windows, dans PowerShell, depuis `server/` :

```powershell
node --env-file=.env bench/demo/demo-server.mjs
```

Puis ouvre http://localhost:4000 dans le navigateur.

La démo demande les embedders de `EMBEDDER_URL` dans l'ordre, puis celui du portable (`http://127.0.0.1:8020`) en dernier.

## Ailleurs (chez un ami, sur un autre réseau)

L'Ubuntu et le PC gamer ne sont pas joignables depuis un autre réseau. C'est donc l'embedder du portable qui travaille.

**1. Démarrer l'embedder du portable.** Dans un premier PowerShell, depuis `server/` :

```powershell
$env:HF_HUB_OFFLINE='1'; python embedder/server.py
```

Attends le message `Embedder listening on http://127.0.0.1:8020`, environ 45 s.

- `HF_HUB_OFFLINE=1` est indispensable. Sans lui, l'embedder cherche à contacter Hugging Face et n'avait pas démarré au bout de 4 minutes.
- Le modèle est déjà sur le portable, dans le cache Hugging Face.
- Sur le processeur du portable, il traite environ 2 textes par seconde : 8 nouvelles prennent environ 8 s.

**2. Démarrer la démo.** Dans un deuxième PowerShell, depuis `server/` :

```powershell
$env:EMBEDDER_URL='http://127.0.0.1:8020'; node --env-file=.env bench/demo/demo-server.mjs
```

La variable `EMBEDDER_URL` du terminal l'emporte sur celle de `.env`. La démo ne perd donc pas de temps à chercher les embedders de la maison.

**3. Ouvrir la page.** Ouvre http://localhost:4000.

En haut de la page, des voyants indiquent :
- quel embedder répond ;
- si l'IA est disponible ;
- si le vocabulaire de bge-m3 est trouvé, ce qui permet d'afficher les mots du vecteur creux au lieu de leurs numéros.

Pour arrêter, fais `Ctrl+C` dans chacun des deux terminaux.

## Coller des nouvelles

- **Une adresse par ligne.** La page est téléchargée et son article extrait (Readability), comme le briefing lit une page.
- **Un texte.** Sa première ligne est son titre, le reste est son article. Sépare deux textes par une ligne `---`. C'est utile pour un site qui refuse la lecture (erreur 403) ou un article derrière un mur payant.
- On peut mélanger adresses et textes, jusqu'à 30 nouvelles.

Exemple :

```
https://www.un-media.ch/sport/football/un-article
https://www.autre-media.fr/espace/un-autre-article
---
Le télescope Roman franchit une étape
La NASA a terminé l'assemblage du télescope spatial Roman, qui doit observer des milliers d'exoplanètes…
```

Pour une démo parlante, mélange plusieurs types de nouvelles :
- des nouvelles dans le profil ;
- une nouvelle sur ce que le lecteur refuse ;
- deux médias qui racontent le même fait, qui seront regroupés ;
- une nouvelle hors sujet.

## Ce que la démo ne fait pas

- **Le volume.** Un vrai briefing classe des dizaines de milliers de nouvelles et donne à l'IA les 40 plus proches. Ici, toutes les nouvelles collées vont à l'IA. Le trait rouge du classement est un repère, pas une règle : 0,555, le score de la 150e histoire d'un lecteur à 3 intérêts, le 7 octobre.
- **Les autres médias.** Seules les nouvelles collées peuvent se regrouper. Pour la même raison, il n'y a ni corroboration (qui a écrit l'article lui-même), ni démentis.
- **Le contrôle par l'IA.** La vérification des articles de chaque histoire et la fusion de deux histoires du même fait ne sont pas faites.
- **Les sources et les votes.** La démo ne cherche pas de sources (découverte, Google News) et ne tient pas compte des votes du lecteur.

## Si quelque chose ne marche pas

| Problème | Que faire |
|---|---|
| Voyant `bge-m3 ✗` partout | L'embedder n'est pas démarré (étape 1), ou pas encore prêt : attends `Embedder listening`. |
| Voyant `IA ✗ (clé manquante)` | Lance la démo depuis `server/` avec `--env-file=.env`. |
| Une page « non lue (HTTP 403) » | Le site refuse la lecture : colle son texte à la place. |
| Une page « trop court » | Moins de 60 mots lus (chapeau, mur payant) : pas de passages possibles. |
| `EADDRINUSE` au démarrage | La démo tourne déjà : ferme l'autre terminal, ou change de port avec `$env:DEMO_PORT='4001'`. |

## Fichiers

- `demo-server.mjs` : le serveur local, sur `127.0.0.1` uniquement. Il reprend les fonctions du briefing (`services/utils/…`) avec les mêmes seuils.
- `demo.html` : la page.
