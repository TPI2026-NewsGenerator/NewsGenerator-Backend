NewsGenerator · parcours d'une nouvelle

# Du texte d'une nouvelle à la carte du lecteur

Une seule nouvelle, suivie du début à la fin. Le flux de Foot Mercato la publie le 6 octobre à 16 h 49. Le serveur la lit, bge-m3 en fait deux vecteurs, et PostgreSQL la range avec les autres médias qui racontent le même fait. Le lendemain, Enzo demande son briefing : la base la classe parmi 44 526 histoires, puis l'IA la choisit, vérifie ses articles et choisit les phrases montrées. Elle devient la troisième carte du briefing.

Mesuré le **7 octobre 2026** sur la base du serveur Ubuntu · Lecteur : **Enzo** (lit en français, 3 intérêts) · Scripts : **server/bench/news-journey.mjs** + **news-journey-story.mjs** · Texte mis à jour le **12 octobre 2026**

Le parcours est celui du 7 octobre ; ce qui a changé depuis est signalé à sa place. « Parcours NewsGenerator » mesure, lui, l'ensemble du serveur le même jour vers 1 h 30, avec un briefing rejoué jusqu'à la fusion : ses nombres diffèrent un peu de ceux-ci (67 636 nouvelles au lieu de 68 259, 12 histoires choisies au lieu de 15, 10 cartes au lieu de 9), c'est un autre moment et un autre briefing.

## Vue d'ensemble : six étapes, de la page du média à la carte

Les trois premières tournent sur le serveur dès que la nouvelle arrive, pour tous les lecteurs à la fois. Les trois dernières n'ont lieu que quand un lecteur demande son briefing.

