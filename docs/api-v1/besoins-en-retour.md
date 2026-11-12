# Ce dont NewsGenerator a besoin en retour de FootballIQ

*Pour Anass. Brouillon à relire avant envoi : les routes décrites en haut existent déjà ; la partie « retour » est une proposition, rien n'est construit
de notre côté tant que tu ne nous as pas dit ce que ton système peut donner.*

## 1. Ce que tu reçois maintenant

Notre système fait une **première sélection**, rapide et peu chère. Le tien, plus précis mais plus lent, **rejuge** ce que nous avons retenu. Deux routes de
plus sur `/api/v1`, avec ta clé habituelle (`Authorization: Bearer ...`), en lecture seule, sans appel d'IA de notre côté :

| Route | Ce qu'elle liste | Un item, c'est | Volume mesuré le 12.11.2026 |
|---|---|---|---|
| `GET /api/v1/fifa/news` | les news retenues pour la carte « The FIFA presidency » | un **passage** : la phrase d'une news qui parle d'une association et d'un candidat, avec notre lecture (pour/contre, déclaré/probable, qui parle, citation) | 788 passages sur 30 jours (512 news, 24 associations, 2 candidats), soit **~26 par jour** ; 278 « établis » et 510 « incertains » |
| `GET /api/v1/briefing/news` | les news choisies dans les briefings de **tous** les lecteurs | une **histoire** (une carte) : ses articles (20 au plus, 6 en moyenne), les phrases clés de l'article principal, notre lecture (nombre de médias, textes indépendants, démentis, mots de prudence) | 294 histoires sur 7 jours, soit **~42 par jour** (1 460 depuis le 24.09) |

Les deux se suivent comme `/v1/news` : `cursor` / `next_cursor`, `limit`, `order=asc`. Un passage FIFA dont notre lecture change après coup (second modèle,
règle corrigée) **revient avec le même `id`** et un `updated_at` plus récent : remplace ce que tu avais. Chaque histoire de briefing n'est donnée **qu'une fois**
(pas une fois par lecteur) ; `readers` dit combien de lecteurs l'ont dans leur briefing. Rien d'un lecteur ne sort : ni profil, ni intérêts, ni pouces. La
référence complète est dans `docs/api-v1/README.md`.

À retenir : **les briefings ne sont pas que du football**. Sur 1 460 histoires, 89 % ont le sujet « sport » (autres sports compris : rugby, basket...), le reste est
de la technologie, de la culture, de la politique. La route accepte `topic=sport` ; nous n'avons pas d'étiquette « football » (voir la question 3).

## 2. Ce qu'on fera de ton retour

- **Carte FIFA.** Ton verdict pèse sur la position affichée : un passage que tu ne confirmes pas ne colore plus la carte, un démenti ou un renversement
  que tu as vu (et nous pas) la corrige. Nos erreurs de couleur restent trop fréquentes : tes retours servent aussi
  à **mesurer** ces erreurs en continu, à la place d'un audit hebdomadaire sur 30 passages.
- **Briefings.** Une pastille sur la carte et dans l'e-mail (« confirmé / rumeur / démenti par FootballIQ »), une carte démentie qui descend ou disparaît, et
  la comparaison de **nos** détecteurs (« non confirmé », démenti, médias indépendants) à tes verdicts pour les régler.
- **Les deux.** Nous mesurons l'accord entre toi et nous, et nous resserrons notre première sélection pour t'envoyer moins de bruit.

## 3. Ce qu'on te demande de nous rendre

Une réponse **par `id`** (passage FIFA ou histoire de briefing). Les champs marqués ★ sont ceux sans lesquels le retour ne nous sert pas ; le reste est un bonus,
dis-nous ce que ton système sait déjà sortir sans travail en plus. Prends **tes mots** pour les statuts (`CONFIRME`, `RUMEUR`, `DEMENTI`, `INCONNU`), nous les
reprendrons tels quels.

**Pour tout item**
- ★ `kind` (`fifa_passage` / `briefing_story`), `id` et `status` : `done`, ou `skipped` avec une `reason` (`hors domaine`, `langue non gérée`, `page illisible`...).
  Un item que tu ne traites pas doit nous revenir en `skipped`, pas disparaître. Un item pas encore traité, tu ne nous le renvoies simplement pas.
- ★ `processed_at` : quand tu l'as jugé. Un retour plus récent pour le même `kind` + `id` **remplace** l'ancien.
- ★ `claim_status` (`CONFIRME` / `RUMEUR` / `DEMENTI` / `INCONNU`) et `confidence` (0 à 1) : sur l'affirmation jugée (pour un passage, la position ; pour une histoire,
  son affirmation principale).
- **L'origine** : la première source que tu connais (`origin`: URL et date) et le nombre de sources **indépendantes** (`independent_sources`, pas des reprises d'agence).
- Les **conflits** (`conflicts`) : propos contraires, démentis, renversements ultérieurs, avec leur URL, leur statut et leur date.
- Un bonus : la version de ton extracteur (`model`) et un identifiant chez toi pour retrouver la fiche (`ref`).

