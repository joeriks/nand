# Leveransläge och nästa etapper

## Etapp 0 — levererad

Teknisk grund, lokal körning, konfigurationsexempel, testverktyg och dokumentation finns. Inga driftkonton, externa databaser eller publika tjänster har skapats.

## Etapp 1 — implementerad, riktigt integrationstest återstår

Inloggning, repository/gren/undermapp, filträd, CodeMirror, förhandsvisning, utkast, skapa/läsa/spara samt konflikthantering är implementerade. GitHub-adaptern gör riktiga REST-anrop när appen konfigurerats. Produktionskoden har inget simulerat GitHub-läge.

Kvar för godkänd milstolpe: konfigurera en GitHub App och kör checklistan i `verification.md` mot ett särskilt testrepository. Verifiera också verkliga organisationsregler, SSO och skyddade grenar i avsedd miljö. Ingen sådan GitHub App eller sådant testrepository har använts under den första leveransen.

Kända begränsningar: tomma repositories behöver en första commit; ingen automatisk tokenförnyelse; lokalt provläge behöver manuell export/överföring till GitHub; endast filnamnssökning; cachade anteckningar kan vara äldre när nät, inloggning eller behörighet hindrar uppdatering.

## Tillägg — val av lagring och Tauri

Arbetsyteväljaren erbjuder repositoryfiler eller GitHub Wiki. Wiki använder separat HTTPS-Git-adapter, upptäckt standardgren, eget utkastutrymme, exakt kontroll av remote-version, samma konfliktdialog och återläsning efter osäkert svar. Första sidan måste skapas på GitHub. Root-level `.md` stöds; fullständig Wiki-markup och bilagor återstår. Verklig privat Wiki-åtkomst via den valda GitHub App-installationen ska kontrolleras i acceptanstestet.

Tauri 2 för Windows x64 paketerar samma editor och en Node-sidecar. Lokal start kräver varken webbserver eller internet. Device flow, native tokenlagring, spara-dialog, väntan på utkastskrivningar vid stängning och en enda appinstans ingår i implementationen. Windows-paketets verifiering dokumenteras i `verification.md`. Ingen mätning mot Electron har gjorts. Kodsignering, automatisk uppdatering, macOS/Linux och migrering av gamla webbutkast återstår.

## Version 0.2 — offline och beständig synk

Implementerat: hämtning av hela den stödda samlingen för repository/undermappar och Wiki; SHA-baserad återanvändning; progress och filvisa fel; bevarade utkast vid ändring/radering; lokal återöppning efter tokenutgång; separat uttrycklig logout/kontobyte; beständig automatisk kö med manuell synk, återläsning av osäkra svar och oberoende konflikter. Tauri återöppnar senaste hämtade arbetsytan utan nät. Lokalt provläge laddas aldrig upp. Se verifieringsrapporten för testade flöden.

Kvar: riktigt GitHub-acceptanstest, webbsidans fullständiga offlineuppstart/service worker, större samlingars prestanda och installeringsprov på ren Windows-miljö. Lokal filsystemsmapp ingår inte i denna leverans.

## Version 0.2.1 — återöppning och grenval

Senast aktivt valda arbetsyta och anteckning återställs från lokal profil. Webb och Tauri delar flödet; cache behöver inte vänta på sessionsanrop. Aktiviteter i synkkön ändrar inte valet. Fel visar återförsök/annat val. Grenväljaren har separata tillstånd för hämtning, tomt repository och fel, samt återförsök och skydd mot sena svar. Android-arbetet behålls; denna rättningsleverans paketeras för Windows.

## Version 0.3 — CSV-data

CSV i repositoryfiler och lokal import/export. Tabell- och källtextredigering, konservativ automatisk typigenkänning (osäkerhet → text), manuella kolumntyper med felmarkering, filter, sortering, paginering och radåtgärder med ångra/gör om. Samma offlineutkast och GitHub-kö används. Wiki förblir Markdown. Lokala filer är arbetskopior och exporteras; direkt skrivning tillbaka till ursprunglig lokal filsökväg ingår inte.

## Version 0.3.1 — nand

Namn från version 0.3.1: **nand — Notes and more**, med repository `joeriks/nand`. Tidigare interna identifierare behålls för lagringskompatibilitet.

## Etapp 2 — relationer och filoperationer

Fullständig lokal indexering och fulltextsökning, entydiga wikilänkar/Markdown-länkar, kodblocksmedveten länkparser, länkförslag, skapa saknade anteckningar, bakåtlänkar och snabbväxling. Atomiska flytt-, namnbytes- och borttagningsoperationer med länkändringar i en sammanhängande commit. Utöka befintlig periodisk upptäckt av externa ändringar, paginering/cache/belastningsgränser och realistiskt indexeringstest.

## Etapp 3 — kunskapsstruktur

Taggar, bevarad och redigerbar YAML-frontmatter, dagliga anteckningar, mallar, favoriter och tabellvyer. Specificera stödet för rubriklänkar, blockreferenser och inbäddningar per funktion; lova inte full `.base`-kompatibilitet.

## Etapp 4 — visuella vyer

Lokal/global graf från samma verifierade länkindex. Undersök JSON Canvas och testa riktiga exempelfiler. Textkort, anteckningskort, kopplingar, positioner, panorering och zoom. Samma säkerhet och sparningsprotokoll som anteckningar.

## Etapp 5 — offline, historik och drift

Service worker och full offlineöppning i webben; samlingscache och kö efter återanslutning finns sedan 0.2. Versionshistorik, diff och återställning genom ny commit. Privat bilagehämtning och storleksgränser. Fördjupad tillgänglighets- och mobilverifiering, test med tusentals anteckningar samt driftsättning i vald miljö.

Tauri kan återöppna hämtade samlingar helt offline. Webben saknar fortfarande service worker och garanterad kallstart utan appserver. Ingen synk sker medan appen är stängd.