- **À LA LECTURE · SERVEUR, POUR TOUS** : 1 · Texte (titre + début de la description, découpés en jetons ; 18 + 74 jetons) → 2 · bge-m3 (dense : le sens creux : le poids de chaque mot ; 1 024 nombres, + 48 mots) → 3 · PostgreSQL (pgvector : l'histoire du même fait, puis le fil de l'affaire ; histoire 305801, score 0,871)
- **AU BRIEFING · POUR UN LECTEUR** : 4 · Classement (une requête SQL note chaque histoire contre ses intérêts ; 16e / 44 526, note 0,622) → 5 · IA (choisir, vérifier, fusionner, choisir les phrases, relire ; 3e sur 47, phrases 1, 2, 3, 5) → 6 · Carte (titre, raison, passages, médias, fil de l'affaire ; 3e de 9, 18 médias)

| Quand | Quoi | Délai |
|---|---|---|
| 6 oct. 16:49:35 | Foot Mercato publie |  |
| 16:52:54 | le serveur lit le flux | +3 min 19 s |
| 16:53:43 | les deux vecteurs sont prêts | +49 s |
| peu après | histoire 305801, puis le fil de l'affaire |  |
| 7 oct. 15:29 | Enzo demande un briefing de 48 h |  |
| +57,6 s | la carte est prête, avec 8 autres |  |

## À la lecture · le serveur, pour tous les lecteurs : comprendre la nouvelle et la ranger

Ce travail est fait une fois par nouvelle, quel que soit le nombre de lecteurs. Aucune IA n'y intervient : seulement bge-m3 et des calculs en SQL.

### 1 · Le texte : ce qui est lu de la nouvelle

Le flux RSS donne le titre, une description, le lien et la date. Le serveur n'ouvre pas encore la page : à ce stade, il garde seulement ce que le flux donne.

> FIFA : la Norvège dépose deux nouvelles plaintes contre Infantino
>
> La Fédération norvégienne (NFF) a déposé ce mardi deux plaintes auprès de la FIFA visant notamment la gouvernance de Gianni Infantino. La première demande au Comité d'éthique de l'instance d'examiner (…)

- La description est coupée par le flux lui-même : « (…) ». Langue : celle du flux, confirmée par les petits mots du texte (« la », « ce »…) : français.
- Deux textes partent vers bge-m3 : **le titre seul**, pour regrouper les titres du même fait, et **le titre suivi des 400 premiers caractères de la description** (`richText`), pour le texte des histoires et pour les intérêts des lecteurs.
- Un même texte vu dans plusieurs flux n'est encodé qu'une fois.

**Les jetons**

bge-m3 ne lit pas des mots mais des jetons, des morceaux de mots tirés d'un vocabulaire de 250 002 entrées commun à une centaine de langues. Le signe ▁ marque le début d'un mot. En jaune, les mots rares découpés en morceaux.

```
<s> | ▁FIFA | ▁: | ▁la | ▁Nor | v | ège | ▁dé | pose | ▁deux | ▁nouvelles | ▁plain | tes | ▁contre | ▁In | fa | ntino | </s>
```

- Un mot courant reste entier : ▁FIFA, ▁contre, ▁nouvelles. Un nom rare est découpé : Infantino → ▁In | fa | ntino, Norvège → ▁Nor | v | ège ; plus loin, gouvernance → ▁gou | vern | ance.
- Le titre fait 18 jetons, le texte complet 74. bge-m3 lit au plus 256 jetons par texte : assez pour un titre et 400 caractères.

*Technologies :* fetch Node 24 · fast-xml-parser · langue : mots courants, franc · tokenizer XLM-RoBERTa (SentencePiece)

### 2 · bge-m3 : deux vecteurs pour chaque texte

Le modèle reçoit les jetons. Ses 24 couches réécrivent chacun d'eux en 1 024 nombres, à la lumière des autres jetons de la phrase : « ▁In », entre « Gianni » et « fa ntino », ne veut plus dire « dans ». Deux lectures en sortent.

**Le vecteur dense : le sens de tout le texte**

- On prend la sortie du premier jeton (`<s>`), qui a lu toute la phrase, puis on la ramène à une longueur de 1. Ses huit premiers nombres : −0,0256 ; 0,0175 ; −0,0157 ; 0,0073 ; 0,0083 ; 0,0071 ; −0,0038 ; −0,0080.
- Aucun nombre ne veut rien dire seul (ils vont de −0,181 à 0,227) : c'est leur ensemble qui situe le sens. Deux textes proches pointent dans la même direction, et leur produit scalaire (la somme des 1 024 produits deux à deux) est leur cosinus : 1 pour deux textes pareils, bien moins pour deux sans rapport.
- Le sens dépend peu de la langue : le titre d'El Mundo, « La federación noruega denuncia la gobernanza de Infantino ante la propia FIFA », fait 0,820 avec celui de Foot Mercato.

**Le vecteur creux : le poids de chaque mot**

| Jeton | Poids |
|---|---|
| ▁FIFA | 0,285 |
| ntino | 0,262 |
| FF | 0,254 |
| fa | 0,248 |
| ▁plain | 0,223 |
| vég | 0,211 |
| ège | 0,202 |
| vern | 0,197 |
| v | 0,193 |
| ▁Fédération | 0,178 |
| ▁Nor | 0,177 |
| tes | 0,175 |
| ▁In | 0,171 |
| ▁contre | 0,170 |
| ▁Gian | 0,164 |
| ▁nor | 0,164 |
| ▁déposé | 0,159 |
| ▁auprès | 0,155 |
| ▁gou | 0,149 |
| ▁deux | 0,148 |

… et 28 autres, de ▁Comité 0,106 à ▁la 0,098, ▁de 0,069 et ▁ce 0,009

- Une petite couche apprise donne à chaque jeton un poids : `max(0, w · sortie du jeton + b)`. Un jeton répété garde son plus grand poids, et les jetons spéciaux sont retirés.
- Seuls les jetons du texte reçoivent un poids : le vecteur a 250 002 cases, et 48 seulement sont remplies (15 pour le titre). Les noms pèsent le plus, les petits mots presque rien.
- Pourquoi les deux ? Le dense trouve deux titres qui disent la même chose avec d'autres mots, mais il rapproche aussi deux pages modèles : « Egypt vs Angola – Betting Tips » et « Togo vs Burundi – Betting Tips » font 0,79. Le creux les sépare, parce qu'elles n'ont aucun nom en commun. Mesuré : 96 % de bonnes cartes avec les deux, 82 % avec les mots seuls.

*Technologies :* BAAI/bge-m3 (XLM-RoBERTa large) · FlagEmbedding + PyTorch (carte graphique) · ONNX Runtime (processeur) · POST /embed

*Où ça tourne :* L'embedder : Python, HTTP (`POST /embed {"texts": [...]}` → `{"dense": [[1024 nombres]], "sparse": [{"id du jeton": poids}]}`, avec un jeton secret) · PC de jeu, RTX 4070 Ti : 55 textes/s (PyTorch) · Processeur du serveur Ubuntu : ≈ 4 textes/s (ONNX Runtime, mêmes vecteurs (cosinus 0,99997)) · Choix : tous ensemble (depuis le 9 octobre, chaque embedder de la liste EMBEDDER_URL qui répond prend les lots qu'il finit le plus vite ; le 7 octobre, le premier qui répondait)

