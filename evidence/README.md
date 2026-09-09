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
| `storm-14h` | agency 138 · press 142 · provider 151 **at Borongan** · station 149, all over a **1-hour** window | Act II, live: with `measurement_hours = 1` the panel can read these inside a one-hour event window, so the whole arc runs the same day instead of waiting out a 24-hour coverage period. One publisher past the trigger and two short — NOT_SATISFIED, nothing moves, and the coverage returns to the insurer through `expire` |
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

`storm-14h` exists because the event window a claim names must be at least one
measurement window wide, and the window must be OVER before a claim is
accepted. A 24-hour policy therefore cannot be claimed until a day has passed.
The readings are the same shape as `storm-12`; only the stated window differs,
so the scenario is identical and the wait is not.


## What the live panel did with `at Borongan`

Both the `storm-12` and `storm-14h` provider pages attribute their reading to
Borongan. The insured area in these scenarios is 50 km around Guiuan, and
Borongan is outside it — so when `storm-14h` ran live on `trg-000004`, every
validator marked that row `geo_ok: false` and its reading came back `null`.
The page was fetched and read; it was simply not a reading for the insured
area.

That changes the arithmetic these scenarios were written to show. The provider
is the only source past the trigger, so dropping it does not flip the outcome
— it is NOT_SATISFIED either way — but the route is **0 of 2**, not the 1 of 3
this file first predicted. The prediction was wrong; the panel was right, and
the geo check earned its place by refusing a number that was true about the
wrong town.

A scenario that genuinely wants a qualifying-but-outvoted source needs its
provider page to state the insured location, as `storm-07` does.
