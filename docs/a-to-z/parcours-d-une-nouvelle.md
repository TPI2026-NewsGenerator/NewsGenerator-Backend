NewsGenerator · parcours d'une nouvelle

# Du texte d'une nouvelle à la carte du lecteur

Une seule nouvelle, suivie du début à la fin. Le flux de tribuna.com la publie le 16 octobre à 22 h 34. Le serveur la lit, relève ses noms, bge-m3 en fait deux vecteurs, et PostgreSQL la range avec les 37 autres médias anglophones qui racontent le même fait. Le lendemain, Enzo demande son briefing : la base la classe parmi 68 101 histoires, l'IA la choisit, vérifie ses articles et lui joint ses versions en quatre autres langues, choisit les phrases montrées, écrit sa version IA, cherche ses autres angles et sa source officielle, puis, la carte déjà montrée, son analyse. Elle devient la quatrième carte du briefing.

Mesuré le **17 octobre 2026** sur la base du serveur Ubuntu · Lecteur : **Enzo**, profil « Enzo » (lit en anglais, 2 intérêts) · Scripts : **server/bench/news-journey.mjs** + **news-journey-story.mjs**, **-grouping.mjs**, **-rank.mjs**

Le profil d'Enzo lit maintenant en anglais : la carte et les réponses de l'IA sont en anglais, le reste de la page en français. Ce parcours remplace celui du 7 octobre (Foot Mercato, les plaintes de la Norvège contre Infantino), mesuré avant les points, le résumé, les versions IA, l'analyse et la source officielle. « Parcours NewsGenerator » décrit l'ensemble du serveur avec des mesures du 7 octobre : ses nombres sont d'un autre moment.

## Vue d'ensemble : six étapes, de la page du média à la carte

Les trois premières tournent sur le serveur dès que la nouvelle arrive, pour tous les lecteurs à la fois. Les trois dernières n'ont lieu que quand un lecteur demande son briefing.

- **À LA LECTURE · SERVEUR, POUR TOUS** : 1 · Texte (titre + description, en jetons ; ses noms relevés par GLiNER ; 16 + 90 jetons, 5 noms) → 2 · bge-m3 (dense : le sens creux : le poids de chaque mot ; 1 024 nombres, + 51 mots) → 3 · PostgreSQL (pgvector : l'histoire du même fait, puis le fil de l'affaire ; histoire 798086, score 0,953)
- **AU BRIEFING · POUR UN LECTEUR** : 4 · Classement (une requête SQL note chaque histoire contre ses intérêts ; 45e / 68 101, note 0,611) → 5 · IA (choisir, vérifier, les phrases, version IA, angles, analyse ; 4e sur 47, phrases 7, 1, 8) → 6 · Carte (passages, médias, source officielle, angles, analyse ; 4e de 10, 21 médias)

| Quand | Quoi | Délai |
|---|---|---|
| 16 oct. 22:34:00 | tribuna.com publie |  |
| 22:40:36 | le serveur lit le flux | +6 min 36 s |
| 22:41:28 | ses noms sont relevés | +52 s |
| 22:41:34 | les deux vecteurs sont prêts, puis l'histoire 798086 | +6 s |
| 17 oct. 15:21 | Enzo demande un briefing de 48 h |  |
| +2 min 34 s | la carte est prête, avec 9 autres |  |
| +1 min 43 s | son analyse est écrite |  |

## À la lecture · le serveur, pour tous les lecteurs : comprendre la nouvelle et la ranger

Ce travail est fait une fois par nouvelle, quel que soit le nombre de lecteurs. Aucune IA générative n'y intervient : bge-m3 pour les vecteurs, GLiNER pour les noms, et des calculs en SQL.

### 1 · Le texte : ce qui est lu de la nouvelle

Le flux RSS donne le titre, une description, le lien et la date. Le serveur n'ouvre pas encore la page : à ce stade, il garde seulement ce que le flux donne.

> FIFA to amend Article 27 after controversy surrounding Balogun case
>
> FIFA has committed to amending Article 27 of its disciplinary regulations following questions raised by the Belgian Football Association (RBFA) over the Folarin Balogun case. The announcement came after a FIFA Council meeting in Zurich, where RBFA president Pascale Van Damme raised concerns about the disciplinary process and the circumstances surrounding the case.

- La description du flux tient en deux phrases. Langue : celle du flux, confirmée par les petits mots du texte (« to », « the », « after ») : anglais.
- Deux textes partent vers bge-m3 : **le titre seul**, pour regrouper les titres du même fait, et **le titre suivi des 400 premiers caractères de la description** (`richText`), pour le texte des histoires et pour les intérêts des lecteurs. Ici, la description entière y tient.
- Un même texte vu dans plusieurs flux n'est encodé qu'une fois.
- À côté, l'étiqueteur (GLiNER multi v2.1) lit le titre et 700 caractères de la description et relève 5 noms : **FIFA**, **RBFA**, **Belgian Football Association**, **Pascale Van Damme** (organisations et personne) et **Zurich** (lieu). Deux deviennent une fiche de Wikidata, la seule fiche qui porte exactement ce nom : Pascale Van Damme et la Belgian Football Association. « FIFA », cité par 8 734 nouvelles, n'en a aucune : plusieurs fiches s'appellent ainsi.

**Les jetons**