### 3 · PostgreSQL + pgvector : ranger, regrouper, relier

Chaque nouvelle garde quatre vecteurs dans sa ligne de la table `articles`. Tous les calculs sont exacts, faits en SQL dans la base. Il n'y a pas d'index approximatif (HNSW) : il pourrait oublier une histoire proche.

| Colonne | Type pgvector | Ce qu'elle garde |
|---|---|---|
| `title_dense`, `text_dense` | `halfvec(1024)` | 2 Ko chacun, en demi-précision, dans la ligne : un cosinus bouge de 0,0001 au plus, la table passe de 1,48 à 0,99 Go et se relit 8 fois plus vite |
| `title_sparse`, `text_sparse` | `sparsevec(250002)` | seulement les jetons présents : `{37672:0.21973,78245:0.21454,…}/250002` |

`<#>` est l'opérateur de pgvector qui donne le produit scalaire, négatif. `-(a <#> b)` vaut donc le cosinus de deux vecteurs denses, et pour deux vecteurs creux la somme des poids multipliés des jetons partagés.

**L'histoire : la même nouvelle chez d'autres médias (`assign_stories`)**

- **Présélection** : les 100 histoires françaises des 48 h dont la moyenne des textes est la plus proche.
- **Score** : la moyenne, sur les nouvelles de chaque histoire venues d'autres médias, de la proximité des titres, dense + creux.
- **Conditions** : titres ≥ 0,70 et textes ≥ 0,60. Une histoire calme depuis plus de 6 h demande 0,003 de plus par heure.
- La nouvelle rejoint la meilleure histoire qui passe, sinon elle en commence une.

Au moment où la nouvelle de Foot Mercato a été placée (le trait noir marque le seuil) :

| Histoire candidate | Autres médias | Titres : dense + creux | Textes | Décision |
|---|---|---|---|---|
| 305801 La Norvège s’attaque à Gianni Infantino : deux plaintes qui pourraient secouer la FIFA | 20 (10 médias) | 0,758 + 0,113 = **0,871** | 0,785 | rejointe : la meilleure |
| 312864 FIFA : deux nouvelles plaintes contre Gianni Infantino | 2 | 0,549 + 0,184 = **0,733** | 0,709 | acceptable, moins bonne |
| 241701 Acusan a la FIFA de Infantino de tapar la alineación indebida de RD Congo | 15 | 0,588 + 0,145 = **0,733** | 0,607 | acceptable de justesse : un autre fait |
| 62971 Crise à la Fifa : Gianni Infantino reçoit le soutien des associations arabes | 27 | 0,537 + 0,148 = **0,685** | 0,582 | refusée : sous 0,70 et 0,60, calme depuis 22 h (−0,048) |

Dans l'histoire 305801, quelques titres comparés à celui de Foot Mercato :

| Média | Titre | Dense | Creux | Total |
|---|---|---|---|---|
| sport.fr | FIFA : La Norvège dépose deux plaintes contre Gianni Infantino | 0,962 | 0,293 | 1,255 |
| L'Équipe | La fronde contre Gianni Infantino continue : la Fédération norvégienne a porté plainte à deux reprises auprès de la FIFA | 0,861 | 0,199 | 1,060 |
| El Mundo | La federación noruega denuncia la gobernanza de Infantino ante la propia FIFA | 0,820 | 0,162 | 0,982 |
| Ouest-France | Après les multiples polémiques autour de la Fifa et Infantino, la Fédération norvégienne de football porte plainte | 0,809 | 0,122 | 0,931 |
| Boursorama | Football-La Fédération norvégienne saisit deux commissions de la Fifa sur la gouvernance et l'éthique | 0,660 | 0,044 | 0,704 |

