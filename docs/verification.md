# Verifieringsrapport

## Lokala bilder — 0.3.9, 2026-09-25

Lokala PNG-, JPEG-, GIF-, WebP- och BMP-filer kan öppnas direkt från Utforskaren eller inkluderas från den valda rotmappen. Bildvyn visar originalet och kan beskära med procentvärden samt konvertera till PNG, JPEG eller WebP. Ändringar sparas tillbaka atomiskt till originalfilen; Exportera bild använder den valda kodningen och rätt filändelse.

## Direkt filöppning — 0.3.7, 2026-09-21

NSIS-installationspaketet bygger med egna Open With-registreringar för TXT, MD och CSV. Genererat installationsskript använder dessa hooks utan Tauris standardassociationer. Registreringarna har egna ProgID:n och citerade programsökvägar, och ändrar inte befintliga standardappar eller UserChoice.

Produktionsbygge/TypeScript och ESLint passerar. Windows-regressionen klarar åtta starter. `scripts/verify-file-opening.mjs` testar en kallstart med TXT-sökväg som innehåller mellanslag, å och &, faktisk redigering tillbaka till originalfilen, samt startargument till en redan körande app med relativa Markdown- och CSV-sökvägar. Båda filerna väljs automatiskt i egna fönster och det första fönstret behåller sitt dokument. Samma fil i ytterligare ett fönster är skrivskyddad. Saknad fil och ogiltig UTF-8 ger fel. Oredigerade filer behåller exakta originalvärden och radslut.

Testerna använder en isolerad appidentitet och testmappar. Installerad Windows-filassociation/Utforskarens registerintegration ändras inte på användarens dator under testet; öppningskedjan testas genom de startargument som filassociationen använder. Resultat: `artifacts/file-opening-verification.json`. Startfönstret har granskats visuellt.

## Senaste samling, historik och flera fönster — 0.3.6, 2026-09-21

Produktionsbygge/TypeScript, ESLint, 19 enhetstester för samlingsval/synk och 39 Edge-tester för återöppning, kontoisolering, Markdown, CSV och import passerar. Webbversionens omladdning öppnar nu också den senaste lokala samlingen direkt; tidigare tester som klickade genom startsidan har anpassats till detta beteende.

Windows-regressionen klarar åtta starter. Rotmappstestet öppnar samlingar via den riktiga historikdialogen, kontrollerar filer på disk, öppnar ett extra fönster via menyn och verifierar att samma fil är skrivskyddad där. Det andra fönstret byter rotmapp och laddas om utan att det första fönstrets rot ändras. Stängning av sekundärfönstret lämnar det första öppet. En andra start av samma exe öppnar också ett nytt fönster med den senast valda lokala mappen. Uppdatering blockeras innan synkningen stängs om flera fönster finns öppna.

Historikdialogen är visuellt granskad. Testet använder en separat appidentitet och egna mappar; historiken förbereds i testprofilen eftersom OS-mappväljaren inte automatiseras. Rapporter: `artifacts/desktop-verification.json`, `artifacts/local-folder-verification.json`. Ingen installation över användarens app utförs av testerna.

## TXT, filskapande och CSV-kolumner — 0.3.5, 2026-09-20

Godkänt: produktionsbygge/TypeScript, ESLint, 42 enhetstester för säkerhet, repository, wiki och lokala filer samt 16 olika Edge-tester för CSV och import. Filskapandet testas med CSV och TXT. TXT-import/export behåller exakta radslut och hanterar dubblettnamn. CSV-kolumntester verifierar avbruten och bekräftad borttagning, dolda rader, ångra med datatyper, nya kolumner, ojämna rader utan rubrikrad och skydd mot borttagning av sista kolumnen. Bekräftelsedialogen har granskats visuellt.

Windows-regressionen klarade åtta starter utan console/page errors. Det separata rotmappstestet verifierar TXT-val och redigering till samma fil samt skapande av en ny CSV och tillagd kolumn med innehållskontroll direkt på disk. Allt körs med isolerad appidentitet och testmappar. De första webbtestfelen berodde på gammalt frontendbygge respektive testväljare; omkörningar mot aktuellt bygge passerade. OS-filväljare och installation över användarens app automatiseras inte.

## Valbara lokala filer — 0.3.4, 2026-09-20