bge-m3 ne lit pas des mots mais des jetons, des morceaux de mots tirés d'un vocabulaire de 250 002 entrées commun à une centaine de langues. Le signe ▁ marque le début d'un mot. En jaune, les mots découpés en morceaux.

```
<s> | ▁FIFA | ▁to | ▁a | mend | ▁Article | ▁27 | ▁after | ▁contro | vers | y | ▁surrounding | ▁Balo | gun | ▁case | </s>
```

- Un mot courant reste entier : ▁FIFA, ▁Article, ▁after, ▁case. Un mot plus rare est découpé : amend → ▁a | mend, controversy → ▁contro | vers | y, Balogun → ▁Balo | gun ; plus loin, disciplinary → ▁disciplina | ry, Folarin → ▁Fol | arin.
- Le titre fait 16 jetons, le texte complet 90. bge-m3 lit au plus 256 jetons par texte : assez pour un titre et 400 caractères.

*Technologies :* fetch Node 24 · fast-xml-parser · langue : mots courants, franc · tokenizer XLM-RoBERTa (SentencePiece) · GLiNER (noms)

### 2 · bge-m3 : deux vecteurs pour chaque texte

Le modèle reçoit les jetons. Ses 24 couches réécrivent chacun d'eux en 1 024 nombres, à la lumière des autres jetons de la phrase : « ▁a », suivi de « mend », ne veut plus dire « un ». Deux lectures en sortent.

**Le vecteur dense : le sens de tout le texte**

- On prend la sortie du premier jeton (`<s>`), qui a lu toute la phrase, puis on la ramène à une longueur de 1. Ses huit premiers nombres : −0,0055 ; −0,0336 ; −0,0280 ; 0,0228 ; −0,0092 ; −0,0022 ; 0,0462 ; −0,0235.
- Aucun nombre ne veut rien dire seul (ils vont de −0,163 à 0,191) : c'est leur ensemble qui situe le sens. Deux textes proches pointent dans la même direction, et leur produit scalaire (la somme des 1 024 produits deux à deux) est leur cosinus : 1 pour deux textes pareils, bien moins pour deux sans rapport.
- Le sens dépend peu de la langue : le titre de Mundo Deportivo, « La FIFA propone cambiar el reglamento para justificar el 'caso Balogun' », fait 0,823 avec celui de tribuna.com ; celui de Calcio e Finanza, « Niente più casi Balogun: la FIFA modificherà il proprio regolamento disciplinare », 0,793.

**Le vecteur creux : le poids de chaque mot**

| Jeton | Poids |
|---|---|
| ▁FIFA | 0,310 |
| gun | 0,273 |
| ▁27 | 0,241 |
| ▁disciplina | 0,239 |
| mend | 0,238 |
| ▁Belgi | 0,232 |
| arin | 0,230 |
| mme | 0,222 |
| FA | 0,218 |
| ▁Balo | 0,211 |
| ▁amen | 0,209 |
| ▁regulations | 0,207 |
| ▁Article | 0,201 |
| ▁Football | 0,198 |
| ▁case | 0,194 |
| ▁committed | 0,186 |
| ding | 0,179 |
| rich | 0,163 |
| ry | 0,159 |
| ▁Van | 0,151 |

… et 31 autres, de ▁Fol 0,148 et RB 0,143 à ▁following 0,025, ▁in 0,006 et ▁by 0,001

- Une petite couche apprise donne à chaque jeton un poids : `max(0, w · sortie du jeton + b)`. Un jeton répété garde son plus grand poids, et les jetons spéciaux sont retirés.
- Seuls les jetons du texte reçoivent un poids : le vecteur a 250 002 cases, et 51 seulement sont remplies (13 pour le titre). Les noms et les chiffres pèsent le plus (FIFA, Balogun, 27), les petits mots presque rien.
- Pourquoi les deux ? Le dense trouve deux titres qui disent la même chose avec d'autres mots, mais il rapproche aussi deux pages modèles : « Egypt vs Angola – Betting Tips » et « Togo vs Burundi – Betting Tips » font 0,79. Le creux les sépare, parce qu'elles n'ont aucun nom en commun. Mesuré : 96 % de bonnes cartes avec les deux, 82 % avec les mots seuls.

*Technologies :* BAAI/bge-m3 (XLM-RoBERTa large) · FlagEmbedding + PyTorch (carte graphique) · ONNX Runtime (processeur) · POST /embed

*Où ça tourne :* L'embedder : Python, HTTP (`POST /embed {"texts": [...]}` → `{"dense": [[1024 nombres]], "sparse": [{"id du jeton": poids}]}`, avec un jeton secret) · PC de jeu, RTX 4070 Ti : 55 textes/s (PyTorch, quand il est allumé) · Processeur du serveur Ubuntu : ≈ 4 textes/s (ONNX Runtime, mêmes vecteurs (cosinus 0,99997)) · Choix : tous ensemble (chaque embedder de la liste EMBEDDER_URL qui répond prend les lots qu'il finit le plus vite)

### 3 · PostgreSQL + pgvector : ranger, regrouper, relier

Chaque nouvelle garde quatre vecteurs dans sa ligne de la table `articles`. Tous les calculs sont exacts, faits en SQL dans la base. Il n'y a pas d'index approximatif (HNSW) : il pourrait oublier une histoire proche.