Boursorama ne dit ni « Norvège », ni « plainte », ni « Infantino » : le creux est presque nul, mais le dense reconnaît le même fait. Aujourd'hui, l'histoire compte 39 lignes, 28 liens différents et 20 médias : une nouvelle présente dans plusieurs flux a une ligne par flux.

**Ce que le regroupement ne fait pas.** Une nouvelle choisit une histoire, mais deux histoires ne fusionnent jamais après coup. L'histoire 312864, née 2 h 40 plus tôt sur le même fait, reste à part : c'est le fil, puis l'IA (5c), qui les réunissent.

**Le fil : l'affaire suivie dans le temps (`assign_threads`)**

- Une histoire rejoint le fil dont elle ressemble en moyenne aux histoires des autres médias, à 0,75 ou plus ; deux fils nés à part fusionnent à 0,70.
- La comparaison se fait sur le centre (`centroid`) de chaque histoire : la moyenne normalisée des textes de ses nouvelles.

| Histoire | Née le | Médias | Proximité avec 305801 | Premier titre |
|---|---|---|---|---|
| 212419 | 4 oct. | 3 | 0,746 | Tout ce qu'il faut savoir sur la crise entre Gianni Infantino et la FIFA : historique, dates clés et actualités |
| 305801 | 6 oct. | 20 | 1 | La Norvège s'attaque à Gianni Infantino : deux plaintes qui pourraient secouer la FIFA |
| 312864 | 6 oct. | 7 | 0,861 | FIFA : deux nouvelles plaintes contre Gianni Infantino |

*Technologies :* PostgreSQL 18 · pgvector 0.8 (halfvec, sparsevec, <#>) · assign_stories (PL/pgSQL) · assign_threads (PL/pgSQL)

## Au briefing · pour un lecteur : la choisir pour Enzo et la montrer

Le 7 octobre à 15 h 29, Enzo demande un briefing de 48 h. Rien n'est relu sur le web avant que l'IA ait choisi : la base classe ce que le serveur a déjà préparé.

### 4 · Le classement pour le lecteur (`rank_stories`, aujourd'hui `rank_profile_stories`)

Une seule requête SQL prend toutes les nouvelles de ses 765 flux sur 48 h, dans toutes les langues. Chaque nouvelle est notée contre chacun de ses intérêts : **poids × (dense + 0,5 × creux)**, sur le texte complet. Chaque intérêt a ses propres vecteurs, calculés une fois à partir de son texte. Une nouvelle garde son meilleur intérêt, une histoire sa meilleure nouvelle.

| Intérêt d'Enzo | Dense | Creux | Note |
|---|---|---|---|
| Gouvernance du football (élections, dirigeants, crises de gouvernance…) | 0,579 | 0,087 | **0,622** |
| Instances internationales (UEFA, ses 55 associations, la FIFA…) | 0,568 | 0,079 | **0,608** |
| Arbitrage (VAR, Lois du Jeu, désignations…) | 0,539 | 0,006 | **0,542** |

- Le creux ne compte que les jetons partagés. Avec « Gouvernance » : vern 0,197 × 0,223 = 0,044 ; ▁gou 0,149 × 0,157 = 0,024 ; ance 0,096 × 0,127 = 0,012 ; 3 petits mots, 0,007. Total 0,087 : c'est le mot « gouvernance » de la description qui fait le lien.
- Avec « Instances internationales » : ▁FIFA 0,285 × 0,188 = 0,054, plus quelques miettes.

**Du tout au peu : où se trouve la nouvelle**

| Étape | Nombre | La nouvelle |
|---|---|---|
| Nouvelles de ses sources (48 h) | 68 259 |  |
| Histoires notées | 44 526 | 16e |
| Gardées par le SQL | 600 | 16e |
| Partagées entre les intérêts | 150 | 16e · 2e de « Gouvernance » |
| Crédibles | 146 |  |
| Candidates pour l’IA | 47 | candidate |
| Choisies par l’IA | 15 | 3e |
| Gardées (10 + 5 en réserve) | 10 | 3e |
| Cartes montrées | 9 | 3e carte |

- Les 600 meilleures histoires sont gardées, et chaque intérêt reçoit 50 places sur 150. Notes : de 0,766 (1re) à 0,536 (150e).
- Juste devant elle dans son intérêt : « From Cristiano Ronaldo to Diego Maradona: seven of football's messiest national-team exits ». Juste derrière : une analyse de la crise bancaire de 2008 par Gordon Brown, puis un quiz. Les vecteurs ne distinguent pas un fait d'un quiz : c'est le travail de l'IA.
- Candidates : les 40 meilleures venues de flux, partagées entre les intérêts, et 7 de plus, connues seulement par Google News ou racontées par une source de confiance.

*Technologies :* rank_stories (SQL) · pgvector · shareOut · pickCandidates

*Enzo, 48 h :* Dans ses sources : 68 259 nouvelles (44 526 histoires, 34 langues, 765 flux) · Rang de la nouvelle : 16e (2e de son intérêt, note 0,622) · Candidates pour l'IA : 47 (17, 15 et 15 par intérêt) · Durée : 5,3 s (le SQL des 600 ; 23 s pour l'étape entière, serveur chargé)