Godkänt: Next.js-produktionsbygge/TypeScript, ESLint, 19 enhetstester för lokala filer och utkast samt sex Edge-tester för menyer och import. Windows-regressionen klarade åtta starter utan console/page errors. En tidigare körning fastnade vid stängning; omkörningen med samma binär passerade.

Det isolerade rotmappstestet verifierar explicit filval, direkt redigering på disk, separata rotmappar, externa ändringar, CSV-val, beständigt urval och avmarkering utan filradering. 1005 oöppnade undermappar och en ogiltig, ovald UTF-8-fil blockerar inte samlingen. Kataloglistning pagineras med 200 poster och sökvägar utanför roten avvisas. Första inkluderade filen blir redigerbar efter att inkluderingslåset släppts. Windows mappdialog simuleras genom testappens sparade inställning; användarens appdata används inte.

Rapporter: `artifacts/local-folder-verification.json` och `artifacts/desktop-verification.json`. Utforskarens layout har granskats visuellt; kryssrutorna har fått egna flexregler för att undvika att globala formulärstilar bryter raderna.

## Uppdaterare och valbar rotmapp — 0.3.3, 2026-09-20

Verifierat: Next.js-produktionsbygge/TypeScript, ESLint, 22 enhetstester för uppdateringar/utkast/lokala filer samt 20 Edge-tester för menyer, importer och sparskydd. Windows-regressionen har klarat åtta starter med separat appidentitet, filsystem och WebView-profil, utan console/page errors.

Separata Windows-tester verifierar uppdateringsdialogens tillgänglig/aktuell/offline-tillstånd, blockerad Escape under hämtning, simulerade signatur-/installationsfel och verklig avstängning/återaktivering av appens synkprocess. Uppdaterarens IPC-transport simuleras bara i testfönstret; ingen riktig installation körs. Rapport: artifacts/updater-verification.json.

Rotmappstestet använder två riktiga mappar med samma filnamn: separat innehåll och utkast, skrivning från appen tillbaka till filen, externa ändringar, ny CSV, omladdning, återgång till tidigare mapp samt avvisad sparning med gammal rotsökväg. Testet sätter det sparade mappvalet direkt i testappens inställningsfil; själva Windows mappdialog automatiseras inte. Rapport: artifacts/local-folder-verification.json. Skärmbilderna från båda flödena är granskade.

En tidig Windows-testkörning stängdes utan rapporterat JavaScript-fel. En senare körning hittade skillnaden mellan logisk och kanonisk appdatamapp under Windows omdirigering; rootinformationen korrigerades till den kanoniska sökvägen. Den avslutande fullständiga körningen och de två separata testerna är godkända. Uppgradering av användarens installerade app testas inte automatiskt.


## Installationsrelease 0.3.2 — 2026-09-20

Funktionerna nedan paketeras i nand 0.3.2. Versionsnummer i npm, Cargo och Tauri är synkroniserade. Funktionsverifieringen nedan genomfördes före versionshöjningen; Windows-installationsbygget byggs separat med produktidentiteten oförändrad.

## Riktiga lokala filer och förenklat gränssnitt — utveckling efter 0.3.1, 2026-09-20

Windows-appen använder Dokument/nand för den lokala Markdown/CSV-samlingen och visar **Öppna i Utforskaren** med den faktiska mappen. Befintliga IndexedDB-utkast bevaras och skrivs ut till filer, med konflikt vid annat befintligt innehåll. Externa filer upptäcks genom omläsning. Import, export, uppdatering, dokumentinformation och anslutning från lokalt läge ligger i **Fler alternativ**; skriv-/läsläge ligger i toppfältet. Den dubbla dokumentfliken och det lokala informationsfältet är borttagna, och synköversikten är mindre framträdande.

Verifierat: Next.js-produktionsbygge/TypeScript, ESLint, 17 enhetstester för utkast/lokala filer samt samtliga 41 Edge-tester. De sex nya enhetstesterna omfattar migrering, exakt text/BOM/radslut, namnkonflikter, externa ändringar/raderingar, diskfel, förlorade svar och fortsatt skrivande under sparning. Menytestet verifierar dolda sekundära funktioner, tangentbordsnavigation, Escape/fokusåtergång, klick utanför menyn och dokumentinformation. Desktop- och mobilbilder har granskats.