| Colonne | Type pgvector | Ce qu'elle garde |
|---|---|---|
| `title_dense`, `text_dense` | `halfvec(1024)` | 2 Ko chacun, en demi-précision, dans la ligne : un cosinus bouge de 0,0001 au plus, la table passe de 1,48 à 0,99 Go et se relit 8 fois plus vite |
| `title_sparse`, `text_sparse` | `sparsevec(250002)` | seulement les jetons présents : `{37672:0.31029,6968:0.2732,…}/250002` |

`<#>` est l'opérateur de pgvector qui donne le produit scalaire, négatif. `-(a <#> b)` vaut donc le cosinus de deux vecteurs denses, et pour deux vecteurs creux la somme des poids multipliés des jetons partagés.

**L'histoire : la même nouvelle chez d'autres médias (`assign_stories`)**

- **Une langue à la fois** : une nouvelle anglaise ne rejoint qu'une histoire anglaise.
- **Présélection** : les 100 histoires anglaises des 48 h dont la moyenne des textes est la plus proche.
- **Score** : la moyenne, sur les nouvelles de chaque histoire venues d'autres médias, de la proximité des titres, dense + creux.
- **Conditions** : titres ≥ 0,70 et textes ≥ 0,60. Une histoire calme depuis plus de 6 h demande 0,003 de plus par heure.
- La nouvelle rejoint la meilleure histoire qui passe, sinon elle en commence une.

Au moment où la nouvelle de tribuna.com a été placée, le 16 octobre à 22 h 41, avec les membres que chaque histoire avait alors (le trait noir marque le seuil) :

| Histoire candidate | Autres médias | Titres : dense + creux | Textes | Décision |
|---|---|---|---|---|
| 798086 FIFA to amend disciplinary rule over Balogun case fallout | 61 (36 médias) | 0,785 + 0,167 = **0,952** | 0,742 | rejointe : la meilleure (calme depuis 7 h : seuil 0,703) |
| 880337 A December deadline in Doha: FIFA panel to rule on Trump peace prize | 13 (9 médias) | 0,547 + 0,071 = **0,618** | 0,521 | refusée : sous 0,70 et 0,60 |
| 876090 Donald Trump Has Forced FIFA Into Making Major Rule Change After World Cup | 9 (6 médias) | 0,545 + 0,060 = **0,605** | 0,600 | refusée : titres sous 0,70, calme depuis 19 h (seuil 0,738) |
| 776390 FIFA governance row: Integrity group calls for independent scrutiny after tense Council meeting | 9 (5 médias) | 0,501 + 0,075 = **0,576** | 0,560 | refusée : sous 0,70 et 0,60 |

Dans l'histoire 798086, quelques titres comparés à celui de tribuna.com :

| Média | Titre | Dense | Creux | Total |
|---|---|---|---|---|
| Arab News | FIFA to amend Article 27 of disciplinary code after Balogun case | 0,951 | 0,284 | 1,235 |
| 9 radios (dépêche Reuters) | Soccer-FIFA to amend Article 27 of disciplinary code after Balogun case | 0,896 | 0,226 | 1,122 |
| RTÉ | FIFA to amend disciplinary rule over Balogun case fallout | 0,875 | 0,227 | 1,102 |
| The New York Times | FIFA seeking to amend rules to prevent repeat of Folarin Balogun scandal at World Cup | 0,783 | 0,198 | 0,981 |
| Daily Express | Donald Trump to force FIFA into major rule change today after explosive scandal | 0,607 | 0,102 | 0,709 |
| ABC News | What to know about US soccer star Folarin Balogun's 1-game red card suspension, why team can't appeal | 0,594 | 0,076 | 0,670 |

La même dépêche de Reuters, « Soccer-FIFA to amend… », est reprise mot pour mot par 9 sites de radios américaines : 9 médias, un seul texte. Le compte des médias le dit, la corroboration (5d) le mesure à part. En bas du tableau, deux titres d'autres faits de la même affaire ont rejoint l'histoire : l'annonce d'un changement « aujourd'hui », la suspension du 1er octobre. La vérification de l'IA (5b) retire le premier de la carte ; le second n'est pas parmi les articles qu'elle montre. Aujourd'hui, l'histoire compte 64 lignes, 55 liens différents et 38 médias : une nouvelle présente dans plusieurs flux a une ligne par flux.

**Ce que le regroupement ne fait pas.** Une histoire est d'une seule langue, et deux histoires ne fusionnent jamais après coup. Le même fait existe donc aussi en espagnol (histoire 792389, 21 médias), en italien (790739, 13), en portugais (800836, 6) et en néerlandais (794732, 4) : c'est la vérification de l'IA (5b) qui les réunit sur une carte.

**Le fil : l'affaire suivie dans le temps (`assign_threads`)**

- Une histoire rejoint le fil dont elle ressemble en moyenne aux histoires des autres médias, à 0,75 ou plus ; deux fils nés à part fusionnent à 0,70.
- La comparaison se fait sur le centre (`centroid`) de chaque histoire : la moyenne normalisée des textes de ses nouvelles.

| Histoire | Née le | Médias | Proximité avec 798086 | Premier titre |
|---|---|---|---|---|
| 52126 | 1er oct. | 5 | 0,817 | What to know about US soccer star Folarin Balogun's 1-game red card suspension, why team can't appeal |
| 798086 | 14 oct. | 38 | 1 | FIFA moves to avoid repeating Balogun scandal amid ac… \| YSscores |