### 5 · L'IA : choisir, vérifier, fusionner, choisir les phrases, relire

Toutes ces étapes utilisent gemma4:31b sur Ollama cloud, à une température de 0,1, avec une réponse en JSON. L'IA ne voit jamais de vecteur : seulement du texte. En jaune, ce qui concerne la nouvelle suivie.

**5a · Choisir (`selectStories`) · 4 811 jetons lus, 761 écrits, 2,7 s**

L'IA reçoit le profil d'Enzo dans ses mots, ses 3 intérêts, puis une ligne par candidate. Celle de l'exemple :

```
[305801] FIFA : la Norvège dépose deux nouvelles plaintes contre Infantino — La Fédération norvégienne (NFF) a déposé ce mardi deux plaintes auprès de la FIFA visant notamment la gouvernance de Gianni Infantino. La première demande au Comité d'éthique de l'instance d'examiner  (aussi : Nouvelle tempête pour la FIFA ! La Norvège dépose une plainte éthique remettant en question la conduite de Gianni Infantino / La Federación de Futbol de Noruega pide a la FIFA investigar a Infantino / La Federación de Noruega pide formalmente a la FIFA investigar a Infantino)
… 46 autres lignes …

Choisis au plus 15 histoires qui correspondent vraiment à ce que ce lecteur demande, de la plus à la moins pertinente.
Couvre tous ses intérêts […] Ce qu'il dit ne pas vouloir est exclu […] une liste courte vaut mieux qu'une histoire hors sujet. Varie […] Préfère les faits du jour […] Ne choisis jamais une page qui n'apporte aucun fait nouveau […]
Réponds uniquement en JSON : {"selected": [{"id": "...", "why": "une phrase courte"}]}
```

```
{"selected": [
  {"id": "309953", "why": "Concerne la mise sous tutelle de la Fédération italienne de football …"},
  {"id": "370308", "why": "Traite de la stratégie de l'UEFA pour évincer le président de la FIFA …"},
  {"id": "305801", "why": "Plaintes déposées par la Fédération norvégienne contre la gouvernance de Gianni Infantino auprès de la FIFA."},
  … 12 autres]}
```

- 15 histoires choisies, celle de l'exemple en 3e. La raison est tirée seulement du titre et de la description.
- Équilibre : 3 places par intérêt, puis le reste dans l'ordre de l'IA. Elle est gardée parmi les 10 ; les 5 dernières restent en réserve, pour remplacer une carte illisible.

> Depuis le 8 octobre, l'IA choisit jusqu'à 20 histoires pour 10 cartes (30 pour 20 cartes, 45 pour 30) : la réserve est plus grande.

**5b · Vérifier les articles de l'histoire (`checkStories`) · toutes les cartes en un appel, 1 796 jetons lus, 352 écrits, 1,9 s**