Den avslutande Tauri-körningen använder en unik `se.gitbsidian.verification…`-identitet, separat WebView-profil och en egen filmapp under testappens datamapp. Åtta starter är godkända utan console/page errors. Riktiga filkontroller verifierar att text finns på disk efter stängning, att offlineändringar sparas, att en CSV som skapats direkt i mappen upptäcks och kan redigeras tillbaka till samma fil, att fel bastext inte skriver över filen och att `../` avvisas. Utforskar-knappens målsökväg jämförs med den mapp som faktiskt används. Själva Explorer-fönstret startas inte i automatiseringen. Rapport: `artifacts/desktop-verification-local-files.json`. Användarens installerade app, inloggning och Dokument-mapp används inte av testet.

Filsparning har ett beständigt utkast innan native-anropet. Den nya filversionen skrivs till temporär fil innan namnbyte, med innehållskontroll före skrivning och före ersättning. Detta är inte en atomisk transaktion med andra redigeringsprogram; se dokumenterade begränsningar i `docs/desktop.md`. Ingen ny installationsrelease har byggts/publicerats i denna ändring.

## Arbetsyte-länkar och filimport — utveckling efter 0.3.1, 2026-09-20

Anslutna arbetsytor har en direktlänk till repositoryt eller wikin. Markdown och CSV visas i samma fillista, och den tidigare knappen **Öppna lokal CSV** är ersatt av **Importera fil**. Import läggs i aktiv lokal skrivyta eller vald GitHub-gren/undermapp; Wiki tar emot Markdown. Namnkonflikter ger numrerade kopior, inklusive när en befintlig fjärrfil ännu inte kunnat hämtas. Byte av arbetsyta och native-stängning inväntar pågående import och lokal lagring.

Next.js-produktionsbygge, TypeScript och ESLint är godkända. 23 olika Edge-tester är godkända: sju CSV-tester, åtta arbetsytevalstester, fem nya importtester samt tre befintliga tester för Markdown, mobilvy och sparskydd. Importtesterna kontrollerar filväljare, BOM/radslut, dubblettnamn, befintlig CSV i fillistan, offlineimport/omladdning, rätt mål för repository/Wiki, ogiltiga filtyper/storlek/UTF-8 och att import slutförs innan navigation. GitHub-svar och skrivningar är simulerade. Repository-länk och import har även granskats visuellt i desktop- och mobilstorlek; mobilkontrollen inväntar menyanimationen och verifierar att kontrollerna ligger helt inom skärmen.

Tauri/WebView2-testet är godkänt med åtta starter i separat verifieringsbygge och egen dataprofil, inklusive CSV-import via den gemensamma importfunktionen och återläsning efter offlineomstart. Inga console/page errors. Rapport: `artifacts/desktop-verification-file-import.json`. Ingen riktig GitHub-inloggning eller innehållsskrivning gjordes, och den installerade appens profil användes inte.

Ändringarna är ännu inte paketerade eller publicerade som ny installationsrelease. Den befintliga releasen 0.3.1 och dess kontrollsumma är oförändrade.

## Namnbyte till nand 0.3.1 — 2026-09-20

Synligt appnamn är **nand**, med underraden **Notes and more**. Startsida, sidfot, editor, titel/metadata, desktop-inställningar, npm-paket och Tauri-produktnamn är uppdaterade. Projektets `origin` är kopplat till befintliga `https://github.com/joeriks/nand.git`. Ingen commit eller uppladdning av källkod gjordes vid namnbytet.

Next.js-produktionsbygge inklusive TypeScript och ESLint är godkända. Sex befintliga Edge-tester har körts efter namnbytet: lokal redigering/export/omladdning, mobilvy, sparskydd vid lagringsfel, CSV-typval/felmarkering, synkkö utanför aktiv arbetsyta samt återöppning av vald Wiki/anteckning. Alla sex är godkända. De bredare testresultaten nedan avser tidigare versioner.

Lagringsnycklar, databasnamn, cookies, lås, appidentifierare och intern Rust-/sidecar-identitet behålls för kompatibilitet. Android-källorna är bevarade; Android har inte byggts. Native omstartstest och faktisk installation/uppgradering har inte körts för 0.3.1. NSIS skapar en nand-installationspost; tidigare gitbsidian-installation kan finnas kvar och delar appdata. Se `docs/desktop.md`.

