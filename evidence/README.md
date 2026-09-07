# Evidence fixtures

The pages the live arc (`web/scripts/arc.mjs`) points the panel at. They are
committed here so their bytes are pinned to a commit and served by three CDN
origins that mirror this repository at that commit; validators fetch them from
those origins, never from this checkout.

| basis class | agreed kind | origin | serves |
|---|---|---|---|
| INDEPENDENT | METEOROLOGICAL_AGENCY | raw.githubusercontent.com | `agency-bulletin-*.txt` |
| INDEPENDENT | NEWS_REPORT | cdn.jsdelivr.net | `press-report.txt` |
| INDEPENDENT | WEATHER_PROVIDER | rawcdn.githack.com | `provider-history.txt` |
| PARTY | STATION_LOG | raw.githack.com | `station-log.txt` |

The station log is the policyholder's own instrument: it may inform the panel
and never counts as a publisher. `raw.githack.com` and `rawcdn.githack.com`
share a publisher (`githack.com`); that is fine only because the station row is
PARTY class and never enters the count — the three INDEPENDENT origins are
three distinct publishers.

| scenario | pages (sustained km/h) | expected |
|---|---|---|
| `storm-07` | agency 157 · provider 149 · press 161 · station 153 | Act I: SATISFIED on agency + press (2 of 2); the insurer's appeal adds the provider (149) and the outcome stands at 2 of 3 — bond forfeited |
| `storm-12` | agency 138 · provider 151 · press 142 · station 149 | Act II: NOT_SATISFIED (1 of 3); nothing moves; the policy expires back to the insurer |
| `storm-07b` | agency page absent (404) · press 157 · provider 152 · station 150 | Act III: with `min_independent = 2` and one readable publisher, UNDETERMINED · UNCORROBORATED; refiled with the provider, SATISFIED (2 of 2) |

Pages identify the event by storm number rather than by calendar date; the
policy text in the arc says so, and the README's honest limitations name it.
The URL forms, with `<sha>` the pinned commit:

```text
https://raw.githubusercontent.com/Hemmy1417/Triggera/<sha>/evidence/storm-07/agency-bulletin-07.txt
https://cdn.jsdelivr.net/gh/Hemmy1417/Triggera@<sha>/evidence/storm-07/press-report.txt
https://rawcdn.githack.com/Hemmy1417/Triggera/<sha>/evidence/storm-07/provider-history.txt
https://raw.githack.com/Hemmy1417/Triggera/<sha>/evidence/storm-07/station-log.txt
```