Le regroupement par vecteurs peut mêler deux faits proches. L'IA reçoit l'article principal (P) et jusqu'à 12 autres titres, un par média d'abord, et dit lesquels racontent le même événement.

```
[305801]
P. FIFA : la Norvège dépose deux nouvelles plaintes contre Infantino — …
1. Nouvelle tempête pour la FIFA ! La Norvège dépose une plainte éthique …
2. La Federación de Futbol de Noruega pide a la FIFA investigar a Infantino
3. Les murs se resserrent ! La Norvège dépose une plainte explosive contre Infantino
…
12. La fronde contre Gianni Infantino continue : la Fédération norvégienne a porté plainte à deux reprises auprès de la FIFA
```

```
{"id": "305801", "same": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]}
```

Les 12 sont gardés, titres espagnols compris. Ailleurs, la même vérification a retiré 2 articles de l'histoire de Manchester City.

> Depuis le 8 octobre, chaque carte apporte aussi à cette vérification ses versions dans les autres langues (0,78 et plus, 4 au plus) : celles qui racontent le même fait la rejoignent.

**5c · Fusionner les cartes du même fait (`mergeStories`) · 20 lignes, 1 328 jetons lus, 1 015 écrits, 5,8 s**

L'IA reçoit les cartes, la réserve et les versions dans la langue du lecteur. Pour chacune, elle écrit d'abord le fait principal, puis dit s'il est le même qu'une histoire plus haut.

```
{"id": "305801", "fait": "La Fédération norvégienne dépose deux plaintes contre Gianni Infantino à la FIFA", "sameAs": null}
…
{"id": "312864", "fait": "La Fédération norvégienne demande l'enquête sur Infantino (Trump, Balogun, FFE)", "sameAs": "305801"}
```

L'histoire 312864, arrivée comme version française d'une autre carte, rejoint 305801. La séparation de l'étape 3 est réparée ici : la carte compte les médias des deux. Deux autres fusions dans ce briefing : Manchester City et la CAN.

**5d · Lire la page et choisir les phrases (`extractArticle`) · 783 jetons lus, 34 écrits, 1,3 s**

Maintenant seulement, les pages sont téléchargées : 5 articles par histoire au plus, un par média, celui dans la langue du lecteur d'abord. Le texte est extrait comme le fait le mode lecture de Firefox, puis découpé en phrases numérotées. L'IA ne réécrit rien, elle renvoie des numéros.

```
TITLE: FIFA : la Norvège dépose deux nouvelles plaintes contre Infantino

SENTENCES:
[1] La Fédération norvégienne (NFF) a déposé ce mardi deux plaintes auprès de la FIFA visant notamment la gouvernance de Gianni Infantino.
[2] La première demande au Comité d'éthique de l'instance d'examiner la conduite du président de la FIFA et d'autres responsables concernant de potentielles violations du code d'éthique.
[3] La seconde saisit la Commission d'audit et de conformité afin de vérifier si les règles de gouvernance, les contrôles financiers et internes ainsi que les processus décisionnels de la FIFA ont bien été respectés.
[4] La suite après cette publicité
[5] À la pointe de la fronde contre Infantino, la NFF et sa présidente Lise Klaveness ciblent trois dossiers distincts, à savoir l'attribution du Prix de la paix à Donald Trump en décembre dernier, la levée de la suspension de Folarin Balogun pendant la Coupe du Monde et le projet FIFA Forward Enterprise, finalement abandonné après de nombreuses contestations.
[6] Pour la Fédération norvégienne, ces trois affaires illustrent un même problème, celui d'une « utilisation abusive des pouvoirs et de l'influence de la FIFA ».
[7] Une nouvelle offensive qui intervient alors qu'Infantino, confronté à une crise de gouvernance, prépare sa candidature à un nouveau mandat en mars prochain.
[8] Pub. le 06/10/2026 16:49 - MAJ le 06/10/2026 20:14
```

```
{"topic": "sport", "sourcing": "named", "sentences": [1, 2, 3, 5]}
```