Tauri release och NSIS-paketet är byggda. Windows-resursmetadata visar produktnamnet `nand` och version `0.3.1`. Leverans: `releases/nand-0.3.1-windows-x64-setup.exe` (osignerad). Kopians SHA-256 har jämförts med byggresultatet och finns i `releases/SHA256SUMS.txt`. Tidigare installationspaket behålls.

## CSV-redigerare 0.3.0 — 2026-09-20

CSV öppnas från GitHub-repository eller som lokal arbetskopia från datorn. Tabellvyn erbjuder typigenkänning med Text vid osäkerhet, manuella kolumntyper (Heltal, Decimaltal, Text, Datum och Boolesk), felmarkering, sökning, kolumnfilter, sortering, radredigering och ångra/gör om. Värden konverteras inte. Typval/filter/sortering ändrar inte filinnehållet; export innehåller alla rader i filordning. Lokala kopior exporteras uttryckligen till fil och synkas inte automatiskt till GitHub.

| Kontroll | Resultat |
| --- | --- |
| TypeScript/Next.js-produktionsbygge | Godkända |
| ESLint | Godkänd utan varningar |
| Vitest | 112 tester i tio filer godkända |
| Playwright, Edge | 35 olika tester godkända: 33 i hel körning, därefter alla sju CSV-tester inklusive två nya regressioner |
| Native Tauri/WebView2 | Åtta starter i separat verifieringsbygge godkända, inklusive CSV och offlineomstart; inga console/page errors i den avslutande körningen |
| Produktionspaket | Tauri release och NSIS-installer byggda för Windows x64 |

CSV-testerna verifierar BOM, radslut, citerade och flerradiga fält, svenska tecken, inledande nollor, långa numeriska ID:n, exakta taljämförelser, blandade/osäkra kolumner, ogiltiga kalenderdatum, manuella heltals-/decimalfel, tomma enkolumnsrader, rubrikfria filer, paginering, fokus under sorterad redigering, lokala dubblettnamn, ångra/gör om och export/omladdning. Felaktig CSV kan öppnas i textvyn. Repository-testet verifierar att typval och sortering inte skriver innehåll samt att en offlineändring överlever omladdning och sparas med rätt grund-SHA. GitHub-svaren i testet är simulerade; inga filer i användarens repository ändras.

Native-körningen använder separat appidentifierare, datamapp, Credential Manager-tjänst och WebView-profil. Den kontrollerar CSV-import, textval för `00123`, manuellt decimalval med felmarkering, redigering efter sortering och återläsning av både data och typval efter stängning/offlineomstart. Samtliga tidigare kontroller av repository/Wiki-val, lokala utkast och logout körs också. Den senaste körningen slutfördes 07:49 UTC; de två första observerade starterna var 3011 respektive 938 ms. Detta är testobservationer, inte ett prestandalöfte. Rapport: `artifacts/desktop-verification-0.3.0.json`.

En mellanliggande native-körning fick timeout vid stängning. Diagnostik för startnummer, fel och skärmbild har lagts till i testverktyget. Problemet återkom inte i den fullständiga omkörningen; orsaken är inte fastställd och ingen appändring påstås ha rättat det.

Datum använder `ÅÅÅÅ-MM-DD`; manuella decimaler tillåter punkt/komma utan tusentalsavgränsare. Tomma värden tillåts. Typval ligger i lokal profil, inte i ett portabelt CSV-schema. Filgränsen är 1 MiB; tabellvyn högst 50 000 rader/200 kolumner och 100 rader per sida. Parsern kan normalisera CSV-citering och radslut mellan poster vid en redigering. Gränssnittet har granskats från `artifacts/csv-type-validation.png` och `artifacts/tauri-csv.png`.

Android-källorna har fått CSV-stöd i filvalidering, manifest och exporttyp, men Android/APK har inte byggts eller verifierats. Installation/uppgradering i en ren Windows-miljö, native exportdialogens faktiska filskrivning och fullständigt live-test mot GitHub/Wiki återstår.

Leverans: `releases/gitbsidian-0.3.0-windows-x64-setup.exe`, osignerad Windows x64-installer, med SHA-256 i `releases/SHA256SUMS.txt`. Tidigare 0.2.1-installer behålls. Det ordinarie app-ID:t är oförändrat så att befintliga inställningar och utkast kan återanvändas.

