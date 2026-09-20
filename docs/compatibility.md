# Format och kompatibilitet

Anteckningar är vanliga UTF-8-filer med `.md`-ändelse. Ingen konvertering till eget dokumentformat sker. Filens innehåll sparas som text; editorövergångar bevarar orörd frontmatter, okänd syntax, UTF-8-BOM och blandade radslut. Nya radslut använder det första radslutets konvention. Detta är verifierat med automatiserade exempel, inte en fullständig Obsidian-testsvit.

| Funktion | Version 0.3 |
| --- | --- |
| Rubriker, text, listor, länkar och kodblock | Redigering och förhandsvisning |
| GFM-tabeller, checklistor, överstrykning | Förhandsvisning; checklistor redigeras i källtexten |
| YAML-frontmatter | Bevaras som text; ingen egenskapseditor eller YAML-tolkning |
| `[[wikilänkar]]`, alias, blockreferenser, inbäddningar | Bevaras; navigering/indexering ej implementerad |
| Relativa Markdown-länkar och rubrikankare | Bevaras; intern navigering ej implementerad |
| HTML | Bevaras i källtexten; rå HTML renderas inte |
| Externa länkar | Säkra protokoll, öppnas i ny flik utan opener/referrer |
| Bilder och privata bilagor | Texten bevaras; bilder hämtas inte. Platshållare visas |
| Svenska tecken och mellanslag i sökväg | Testade i klient, kodning och GitHub-adapter |
| CSV | Tabell- och textredigering, kolumntyper, validering, filter/sortering; lokal import/export och GitHub-repository |
| `.canvas`, `.base`, Dataview och tillägg | Inte implementerade; övriga filer lämnas orörda |

Förhandsvisningen använder `react-markdown` utan rå HTML-plugin. Ingen egen HTML körs och `javascript:`-länkar kan inte aktiveras. Bilder blockeras tills ett säkert flöde för privata bilagor finns.

Högst 1 MiB per anteckning. Binärdata, ogiltig UTF-8, symboliska länkar och submoduler avvisas. Sökvägar ska vara relativa med `/` som mappseparator; `..`, tomma segment, `.git`, kontrolltecken, backslash, `%`, `?`, `#` och `:` avvisas i första versionen. API:t skriver bara den valda Markdown- eller CSV-filen under arbetsytans undermapp. Annan repositorykonfiguration ändras inte.

Det finns ännu inget portabelt appinställningsformat i repositoryt. Tema och senaste valda arbetsyta ligger lokalt i webbläsaren; utkast i IndexedDB; sessioner på servern. Inget sökindex eller åtkomstuppgift checkas in.

CSV-värden lagras alltid som strängar. Automatisk typigenkänning påverkar sortering/validering, inte filinnehållet. Osäkra värden blir text; manuella kolumntyper sparas lokalt. Vid grid-skrivning återserialiserar Papa Parse datan och kan normalisera citering/radslut mellan poster. BOM, cellernas text (inklusive interna radbrytningar), tomma fält, filordning och förekomst av avslutande radslut bevaras. Byte av typ, filter, sortering och rubrikinställning skriver inte om filen. En CSV-konflikt granskas som text med samma versionskontroll som anteckningar.