Le fil, créé le 17 octobre à 5 h 51, relie l'annonce à la suspension de Balogun pendant la Coupe du monde, deux semaines plus tôt. C'est lui que l'analyse (5h) lit pour raconter « l'histoire jusqu'ici ».

*Technologies :* PostgreSQL 18 · pgvector 0.8 (halfvec, sparsevec, <#>) · assign_stories (PL/pgSQL) · assign_threads (PL/pgSQL)

## Au briefing · pour un lecteur : la choisir pour Enzo et la montrer

Le 17 octobre à 15 h 21, Enzo demande un briefing de 48 h, 10 cartes. Rien n'est relu sur le web avant que l'IA ait choisi : la base classe ce que le serveur a déjà préparé.

### 4 · Le classement pour le lecteur (`rank_profile_stories`)

Une seule requête SQL prend toutes les nouvelles de ses 1 152 flux sur 48 h, dans toutes les langues. Chaque nouvelle est notée contre chacun des intérêts du profil (et de ses projets en cours, il n'en a pas) : **poids × (dense + 0,5 × creux)**, sur le texte complet. Chaque intérêt a ses propres vecteurs, calculés une fois à partir de son texte. Une nouvelle garde son meilleur intérêt, une histoire sa meilleure nouvelle.

| Intérêt d'Enzo | Dense | Creux | Note |
|---|---|---|---|
| Gouvernance du football (l’UEFA et ses 55 associations, la FIFA, élections, crises…) | 0,525 | 0,058 | **0,554** |
| Arbitrage (VAR, Lois du Jeu de l’IFAB, désignations, sanctions et controverses…) | 0,576 | 0,052 | **0,601** |

- Le creux ne compte que les jetons partagés. Avec « Arbitrage » : FA 0,218 × 0,199 = 0,044 ; ▁contro 0,111 × 0,073 = 0,008. Total 0,052. Le jeton « FA » vient de RBFA dans la nouvelle et d'IFAB dans l'intérêt : deux instances différentes, un même morceau de mot. Le creux compte des jetons, pas des sens.
- Avec « Gouvernance » : ▁FIFA 0,310 × 0,186 = 0,058, et rien d'autre.
- L'histoire est notée par sa meilleure nouvelle, celle de RTÉ : 0,611, contre 0,601 pour celle de tribuna.com.

**Du tout au peu : où se trouve la nouvelle**

| Étape | Nombre | La nouvelle |
|---|---|---|
| Nouvelles de ses sources (48 h) | 107 545 |  |
| Histoires notées | 68 101 | 45e |
| Gardées par le SQL | 600 | 45e |
| Partagées entre les intérêts | 150 | 45e · 12e de « Arbitrage » |
| Candidates pour l’IA | 47 | candidate |
| Retenues par l’IA | 13 | 4e |
| Gardées (10 + 3 en réserve) | 10 | 4e |
| Cartes montrées | 10 | 4e carte |

- Les 600 meilleures histoires sont gardées, puis 150 partagées entre les intérêts : 88 pour « Gouvernance », 62 pour « Arbitrage ». Notes : de 0,802 (1re) à 0,561 (150e).
- Juste devant elle dans son intérêt : « Real : Tebas provoque la colère du club ! » (0,611). Juste derrière : « Moment nemaivăzut în fotbal! Arbitrul a arătat cartonașul roșu pe telefon » (0,610), un carton rouge montré sur un téléphone. Les vecteurs notent presque pareil une décision de la FIFA, une colère de club et une curiosité d'arbitrage : c'est à l'IA de trier.
- **Déjà envoyée, mais l'affaire a bougé.** Les histoires des affaires envoyées à Enzo par e-mail dans les 48 dernières heures sont écartées : 28 cette fois ; 9 autres restent, parce qu'elles disent du neuf. Celle-ci en est : sa carte « FIFA amends red card rules in connection with Trump's controversy. » est partie le 16 octobre à 11 h 52. Un appel de l'IA (gemma4:31b, 2 768 jetons lus, 729 écrits, 2,2 s) lit les nouvelles publiées depuis et répond « Reports indicate Gianni Infantino personally intervened in the Balogun red card case. », `evolved: true`. La carte revient comme une suite de celle envoyée.
- Candidates : les 40 meilleures venues de flux, partagées entre les intérêts, et 7 de plus, connues seulement par Google News ou racontées par une source de confiance.

*Technologies :* rank_profile_stories (SQL) · pgvector · shareOut · repeats (gemma4:31b) · pickCandidates

*Enzo, 48 h :* Dans ses sources : 107 545 nouvelles (68 101 histoires, 38 langues, 1 152 flux ; 32 856 nouvelles en anglais) · Rang de la nouvelle : 45e (12e de son intérêt, note 0,611) · Candidates pour l'IA : 47 · Durée : 5,9 s (le SQL des 600 ; 33 s pour l'étape entière, avec le tri des sources du profil et les suites)

### 5 · L'IA : choisir, vérifier, choisir les phrases, relire, version IA, angles, analyse

Deux modèles, sur Ollama cloud, avec une réponse en JSON. **gemma4:31b**, à une température de 0,1, choisit, vérifie, juge et relit. **deepseek-v4-pro** écrit les deux seuls textes que l'IA rédige elle-même : la version IA de la carte et son analyse. L'IA ne voit jamais de vecteur : seulement du texte. En jaune, ce qui concerne la nouvelle suivie.

**5a · Choisir (`selectStories`) · gemma4:31b, 5 806 jetons lus, 563 écrits, 3,1 s**

L'IA reçoit le profil d'Enzo dans ses mots, ses 2 intérêts, puis une ligne par candidate, menée par la meilleure nouvelle de l'histoire (ici celle de RTÉ). Celle de l'exemple :

```
[798086] FIFA to amend disciplinary rule over Balogun case fallout — FIFA will amend its disciplinary regulations after controversy over its decision to suspend US forward Folarin Balogun's automatic World Cup ban, the Belgian Football Association (RBFA) said on Thursd (aussi : FIFA to amend Article 27 after controversy surrounding Balogun case / Gianni Infantino reportedly intervened in Folarin Balogun’s red card case / FIFA will amend Article 27 of its disciplinary rules following the Balogun incident.)
… 46 autres lignes …

Choisis au plus 20 histoires qui correspondent vraiment à ce que ce lecteur demande, de la plus à la moins pertinente.
Couvre tous ses intérêts […] Son résumé en gardera 10, réparties entre ses intérêts. Ce qu'il dit ne pas vouloir est exclu […] une liste courte vaut mieux qu'une histoire hors sujet. Varie […] Préfère les faits du jour […] Ne choisis jamais une page qui n'apporte aucun fait nouveau […]
Pour chacune, "why" est une phrase courte qui dit au lecteur pourquoi elle est pour lui, en anglais, tirée seulement de ce que disent son titre et sa description […]
Réponds uniquement en JSON : {"selected": [{"id": "...", "why": "une phrase courte"}]}
```

```
{"selected": [
  {"id": "769743", "why": "UEFA is searching for a candidate to challenge Gianni Infantino for the FIFA presidency."},
  {"id": "969493", "why": "Details on UEFA's direction regarding referee centrality and reduced VAR usage."},
  {"id": "945451", "why": "Tensions between club presidents and the FFF regarding football governance reform."},
  {"id": "798086", "why": "FIFA is amending its disciplinary regulations following the Balogun case controversy."},
  … 10 autres]}
```

- 13 histoires retenues, celle de l'exemple en 4e. La raison est tirée seulement du titre et de la description.
- Équilibre entre les intérêts, puis le reste dans l'ordre de l'IA : 10 pour les cartes, 3 en réserve, pour remplacer une carte illisible. Une carte n'a pas pu être lue ; une de la réserve a pris sa place.

**5b · Vérifier les articles de l'histoire (`checkStories`) · toutes les cartes en un appel, 3 199 jetons lus, 394 écrits, 4,2 s**

Le regroupement par vecteurs peut mêler deux faits proches. L'IA reçoit l'article principal (P) et jusqu'à 12 autres titres, un par média d'abord, et dit lesquels racontent le même événement. Chaque carte apporte aussi ses versions dans les autres langues : les histoires d'autres langues dont le centre est à 0,78 ou plus du sien, 4 au plus (ici les lignes 10 à 13).

```
[798086]
P. FIFA to amend disciplinary rule over Balogun case fallout — …
1. FIFA to amend Article 27 after controversy surrounding Balogun case — …
2. Gianni Infantino reportedly intervened in Folarin Balogun’s red card case — …
…
7. Donald Trump to force FIFA into major rule change today after explosive scandal — …
…
10. FIFA modificaría su reglamento disciplinario tras polémica por Folarin Balogun en el Mundial
11. Niente più casi Balogun: la FIFA modificherà il proprio regolamento disciplinare
12. FIFA past regels aan na Balogun-kwestie, maar voor België 'stopt het daar niet' — …
13. FIFA prepara alteração da regra que beneficiou Folarin Balogun e Cristiano Ronaldo — …
```

```
{"id": "798086", "same": [1, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13]}
```

- Deux articles sont retirés : l'intervention d'Infantino (2), un autre fait de l'affaire, et l'annonce d'un changement « aujourd'hui » (7), d'avant la décision.
- Les 4 versions sont gardées : l'espagnole (histoire 792389, centres à 0,950), l'italienne (790739, 0,941), la néerlandaise (794732, 0,917) et la portugaise (800836, 0,916). Leurs médias rejoignent la carte. Dans tout le briefing, 9 versions d'autres langues ont rejoint leur carte.

**5c · Fusionner les cartes du même fait (`mergeStories`) · 1 242 jetons lus, 857 écrits, 2,7 s**

L'IA reçoit les cartes et la réserve. Pour chacune, elle écrit d'abord le fait principal, puis dit s'il est le même qu'une histoire plus haut.

```
{"id": "798086", "fait": "La FIFA va modifier son règlement disciplinaire suite au cas Balogun", "sameAs": null}
```

Aucune autre carte ne raconte ce fait : elle reste seule. Une seule fusion dans ce briefing, deux versions d'une même analyse de la fédération vietnamienne.

**5d · Lire la page et choisir les phrases (`extractArticle`) · gemma4:31b, 819 jetons lus, 31 écrits, 11,8 s**

Maintenant seulement, les pages sont téléchargées : 5 articles par histoire au plus, un par média, une source de confiance puis la langue du lecteur d'abord. Le texte est extrait comme le fait le mode lecture de Firefox, puis découpé en phrases numérotées. La page lue en entier est celle de tribuna.com. L'IA ne réécrit rien, elle renvoie des numéros.

```
TITLE: FIFA to amend Article 27 after controversy surrounding Balogun case

SENTENCES:
[1] The announcement came after a FIFA Council meeting in Zurich, where RBFA president Pascale Van Damme raised concerns about the disciplinary process and the circumstances surrounding the case.
[2] Van Damme, who sits on the FIFA Council, put three questions to the governing body.
[3] The first concerned US President Donald Trump's publicly acknowledged intervention in the Balogun case, with the RBFA asking FIFA to guarantee that no interference of any kind occurred during the disciplinary procedure.
[4] The federation also sought clarification on the exceptional circumstances that led to the decision and the criteria used to apply Article 27 in comparable cases.
[5] Its third question concerned whether member associations would have the right to be heard in future decisions made by FIFA's disciplinary bodies.
[6] According to the RBFA, FIFA emphasised that decisions are taken independently by its disciplinary bodies.
[7] FIFA also confirmed that Article 27 would be amended, following the questions raised by the Belgian federation.
[8] The proposal is scheduled to be put to a vote in Doha on December 16, alongside an explanation of the specific circumstances of the Balogun case.
[9] Van Damme welcomed the commitment to amend the rules but stressed that the federation still wanted clarity on how they were applied.
[10] (quote) “That FIFA confirms Article 27 will be amended, which we already requested in July, is an important step.
[11] … [14] la suite de la citation de Pascale Van Damme
```

```
{"topic": "sport", "sourcing": "named", "sentences": [7, 1, 8]}
```

- Les numéros viennent dans l'ordre d'importance : 7, puis 1, puis 8. Les mêmes phrases donnent les trois façons de lire la carte, toutes publiées telles quelles : **passages clés** dans l'ordre de l'article (1, puis 7 et 8 qui se suivent : le lecteur voit le saut) ; **points**, une phrase chacun, la plus importante d'abord (7, 1, 8) ; **résumé**, les plus importantes tant qu'elles tiennent en 65 mots (1 et 7, 48 mots : la 8 n'y entre plus).
- `sourcing: named` : l'article nomme sa source, la RBFA. L'article est en anglais, la langue d'Enzo : rien à traduire.
- Corroboration, sans IA : 5 pages lues, de 5 médias, 5 textes différents. Deux textes qui partagent la moitié de leurs suites de 8 mots seraient une même dépêche d'agence ; il n'y en a pas parmi les 5 lues. Aucun verbe de démenti dans les pages lues : pas d'appel « contesté ».

**5e · Relire avant de montrer (`reviewCards`) · 2 356 jetons lus, 424 écrits, 1,7 s**

L'IA relit les cartes avec leurs passages, les intérêts d'Enzo et ce qu'il refuse (« les résultats purement sportifs, les transferts de joueurs ou l'actualité sportive quotidienne »). Elle donne le sujet de chacune : « FIFA disciplinary process amendment », `refused: false`. Aucune carte n'est retirée.

**5f · La version IA (`aiWaysOf`) · deepseek-v4-pro sans raisonnement, deux appels en même temps : 747 + 727 jetons lus, 148 + 102 écrits, 6,4 et 6,1 s**

Une fois les cartes gardées et relues, au début de l'étape « angles », deepseek-v4-pro écrit avec les mêmes phrases numérotées 3 ou 4 points et un résumé de 65 mots au plus, dans la langue d'Enzo, sous dix règles : seulement les faits de l'article, qui a dit quoi, aucun lien de cause qu'il ne donne pas, sa certitude gardée, les chiffres exacts.

```
{"points": [
  {"text": "FIFA will amend Article 27 after the RBFA raised concerns.", "sentences": [7]},
  {"text": "The proposal is scheduled for a vote in Doha on December 16.", "sentences": [8]},
  {"text": "RBFA president Pascale Van Damme raised concerns at a FIFA Council meeting in Zurich.", "sentences": [1]},
  {"text": "Van Damme says the federation still wants clarity on how the rules were applied.", "sentences": [9, 12]}]}

{"summary": "FIFA announced after a Council meeting in Zurich that it will amend Article 27, following questions from RBFA president Pascale Van Damme about the Balogun case. FIFA said its disciplinary bodies decide independently. The amendment proposal is scheduled for a vote in Doha on December 16. Van Damme welcomed the step but wants clarity on how rules are applied.", "sentences": [1, 6, 7, 8, 9]}
```

- Le serveur contrôle les chiffres : 27 et 16 sont dans l'article, les deux textes sont gardés. Un chiffre absent de l'article les aurait fait retirer.
- Ils ne sont montrés que sur demande (« Show AI version »), sous les points ou le résumé publiés, marqués comme écrits par l'IA. deepseek n'écrit que pour les cartes gardées : 20 appels pour les 10 cartes.

**5g · Autres angles, source officielle, noms (étape « angles », 69 s pour les 10 cartes, versions IA comprises)**

Avec les versions IA, quatre recherches partent ensemble ; aucune ne peut faire échouer le briefing.

- **Autres angles** (gemma4:31b, 1 033 jetons lus, 329 écrits, 5,9 s) : 13 nouvelles proches de la carte, de toutes les langues, jugées sur leurs titres. 6 racontent le même fait (« same »), 4 un autre angle de l'affaire, 3 répètent un de ces angles. La carte en montre 4, titres traduits : l'intervention de Donald Trump (Przegląd Sportowy, 14 oct.), « Infantino under pressure: FIFA intervened so that Balogun could play against Belgium » (bljesak.info), « One phone call, and the matter was settled – Fifa insider confirms suspicion against Infantino » (Die Welt) et le scandale possible du 6 octobre (laola1.at).
- **Source officielle** (gemma4:31b, un appel pour nommer les parties, puis deux pour leurs déclarations) : l'IA classe la nouvelle comme « announced », une annonce de ceux qu'elle concerne, et nomme ses parties, FIFA et Royal Belgian Football Association, cherchées dans Wikidata avec leurs canaux. Aucune publication sur leurs propres sites n'a été trouvée. Restent leurs déclarations que les articles rapportent : l'IA lit les phrases de sapo.pt et d'A Bola deux fois, dans deux ordres, et garde ce que les deux lectures disent. La carte en montre 2, traduites du portugais : FIFA et Pascale Van Damme.
- **Noms** : ceux qu'un quart au moins de ses articles citent, 4 au plus. Ici **FIFA** (sans fiche Wikidata : sa page est celle du nom) et **Folarin Balogun** (fiche Q101035007).
- **Ce que le profil suit** : les nouvelles des fiches et des mots suivis par le profil, listées à part, sans IA.

**5h · L'analyse (`card-analysis.js`) · après le briefing, la carte déjà montrée**

D'abord, deepseek-v4-pro sans raisonnement (2 133 jetons lus, 184 écrits, 1,7 s) choisit les cartes qui méritent une analyse : 6 sur 10, dont celle-ci, « Rule change after controversy, vote date set for December. » Puis, avec raisonnement, pour chacune, il lit la carte, ses articles numérotés phrase par phrase et les histoires plus anciennes de son fil, et écrit, chaque ligne citant ses sources :

```
{"why": [
  {"text": "FIFA's use of Article 27 to lift Balogun's ban before Belgium's last-16 match drew political interference claims and Belgian demands for transparency.", "cites": ["A2 s2", "A2 s3", "A1 s3", "A2 s11"]},
  {"text": "FIFA confirmed Article 27 would be amended; a proposal is scheduled for a vote in Doha on December 16; Belgium still wants clarity on application.", "cites": ["A1 s7", "A1 s8", "A1 s9", "A2 s5"]}],
 "next": [
  {"if": "The proposed amendment is approved at the next FIFA Council meeting in Doha on 16 December.",
   "then": "The change could help make the eligibility process more consistent and reduce controversial decisions.", "cites": ["A2 s5", "A3 s12"]}]}
```

- 4 369 jetons lus, 5 412 écrits (le raisonnement compris), 47,8 s pour cette carte ; 102,7 s pour les 6, 3 à la fois.
- Le serveur retire une ligne dont un chiffre ou un nom n'est pas dans ses sources (les noms lus par l'étiqueteur) : aucune ligne retirée dans ce briefing.
- « L'histoire jusqu'ici » vient du fil (étape 3) : la suspension de Balogun, le 1er octobre (ABC News).

