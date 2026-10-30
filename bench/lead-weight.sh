#!/bin/sh
# bytes downloaded per article page (compressed, as a crawler receives it), on a sample of links
# sh bench/lead-weight.sh links.txt
tr -d '\r' < "$1" | while read -r url; do
  curl -s -L --compressed -m 15 -A 'Mozilla/5.0 (compatible; NewsGenerator/1.0; +RSS reader)' -o /dev/null -w '%{size_download} %{http_code}\n' "$url"
done | awk '$2 == 200 { n++; s += $1; v[n] = $1 } END { asort(v); printf "%d pages: mean %d KB, median %d KB\n", n, s / n / 1024, v[int(n / 2)] / 1024 }'
