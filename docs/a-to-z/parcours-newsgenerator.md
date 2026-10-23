NewsGenerator · schéma du processus

# De la création du compte à la lecture d'une nouvelle

Deux chaînes tournent en parallèle. Le serveur lit, comprend et regroupe toutes les nouvelles en continu, sans attendre personne. Le lecteur, lui, s'inscrit une fois, puis demande un briefing : l'application cherche alors dans ce qui est déjà prêt, et l'IA n'intervient que sur les quelques nouvelles qui seront montrées.

Mesuré le **17 octobre 2026** sur le serveur Ubuntu · Lecteur d'exemple : **Profil foot** (arbitrage, UEFA, lit en anglais) · Scripts : **server/bench/funnel-now.mjs**, **news-journey.mjs** · Texte mis à jour le **17 octobre 2026**

Le fonctionnement décrit est celui du 17 octobre 2026. Les chiffres viennent de la mesure du 17 octobre entre 15 h 15 et 15 h 50, sauf quand une autre date est donnée. Les étapes du briefing après la vérification (lecture, passages, angles, analyse, durées, jetons) viennent du briefing complet du profil foot écrit à 15 h 21, celui que suit « Parcours d'une nouvelle » : 107 545 nouvelles dans ses sources à ce moment, contre 106 673 une demi-heure plus tard pour l'entonnoir rejoué.

## Vue d'ensemble : deux chaînes qui se rejoignent au briefing

En haut, le travail de fond du serveur, toutes les minutes. En bas, ce que fait le lecteur. La découverte ajoute ses sources à la lecture du serveur ; le briefing et la recherche puisent dans les histoires déjà prêtes.

- **EN CONTINU** (serveur Ubuntu, chaque minute) : Sources (RSS, Google News, RSS-Bridge ; 2 488 flux) → Lecture (chaque flux à son rythme (2 à 60 min) ; 136 023 / 24 h) → Vecteurs (bge-m3, dense + creux (mots) ; 126 122) → Histoires (un même fait, plusieurs médias ; 71 214) → Fils d'affaires (une affaire suivie sur plusieurs jours ; 63 226)
- **LE LECTEUR** (à son rythme, 1 à 2 fois par jour) : Inscription (compte, une langue, questions de l'IA ; ≈ 5 s) → Intérêts (l'IA découpe le texte en intérêts + vecteurs ; 3 intérêts) → Découverte (Google News d'abord, puis la presse ; 36 flux + 24 req.) → Briefing (6 étapes + analyse, 10 à 30 cartes sur 1 à 7 jours ; 43 931 → 10 cartes) → Lecture (passages clés, médias, fil de l'affaire, vote ; ≈ 6 médias / carte) ; à côté : Recherche par phrase
- Base PostgreSQL + pgvector, 30 jours gardés : 691 147 nouvelles
- ses flux rejoignent la lecture
- histoires de 24 h à 7 jours

- travail du serveur, sans lecteur
- déclenché par le lecteur
- les votes reviennent au briefing suivant

## L'entonnoir : combien de nouvelles restent à chaque étape

Échelle logarithmique : chaque graduation multiplie par dix. Une barre deux fois plus courte veut dire beaucoup moins que la moitié. En rouge, ce qui a été retiré et pourquoi.

### Travail de fond (toutes les sources · 24 h)

| Étape | Nombre | Retiré, pourquoi |
|---|---|---|
| Flux suivis | 4 391 | 3 089 ont publié dans les 24 h |
| Nouvelles enregistrées | 118 598 | Les liens déjà connus et les nouvelles redonnées sous un autre lien ne sont pas comptés ; une lecture sur quatre ne renvoie rien de neuf |
| Avec vecteurs | 115 681 | −2 917 encore en file d’attente au moment de la mesure (embedder sur processeur) : 1 618 de la fenêtre de 48 h, les autres plus anciennes, encodées après |
| Placées dans une histoire | 115 544 | −137 publiées il y a plus de 48 h : vecteurs pour la recherche seulement |
| Histoires | 63 985 | les nouvelles d’un même fait regroupées (1,8 par histoire) |
| Histoires de 2 médias ou plus | 11 230 | 45 851 histoires restent d’une seule nouvelle |

### Briefing du profil foot (ses 1 150 flux · 48 h · toutes langues)

| Étape | Nombre | Retiré, pourquoi |
|---|---|---|
| Nouvelles dans ses sources | 106 673 | 38 langues, dont 32 496 en anglais : aucune n’est écartée pour sa langue |
| Histoires | 67 500 | une note par histoire, la meilleure de ses nouvelles |
| Gardées par le SQL | 600 | −66 900 moins proches de ses intérêts (note sous 0,524) |
| Partagées entre ses intérêts | 150 | −450 75 par intérêt, ses meilleures d’abord |
| Crédibles | 147 | −3 pages répétées ou connues seulement par Google sans média établi |
| Pas encore envoyées | 118 | −29 déjà dans une carte envoyée par e-mail dans les 48 h, ou de son fil ; 8 autres gardées comme suites |
| Candidates pour l’IA | 47 | −71 au-delà des 40 premières venues de flux (+7 connues par Google News) |
| Choisies par l’IA | 12 | −35 hors du profil, dossiers, guides, pronostics, doublons |
| Après équilibre des intérêts | 10 | −2 gardées en réserve, pour remplacer une carte illisible |
| Cartes après vérification | 10 | aucune fusion ; 48 articles vérifiés avec la réserve, 14 retirés |
| Cartes avec passages clés | 10 | briefing complet de 15 h 21 : 10 sur 10, une carte illisible remplacée par la réserve |

### Recherche par phrase (toutes les langues · 7 jours)

| Étape | Nombre | Retiré, pourquoi |
|---|---|---|
| Articles candidats | 211 | 8 langues, 80 + 30 par langue au plus |
| Lignes envoyées à l’IA | 106 | −105 une ligne par histoire |
| Cartes | 10 | −96 hors du sujet de la phrase ; 9 réponses et 1 nouvelle proche, 11 articles joints |

Les trois groupes ne se suivent pas un à un : le serveur traite tout ce qui arrive, le briefing ne regarde que la période choisie (ici 48 heures) dans les sources du lecteur, toutes langues comprises, la recherche les 7 derniers jours de toutes les sources. Les étapes du briefing jusqu'à la vérification ont été rejouées avec le code du 17 octobre à 15 h 49, sans rien enregistrer ; la dernière ligne vient du briefing de 48 heures du profil foot écrit en entier à 15 h 21 (13 histoires choisies, 10 cartes sur 10 avec passages, une carte illisible remplacée par la réserve).

## Étape par étape : les mécanismes et les technologies

## A · Le lecteur arrive : inscription, profil et sources

Rien n'est lu pour un lecteur sans profil : le compte et ses premières sources naissent ensemble.

### A1 · Créer le compte

Le lecteur choisit un nom, un e-mail, un mot de passe et la langue dans laquelle il lit. L'IA lui pose ensuite quelques questions sur ce qu'il veut suivre, puis écrit son profil, qu'il relit et corrige avant de créer son compte. Les nouvelles de toutes les autres langues lui seront traduites.