*Technologies :* gemma4:31b (Ollama cloud) · deepseek-v4-pro (Ollama cloud) · JSON, température 0,1 · fetch + @mozilla/readability · Crawlee (Cheerio) en secours · corroboration (shingles) · Wikidata

### 6 · Le résultat : la carte

> tribuna.com · 16 octobre, 22 h 34 · Arbitrage · suite de la carte du 16 octobre
>
> **FIFA to amend Article 27 after controversy surrounding Balogun case**
>
> *Pourquoi pour vous :* FIFA is amending its disciplinary regulations following the Balogun case controversy.
>
> The announcement came after a FIFA Council meeting in Zurich, where RBFA president Pascale Van Damme raised concerns about the disciplinary process and the circumstances surrounding the case.
>
> […]
>
> FIFA also confirmed that Article 27 would be amended, following the questions raised by the Belgian federation. The proposal is scheduled to be put to a vote in Doha on December 16, alongside an explanation of the specific circumstances of the Balogun case.
>
> - **21** médias
> - **5** textes différents sur 5 lus
> - source nommée
> - fil de l'affaire : **2** faits depuis le 1er oct.
> - FIFA · Folarin Balogun
>
> Official sources
>
> **FIFA** (via sapo.pt) : FIFA announced the change of the controversial rule for the 2026 World Cup, which includes Folarin Balogun and Cristiano Ronaldo, with new disciplinary norms to be applied. **Pascale Van Damme** (via sapo.pt) : Pascale Van Damme, from the Belgian federation, confirmed the revision of Article 27 of the Disciplinary Code.
>
> AI analysis
>
> *Why it matters* — FIFA's use of Article 27 to lift Balogun's ban before Belgium's last-16 match drew political interference claims and Belgian demands for transparency. FIFA confirmed Article 27 would be amended; a proposal is scheduled for a vote in Doha on December 16; Belgium still wants clarity on application. *What could come next* — If the proposed amendment is approved in Doha on 16 December, the change could help make the eligibility process more consistent and reduce controversial decisions. *The story so far* — 1 Oct: What to know about US soccer star Folarin Balogun's 1-game red card suspension (ABC News).
>
> Other angles · 4
>
> 14 Oct · FIFA wants to change the rules. All because of Donald Trump's intervention *(przegladsportowy.onet.pl, PL)* 16 Oct · Infantino under pressure: FIFA intervened so that Balogun could play against Belgium after a red card *(bljesak.info, BS)* 15 Oct · “One phone call, and the matter was settled” – Fifa insider confirms suspicion against Infantino *(welt.de, DE)* 6 Oct · No eligibility to play? FIFA confronted with possible scandal *(laola1.at, DE)*