## Rättningsleverans 0.2.1 — 2026-09-20

Senast aktivt valda arbetsyta och senast visade anteckning återställs i webb och Tauri. Valet innehåller kontoavgränsning, lagringsläge, repository, gren och undermapp. Grenväljaren skiljer mellan väntan, tomt resultat och fel och har återförsök. Android-källorna är bevarade och använder samma frontend, men Android/APK har inte byggts eller verifierats i denna rättningsleverans.

| Kontroll | Resultat |
| --- | --- |
| TypeScript och ESLint | Godkända utan varningar |
| Next.js-produktionsbygge | Godkänt |
| Vitest | 80 tester i nio filer godkända; de sju nya urvalstesterna även kontrollerade separat |
| Playwright, Edge | 28 olika tester godkända: 26 i hel körning samt två tillagda tester separat. Preciserat cachetest och visuella kontroller kördes om efter teständringarna. |
| Native Tauri/WebView2 | Sju starter i separat verifieringsbygge, alla kontroller godkända; inga console/page errors |

Nya regressioner verifierar följande:

- Aktivt Wiki-val och en anteckning som endast lästs överlever omladdning trots senare uppdatering av repository-cache och andra utkast. Val tillbaka till repository återställer gren, undermapp och föregående anteckning.
- Cachen öppnas innan ett obesvarat sessionsanrop är klart och efter tokenutgång. Ett misslyckat försök att öppna en ny arbetsyta ersätter inte det tidigare valet.
- En fullständig sparad beskrivning registreras på nytt hos servern när arbetsytans cachemetadata saknas, utan att kasta bort utkast. Nekad registrering visar felet, behåller anteckningen och kan återförsökas.
- Skadad beskrivning visar återställningsvyn, med fungerande återförsök och byte av arbetsyta. Ingen tyst gissning utifrån senast synkad cache görs.
- Val i en annan flik stänger inte den nu öppna editorn. Nästa start följer det senast aktiva valet. Befintliga tester för logout mellan flikar och kontobyte är fortsatt godkända.
- Tom grenlista, misslyckad hämtning och återförsök har olika synliga tillstånd. Återförsök väljer rätt standardgren, eller första grenen om standardgrenen saknas. Försenade lyckade/felaktiga svar från tidigare repository eller lagringsläge påverkar inte aktuellt val.
- Enhetstester kontrollerar dessutom lagringsfel, återställning av äldre valpekare, avbrutet val efter konto-/valbyte och avvisning av en pekare till annat konto.

Native-testet bygger samma källkod som release under **`se.gitbsidian.verification`**, med egen datamapp, Credential Manager-tjänst och WebView-profil. Det ordinarie paketet använder fortsatt `se.gitbsidian.desktop`, så befintliga användarinställningar/inloggning behålls. Testbygget innehåller lokal frontend och riktig Rust-/Node-brygga; det använder ingen appserver. Syntetiska repository- och Wiki-samlingar läggs enbart i testprofilens IndexedDB. Ingen GitHub-token skapas och inga riktiga GitHub-anrop för innehåll görs. Ett första försök mot ordinarie identitet avbröts när en verklig credential upptäcktes, innan ändringar; verifieringen flyttades därför till separat identitet.

Native-kontrollerna omfattar lokal redigering/preview, stängning med sparskydd, cache utan giltig inloggning, offlineomladdning, val från repository till Wiki, återöppning av tidigare visad Wiki-anteckning trots äldre cache, val tillbaka till repository samt bevarat utkast och uttrycklig logout över omstart. Resultat: `artifacts/desktop-verification-0.2.1.json`; bild: `artifacts/tauri-desktop.png`. De två första observerade starterna var 2553 ms och 783 ms på byggdatorn; detta är inte en jämförande prestandamätning.

Grenväljaren och återställningsvyn har även granskats från `artifacts/workspace-picker-retry.png` och `artifacts/workspace-recovery.png`.

Leverans: `releases/gitbsidian-0.2.1-windows-x64-setup.exe`, osignerad Windows x64-installer, med SHA-256 i `releases/SHA256SUMS.txt`. Installation/uppgradering i en ren Windows-miljö, native exportdialogens filskrivning och ett fullständigt live-test mot GitHub/Wiki återstår. Ingen ändring av användarens repository gjordes under denna rättning. Webben saknar fortfarande service worker och behöver nå servern för en helt ny laddning av appens skal.

