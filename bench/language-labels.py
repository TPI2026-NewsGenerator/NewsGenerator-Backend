# The second detector of bench/language-labels.mjs: lingua (pip install lingua-language-detector) on the
# news and the feeds of data/language-labels/, its language as the project writes it (ISO 639-1, Norwegian
# 'no') and its confidence. Writes data/language-labels/lingua.json
import json
import pathlib
import sys

from lingua import LanguageDetectorBuilder

DIR = pathlib.Path(__file__).parent / 'data' / 'language-labels'
CODES = {'nb': 'no', 'nn': 'no'}

detector = LanguageDetectorBuilder.from_all_languages().build()


def detect(texts):
    out = []
    for values in detector.compute_language_confidence_values_in_parallel(texts):
        if not values or values[0].value == 0:
            out.append({'code': None, 'confidence': 0})
            continue
        code = values[0].language.iso_code_639_1.name.lower()
        out.append({'code': CODES.get(code, code), 'confidence': round(values[0].value, 3)})
    return out


def load(name):
    return json.loads((DIR / name).read_text(encoding='utf-8'))


def by_id(rows, texts):
    return dict(zip((str(row['id']) for row in rows), detect(texts)))


# 'extra': the news the words overrode and the news of the contradicted feeds -> lingua-extra.json
if len(sys.argv) > 1 and sys.argv[1] == 'extra':
    overrides, mix = load('overrides.json'), load('mix.json')
    result = {'overrides': by_id(overrides, [o['text'] for o in overrides]), 'mix': by_id(mix, [m['text'] for m in mix])}
    (DIR / 'lingua-extra.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    print(len(overrides), 'overridden', len(mix), 'of contradicted feeds')
else:
    articles, feeds = load('articles.json'), load('feeds.json')
    result = {
        'articles': by_id(articles, [a['text'] for a in articles]),
        'feeds': by_id(feeds, [' '.join(f['texts'])[:3000] for f in feeds]),
    }
    (DIR / 'lingua.json').write_text(json.dumps(result, indent=1), encoding='utf-8')
    print(len(articles), 'news', len(feeds), 'feeds')