C'est la 4e des 10 cartes du briefing, menée par l'article de tribuna.com. Parmi ses 21 médias : Reuters, El País, Marca, RTÉ, Goal, De Telegraaf, A Bola, Arab News. La carte se lit en passages clés (ci-dessus), en 3 points ou en résumé, au choix d'Enzo ; sous les points ou le résumé, « Show AI version » montre ceux de deepseek-v4-pro (5e). Elle montre aussi son image (celle de tribuna.com), le code de langue de chaque article, et elle est marquée comme la suite de la carte envoyée le 16 octobre.

*Ce qu'elle a coûté :* Briefing entier : 153,7 s (classement 33 s, choix 3 s, vérification 7 s, lecture 7 s, phrases et relecture 33 s, versions IA, angles et sources officielles 69 s ; puis l'analyse, la carte déjà montrée : 102,7 s) · Jetons de l'IA, briefing et analyse : 134 552 (90 appels : gemma4:31b 63 appels, 65 960 jetons ; deepseek-v4-pro 27 appels, 68 592 jetons, dont 42 544 pour les analyses) · Pour cette nouvelle seule : ≈ 16 000 jetons (phrases 850, version IA 1 724, source officielle 2 240, angles 1 362, analyse 9 781 ; plus une ligne dans le choix, la vérification, la fusion, la relecture et le choix des analyses) · Ses vecteurs et ses noms : une fois (à la lecture, pour tous les lecteurs)