- Le site est ouvert sur internet ; ses lecteurs sont ceux qui ont un compte. La création de compte est fermée par défaut et s'ouvre avec `SIGNUP_OPEN=1`. Le mot de passe du site (Caddy, puis une page à lui) a été retiré le 10 octobre.
- Les questions : 3 tours au plus, de 2 à 4 questions avec 4 à 8 choix et un texte libre chacune, dans la langue choisie. Elles demandent aussi ce qu'il suffit de suivre « de plus loin ». Au plus 40 tours par heure et par adresse.
- Contrôles d'abord : nom de 3 à 30 caractères, mot de passe de 10 caractères minimum, texte du profil de 20 à 3 000 caractères.
- Nom ou e-mail déjà pris : refus immédiat (409), sans appeler l'IA. L'unicité ignore les majuscules.
- Le compte n'est créé qu'une fois le profil compris (étape A2). Si l'IA ou les vecteurs échouent, aucun compte ne reste.
- Au plus 5 inscriptions par heure et 10 connexions par quart d'heure par adresse IP.
- Connexion : le nom quelle que soit sa casse, le mot de passe vérifié par bcrypt ; un nom inconnu et un mauvais mot de passe reçoivent la même réponse, dans le même temps (17 octobre). Session dans un cookie que la page ne peut pas lire (HttpOnly), valable 7 jours et renouvelée chaque jour d'usage.
- Compte : nom d'utilisateur, e-mail et mot de passe changés depuis la page Settings ou la section « Your account » du profil, chacun avec le mot de passe actuel ; un nouveau mot de passe ferme les sessions des autres appareils.
- Plusieurs profils (« Travail », « Loisirs ») pour les administrateurs, 15 au plus : chacun a ses intérêts, ses projets, ses sources, ses votes, ce qu'il suit et ses briefings. La page envoie le profil choisi avec chaque demande (en-tête `X-Profile`).
- Projets (13 octobre) : ce que le lecteur prépare pour un temps (un voyage, un achat, un rapport), 5 au plus par profil, écrits avec les questions de l'IA comme un profil, avec un dernier jour dans l'année ou aucun. Leurs intérêts entrent dans le classement du briefing jusqu'à ce jour ; aucune source n'est cherchée pour eux.

*Technologies :* React 19 + Vite · Express 5 · bcrypt · cookie HttpOnly · Prisma 7 · gemma4:31b (les questions)

*Chiffres :* Compte + intérêts prêts : ≈ 5 s · Profil foot : 1 085 caractères (lit en anglais)

### A2 · Comprendre le profil

L'IA lit le texte libre et le découpe en intérêts distincts (6 au plus), et met à part ce que le lecteur refuse. Chaque intérêt reçoit ses deux vecteurs (dense et creux) et ses recherches Google News.

- Un vecteur par intérêt plutôt qu'un seul pour tout le profil : 88 % de cartes pertinentes contre 38 % (mesuré sur 4 profils, 249 histoires jugées à la main).
- L'IA choisit les langues des recherches de chaque intérêt : celle du lecteur, l'anglais, celles des pays dont parle le sujet, 4 au plus.
- Les refus sont gardés et montrés sur le profil, dans les mots du lecteur ; ils ne deviennent jamais un intérêt (son vecteur ramènerait justement ces nouvelles).
- Un intérêt est principal (poids 1) ou secondaire (0,85), selon les réponses ou le bouton du profil ; le lecteur corrige chaque intérêt, et changer la langue du profil le fait relire.
- L'IA reçoit la date du jour, pour ne pas écrire « Euro 2024 » en 2026.
- Un mot du lecteur absent de tous les intérêts, ou un intérêt de plus de 500 caractères : l'IA découpe une seconde fois, et la seconde réponse est gardée si elle fait mieux sur un point sans faire pire sur l'autre (13 octobre).
- Le texte entier reste la référence : c'est lui que l'IA relit au moment de choisir (C2).

*Technologies :* gemma4:31b (Ollama cloud) · Gemini en secours · bge-m3