## Historisk verifiering av 0.2.0

Nedanstående beskriver läget den 19 september, inklusive då saknad GitHub-konfiguration. Det är inte en inventering av användarens nuvarande inställningar. Den äldre native-rapporten bevaras i `artifacts/desktop-verification-0.2.0.json`.

Version: **0.2.0**. Datum: 2026-09-19. Plattform: Windows, Node.js 24.21.0, npm 11.19.0. Webbversionen verifieras som Next.js 16.3.5-produktionsbygge på localhost. Skrivbordsversionen är byggd med Tauri 2.11.5 och Rust 1.98.1. Exakta beroendeträd finns i `package-lock.json` och `src-tauri/Cargo.lock`.

## Automatiska kontroller

| Kontroll | Resultat |
| --- | --- |
| TypeScript (`npm run typecheck`) | Godkänd |
| ESLint (`npm run lint`) | Godkänd utan varningar |
| Produktionsbygge (`npm run build`) | Godkänt |
| Vitest | 73 tester i åtta filer, inklusive riktig lokal Git och desktop-RPC |
| Playwright, Microsoft Edge | 20 webbläsartester godkända; se nedan |
| Tauri release och NSIS-installationspaket | Byggda för Windows x64; osignerade |
| Riktig Tauri-app, WebView2 via CDP | Lokal editor, native RPC, offline-navigation, beständig kö efter omstart och logout godkända; inga gränssnittsfel |
| `npm audit --omit=dev` | Inga kända sårbarheter vid tidigare 0.1-kontroll; inga beroendeversioner har ändrats i 0.2 |

Vitest täcker versionskonflikter, skapanderace, villkorad skrivning, utgångna/förlorade svar, bekräftelse utan extra commit, skyddade grenar, serialisering, IndexedDB-återläsning, lagringsfel, kontoisolering, trevägssammanslagning, radslut/BOM, sökvägsvalidering, ursprungskontroll och sessionskryptering. GitHub-adaptern testas mot simulerad `fetch`, inklusive rätt URL-kodning, appmedlemskap, symlänkar, trunkerade träd och rate limits.

Webbläsartesterna täcker:

1. Lokal redigering, Markdown-förhandsvisning, skriptskydd, omladdning och export.
2. Mobilnavigation vid 390 × 844, svenska sökvägar, mörkt tema och frånvaro av horisontell sidöverströmning.
3. Lagringsfel som bevarar editorn och ger användaren möjlighet att exportera.
4. Två flikar med ett gemensamt IndexedDB-utkast; läslås och säker övertagning med ny återläsning.
5. Fortsatt skrivande under en långsam GitHub-sparning och bevarad senare text efter omladdning.
6. Två isolerade webbläsarsessioner, konflikt och ett uttryckligen granskat resultat.
7. Förlorat svar efter sparning, omladdning och kontroll utan en extra skrivning.
8. Utgången inloggning, fortsatt offlineredigering i en redan öppen app och bevarat utkast.
9. Frontmatter, BOM, blandade radslut och okänd Obsidian-syntax vid riktig CodeMirror-redigering.
10. Skapa en anteckning med svensk sökväg och återläsa exakt sparad text i en ny webbläsarsession.
11. Riktiga lokala API-endpoints avvisar oautentiserad läsning och skrivning från fel Origin.
12. Repository- och Wiki-utkast hålls åtskilda för samma konto/repository/gren/sökväg; mode återställs efter omladdning.
13. Wiki nekar undermappar och använder samma granskningsflöde vid konflikt.
14. Wiki som saknar Git-stöd visas som otillgänglig med förklaring före öppning.
15. Hela samlingen, inklusive tidigare oöppnad undermappsfil, finns i IndexedDB. Utgången inloggning och omladdning bevarar redigering och kön återupptas automatiskt med rätt konto.
16. Delvis misslyckad hämtning visar filfel; återförsök hämtar bara saknade blobbar.
17. Automatisk konflikt bevarar lokal text medan en oberoende köad anteckning synkas.
18. Offline-logout lämnar en beständig spärr även när serverns tidigare session fortfarande är giltig. Kontobyte visar inte föregående kontos arbetsytor.
19. En köad GitHub-arbetsyta synkas även när den lokala provytan visas. Provytans innehåll laddas inte upp.
20. Uttrycklig utloggning i en flik döljer samma kontos arbetsyta i en annan.

