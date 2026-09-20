# nand — Notes and more

Samla, organisera och redigera din kunskap. En svensk Markdown-skrivyta och CSV-redigerare för webb och Windows, med lokala utkast och GitHub som permanent lagring.

App- och repositorynamn: **nand**, tills vidare. Repository: [joeriks/nand](https://github.com/joeriks/nand). Namnbytet i 0.3.1 ändrar gränssnitt och produktnamn; interna lagringsnycklar och appidentifierare behålls för befintliga utkast och inloggning.

**Status 0.3.3:** Valbar lokal rotmapp med direkt filåtkomst och signerade appuppdateringar finns i Windows-appen. Appen heter nand. CSV-redigering med typigenkänning, manuella kolumntyper, felmarkering, filter och sortering ingår. Återöppning av senast aktivt valda arbetsyta/anteckning och tydliga tillstånd för grenhämtning är rättade. Samlingshämtning, lokal åtkomst efter tokenutgång och beständig automatisk synk finns sedan 0.2. Projektgrunden och etapp 1 är implementerade; fullständigt dokumenterat acceptanstest mot riktig GitHub återstår. Etapp 2–5 är inte levererade. Appen är inte fullständigt Obsidian-kompatibel.

## Skrivbordsapp med Tauri

Projektet har också en **Tauri 2-app för Windows x64**. Den paketerar React-editorn lokalt och återöppnar senast aktivt valda GitHub-arbetsyta utan nätverk, även efter utgången inloggning. Utan tidigare val öppnas den lokala skrivytan. En medföljande Node-process hanterar GitHub och Wiki via en privat kanal till Rust, utan lokal webbserver. Node ingår i paketet; Git behövs separat för Wiki. Befintliga webbläsarutkast flyttas inte automatiskt till appen.

```powershell
npm ci
npm run tauri dev
# Skapa ett installationspaket:
npm run desktop:build
```

Byggdatorn behöver [Rust, Microsoft C++ Build Tools och WebView2](https://v2.tauri.app/start/prerequisites/). Installationsfilen skapas i `src-tauri/target/release/bundle/nsis/`. Paketet är ännu inte signerat. Automatisk uppdatering och byggen för macOS/Linux är inte implementerade.

I appen: **Anslut GitHub → Konfigurera GitHub App**. Ange Client ID och appens namn från GitHub-adressen. Aktivera **Device flow** i GitHub-appens inställningar. Godkänn sedan engångskoden i din vanliga webbläsare. Desktop använder inga client secrets eller webbservercookies. Användartoken sparas i Windows Credential Manager och lämnar inte den privilegierade Rust-/Node-delen. Ny inloggning behövs för nätverksåtkomst efter högst åtta timmar; hämtade anteckningar går fortsatt att redigera lokalt. Se [skrivbordsarkitekturen](docs/desktop.md).

## Filer och import

Dessa funktioner ingår i version 0.3.2.

I Windows-appen är den lokala skrivytan en riktig **nand**-mapp under användarens **Dokument**. Länken **Öppna i Utforskaren** öppnar exakt den mappen. Markdown- och CSV-filer i undermappar läses in, nya filer upptäcks och redigeringar sparas automatiskt. Appen kontrollerar mappen ungefär varannan sekund och när den får fokus. Befintliga lokala utkast sparas ut till filer; om samma namn redan har annat innehåll visas en jämförelse. Utkasten ligger kvar som skydd i appens databas. Ändringar/radering utanför appen jämförs med det öppnade innehållet innan sparning. Den vanliga webbversionen behåller sin webbläsarlagring och visar ingen Utforskar-länk.

**Fler alternativ** (⋯) samlar import, export, uppdatering och dokumentinformation. Sökning, ny anteckning, filval och skriv-/läsläge ligger kvar direkt i arbetsytan.

Den anslutna arbetsytan har en direktlänk till sitt repository eller sin wiki på GitHub. Befintliga Markdown- och CSV-filer visas tillsammans i fillistan. CSV-filer öppnas automatiskt i tabellredigeraren.

**Importera fil** lägger en UTF-8-fil på högst 1 MiB i den valda arbetsytan: Markdown (`.md`) eller CSV (`.csv`) i lokal skrivyta/repository, och Markdown i Wiki. I repositoryläget används vald gren och undermapp. GitHub-importer går genom den vanliga synkkön; lokala importer stannar i den lokala skrivytan. Ett upptaget filnamn får ett nytt namn, utan att befintlig fil skrivs över. Originalfilen på datorn påverkas inte.

Från 0.3.3 väljs rotmappen under **Fler alternativ → Välj rotmapp**. Appen minns valet och redigerar filerna direkt i mappen. Befintliga filer flyttas inte vid mappbyte. Den stöder högst 500 Markdown/CSV-filer och 16 MiB text totalt, med högst 1 MiB per fil. Filer ska vara UTF-8; binär text, otillgängliga filer och överskridna gränser ger ett läs-/sparfel medan utkasten bevaras. `.git`, `.obsidian`, appens temporära filer och symboliska länkar tas inte med. Importen kopierar till den valda rotmappen, den skapar ingen permanent koppling till originalfilen.

## CSV-redigerare

Öppna `.csv`-filer direkt i arbetsytans fillista. **Importera fil** lägger till en fil från datorn enligt ovan. **Exportera CSV** sparar arbetskopian till en fil på datorn. CSV i en GitHub-arbetsyta använder samma offlinekö, behörighetskontroll och konflikthantering som Markdown. Wiki stöder fortsatt endast Markdown.

Tabellvyn har global sökning, filter per kolumn, sortering, radredigering, lägg till/ta bort rad samt ångra/gör om (de senaste 20 ändringarna i den öppna tabellen). Växla till **CSV-text** för att redigera källtext eller rätta en fil som inte kan tolkas. Filter och sortering ändrar endast vyn: sparning och export bevarar samtliga rader i deras filordning.

Varje kolumn har **Auto**, **Heltal**, **Decimaltal**, **Text**, **Datum** och **Boolesk**. Osäker/blandad/tom kolumn blir Text. Inledande nollor, långa numeriska ID:n, lokalt tvetydiga tal och datum konverteras inte automatiskt. Manuella typval markerar felaktiga celler med röd kant, feltext och `aria-invalid`; de ändrar inte värden eller blockerar sparning. Tomma celler tillåts. Datum valideras som riktiga kalenderdatum i `ÅÅÅÅ-MM-DD`; decimaltal accepterar punkt eller komma, utan tusentalsavgränsare. Manuella inställningar sparas per fil i den lokala profilen, inte som schema i CSV-filen eller på andra enheter.

Komma, semikolon, tabb och lodstreck kan identifieras automatiskt eller väljas manuellt. Första raden används som rubriker tills kryssrutan avmarkeras. Citerade fält, citattecken, radbrytningar i celler, UTF-8-BOM och svenska tecken stöds. Ingen typkonvertering eller formelevaluering görs. Vid grid-redigering kan CSV-citering normaliseras och filens första radslutskonvention användas; cellvärdena bevaras. Gränser: UTF-8, 1 MiB per fil, högst 50 000 rader/200 kolumner i tabellvyn, 100 rader per visningssida.

## Återöppning och arbetsyteval i 0.2.1

Vid start och omladdning återöppnas den senast aktivt valda GitHub-arbetsytan för samma konto: repository eller Wiki, med rätt gren och undermapp. Valet sparas när arbetsytan öppnats och lagrats lokalt. Bakgrundssynk och nyare utkast ändrar inte valet. Den senast öppnade anteckningen återställs per arbetsyta.

Cachen öppnas utan att invänta sessionsanropet, även efter tokenutgång. Tauri kan dessutom starta helt utan nät. Webben behöver fortfarande nå appservern för att ladda appens skal. Saknad/skadad valbeskrivning visar fel med återförsök och nytt val; den byts inte tyst mot en annan arbetsyta. Utkast behålls och uttrycklig utloggning/kontobyte respekteras.

Grenväljaren skiljer mellan **Hämtar grenar**, **Inga grenar finns ännu** och **Kunde inte hämta grenar**. Ett tomt repository länkas till GitHub för första commit. **Hämta grenar igen** uppdaterar listan och väljer repositoryts standardgren när den finns.

## Offline och automatisk synk

När du väljer en GitHub-arbetsyta hämtas hela dess stödda samling: vanliga UTF-8-filer, högst 1 MiB per fil. Repositoryläget inkluderar `.md` och `.csv` i vald undermapp och dess undermappar; Wiki omfattar `.md` i roten. Statusen **Offline och synkkö** visar antal hämtade filer, saknade/äldre versioner, fel och köade ändringar. Oändrade blobbar hämtas inte på nytt. Använd **Hämta och synka nu** för att försöka igen efter en partiell hämtning.

Varje ändring lagras lokalt och köas för automatisk synk efter cirka 2,5 sekunders skrivpaus. Skrivningar sker i ordning. Kön, osäkra sparningssvar och konflikter överlever omstart. När nät och inloggning fungerar igen återupptas synkningen även för andra tidigare valda arbetsytor i samma konto. Vid nätfel används väntetid och återförsök; GitHubs API-paus respekteras. **Spara till GitHub** och `Ctrl+S` finns kvar för manuell synk. Synk av Wiki ändrar den synliga Wiki-sidan.

Utgången inloggning stoppar nätverksåtkomst, men hämtade arbetsytor finns fortsatt på enheten. **Uttrycklig utloggning döljer kontots cache**, även om utloggningsanropet misslyckas utan nät. Ny inloggning med samma konto öppnar den igen; andra konton ser inte dess cache. Lokala data är okrypterade i Windows-/webbläsarprofilen. Det är inte ett skydd mot någon som kan läsa profilens filer.

Extern ändring granskas om den kolliderar med lokalt arbete. Extern radering behåller den lokala texten och kräver granskning innan en eventuell återskapning. Konflikter blockerar endast berörda anteckningar. Godkänt resultat köas för synk. Senare skrivande bevaras när en tidigare ögonblicksbild bekräftas.

Tauri kan startas helt utan nät och återöppna hämtat innehåll. **Webbversionen saknar fortfarande service worker**: den redan laddade appen fungerar offline, men en helt ny webbläsarladdning behöver nå appservern. Ingen synk sker när appen/webbfliken är stängd. Det separata lokala provläget laddas aldrig upp automatiskt. Att öppna en lokal filsystemsmapp ingår inte.

## Starta lokalt

Kräver Node.js 24 eller senare och npm. Använd en aktuell Chromium-webbläsare, Firefox eller Safari med IndexedDB och Web Locks. Den faktiska webbläsarverifieringen har gjorts i Microsoft Edge.

```powershell
npm ci
npm run setup
npm run dev
```

Öppna **http://localhost:3000**. `Prova skrivytan lokalt` fungerar utan GitHub-konfiguration: detta är en riktig lokal editor med beständiga utkast och Markdown-export. Den kopplas inte till något låtsasrepository. Lokala anteckningar laddas inte upp automatiskt när du ansluter GitHub; exportera dem och för över innehållet själv i denna version.

`npm run setup` skapar `.env.local` med en slumpmässig sessionsnyckel. Befintliga inställningar skrivs aldrig över. Filen är ignorerad av Git. Klistra inte in hemligheter i anteckningar, chattar eller dokumentation.

## Anslut en GitHub App

1. Öppna [GitHubs utvecklarinställningar](https://github.com/settings/apps) och skapa en **GitHub App** (inte en OAuth App).
2. Ange en startsida. Vid lokal testning används `http://localhost:3000`.
3. Under användarauktorisering anger du callback-URL: `http://localhost:3000/api/auth/callback`. Aktivera **Request user authorization (OAuth) during installation** om du vill att installationen också leder genom inloggningen. Web application flow används; device flow behövs inte.
4. Behörigheter för repository: **Contents: Read and write**; **Metadata: Read-only** (obligatorisk). Inga organisationstillstånd, Actions-, Workflows- eller e-postbehörigheter behövs. Ingen privat appnyckel behövs för detta användartokenflöde.
5. Stäng av webhookleveranser för den här första versionen. Tokenåterkallning upptäcks på nästa GitHub-anrop; inga bakgrundsanrop görs på utloggade sessioner.
6. Behåll utgångstid för användartoken. Appen använder en session om högst åtta timmar och ber därefter om ny inloggning. Refresh tokens används inte ännu.
7. Installera appen på **Only select repositories** och välj ett särskilt testrepository. Skapa först en README eller annan första commit i repositoryt. Skapa vid behov en tillåten arbetsgren på GitHub.
8. Fyll i följande i `.env.local` och starta om servern:

| Variabel | Värde |
| --- | --- |
| `APP_URL` | Appens exakta ursprung utan avslutande snedstreck, lokalt `http://localhost:3000` |
| `GITHUB_CLIENT_ID` | GitHub-appens **Client ID**, inte App ID |
| `GITHUB_CLIENT_SECRET` | En genererad client secret, endast på servern |
| `GITHUB_APP_SLUG` | Namnet i adressen `github.com/apps/<namn>` |
| `SESSION_SECRET` | 64 slumpmässiga hextecken; genereras av `npm run setup` |
| `SESSION_DB_PATH` | `.data/sessions.sqlite`, eller en sökväg på beständig serverdisk |

Logga in i appen, välj repository, befintlig gren och valfri undermapp. Undermappen behöver inte finnas ännu. Skapa en anteckning; den synkas automatiskt. **Spara till GitHub** kan användas för att synka direkt. Utkast och bekräftade GitHub-versioner har skilda statusmeddelanden. Om direkt sparning nekas: kontrollera appens behörigheter och välj en tillåten arbetsgren via arbetsyteväljaren. Grenregler kringgås aldrig.

## Välj repositoryfiler eller GitHub Wiki

Arbetsyteväljaren har två verkliga lagringssätt med samma editor, utkastmodell och konfliktdialog:

| Lagringssätt | Plats | Val i appen | Skrivning |
| --- | --- | --- | --- |
| Repositoryfiler | Vanliga `.md`- och `.csv`-filer i repositoryt | Befintlig gren och valfri undermapp | GitHub Contents API med blob-SHA |
| GitHub Wiki | Separata `OWNER/REPO.wiki.git` | Wikins faktiska standardgren och rot | Git-commit och vanlig push med kontroll av grenens gamla SHA |

Wiki behöver vara aktiverad och ha **en första sida skapad på GitHub**. Tillgången beror också på repositoryts plan, appinstallation och användarens rättigheter. Appen skapar inte en Wiki åt användaren. Den verifierar åtkomsten när Wiki öppnas; nekad åtkomst lämnar utkasten kvar. Spara uppdaterar den publicerade Wiki-sidan direkt för dem som har åtkomst till repositoryts Wiki.

Wiki använder samma GitHub App user access token och Contents-behörighet för HTTPS-Git. [GitHub dokumenterar dessa token för Git-autentisering](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app). **Just åtkomsten till en riktig privat Wiki med en konfigurerad app återstår att integrationstesta.** Ingen Contents API-adress för Wiki antas. Ingen extra PAT med bredare behörighet begärs.

Första Wiki-versionen stöder vanliga UTF-8-filer med ändelsen `.md` i roten, högst 1 MiB per sida. Inga undermappar, andra Wiki-format eller bilageuppladdningar redigeras; befintliga övriga objekt bevaras. Titlar som kolliderar efter normalisering nekas. Git hämtar ett grunt snapshot, med 64 MiB-gräns på objektlagret **efter hämtning** och 45 sekunders tidsgräns per Git-process. Webben kräver Git 2 på servern. `GIT_EXECUTABLE`, `WIKI_TEMP_DIR` och `WIKI_ENABLED=false` finns i `.env.example`.

Varje Wiki-anrop använder en separat tillfällig bare-klon utan checkout. Den tas bort efter anropet; processkrasch kan lämna rester. Driftmiljön behöver privat temporär disk, diskkvot och städning av gamla request-mappar när inga anrop pågår. I desktop ligger dessa under appens lokala datamapp. Tokens skrivs aldrig till Git-URL, kommandoradsargument eller Git-konfiguration på disk.

## Det som fungerar nu

- CodeMirror-editor, syntaxmarkering, ångra/gör om och säkert renderad GFM-förhandsvisning.
- Skapa, öppna och spara UTF-8-filer med svensk text och mellanslag i sökvägen.
- Filträd, filtrering på filnamn, undermappar, Markdown-export, dator- och mobilvy samt ljust/mörkt tema.
- GitHub App-inloggning med state och PKCE. Token finns bara i krypterad serverlagring; webbläsarens cookie innehåller ett slumpmässigt sessions-ID.
- Åtkomstkontroll mot GitHub vid varje filoperation och serverbunden arbetsyta.
- IndexedDB-utkast avgränsade per konto, lagringssätt, repository, gren, undermapp och sökväg, med grundversion och pågående sparning. Befintliga repositoryutkast behåller sina gamla nycklar.
- Fast sparningsögonblicksbild, villkorad GitHub-skrivning, återläsning efter osäkra svar och granskning av tre versioner vid konflikt.
- Hela hämtade samlingar kan redigeras medan nätet är nere, även efter att inloggningen gått ut. Ändringar återupptas automatiskt efter återanslutning och giltig inloggning.
- En andra flik får läsåtkomst när samma lokala utkast redan redigeras. Stäng den första eller byt anteckning där, och välj **Försök igen** i den andra.

`Ctrl/Cmd+S` sparar till GitHub när en GitHub-arbetsyta är öppen. `Ctrl/Cmd+K` fokuserar filnamnssökningen. Vanliga editorgenvägar för ångra/gör om fungerar. Tangentfokus är synligt och dialoger använder native `<dialog>` med fokuslåsning.

## Teknisk grund

Next.js App Router och React med TypeScript, Node-runtime och Route Handlers. Alla paket är exakt versionslåsta i `package-lock.json`. Aktuella versioner kontrollerades vid installationen 2026-09-19.

Webbläsaren använder CodeMirror, `react-markdown`/GFM, IndexedDB genom `idb` och en separat utkastmodell. Typsnitt levereras lokalt genom `next/font/local`. Inga externa typsnitt, spårningsskript eller automatisk hämtning av bilder från anteckningar används.

Repositoryläget anropar GitHubs dokumenterade REST-API med GitHub App user access tokens (API-version `2026-03-10`). Filträdet använder Git Trees, filer läses som blobs och skrivs villkorat med Contents API. Trunkerade träd hämtas mappvis. Wiki-läget använder HTTPS-Git via en separat adapter. SHA, status och fel kontrolleras; inga `force`-anrop finns.

SQLite innehåller enbart krypterade sessioner och valda arbetsytor, inte anteckningsinnehåll. AES-256-GCM används för kryptering, sessions-ID lagras hashat. Läs mer i [arkitektur och sparning](docs/architecture.md).

## Verifiera

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run desktop:build
npm run test:desktop
```

Webbläsartesterna startar produktionsservern om den inte redan kör. På Windows används installerad Microsoft Edge. På andra plattformar: installera Chromium med `npx playwright install chromium`. Kör om bygget efter källkodsändringar före webbläsartesterna.

Se [verifieringsrapporten](docs/verification.md) för exakta resultat, avgränsning av simulerade GitHub-anrop och en checklista för det återstående riktiga integrationstestet.

## Driftsättning

Den här versionen körs som **en Node-process med beständig disk**, exempelvis bakom en HTTPS-proxy på en egen server eller containerplattform. Ingen driftleverantör är vald och inget är publicerat.

```powershell
npm ci
npm run build
# Ange produktionsmiljövariabler via värdplattformen.
npm run start
```

`npm run start` lyssnar som standard bara på loopback. För containerbruk: `npm run start -- --hostname 0.0.0.0`. Exponera inte `.data`, `.env.local` eller övriga projektfiler via webbservern. Låt `APP_URL` och GitHub-appens startsida/callback matcha den riktiga HTTPS-adressen. HTTPS ger `Secure`-cookies. Använd en separat GitHub App och separat sessionsnyckel för produktion. Node-kontot ska ensamt ha åtkomst till datakatalogen.

Ephemeral/serverless-disk eller flera serverprocesser stöds inte i den här implementationen: byt först SQLite-sessionerna till gemensam serverlagring och skrivkön till en distribuerad kö. GitHubs SHA-kontroll behövs även då. Anteckningarna ligger fortfarande på GitHub och kräver ingen egen innehållsdatabas.

## Kvarvarande arbete

Se [roadmap](docs/roadmap.md) och [format och kompatibilitet](docs/compatibility.md). Nästa leverans är först det riktiga GitHub-acceptanstestet, därefter etapp 2 med interna länkar, fulltextsökning, bakåtlänkar och atomiska filflyttar.