**En plus, pour un passage FIFA** (la phrase dit-elle ce que nous avons lu ?)
- ★ `about_association` : la phrase parle-t-elle bien de **cette** association ? (oui / non). Si non, la position ne compte pas.
- ★ `position` : ce que la phrase exprime, telle que tu la lis (que tu sois d'accord avec nous ou non) : `stance` (pour / contre / indécis / aucune), `toward` (le candidat,
  un autre, personne ; si c'est un autre, lequel, avec son QID dans `target`) et `level` (`declared` : dit clairement au nom de l'association ; `probable` : cela se
  déduit). C'est cette position que nous comparons à la nôtre passage par passage, et qui corrige la carte.
- ★ `claimant` : **qui parle** (la personne, son QID Wikidata si tu l'as, son rôle) et s'il **engage** l'association (président, exécutif, communiqué) ou non. C'est notre
  erreur la plus coûteuse aujourd'hui.
- Le **temps** (`temporality`) : la position est-elle présente, passée, ou conditionnelle (« pourrait »).

**En plus, pour une histoire de briefing**
- ★ `claim` : l'**affirmation principale** que tu as jugée, en une phrase (pour que nous affichions ce que tu as vérifié). `independent_sources` y est ★ : à comparer à notre
  `reading.corroboration.independent`.
- `claims` : la liste de ses affirmations (type, sujet, objet, valeur, statut), si ton extracteur la donne.
- `title_held` : le texte tient-il le titre ? (titre plus fort que l'article)
- `same_claim_as` : d'autres histoires (leurs `id`) qui portent la même affirmation. Nos regroupements se trompent parfois ; c'est une mesure précieuse.

## 4. Nos questions

1. **Cadence.** Combien d'items par jour ton système peut-il traiter ? Nous en envoyons ~70 par jour en tout. Sous quel délai peux-tu répondre (heures, jour) ?
   Nous afficherons les cartes tout de suite, « en cours de vérification », et mettrons à jour quand ton retour arrive.
2. **Granularité.** Pour une histoire de briefing, juges-tu **chaque article** ou **l'histoire** ? Nous donnons l'URL de chaque article (20 au plus) et les phrases
   clés de l'article principal, mais pas le texte entier : le récupères-tu toi-même à partir de l'URL, ou veux-tu que nous t'envoyions le texte ?
3. **Hors football.** Ton extracteur est football seulement (23 types d'affirmations). Dans les briefings, 89 % des histoires sont du sport, mais pas toutes du football.
   Préfères-tu recevoir `topic=sport` et nous renvoyer un `skipped` / `hors domaine` pour le reste, ou que nous cherchions un filtre football de notre côté ?
4. **Langues.** Lesquelles sont gérées ? Nous avons surtout de l'anglais, du français, de l'espagnol, de l'italien, du portugais, du grec.
5. **Tes statuts.** `DEMENTI` n'était pas produit la dernière fois que nous en avons parlé : est-ce changé ? Sinon, comment signales-tu un démenti ?
6. **Identifiants.** Peux-tu garder l'`id` que nous t'envoyons (passage ou histoire) et le renvoyer tel quel ? Et nous donner le QID Wikidata des personnes et
   associations de tes verdicts (nous les avons déjà pour les 211 associations) ?
7. **Sens du transport.** Nous proposons que **tu envoies** tes verdicts à une route de chez nous (voir ci-dessous), parce que tu as déjà la clé et que nous n'avons
   rien à interroger chez toi. Si tu préfères que nous allions les chercher chez toi, dis-nous quelle route.

## 5. Proposition de transport (à valider)

`POST /api/v1/verdicts`, avec ta clé, jusqu'à 100 verdicts par appel, **idempotent** (même `kind` + `id` : le `processed_at` le plus récent est gardé). Nous
répondons `{accepted, rejected: [{index, id, reason}]}` : ce qui a été pris et ce qui est refusé (champ inconnu, `id` inexistant, retour plus ancien que celui déjà
gardé). Exemple :

```json
{
  "verdicts": [
    {
      "kind": "fifa_passage", "id": 4127, "status": "done", "processed_at": "2026-11-12T21:29:40Z",
      "claim_status": "CONFIRME", "confidence": 0.86, "independent_sources": 2,
      "about_association": true,
      "position": {"stance": "against", "toward": "candidate", "level": "declared"},
      "claimant": {"qid": "Q000000", "name": "A. President", "role": "president", "binds_association": true},
      "temporality": "present",
      "origin": {"url": "https://example.org/first", "first_seen": "2026-11-04T09:12:00Z"},
      "conflicts": [{"url": "https://example.org/denial", "claim_status": "DEMENTI", "date": "2026-11-06"}],
      "model": "footballiq-extractor-x", "ref": "claim-98123"
    },
    {
      "kind": "briefing_story", "id": 23684, "status": "done", "processed_at": "2026-11-12T21:31:10Z",
      "claim": "Le club a signé le joueur pour 40 millions", "claim_status": "RUMEUR", "confidence": 0.7, "independent_sources": 1,
      "title_held": false, "same_claim_as": [23701]
    },
    {"kind": "briefing_story", "id": 23690, "status": "skipped", "reason": "hors domaine", "processed_at": "2026-11-12T21:31:12Z"}
  ]
}
```

Dis-nous ce qui te manque, ce qui est facile et ce qui est coûteux : nous n'écrirons la route qu'une fois la forme décidée avec toi.