Wiki-adaptern testas även med riktiga tillfälliga bare-repositories och Git-processer, utan nätverk: upptäckt av annan standardgren än main, UTF-8/BOM/CRLF, skapande/uppdatering utan förändrade syskonobjekt, samtidig sidändring, ändrad annan sida mellan läsning och push, remote rewind, förlorat lyckat push-svar, symlänkar, titelkollisioner, ändrad standardgren, tom Wiki och rensning av temporära objekt. Dessa tester verifierar Git-protokollets lokala implementation, inte GitHubs behörighetsbeslut.

Synkmotorn testas med riktig IndexedDB-modell och simulerad transport: samlingshämtning i båda lagringssätten, återanvända SHA, hämtning i avgränsade omgångar, kö mellan omgångar, partiell hämtning, tokenutgång, omstart, senare skrivande, förlorat svar utan dubblett, oberoende konflikter, bevarad raderad fjärrfil, kontoisolering och rate-limit-paus. Batchtest verifierar att servern använder sitt eget behörighetskontrollerade manifest.

Desktop-RPC testas som en riktig bundlad Node-process med privat stdin/stdout: start utan nätverkskonfiguration, offentliga appinställningar på disk, ingen token i sessionssvaret samt avvisade oautentiserade/okända adresser innan nätverksanrop. Ett separat test matar den riktiga bundlade backendprocessen med en syntetisk utgången session: lokal användaridentitet återges utan token, medan samtliga testade nätverksrutter avvisas med 401. Annat förväntat konto avvisas även med en ännu giltig syntetisk session.

## Tauri-kontroll

`npm run test:desktop` startade det färdiga `gitbsidian.exe` fem gånger i en ny separat WebView2-testprofil. Ingen lokal Next.js-server används av appen. Riktig Rust-/Node-brygga, Markdown-rendering, omedelbar native-stängning med lokalt sparskydd, omstart, offlinearbete och arbetsyteval kontrollerades.

En **syntetisk tidigare hämtad GitHub-arbetsyta** och lokal kontoidentitet lades i testprofilens IndexedDB/localStorage. Ingen GitHub-token eller verklig inloggning skapades. Appen återöppnade denna arbetsyta utan giltig credential. Efter omstart sattes WebView uttryckligen offline, dokumentet laddades på nytt och testet kontrollerade att dokumentets `performance.timeOrigin` ändrats och editorn återkommit. Text ändrades och återlästes efter ytterligare omstart/offline-navigation; den ursprungliga grundtexten och det köade nya innehållet kontrollerades separat i IndexedDB. Explicit logout följt av omstart öppnade enbart den lokala provytan.

CDP:s globala offlineemulering återställdes före testverktygets native-stängningskommando, eftersom den även kan blockera verktygets privata IPC-kontrolladress. Detta skiljer testets offline-navigation/redigering från kontrollanropet för stängning. Inga console errors eller page errors noterades. Verklig GitHub-/Wiki-autentisering och synk ingår inte i detta native-test.

Processstart till synlig och upplåst editor i de två första starterna: **799 ms** och **768 ms**. Det är lokala testobservationer, inte en generell starttid eller Electron-jämförelse. Maskinbelastning och WebView-cache påverkar resultatet. Resultat finns i `artifacts/desktop-verification-0.2.0.json`, bild i `artifacts/tauri-desktop.png`.

Installer: `releases/gitbsidian-0.2.0-windows-x64-setup.exe` (cirka 26 MB), med checksumma i `releases/SHA256SUMS.txt`. Paketet innehåller lokal frontend, Node-sidecar och licenser utan `.env.local` eller GitHub-uppgifter. Det är **osignerat**, och automatisk uppdatering är inte implementerad. Native exportdialogens faktiska filskrivning och installation i en ren Windows-miljö återstår; appen kördes direkt ur release-katalogen.

Webbgränssnittets offlineöversikt har också granskats visuellt från Playwright-skärmbilden `test-results/offline-collection.png`. Tidigare agent-browser-kontroll gällde 0.1. Mobil- och desktoptester använder Edge/WebView2; fler plattformar har inte verifierats.