- Elle laisse la publicité [4] et la date [8]. Les phrases 1 à 3 se suivent et forment un passage, la 5 en forme un second : le lecteur voit le saut entre les deux. Au plus 5 phrases et 170 mots.
- `sourcing: named` : l'article nomme sa source, la NFF. L'article est en français : rien à traduire. Ailleurs, un autre appel traduit les phrases, et le serveur contrôle que chaque chiffre est gardé.
- Corroboration, sans IA : 2 pages lues, 2 rédactions indépendantes. Deux textes qui partagent la moitié de leurs suites de 8 mots seraient une même dépêche d'agence ; il n'y en a pas ici. Aucun verbe de démenti dans les pages lues : pas d'appel « contesté ».

> Depuis le 8 octobre, la page est d'abord lue par une simple requête, et Crawlee seulement si elle manque ; son image (og:image) est gardée pour la carte.

**5e · Relire avant de montrer (`reviewCards`) · 2 210 jetons lus, 70 écrits, 0,8 s**

L'IA relit les 10 cartes avec leurs passages. Elle cherche seulement celles dont le sujet principal est ce que le profil refuse, et qu'un titre seul pouvait cacher. Celle de l'exemple est gardée. Une autre est retirée, celle du Tribunal arbitral du sport et de la CAN 2025.

> Depuis le 7 octobre au soir, la relecture reçoit les intérêts et la liste des refus d'Enzo, et seul un de ces refus retire une carte. Elle a lieu à chaque tour de lecture, et une carte retirée est remplacée par la réserve. Cet exemple n'a pas été rejoué avec la nouvelle règle.

**5f · Autres angles et termes suivis (depuis le 8 octobre)**

Cette étape n'existait pas le 7 octobre. Les cartes prêtes, deux recherches partent ensemble : pour chaque carte, l'IA juge sur leurs titres jusqu'à 8 histoires de toutes les langues des 3 derniers jours (0,6 et plus) et garde au plus 3 autres angles de l'affaire, qui ne disent pas la même chose ; et les nouvelles des termes suivis par le profil sont listées, sans pertinence ni IA. Une carte comme celle-ci, au cœur d'une affaire suivie par une vingtaine de médias, est le cas où les angles servent le plus.

*Technologies :* gemma4:31b (Ollama cloud) · JSON, température 0,1 · fetch + @mozilla/readability · Crawlee (Cheerio) en secours · corroboration (shingles)

### 6 · Le résultat : la carte

> Foot Mercato · 6 octobre, 16 h 49 · Gouvernance du football
>
> **FIFA : la Norvège dépose deux nouvelles plaintes contre Infantino**
>
> *Pourquoi pour vous :* Plaintes déposées par la Fédération norvégienne contre la gouvernance de Gianni Infantino auprès de la FIFA.
>
> La Fédération norvégienne (NFF) a déposé ce mardi deux plaintes auprès de la FIFA visant notamment la gouvernance de Gianni Infantino. La première demande au Comité d'éthique de l'instance d'examiner la conduite du président de la FIFA et d'autres responsables concernant de potentielles violations du code d'éthique. La seconde saisit la Commission d'audit et de conformité afin de vérifier si les règles de gouvernance, les contrôles financiers et internes ainsi que les processus décisionnels de la FIFA ont bien été respectés.
>
> […]
>
> À la pointe de la fronde contre Infantino, la NFF et sa présidente Lise Klaveness ciblent trois dossiers distincts, à savoir l'attribution du Prix de la paix à Donald Trump en décembre dernier, la levée de la suspension de Folarin Balogun pendant la Coupe du Monde et le projet FIFA Forward Enterprise, finalement abandonné après de nombreuses contestations.
>
> - **18** médias
> - **2** rédactions lues, indépendantes
> - source nommée
> - fil de l'affaire : **3** faits depuis le 4 oct.

C'est la 3e des 9 cartes du briefing. Parmi les médias : L'Équipe, Ouest-France, Le Parisien, So Foot, El Mundo, Goal, TUDN.

> Aujourd'hui, la même carte montrerait aussi son image, le code de langue de chaque article, ses autres angles (5f), et le bouton « Names and terms found » la retrouverait si elle nomme un terme suivi par le profil.