*Chiffres :* Profil foot : 2 intérêts (gouvernance du football (l'UEFA et ses 55 associations, la FIFA) ; arbitrage) · Refus : 3 · Recherches Google News : 16 (langues choisies par l'IA pour chaque intérêt)

### A3 · Découvrir ses sources

En arrière-plan, juste après l'inscription. Pour chaque intérêt et chaque langue, le serveur demande à Google News quels médias ont écrit sur le sujet cette semaine, puis cherche dans chacun le flux de la bonne rubrique.

- Médias classés par nombre d'articles sur 7 jours, essayés dans l'ordre par vagues de 3.
- Flux cherché sur la page d'accueil, sur `/rss`, dans l'annuaire Feedly, puis dans un plan du site d'actualités (sitemap) ; sans rien de tout cela, RSS-Bridge en construit un depuis la page.
- Chaque flux est jugé sur le sens de ses nouvelles (titre et description) : assez d'entre elles doivent atteindre 0,45 de proximité avec un intérêt, puis l'IA doit confirmer 2 de ces nouvelles (la une d'un journal et un flux de cricket passaient sur 2 nouvelles fortuites).
- Par langue : 2 flux gardés ou 5 médias essayés, puis la presse nommée par Media Cloud (2 gardés sur 3 essais).
- Deux temps : les flux trouvés par Google News sont ajoutés et lus aussitôt, puis vient la presse de Media Cloud. La page du profil dit quel temps tourne, et qu'il est inutile d'attendre sur la page.
- Media Cloud répond à 2 recherches par minute : toutes sont posées dès le départ et gardées un jour ; une seule par langue hors celle du lecteur et l'anglais (file de 27 à 13 min sur 5 profils).
- Une découverte arrêtée par un redémarrage reprend d'elle-même.
- Au plus 20 flux par découverte, 60 au total. Un flux qui n'apporte plus rien sur le profil en 14 jours est retiré ; le lecteur peut aussi en retirer un lui-même (il n'est alors plus jamais retrouvé, ni lu pour ses briefings même si un autre lecteur l'a) et le ramener.
- Le lecteur ajoute aussi ses propres sources, 800 au plus : un site, une recherche dans l'annuaire et sur le web, un fichier (OPML, CSV, Excel), ou une source que d'autres lecteurs lisent sur ses intérêts, confirmée par l'IA.
- Les sources de chaque lecteur sont lues pour tous les briefings et toutes les recherches (depuis le 8 octobre). Seules restent à part les adresses qui portent une clé et celles de notre RSS-Bridge.

*Technologies :* Google News RSS · Feedly · RSS-Bridge · Media Cloud · bge-m3 · gemma4:31b

*Chiffres :* Premières sources (Google News) : 7 à 18 min (sur processeur, profils pris comme à l'inscription (6 octobre) ; ≈ 2 min avec la carte graphique (25 septembre)) · Fin, avec la presse : 14 à 43 min (avant : aucune source avant la fin) · Flux trouvés pour le profil foot : 46 (+ 600 ajoutés à la main) · Sources lues pour lui : 1 150 flux (386 partagés (toutes langues) + les 759 de tous les lecteurs, les siens compris + 16 recherches, moins les doublons)

## B · Le travail de fond : lire, comprendre et regrouper, toutes les minutes

Une passe démarre une minute après le début de la précédente, ou dès sa fin si elle a duré plus, protégée par un verrou PostgreSQL pour qu'elles ne se chevauchent jamais. Le 17 octobre après-midi, embedder sur processeur : 145 s en moyenne sur 14 passes (35 min, de 106 à 245 s), 207 nouvelles encodées et regroupées par passe, environ 5 100 par heure.

### B1 · Lire les flux à leur rythme

Chaque flux est relu selon ce qu'il publie : un média très actif toutes les 2 minutes, un blog calme toutes les heures. Seuls les liens jamais vus sont enregistrés.

- Rythme selon les nouvelles des 24 h : 72 et plus → 2 min, 24 → 5 min, 6 → 15 min, 1 → 30 min, aucune → 60 min. Google News : 60 min.
- Un flux en échec attend 2, 4, 8… fois plus longtemps, jusqu'à 60 min ; en échec depuis 3 jours (un site qui refuse le serveur), il n'est plus lu qu'une fois par jour.
- ETag et Last-Modified : une lecture sur quatre répond « rien de neuf » sans renvoyer le flux.
- 50 flux lus en même temps, abandon après 8 s (40 s pour un flux construit par RSS-Bridge).
- Langue détectée à la lecture quand le flux ne la donne pas ; texte lu dans son jeu de caractères (un flux en ISO-8859-1 perdait ses accents).
- Titres manquants : un flux qui met son titre dans la description (uol.com.br) ou laisse la variable de son modèle (« Vidéo. $content.TitleNoTags ») reçoit la description comme titre.
- Une même nouvelle redonnée sous un nouveau lien (même flux, même titre, même date) n'est pas enregistrée : agenzianova.com redonnait 1 088 nouvelles 7 fois par jour.
- Un flux qui donne plus de 500 nouvelles par jour est un déluge : ses nouvelles reçoivent leurs vecteurs après celles des autres, et le lecteur qui l'a ajouté le voit dans sa liste.
- Les archives ne sont plus enregistrées (9 octobre) : une nouvelle publiée avant les 30 jours gardés est sautée. La liste importée du profil foot avait apporté des flux qui redonnaient leurs nouvelles depuis 2006 et 2012.
- L'image de la nouvelle est gardée quand le flux en donne une : la sienne, une pièce jointe image, ou la première image de la description.

*Technologies :* fetch Node 24 · fast-xml-parser · RSS-Bridge · franc · Docker

*Chiffres :* Flux suivis : 4 391 (3 089 ont publié dans les 24 h (2 488 et 1 981 le 7 octobre)) · Lectures sur 14 passes (35 min) : 9 923 (2 552 « rien de neuf » (26 %), 20 en échec (0,2 %)) · Nouvelles enregistrées en 24 h : 118 598 (39 langues, 3 515 médias ; en 45 347, es 17 419, fr 13 392, it 8 835 (136 023 le 7 octobre, avant le tri de l'annuaire))

### B2 · Donner un sens à chaque nouvelle

Le titre, puis le titre suivi du début de la description (400 caractères), deviennent des vecteurs. C'est ce qui permet de comparer deux nouvelles écrites dans deux langues.

- bge-m3 découpe le texte en jetons, puis ses 24 couches réécrivent chaque jeton d'après les autres mots de la phrase. Il en tire deux vecteurs : un dense de 1 024 dimensions (le sens de toute la phrase) et un creux (le poids de chaque mot, les noms propres pèsent le plus).
- Exemple : « Spain beat Croatia 2-1… » et « Croatia lose 2-1 to Spain… » font 0,71 (dense) + 0,21 (creux) = 0,92, une même histoire. Mais deux pages de pronostics, « Egypt vs Angola – Betting Tips » et « Togo vs Burundi – Betting Tips », font 0,79 : d'où les règles de B3.
- Stockés en demi-précision (halfvec) : table 1,48 → 0,99 Go, résultats identiques. Le creux en sparsevec : seuls les mots du texte, sur un vocabulaire de 250 002.
- Tous les embedders qui répondent travaillent ensemble (9 octobre) : la carte graphique du PC de jeu, le processeur du serveur Ubuntu, une autre machine. Chacun prend le lot suivant seulement s'il le finit avant les autres ; un embedder éteint est revérifié chaque minute.
- Sur le processeur : ONNX Runtime au lieu de PyTorch, mêmes vecteurs (cosinus 0,99997), 1,6 fois plus vite. La version int8, 3 à 6 fois plus rapide, changeait 10 à 15 % des nouvelles les plus proches : écartée.
- Le lot suivant s'encode pendant que le précédent est regroupé et pendant la lecture des flux : 200 nouvelles par passe au lieu de 100. L'embedder a une priorité basse : le site et le reste de la machine passent d'abord.
- Les nouvelles de plus de 48 h reçoivent des vecteurs pour la recherche, mais ne rejoignent aucune histoire.

*Technologies :* bge-m3 · ONNX Runtime (processeur) · FlagEmbedding + torch (carte graphique) · RTX 4070 Ti · pgvector halfvec + sparsevec

*Chiffres :* Vecteurs donnés en 24 h : 115 681 (98 % des nouvelles enregistrées ; 5 529 en attente sur les 257 818 de la fenêtre de 48 h) · Délai médian lecture → vecteur : 113 s (sur processeur, PC de jeu éteint ; 87 s le 7 octobre, 44 s le 3 octobre) · Vitesse : 55 textes/s (sur la RTX ; ≈ 4 sur le processeur du serveur (16 textes en 2 à 6 s), mesuré avant le 7 octobre)

### B3 · Regrouper un même fait en histoire

Une nouvelle rejoint l'histoire dont elle est la plus proche, si elle est assez proche de ses membres venus d'autres médias. Sinon, elle en commence une.

- Titres : proximité moyenne ≥ 0,70 (dense + creux) avec les membres des autres médias.
- Textes : ≥ 0,60 en plus. Un même sujet n'est pas un même fait.
- Un média seul avec lui-même doit faire +0,5 et citer les mêmes chiffres : ses titres-modèles se ressemblent (« Is X v Y on TV? »).
- Une histoire calme depuis plus de 6 h demande un peu plus chaque heure (−0,003/h) : elle dérive moins.
- Affiches : une nouvelle qui nomme un match (« Egypt vs Angola ») saute une histoire dont la plupart des membres nomment un autre match. Les annonces, cotes et « comment regarder » s'écrivent pareil pour chaque match.
- Un titre vide n'est jamais « la même nouvelle revue » (459 nouvelles d'un média brésilien s'étaient retrouvées dans une seule histoire), et une nouvelle sans titre ni description n'est pas jugée.
- Présélection : une nouvelle n'est comparée qu'aux membres des 100 histoires de sa fenêtre les plus proches d'elle (moyenne des textes de l'histoire), plus les histoires sans moyenne. Mêmes décisions sur 450 nouvelles rejouées, 145 → 60 ms par nouvelle.
- Calcul exact en SQL dans la base, sans index approximatif (HNSW), par lots, avec un budget de temps par passe.

*Technologies :* PostgreSQL 18 · pgvector 0.8 · assign_stories (plpgsql) · matchup_of

*Chiffres (24 h) :* Nouvelles placées : 115 544 (1 732 publiées il y a plus de 48 h, sans histoire) · Histoires : 63 985 (1,8 nouvelle par histoire en moyenne) · Racontées par 2 médias ou plus : 11 230 (45 851 histoires d'une seule nouvelle) · Par passe : 207 placées (86 histoires créées, 26 réunies à une autre (14 passes du 17 octobre)) · Durée par lot de 100 : 2,5 à 4 s (7 octobre ; 7 à 20 s avant la présélection (5 octobre)) · Choix mesuré : 96 % de bonnes cartes (contre 82 % avec les mots seuls) · Règle des affiches : 19 décisions sur 1 075 (changées sur 36 h de nouvelles anglaises : 12 à raison, 2 neutres, 5 un match coupé en deux (alias))

### B4 · Suivre une affaire dans le temps

Les histoires d'une même affaire (l'annonce, le verdict, les réactions) sont reliées dans un fil. La carte peut ensuite montrer toute la chronologie.

- Une histoire rejoint un fil si sa proximité moyenne avec les histoires des autres médias atteint 0,75 (+0,10 à travers son propre média).
- Deux fils nés à part fusionnent à 0,70.
- Un fil calme depuis 7 jours ne prend plus d'histoire.
- Présélection : une histoire n'est comparée qu'aux histoires des 20 fils les plus proches d'elle (la moyenne d'un fil vaut la proximité moyenne de ses histoires), plus les fils changés dans le même lot. Même fil pour 800 histoires rejouées sur 800, 250 → 50 ms par histoire.
- Fusions : un fil d'une histoire qui ne pouvait rejoindre aucun fil n'est comparé qu'aux fils changés ; les autres ne regardent les médias que des fils assez proches. Mêmes fils sur 300 histoires rejouées, vérification 2 fois plus rapide.

*Technologies :* assign_threads (plpgsql) · centroïdes halfvec

*Chiffres :* Fils des histoires du jour : 58 493 (184 histoires rangées par passe (17 octobre)) · Durée par appel : 7 à 12 s (7 octobre ; 30 à 88 s avant les présélections (3 et 5 octobre)) · Mesuré à la main : 93 % (des faits rangés dans un seul fil)

### B5 · Faire le ménage

Toutes les heures, les nouvelles de plus de 30 jours et les histoires vides sont effacées. Toutes les 20 minutes, l'annuaire s'agrandit : médias souvent cités par Google News et rubriques des médias déjà lus. Une fois par jour, il est aussi trié (9 octobre).

- Un flux de l'annuaire est retiré quand son média n'a eu aucune nouvelle montrée dans un briefing depuis 14 jours, et que moins de 11 % de ses nouvelles des 3 derniers jours atteignent 0,45 avec un intérêt d'un profil.
- Un flux nouveau a 14 jours de grâce, sauf un déluge (300 nouvelles en 3 jours). Un flux sans nouvelles est gardé.
- Retiré, il n'est pas repris pendant 60 jours, sauf si un profil est créé ou modifié entre-temps. La découverte d'un profil ne le bloque jamais : un nouveau lecteur l'a aussitôt dans ses sources.

*Technologies :* findFeeds · directory_feeds · DirectoryService.prune · directory_removed

*Chiffres :* Gardé en base : 2 099 425 nouvelles (971 883 histoires, 773 076 fils ; 691 147 nouvelles le 7 octobre) · Annuaire : 2 369 flux (938 le 3 octobre, 1 382 le 7, 1 623 le 10 après le tri : c'est lui qui fait grandir le volume) · Premier tri, 9 octobre : 187 flux retirés (environ 40 % du volume ; 2 à 11 % de leurs nouvelles touchaient un intérêt, aucune n'était dans un briefing. Depuis, plus aucune nouvelle n'attend ses vecteurs)

### B6 · Relever les noms de chaque nouvelle

À côté des passes (13 octobre), un étiqueteur lit le titre et le début de la description de chaque nouvelle et en relève les personnes, les organisations et les lieux. Les noms les plus cités sont ensuite cherchés dans Wikidata, pour savoir de quelle fiche ils parlent.

- GLiNER multi v2.1, toutes les langues des flux, sur le titre et 700 caractères de la description ; les nouvelles les plus récentes d'abord, seulement celles des 30 jours gardés.
- 16 nouvelles à la fois sur le processeur du serveur, 128 sur la carte graphique du PC de jeu quand il est allumé ; chaque étiqueteur travaille de son côté, aucune nouvelle n'est lue deux fois.
- Un nom est gardé une fois par sorte, comparé sans majuscules, accents ni article (« La Fédération lettone de football »). Une nouvelle que le regroupement tient est reprise plus tard : l'étiquetage ne fait jamais attendre les passes.
- Wikidata : un nom cité par 3 nouvelles au moins, un toutes les 7 s. Il devient une fiche seulement quand une seule fiche porte exactement ce nom (« LFF » en a deux, la Lettonie et la Lituanie). Les noms qu'un lecteur voit (sur une carte, sur la page d'un nom) passent en premier.
- Depuis le 22 octobre, les personnes en entier et les lieux de chaque lot de 50 sont d'abord lus par le titre d'un article de la Wikipédia de leur langue, 50 titres par appel : liés tout de suite quand ce n'est pas une page d'homonymes et que la fiche est un humain ou un lieu. 41 % de 300 noms de la file le sont, 90 % justes ; Wikidata n'en laisse passer que 12 000 par jour pour 285 000 en attente.
- Entre plusieurs fiches, une personne prend l'humain nettement plus connu (10 Wikipédias au moins, 30 pour une signature), sinon celui du pays des médias qui la citent (« Istvan Kovacs », l'arbitre roumain). Un mot seul (« Evenepoel ») ne garde sa fiche que s'il est un humain connu dans 20 Wikipédias, et les personnes d'un seul mot passent en dernier.
- Une organisation ne prend la seule fiche portant son nom que si ce n'est ni un humain, ni un lieu, ni une œuvre, et que les sites qui la citent ne sont pas d'un autre pays (« OL » des sites français n'est pas Open Library) ; sinon l'IA choisit sur 5 titres. Un nom resté sans fiche garde les fiches trouvées (les « candidats »), pour que sa carte choisisse (C7).
- Ils servent trois fois : la page d'une fiche suivie trouve ses nouvelles par eux (D3), les autres angles d'une carte cherchent les histoires qui nomment ses noms rares (C7), et chaque carte montre ses noms (D1).

*Technologies :* GLiNER (Python) · mentions · article_mentions · Wikidata · FOR UPDATE SKIP LOCKED

*Mesuré le 13 octobre :* Vitesse : 2,2 nouvelles/s (294 nouvelles de 26 langues, 3 cœurs du serveur ; le titre seul trouvait 44 % des noms) · Noms en attente de Wikidata : ≈ 150 000 (12 000 nouveaux par jour) · Noms en attente, 22 octobre : 285 000 (11 000 liés et 3 000 nouveaux par jour ; liés par le titre de leur article : 41 % de 300 noms)

## C · Le briefing : un clic, six étapes, puis l'analyse

Le briefing ne lit rien de nouveau sur le web avant d'avoir choisi : il classe ce que le serveur a déjà préparé, et l'IA ne voit qu'une quarantaine d'histoires. Le lecteur choisit la période (1 à 7 jours, 2 par défaut) et la taille : 10, 20 ou 30 cartes. La page montre l'étape en cours : ranking, choosing, checking, reading, summarizing, angles ; l'analyse des cartes s'écrit ensuite, les cartes déjà montrées. Les nombres ci-dessous sont ceux de 10 cartes ; pour 20 ou 30, les histoires classées, les candidates et la réserve sont 2 ou 3 fois plus nombreuses.

### C1 · Classer les histoires de la période

Sur la période choisie (2 jours par défaut), une seule requête SQL note chaque nouvelle des sources lues, dans toutes les langues, contre chacun des intérêts du profil et de ses projets en cours, et garde la meilleure note de chaque histoire.

- Avant de classer, les sources trouvées pour le profil qui n'apportent plus rien depuis 14 jours sont retirées (A3).
- Note : proximité dense + la moitié de la proximité creuse, multipliée par le poids de l'intérêt.
- Chaque intérêt a sa part (7 octobre) : les 600 meilleures histoires sont gardées, puis chaque intérêt reçoit sa part des 150 classées et des 40 candidates, selon son poids, ses meilleures d'abord. Un intérêt large n'écrase plus un intérêt étroit avant que l'IA les voie.
- Toutes les langues comptent : le lecteur lit dans la sienne, les titres et passages des autres lui sont traduits.
- Sources refusées par ses votes retirées. Médias de confiance du lecteur : leurs histoires parmi les 60 plus proches entrent en plus des 40 (10 au plus), sans bonus de note.
- Écartées ensuite : pages répétées et histoires connues seulement par Google News sans média établi.
- Déjà envoyées (14 octobre) : une histoire d'une carte envoyée par e-mail dans les 48 dernières heures, et toute autre histoire de son fil, ne revient pas. Elle revient comme une suite quand des nouvelles publiées depuis disent du neuf, ce qu'un appel de l'IA décide (« dans le doute, ce n'est pas neuf »).
- Candidates : les 40 meilleures venues de flux, plus au plus 10 connues seulement par Google News (2 par média). Quand Google bloque la lecture de ses liens, ces dernières ne sont plus proposées, sauf si leur adresse réelle est déjà connue.
- Dès 3 jours : une seule candidate par fil d'affaire, et l'IA reçoit le nombre de médias de chaque histoire pour préférer ce qui a compté. Même coût : 40 candidates.

*Technologies :* rank_profile_stories (SQL) · pgvector · fils (threads)

*Profil foot :* Nouvelles des 48 h dans ses sources : 106 673 (38 langues ; 32 496 en anglais) · Histoires notées : 67 500 → 600 → 150 (600 gardées en 6,2 s (notes de 0,802 à 0,524), puis 75 par intérêt (0,552 et plus) ; 17 à 20 s le 7 octobre, serveur plus chargé) · Déjà envoyées : 29 écartées (sur 147 crédibles ; 8 autres gardées comme suites) · Candidates : 47 (40 venues de flux + 7 de Google News ; 346 articles, 15 langues) · Sur 7 jours : 387 990 nouvelles → 47 (227 789 histoires, classées en 30 s ; 15 déjà envoyées écartées, 119 histoires après une par fil)

### C2 · L'IA choisit

L'IA reçoit le texte du profil et de ses projets, les intérêts et les candidates. Elle en choisit au plus 20 (30 pour 20 cartes, 45 pour 30 ; 15 le 7 octobre), avec une raison tirée du titre et de la description seulement ; le briefing en garde 10, les suivantes restent en réserve (C4).

- Ce que lit l'IA : une ligne par candidate, « [id] titre — début de description (aussi : 3 autres titres) », avec « source de confiance du lecteur » ou, sur 7 jours, le nombre de médias. Jamais de vecteur.
- Refuse les pages-dossiers, les guides pratiques (« comment regarder »), les compilations vidéo ; préfère les faits aux pronostics ; varie les sujets.
- Les votes du lecteur entrent comme exemples : 15 titres aimés et 15 refusés des 30 derniers jours.
- Le choix est ensuite équilibré entre les intérêts.
- Mesuré : 95 % de cartes pertinentes (88 % avec les vecteurs seuls).

*Technologies :* gemma4:31b · JSON

*Profil foot :* Choisies par l'IA : 47 → 12 (13 dans le briefing complet de 15 h 21) · Après équilibre : 10 + 2 en réserve (3 en anglais, 6 langues) · Durée : 2,2 s (3,1 s pour le briefing complet ; 5 806 jetons lus, 563 écrits)

### C3 · Vérifier et fusionner

Deux appels partent ensemble. Le premier garde, dans chaque histoire, les articles qui racontent bien le fait de l'article principal. Le second réunit deux cartes qui racontent le même fait, par exemple la version française et la version anglaise.

- Jusqu'à 12 autres articles vérifiés par histoire, un par média d'abord.
- Une histoire est d'une seule langue : une carte choisie dans une autre langue apporte au second appel les 2 histoires de la langue du lecteur les plus proches d'elle (0,75 et plus). Celles qui racontent le même fait la rejoignent.
- Chaque carte apporte aussi au premier appel ses versions dans les autres langues (4 au plus, 0,78 et plus, depuis le 8 octobre) : celles du même fait la rejoignent, et elle compte leurs médias.
- Deux cartes réunies laissent une place : la suivante de la réserve est lue avec les cartes.
- L'IA écrit d'abord le fait principal de chaque carte avant de comparer : 78-80 % de fusions justes, 5-7 % fausses.
- Les histoires de réserve passent par la même vérification : une réserve qui raconte le fait d'une carte la rejoint.
- Si l'IA échoue, les cartes restent telles que les vecteurs les ont groupées : le briefing n'attend jamais.

*Technologies :* checkStories · mergeStories · centroïdes

*Profil foot :* Articles vérifiés : 48 → 34 (14 retirés, cartes et réserve (aucun sur 31 le 7 octobre)) · Cartes : 12 → 12 (aucune fusion ; dans le briefing complet, 9 versions d'autres langues et 1 en anglais rejoignent leur carte) · Durée : 3,3 s (7,4 s avec les versions (briefing complet))

### C4 · Lire les articles

Maintenant seulement, les pages sont téléchargées : 5 articles par histoire au plus, un par média. L'article d'un média de confiance est lu en premier, puis celui dans la langue du lecteur.

- Le texte est extrait de la page comme le fait le mode lecture de Firefox. Depuis le 8 octobre, une simple lecture de la page d'abord, Crawlee seulement pour les pages manquées : ses en-têtes de navigateur inventés faisaient refuser L'Équipe, Le Télégramme ou phys.org.
- Chaque carte garde l'article d'où viennent ses passages, et l'image de sa page (og:image) avant celle du flux, souvent une miniature (18 octobre : 116 cartes sur 142 avec une image d'au moins 560 pixels au lieu de 98). L'image qu'un site met à toutes ses pages sans photo (« default », « logo ») n'est jamais prise.
- Sans image d'aucun de ses articles, une carte prend son illustration : la photo que Wikimedia Commons a de la personne, sinon de l'organisation, que ses articles nomment le plus, légendée « Illustration » avec son auteur et sa licence (18 octobre).
- Un lien Google News n'est qu'une redirection : au plus 10 adresses réelles demandées par briefing (Google bloque vers 40 par heure).
- Mesuré : 85 % des articles lisibles (60 mots ou plus), 96 % des histoires en ont au moins un.
- Une histoire dont aucune page n'est lisible (un paywall, un site protégé), ou que la relecture retire (C6), ne devient jamais une carte : la suivante de la réserve prend sa place, lue à son tour, en 2 tours au plus. Sans réserve, le briefing montre moins de cartes plutôt qu'une carte vide.

*Technologies :* fetch + @mozilla/readability · Crawlee (Cheerio) en secours · linkedom

*Briefing du profil foot, 15 h 21 :* Durée : 7 s (2 à 7 s le 2 octobre) · Articles par carte : 7,4 en moyenne (de 1 à 27 ; 7 à 10 les 2 et 3 octobre) · Cartes illisibles remplacées : 1 (par la réserve ; 1 par briefing aussi le 6 octobre)

### C5 · Choisir les passages clés, les points et le résumé

L'IA ne réécrit rien. Elle reçoit l'article découpé en phrases numérotées et renvoie les numéros des passages qui portent la nouvelle. Le lecteur lit donc les phrases du journaliste.

- Au plus 5 passages, 170 mots ; traduction automatique marquée comme telle, chiffres contrôlés.
- Deux façons plus courtes de lire la carte, faites des mêmes phrases publiées (12 octobre) : 3 points, les phrases les plus importantes d'abord, et un résumé de 65 mots. Le lecteur choisit l'une des trois sur la page et pour l'e-mail.
- Version de l'IA (15 octobre) : sur demande (« Show AI version »), les points et le résumé écrits par deepseek-v4-pro, pour les cartes gardées seulement, à l'étape « angles » (C7, depuis le 17 octobre), marqués comme tels, retirés s'ils contiennent un chiffre absent de l'article. Mesuré sur 30 articles, 2 passes : 1 à 2 articles avec une erreur de sens (gemma4:31b 2 à 3, les phrases publiées 0) ; d'où une version à demander, à côté des phrases du journaliste.
- Un titre coupé par le flux est repris en entier de la page (14 octobre).
- Pourquoi : les résumés réécrits changeaient le sens dans 4 cas sur 30.
- Corroboration : chaque média compte, mais deux textes qui partagent la moitié de leurs suites de 8 mots sont une même dépêche d'agence.
- Mots de prudence relevés dans le titre et la description (« selon », « aurait »…).
- « Contesté » : les phrases des pages lues qui contiennent un verbe de démenti (nier, démentir, deny, niega…, cherchés dans le code, dans la langue de chaque article), puis un appel de l'IA par carte confirme qui dément quoi. Montré seulement quand le démenti porte sur le fait principal et vient de celui qu'il concerne : 21 cartes justes sur 22 à la main.

*Technologies :* extractArticle · gemma4:31b · aiWaysOf (deepseek-v4-pro) · corroboration (shingles) · contested

*Briefing du profil foot, 15 h 21 :* Durée : 33 s (passages et relecture, 5 histoires à la fois ; ≈ 25 s le 6 octobre) · Jetons : 17 680 (21 appels : passages 17 (14 116 lus, 1 302 écrits), démentis 4 ; 1 carte contestée) · Cartes avec passages : 10 sur 10 (avec points et résumé ; 10 sur 10 aussi le 6 octobre) · Version de l'IA : 10 cartes (20 appels à deepseek-v4-pro, 23 786 jetons lus, 2 840 écrits, à l'étape « angles »)

### C6 · Relire avant de montrer

Une dernière lecture des cartes avec leurs passages : celles qui parlent de ce que le profil refuse, invisible dans un simple titre, sont retirées. En même temps, les titres écrits dans une autre langue que celle du lecteur sont traduits.

- Faite à chaque tour de lecture : une carte retirée est remplacée par la réserve, comme une carte illisible.
- L'IA reçoit les intérêts et la liste des refus du profil ; seul un de ces refus retire une carte, et une restriction ne vaut que pour son sujet (« seulement le codage » ne retire pas toute la technologie). Depuis le 7 octobre au soir : 0 carte retirée à tort sur 264, contre 20 avant, et les cartes refusées toujours retirées.

*Technologies :* reviewCards · translateTexts

*Briefing du profil foot, 15 h 21 :* Retirées : 0 (2 appels, 3 508 jetons lus, 492 écrits) · Total du briefing : 154 s (48 h) (classement 33 s (le retrait des sources inutiles compris), choix 3, vérification 7, lecture 7, passages 33, angles 69 ; ≈ 34 s le 6 octobre, sans angles, source officielle ni version de l'IA) · Jetons du briefing : 92 008 (82 appels à gemma4:31b et deepseek-v4-pro, sans l'analyse (42 544 jetons de plus))

### C7 · Autres angles, source officielle, ce que le profil suit

Les cartes prêtes, cinq recherches partent ensemble (étape « angles ») : la version de l'IA des cartes gardées (C5), les autres angles de chaque carte, sa source officielle, les nouvelles de ce que le profil suit (D3) et les noms de chaque carte.

- Angles : les histoires de toutes les langues des 3 derniers jours proches de la carte (0,6 et plus), 8 au plus par carte, jugées par l'IA sur leurs titres, avec jusqu'à 5 autres titres de la carte : « le même fait », « un autre angle », « le même thème » ou « autre chose ». S'y ajoutent les histoires des 30 derniers jours qui nomment les noms rares de la carte (13 octobre, B6). 5 angles au plus par carte, un par fait, jamais la nouvelle de la carte racontée une seconde fois.
- Le même fait avec un détail de plus n'est pas un autre angle : sans cette règle, une candidature racontée dans 16 langues revenait en angles d'elle-même.
- Source officielle (12 octobre) : l'IA nomme les parties de la nouvelle (un club, une instance, une entreprise), trois cartes à la fois ; chacune est cherchée dans Wikidata, avec ses propres canaux (son site, X, Bluesky…), et ses publications des derniers jours, lues par nos flux de son site ou par son propre flux, sont jugées par l'IA : 2 au plus. Les déclarations d'une partie que les articles rapportent sont montrées aussi.
- Ce que le profil suit : toutes les nouvelles de la période qui nomment une fiche suivie ou un mot du profil, de toutes ses sources, sans pertinence ni IA.
- Noms de chaque carte : les personnes et organisations qu'un quart de ses articles au moins nomment, 4 au plus. Sous son sujet, elle dit aussi de quels pays elle parle (18 octobre) : « Zambie » pour « Hichilema limoge son ministre » ; les gens d'un organisme international que la carte nomme n'y comptent pas (Infantino, de la FIFA, n'est pas une nouvelle suisse).
- Les noms sont vérifiés sur la carte (21 octobre) : un nom est lié une fois pour toutes ses nouvelles, donc sa fiche peut ne pas être celle de la carte (« Primera División » d'un arbitre espagnol, la ligue maltaise). L'IA lit les titres de la carte, son sujet, les autres noms et les pays des sites, et un « non » retire le lien de la carte et de ses pays : 14 liens faux sur 14 retrouvés, 2 justes retirés sur 218 (242 noms jugés à la main).
- Un nom sans fiche choisit sur sa carte (22 octobre) parmi ses candidats, avec les mêmes éléments : sur 240 noms tirés au hasard de 210 cartes, jugés avant tout système, 93 % justes avec le sujet, les autres noms et les pays, 89 % avec les titres seuls.
- Au plus 6 appels à Ollama en même temps pour tout le serveur (14 octobre) : Ollama cloud refuse le septième, et une carte avait perdu ses angles.
- Le briefing n'attend jamais l'une ou l'autre : en cas d'échec, il paraît sans elles.

*Technologies :* closeStories (SQL) · other-angles (gemma4:31b) · official-sources · card-names · watchedNews

*Briefing du profil foot, 15 h 21 :* Durée : 69 s (versions de l'IA comprises ; source officielle : parties 44 s, déclarations 17 s) · Angles : 10 cartes sur 10 (25 en tout, 11 appels ; 83 % justes et 17 cartes sur 30 le 8 octobre) · Source officielle : 2 cartes (7 parties trouvées dans Wikidata, 5 lues, 3 déclarations ; 24 appels)

### C8 · L'analyse des cartes qui en méritent une

Les cartes montrées, l'IA écrit en arrière-plan l'analyse de celles qui en méritent une (15 octobre) : une affaire, un conflit, un enjeu que le titre ne dit pas, une étape à venir. La page la montre dans la carte dès qu'elle est prête.

- deepseek-v4-pro sans raisonnement choisit les cartes ; puis, avec raisonnement, 3 cartes à la fois, il écrit pour chacune pourquoi elle compte (2 lignes), ce qui pourrait suivre, « si ceci, alors cela » (2 lignes), et l'histoire jusqu'ici, tirée des histoires plus anciennes de son affaire (12 au plus).
- Chaque ligne cite les sources de la carte seulement ; le code retire une ligne dont un chiffre ou un nom n'est pas dans ses sources (les noms lus par l'étiqueteur, B6).
- Pas de limite de cartes ; chaque carte finie note son heure, et une analyse n'est montrée en échec qu'après 12 minutes sans carte finie (17 octobre : avant, 12 minutes après son début, alors qu'une longue tournait encore). Elle ne passe jamais à Gemini : un échec, c'est seulement pas d'analyse.

*Technologies :* card-analysis.js · deepseek-v4-pro · briefings.analysis

*Mesuré le 15 octobre :* Cartes jugées : 139 (10 briefings de 7 profils, chaque ligne jugée à l'aveugle) · Ligne trompeuse : 4 à 5 cartes sur 74 (20 sans raisonnement, 29 avec gemma4:31b) · Durée : 71 s par carte (jusqu'à 161 s ; le choix des cartes ≈ 5 s) · Briefing du profil foot, 17 octobre : 6 cartes sur 10 (écrites en 103 s, 8 appels, 22 385 jetons lus, 20 159 écrits ; aucune ligne retirée)

## D · La lecture : ce que le lecteur a sous les yeux

### D1 · Lire une carte

Chaque carte donne le titre (traduit, avec l'original dessous), la raison du choix, son image, les passages clés (ou ses points, ou son résumé, et leur version de l'IA sur demande), le nombre de médias, de textes différents et d'agences citées, les mots de prudence, qui dément la nouvelle (« Contesté », avec sa phrase), sa source officielle, ses noms, son analyse, les autres angles de l'affaire, sa chronologie et la liste des articles.

- Titre et passages sont montrés traduits, avec « Show original » pour lire le texte d'origine ; la langue de chaque article est marquée par son code (FR, ES…).
- Chaque étiquette de la carte s'explique dans un petit « i », au survol, au focus ou au toucher.
- Deux onglets : « Briefing » et celui de ce que le profil suit, un onglet par fiche ou par mot. Le bouton des noms trouvés ne montre que les cartes qui en nomment un, le nom surligné.
- Le compte des médias dit « 2 textes différents sur 3 lus » plutôt que « écrits indépendamment » (15 octobre) : une dépêche réécrite compte pour un autre texte.
- Chaque nom d'une carte ouvre sa page : celle de sa fiche Wikidata, ou une page du nom tel qu'il est écrit.
- Le fil d'affaire montre les autres faits de la même affaire, pris dans toutes les sources lues.
- Pouce levé ou baissé : les exemples du prochain choix (C2). Un flux refusé 3 fois et 2 fois plus refusé qu'aimé est mis de côté, sauf s'il le garde depuis son profil.
- Étoile sur une source : son média devient de confiance, quel que soit le flux ou Google News qui apporte ses nouvelles (C1) ; son article est lu en premier.
- Les sources du profil sont réunies dans une seule liste, avec un seul endroit pour en ajouter. Une source en déluge y est signalée (« N news a day: prepared last »).

*Technologies :* React 19 · Tailwind 4 · shadcn / Radix · Fraunces + Source Serif 4

*Briefing du profil foot, 15 h 21 :* Cartes : 10 (en 5 langues : 5 en anglais, 2 en français, 1 en italien, en allemand, en espagnol) · Médias par carte : 6,6 en moyenne (de 1 à 21 ; 5,7 à 8,1 les 2 et 3 octobre)

### D2 · Chercher par phrase

Le lecteur écrit une phrase. Elle devient un vecteur, comparé aux nouvelles de toutes les langues ; l'IA trie ensuite les candidates en réponses et en nouvelles proches.

- Par langue : les 80 plus proches par le sens et 30 par les mots (les noms propres). La langue choisie est celle de l'affichage, pas un filtre.
- Un mot exact en lettres latines est cherché avec et sans ses accents.
- Google News reçoit la même phrase en parallèle ; ses nouvelles sont lues et ajoutées.
- Une ligne par histoire envoyée à l'IA, qui donne un verdict par article : réponse, proche ou non.
- Les cartes d'un même fait sont réunies quand leurs textes sont proches (0,65 et plus) et que l'IA confirme.
- Titres et descriptions traduits quand ils arrivent à l'écran, 20 par appel, avec le titre original dessous. La dernière recherche est gardée un jour.

*Technologies :* closestArticles (SQL) · sortByMeaning · joinFacts · IntersectionObserver

*Mesuré le 17 octobre, compte du profil foot :* Phrase : « les décisions d'arbitrage contestées en Ligue des champions », 7 jours · Candidates : 211 articles (8 langues ; 106 lignes envoyées à l'IA) · Résultat : 10 cartes (9 réponses, 1 proche ; 11 articles joints (4 cartes le 7 octobre)) · Durée : 31,9 s (sans Google News, base trois fois plus grande (20,1 s le 7 octobre, 8,1 s le 3))

### D3 · Suivre des noms, des clubs, des personnes

Une seule liste, une seule page Following (13 octobre) : des fiches de Wikidata (un club, une personne, une organisation, avec tout ce qui gravite autour) et des noms ou des mots tels qu'écrits. Sans pertinence ni IA : toutes les nouvelles des sources qui les citent, dans un onglet du briefing.

- Mots : 20 au plus par profil, tapés par le lecteur (« VAR », « Infantino »). Cherchés comme mots entiers dans le titre et la description, accents et majuscules ignorés ; un sigle garde ses majuscules et ne compte pas dans un titre crié (« LA VALETTE-DU-VAR »). Listés dans le briefing, 100 histoires au plus par terme.
- Fiches : une fiche de Wikidata choisie dans une liste, 30 au plus. Ses noms sont ceux de la fiche (nom, variantes, « PSG » pour « Paris Saint-Germain F.C. », nom de famille d'une personne) ; le lecteur en ajoute 10 et en retire. Ses liens aussi : joueurs, entraîneur, ligue, président, stade… Relue de Wikidata quand elle est suivie ou ouverte, si elle a plus de 7 jours.
- Sa page montre les nouvelles qui la citent, trouvées par les noms que l'étiqueteur a relevés (B6), puis celles de chaque lien, les plus cités d'abord. Ses nouvelles entrent aussi dans le briefing, sauf si le lecteur la décoche (l'UEFA seule est nommée par une centaine de nouvelles par jour) : les 100 plus récentes par fiche.
- Un nom que Wikidata n'a pas comme une seule fiche (« LFF », « Vadims Ļašenko ») a sa propre page, suivi tel qu'écrit ; un nom que l'étiqueteur a relié à une fiche ouvre celle de la fiche.
- Suggestions : les noms vus sur deux cartes au moins des briefings des deux dernières semaines, pas encore suivis (8 au plus).

*Technologies :* Wikidata (wbsearchentities, SPARQL) · mentions (B6) · pg_trgm · watchedNews · Radix Tabs

*Mesuré :* « VAR », 7 jours : 264 histoires (8 octobre ; 7 s pour deux termes) · PSG, 48 h : 144 histoires (sources d'un profil foot ; Parc des Princes 53, Dembélé 27, Luis Enrique 25 (8 octobre)) · Recherche d'une fiche : 11 s sur 48 h (30 s sur 7 jours, gardée 10 minutes) · UEFA, 48 h : « UEFA » : 152 histoires (sources du profil foot, 12 octobre ; 16 de ses 18 noms n'en trouvent aucune)

### D4 · Envoyer des cartes par e-mail

Pour les administrateurs : le lecteur coche des cartes, les met dans l'ordre voulu, choisit comment elles se lisent (passages clés, points ou résumé, et la version de l'IA carte par carte) et les envoie à son adresse ou à une autre. L'e-mail reprend la mise en page du site et ce que le briefing a écrit, entièrement dans la langue du lecteur : ses propres mots (« Key points », « Contested »…) sont traduits par l'IA une fois par langue, ses dates écrites dans cette langue (18 octobre).

- Pour chaque carte : un autre titre, une autre image (celles de l'histoire, une adresse ou un fichier), sans les démentis ou les angles qu'il retire. Seules les images d'au moins 560 pixels de large sont proposées ; une image trop petite est remplacée par la meilleure de l'histoire, une photo de ses articles avant son illustration.
- Titre au nom du profil et du jour, « Roberto’s Briefing · 13 October 2026 », jamais celui du compte ; objet « Fab's Briefing · 16 October 2026 · 2 stories ». Envoyé à une autre adresse, la raison du choix de chaque carte est retirée et une réponse va au lecteur.
- Chaque carte porte son analyse, ligne par ligne (15 octobre), et sa source officielle dans un encadré juste sous ses phrases (16 octobre). Rien ne dit ce qui est traduit (16 octobre). Le lecteur peut retirer une ligne : un démenti, un angle, une source officielle, une ligne d'analyse.
- Les cartes envoyées sont marquées : leurs histoires ne reviennent pas dans les briefings des 48 heures suivantes, sauf comme suite (C1).
- Plus aucune copie n'est gardée depuis le 13 octobre ; les liens « View the original e-mail » des e-mails envoyés avant mènent toujours à la leur. Sa page n'exécute rien et n'appartient à aucun site (Content-Security-Policy `sandbox`).
- Envoyé par le compte Gmail du serveur (SMTP). Au plus 10 par heure et par adresse, 30 par jour et par compte.

*Technologies :* nodemailer (SMTP Gmail) · briefing-mail.js · sent_mails

## Où ça tourne : les machines

### Serveur Ubuntu — Tout le travail de fond

Docker Compose : API Node/Express avec l'ingestion, PostgreSQL 18 + pgvector, RSS-Bridge, Caddy (le site) et un tunnel Cloudflare vers internet. À part, un embedder bge-m3 sur processeur (ONNX Runtime) et l'étiqueteur des noms (GLiNER, 3 cœurs), en priorité basse. Redémarrage automatique.

### PC de jeu · RTX 4070 Ti — Les vecteurs, vite

bge-m3 et l'étiqueteur des noms sur la carte graphique, 55 textes par seconde pour les vecteurs. Depuis le 9 octobre, il travaille avec le processeur de l'Ubuntu : chacun prend les lots qu'il finit le plus vite. Éteint, le serveur continue sur son processeur, et le reprend une minute après son retour. Éteint lors de la mesure du 17 octobre : tout tournait sur le processeur de l'Ubuntu.

### Ollama cloud · API Gemini — L'IA

gemma4:31b pour presque tout. Si Ollama ne répond pas, ou pas en 120 s, le même modèle via l'API Gemini (plus lente, 30 à 90 s). deepseek-v4-pro écrit les deux textes que l'IA rédige elle-même : la version de l'IA d'une carte et son analyse, sans Gemini derrière. 6 appels en même temps au plus.

### Portable — Le code

Le développement et les tests : le serveur local lit la base de l'Ubuntu, sans ingestion. Le site lui-même (client React construit par Vite) est servi par l'Ubuntu.

---

Chiffres mesurés le 17 octobre 2026 entre 15 h 15 et 15 h 50 (heure suisse) sur la base du serveur, le PC de jeu éteint : l'embedder tournait sur le processeur de l'Ubuntu (charge moyenne de 8 à 10 pour 12 cœurs logiques). Ingestion : 24 dernières heures de la base (server/bench/funnel-now.mjs, 15 h 49) ; lectures de flux et durée des passes tirées des 14 passes du journal depuis le redémarrage de l'API à 15 h 15. Briefing : rejoué avec le code du 17 octobre sur le profil foot jusqu'à la vérification et la fusion, sans rien enregistrer (sans le retrait des sources inutiles ni les versions dans les autres langues), sur 48 heures et 7 jours ; lecture, passages, version de l'IA, angles, source officielle, analyse, durées et jetons tirés de son briefing de 48 h écrit en entier à 15 h 21 sans être enregistré (server/bench/news-journey.mjs), celui que suit « Parcours d'une nouvelle ». Recherche par phrase : même phrase que le 7 octobre, sans Google News, dans la langue du profil (l'anglais). Non remesurés, avec leur date : la découverte des sources (server/bench/discovery-phases.mjs, 6 octobre : elle interroge Google News et Media Cloud, partagés avec le serveur en marche), les vitesses des embedders, les durées par lot de regroupement et par appel des fils (7 octobre), l'étiqueteur des noms (13 octobre), les termes suivis (8 et 12 octobre) et la qualité de l'analyse (15 octobre). Les pourcentages de qualité (88 %, 95 %, 96 %, 85 %, 93 %) viennent des mesures précédentes du projet, jugées à la main.

Depuis le 7 octobre, la base a triplé (691 147 → 2 099 425 nouvelles), surtout par l'annuaire qui s'agrandit seul (1 382 → 2 369 flux) et les sources des lecteurs, lues pour tous depuis le 8 octobre : le profil foot lit 1 150 flux au lieu de 765. Le classement des 48 heures reste à 6 s ; celui des 7 jours, 30 s.

Le 3 octobre, environ 90 histoires mélangées avant la règle des affiches ont été découpées après coup (plus de 400 nouvelles déplacées, sauvegardes dans server/bench/data/matchups).

Remesuré en entier le 17 octobre 2026. Mis à jour le même jour : la version de l'IA des seules cartes gardées, une analyse en échec seulement sans carte finie depuis 12 minutes, une source retirée plus lue pour son profil, la connexion quelle que soit la casse du nom. Texte mis à jour le 16 octobre 2026 : briefings de 1 à 7 jours, projets, cartes envoyées écartées 48 h, points et résumé, version de l'IA, analyse des cartes, source officielle, noms relevés dans chaque nouvelle et noms des cartes, une seule liste de ce que le profil suit, e-mail aux formats choisis, 6 appels à Ollama au plus. Mis à jour le 12 octobre 2026 avec ce qui a changé depuis la mesure : création de compte par les questions de l'IA et fermée par défaut, mot de passe du site retiré, plusieurs profils, compte modifiable depuis le profil, part de chaque intérêt, briefings de 10, 20 ou 30 cartes, réserve plus grande, versions dans les autres langues, lecture des pages sans Crawlee d'abord, relecture par les refus, autres angles, termes suivis et page Following, envoi par e-mail, sources de chaque lecteur lues pour tous, archives sautées, embedders ensemble et tri de l'annuaire. Ces changements ont été remesurés le 17 octobre.