## Ce que l'exemple montre aussi : quatre leçons d'une seule nouvelle

### Les vecteurs trouvent, l'IA trie

Le creux relie la nouvelle à l'intérêt « Arbitrage » par le jeton « FA », de RBFA dans l'une et d'IFAB dans l'autre : deux instances différentes. Et dans son intérêt, une colère de club et un carton rouge sur un téléphone sont notés presque aussi haut. Les vecteurs trouvent des candidats ; c'est l'IA qui dit ce qui est pour Enzo.

### Un fait, cinq langues, une carte

Le regroupement travaille langue par langue : l'annonce fait cinq histoires, en anglais (38 médias), espagnol (21), italien (13), portugais (6) et néerlandais (4). La vérification les réunit sur une carte, leurs centres étant à 0,92–0,95 du sien : Enzo lit une carte de 21 médias au lieu de cinq cartes du même fait.

### Une carte envoyée revient quand l'affaire bouge

La carte de la veille, envoyée par e-mail, aurait dû rester de côté 48 h. Elle revient parce que l'IA a lu du neuf : « Infantino serait intervenu lui-même ». Mais ce neuf vient de l'article que la vérification (5b) retire ensuite de la carte, comme un autre fait : la carte revient pour une raison qu'elle ne montre pas. Le jugement des suites et celui des articles ne se voient pas l'un l'autre.