*Ce qu'elle a coûté :* Briefing entier : 57,6 s (classement 23 s, choix 3 s, vérification et fusion 7 s, lecture 3 s, passages et relecture 22 s) · Jetons de l'IA, briefing entier : 30 227 (23 appels : choix 5 572, vérification et fusion 4 491, passages, traductions et démentis 17 884, relecture 2 280) · Pour cette nouvelle seule : 817 jetons (pour ses phrases ; plus une ligne dans le choix et la fusion, 13 titres dans la vérification, un paragraphe dans la relecture) · Ses vecteurs : une fois (à la lecture, pour tous les lecteurs)

## Ce que l'exemple montre aussi : quatre leçons d'une seule nouvelle

### Les vecteurs trouvent, l'IA trie

Dans le même intérêt, un palmarès de départs de sélection et un quiz étaient notés presque aussi haut que la nouvelle. Seule l'IA sépare un fait d'un quiz.

### Une histoire coupée en deux est réparée plus loin

Deux histoires du même fait (305801 et 312864) sont nées à 2 h 40 d'écart et le restent. Le fil les relie (0,861), puis la fusion de l'IA en fait une seule carte.

### Un autre fait peut passer les seuils

L'histoire de la RD Congo, un autre scandale autour d'Infantino, atteignait 0,733 et 0,607 : la nouvelle aurait pu la rejoindre si 305801 n'avait pas été meilleure. C'est pour cela que l'IA vérifie les articles de chaque carte (5b).

### Défaut relevé : des titres espagnols marqués « français »

Les nouvelles de la recherche Google News espagnole « noticias FIFA » (El Mundo, TUDN, Montevideo) sont enregistrées en français. Leur titre compte trois « la », qui sont autant de mots français qu'espagnols, et sans description rien ne départage. L'égalité va au français, la première langue de la liste, même quand la recherche est espagnole. Ici, c'est sans conséquence : le dense compare toutes les langues, et l'article lu est français. Mais une carte menée par l'un de ces titres ne serait pas traduite.

**Corrigé le 7 octobre** (`services/utils/language.js`) : en cas d'égalité, la langue du flux ou de la recherche l'emporte. Rejoué sur les 656 404 nouvelles des 7 derniers jours, la règle change la langue de 3 171 d'entre elles (0,5 %), toutes vers celle de leur flux : des titres allemands, tchèques, portugais ou néerlandais pris pour de l'anglais, de l'espagnol ou de l'italien, et 213 titres espagnols pris pour du français. Les nouvelles déjà enregistrées gardent leur langue ; la correction vaut pour les suivantes.

---

Mesuré le 7 octobre 2026 à 15 h 29 (heure suisse) sur la base du serveur Ubuntu. Le briefing de 48 h d'Enzo a été écrit en entier avec le code du jour, sans rien enregistrer. Chaque appel à l'IA a été gardé avec son prompt et sa réponse (server/bench/news-journey.mjs). Les vecteurs, les proximités, le fil et les scores du regroupement viennent de la base (server/bench/news-journey-story.mjs). Pour le regroupement, les membres de chaque histoire ont été pris tels qu'ils étaient quand la nouvelle a reçu ses vecteurs. Les jetons ont été traduits en mots par le tokenizer de bge-m3.

Le briefing n'a rien montré à Enzo et n'a rien changé à ses sources. Les pourcentages de qualité (96 %, 82 %) et les vitesses de l'embedder viennent des mesures précédentes du projet.

Texte mis à jour le 12 octobre 2026 : le parcours n'a pas été rejoué, ce qui a changé depuis est signalé à sa place (réserve plus grande, versions dans les autres langues, lecture des pages, relecture par les refus, autres angles et termes suivis, embedders ensemble). « Parcours NewsGenerator » décrit le reste du fonctionnement d'aujourd'hui.

Depuis, au 16 octobre 2026 : le classement se fait par profil et lit aussi les intérêts de ses projets (`rank_profile_stories`) ; une carte envoyée par e-mail est écartée 48 heures ; chaque carte a aussi ses points et son résumé faits des phrases publiées, une version de l'IA sur demande (deepseek-v4-pro), une analyse, une source officielle et ses noms ; les noms de chaque nouvelle sont relevés par un étiqueteur. Le parcours ci-dessus n'a pas été rejoué avec ces changements.