## Vad som är simulerat

**Ingen GitHub App har konfigurerats och inget riktigt GitHub-repository har ändrats eller använts för integrationstester.** Webbläsartesternas GitHub-sessioner och API-svar simuleras uttryckligen i `tests/e2e/app.spec.ts` och `tests/e2e/offline.spec.ts`. Utkastens IndexedDB-lagring, editorn och den övriga klientkoden är riktiga. Adaptertester ersätter enbart GitHubs HTTP-svar. Produktionskoden innehåller ingen testinloggning eller simulerad backend.

Att två testwebbläsare läser samma simulerade fjärrinnehåll uppfyller alltså inte i sig underlagets acceptanskrav mot riktig GitHub. OAuth, faktisk installation och verkliga grenregler måste verifieras nedan.

## Återstående acceptanstest mot GitHub

Vid slutkontrollen saknades `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` och `GITHUB_APP_SLUG` i webbkonfigurationen, och desktop hade ingen sparad offentlig GitHub App-konfiguration. Därför återstår följande riktiga prov. Använd ett särskilt testrepository och GitHub App enligt README; aktivera Device flow för Tauri och installera appen på testrepositoryt med Contents read/write. Dela inga hemligheter i testprotokollet.

- [ ] Logga in med GitHub, välj ett tillåtet privat repository, befintlig gren och undermapp.
- [ ] Skapa `Projekt/Årets idéer.md`, skriv känd text, spara och kontrollera den faktiska committen på GitHub.
- [ ] Öppna en separat webbläsarprofil, logga in och verifiera exakt samma text från GitHub.
- [ ] Fortsätt skriva medan ett nätverksanrop fördröjs; verifiera att den senare texten förblir ett utkast.
- [ ] Ändra samma fil i två separata profiler samt direkt på GitHub. Verifiera konflikt utan tyst överskrivning.
- [ ] Bryt nätet före och efter en skrivning. Ladda om, kontrollera fjärrläget och säkerställ att ingen dubblettcommit skapas.
- [ ] Återkalla appåtkomst, prova en skyddad gren och en utgången session. Utkastet ska finnas kvar och felet vara begripligt.
- [ ] Logga ut, byt konto/repository/gren och kontrollera att privata utkast aldrig visas för fel konto.
- [ ] Kontrollera vald undermapp och privata bilagor. Bilagor ska i denna version visas som platshållare, inte läcka genom publika URL:er.
- [ ] Aktivera Wiki och skapa första sidan på GitHub. Verifiera privat Wiki-läsning och skrivning med den riktiga GitHub App-användartokenen. Testa nekad åtkomst och avstängd Wiki.
- [ ] Ändra samma Wiki-sida direkt på GitHub och i appen. Verifiera granskning, samt att samma filnamn i vanligt repository aldrig påverkas.
- [ ] Aktivera Device flow. Godkänn i vanlig webbläsare, starta om Tauri och kontrollera återanvänd inloggning från Windows Credential Manager. Verifiera logout, utgången token och återkallad åtkomst.
- [ ] Hämta en hel repository-undermapp och en hel Wiki, inklusive oöppnade sidor. Koppla bort internet, låt inloggningen gå ut och starta om Tauri. Alla stödda hämtade filer ska gå att redigera.
- [ ] Starta om med flera köade ändringar, återanslut och logga in med samma konto. Kontrollera riktiga commits, senare skrivande och att en konflikt inte blockerar andra sidor.
- [ ] Avbryt en samlingshämtning och prova API-paus, för stor/ogiltig fil samt extern radering. Kontrollera kvarvarande lokal text, filvis status och återupptagning utan onödig omhämtning.
- [ ] Kör installationsprogrammet på en ren Windows-miljö, med respektive utan WebView2/Git, och kontrollera native export.

## Ej verifierat eller ej implementerat

Full offlineöppning i webbversionen, service worker, komplett indexering, tusentalsanteckningsprestanda, namnbyte/flytt/radering, historik/återställning, faktiska Obsidian-exempelsamlingar, JSON Canvas, skärmläsartest och enhets-/webbläsarmatris utöver Edge/WebView2. Dessa punkter är öppna i roadmapen. Tester med simulerade svar bevisar inte faktisk GitHub-behörighet eller driftklarhet.