### Défaut relevé : une dépêche anglaise de Reuters marquée « espagnol »

Reuters est lu par son plan du site d'actualités (*news sitemap*), un seul flux pour toutes ses langues. La ligne « FIFA to amend Article 27 of disciplinary code after Balogun case », un titre anglais sans description, y est enregistrée en espagnol. Son titre fait 0,951 avec celui de tribuna.com, mais la langue l'envoie dans l'histoire espagnole 792389 : elle arrive sur la carte seulement parce que la vérification y joint la version espagnole, et elle y est marquée ES. À regarder : la langue que ce flux donne à ses lignes, quand le titre dit autre chose.

Corrigé le 17 octobre 2026 : un flux dont les nouvelles sont en plusieurs langues n'en donne plus aucune, chacune est lue à ses propres mots ([Ingestion > Vecteurs](../ingestion/vectors/README.md)). Sur 14 jours, 40,8 % des 4 506 nouvelles de Reuters avaient la langue de leur adresse ; lues ainsi, 84,1 %. Les lignes déjà enregistrées gardent leur langue.

---

Mesuré le 17 octobre 2026 à 15 h 21 (heure suisse) sur la base du serveur Ubuntu, le PC de jeu éteint. Le briefing de 48 h du profil « Enzo » a été écrit en entier avec le code du jour, analyse comprise, sans rien enregistrer : ses écritures (étape, nouvelles suivies, analyse) ont été interceptées par le script. Chaque appel à l'IA a été gardé avec son modèle, son prompt, sa réponse et sa durée (server/bench/news-journey.mjs). Les vecteurs, les proximités et le fil viennent de la base (news-journey-story.mjs) ; les scores du regroupement ont été recalculés avec les membres que chaque histoire avait quand la nouvelle a reçu ses vecteurs (news-journey-grouping.mjs) ; la place dans le classement partagé, avec la même fonction que le briefing (news-journey-rank.mjs). Les jetons ont été traduits en mots par le tokenizer de bge-m3.

Le briefing n'a rien montré à Enzo. Comme tout briefing, il a rempli les caches partagés (l'adresse réelle d'une nouvelle de Google News, les fiches Wikidata des sources officielles) et a retiré 2 flux de son profil qui n'apportaient plus rien (turkishminute.com, thescore.com). Les pourcentages de qualité (96 %, 82 %) et les vitesses de l'embedder viennent des mesures précédentes du projet.
