# Arkitektur och sparning

## Ansvarsgränser

- `src/components`: gränssnitt, editor, konfliktdialog och arbetsyteväljare.
- `src/lib/drafts.ts`: persistent utkastmodell, versionsövergångar och trevägssammanslagning.
- `src/lib/workspace-sync.ts`: gemensam samlingshämtning och beständig synkkö för webb/Tauri.
- `src/lib/local-access.ts`: tidigare verifierad lokal kontoidentitet och beständig spärr efter uttrycklig utloggning.
- `src/lib/editor-text.ts`: omsätter editorns LF-positioner till originaltext, inklusive CRLF och BOM.
- `src/lib/server`: sessionslagring, GitHub-klient, JSON-gränser, behörigheter och sparningsprotokoll.
- `src/app/api`: små serverendpoints; ingen GitHub-token skickas till klienten.
- `src/lib/server/storage.ts`: väljer repository- eller Wiki-adapter.
- `src/lib/server/wiki-git.ts`: isolerade temporära Git-objekt, Wiki-läsning och villkorad push.
- `desktop` och `src-tauri`: paketerad editor, privat Node-kanal och native inloggningslagring. Se `desktop.md`.

Anteckningsinnehåll passerar servern för GitHub-anrop men lagras inte i serverdatabasen. `Cache-Control: no-store, private` används på JSON-svar. Innehåll loggas inte av appkoden. Aktivera inte loggning av request bodies, cookies eller OAuth-callbackens query-parametrar i en driftproxy.

## Identitet och session

OAuth använder slumpmässigt state, PKCE S256, tio minuters tidsgräns och HttpOnly-cookie för det krypterade engångsunderlaget. Callback växlar koden på servern, läser `/user` och skapar en ny session. Refresh-token från GitHub används inte och lagras inte. En session varar högst åtta timmar. Tokens och serverarbetsytor krypteras med AES-256-GCM. Webbläsaren får ett slumpmässigt sessions-ID i en HttpOnly/SameSite=Lax-cookie, Secure i HTTPS-miljö.

Varje filoperation verifierar sessionen, slår upp en arbetsyta som hör till den sessionen och frågar GitHub efter repositories som både appen och användaren får nå. Repositorynamnet hämtas ur GitHubs svar. Filvägen valideras och läggs under den serverlagrade undermappen. Byten av undermapp kräver en ny vald arbetsyta. Undermappen är inte en GitHub-behörighetsgräns.

POST och PUT kräver appens exakta Origin och en egen request-header. JSON-kroppen begränsas till 2 MiB och textinnehållet till 1 MiB. Inga hemligheter har `NEXT_PUBLIC_`-prefix. Symboliska länkar och submoduler öppnas inte som anteckningar.

## Utkast

IndexedDB-databasen `gitbsidian-v1` lagrar en post per JSON-kodad nyckel: konto-ID, lagringssätt, repository-ID, gren, undermapp och relativ sökväg. Repositoryläget behåller gamla nyckeln `[repositoryId, branch, root]`; Wiki använder `["wiki", repositoryId, branch, root]`. Saknat mode i äldre val betyder repository. All cache, pending sparning och Web Locks använder denna avgränsning. Lokalt provläge har en separat identitet och samling. Varje post innehåller:

- Grundens blob-SHA och exakta text.
- Nuvarande text och tid för senaste ändring.
- Bekräftad spartid när sådan finns.
- En pågående sparningsögonblicksbild (text, grund-SHA och starttid).
- Grundtext och fjärrversion när en konflikt har upptäckts.

Varje editorändring uppdaterar modellen direkt och köas till IndexedDB. UI säger först att den sparar lokalt och visar bekräftelse först efter avslutad databasoperation. Vid lagringsfel visas exportväg och sidlämning får en varning. IndexedDB är ingen permanent säkerhetskopia och okrypterat innehåll kan läsas av någon med åtkomst till samma webbläsarprofil/utvecklarverktyg. Appens kontoavgränsning är inte en fysisk säkerhetsgräns på en delad dator.

Web Locks ger endast en skrivande flik per utkast. Den som får låset läser om det beständiga utkastet innan redigering tillåts. Ett lås hålls kvar tills pågående sparning och lokala skrivningar är avslutade. Andra flikar får inte skriva över det under tiden. Utloggning och kontobyte meddelas till öppna flikar; privata arbetsytor döljs men utkast raderas inte.

## Spara till GitHub

1. Om en äldre operation saknar svar: läs först GitHub och jämför med dess sparade ögonblicksbild. Samma bekräftade text behöver inte skrivas igen.
2. Ta en ögonblicksbild av nuvarande text och grund-SHA och spara den i IndexedDB innan nätverksskrivningen börjar.
3. På servern köas skrivningar per repository och gren inom processen. GitHub-medlemskap kontrolleras för varje operation.
4. Läs aktuell filversion. Om texten redan finns där bekräftas den utan ny commit. Om SHA skiljer sig och texten skiljer sig returneras en konflikt.
5. PUT till Contents API med den förväntade blob-SHA:n (utan SHA endast vid skapande). GitHub kontrollerar även loppet mellan läsning och skrivning.
6. Uppdatera utkastets **grund** till den bekräftade ögonblicksbilden. Nuvarande text ersätts aldrig av sparningssvaret; fortsatt skrivande förblir osparat till GitHub.
7. Om skrivsvaret förloras gör servern en återläsning. Om också den misslyckas sparas osäkerheten på klienten. Nästa sparningsförsök läser fjärrläget innan en skrivning tillåts.

Fel som avvisad gren, utgången inloggning eller API-gräns bevarar utkastet. GitHubs `Retry-After`/ratelimit-reset styr en paus i serverklienten. Skrivningar återförsöks aldrig blint.

## Konflikter

Grund, lokal text och ny fjärrtext sparas tillsammans. En radbaserad trevägssammanslagning föreslås om ändringarna inte överlappar. Även det förslaget granskas. Vid överlappning kan användaren redigera resultatet eller välja en hel version. `Använd resultatet` ändrar bara det lokala utkastet och dess förväntade grund. Resultatet köas för automatisk synk efter granskningen. Ändras GitHub igen under granskningen sker en ny konfliktkontroll. Ingen force push används.

## Wiki-adapter

Wiki är ett separat Git-repository på `https://github.com/OWNER/REPO.wiki.git`. Appmedlemskap och vanliga repositorymetadata verifieras via REST; själva Wiki-innehållet går aldrig genom Contents API. `ls-remote --symref` bestämmer Wikins standardgren. Grenbyte upptäcks och kräver nytt arbetsyteval. Första sidan måste redan vara skapad på GitHub.

Varje operation skapar ett privat temporärt bare-repository. Ingen checkout utförs, inga hämtade hooks körs, inga symlänkar följs. Befintliga icke-redigerbara filer ligger kvar i trädet. Endast vald blobs innehåll ändras med Git plumbing. Före skrivning läses aktuell blob-SHA. En egen pre-push-hook jämför remote-SHA med exakt läst gren-SHA, inklusive fallet där någon återställt grenen bakåt. Vanlig push använder sedan Git-serverns atomiska ref-kontroll. Ingen force eller force-with-lease används. Vid osäkert svar återläser samma `saveVersion`-protokoll både repo- och Wiki-versioner.

Git körs utan shellinterpolering, ärvda credential helpers, tracing, globala/systeminställningar eller HTTP-omdirigeringar. Token skickas som en processlokal HTTPS-header för endast github.com; den läggs inte i URL, argument eller konfigurationsfil. Detaljerade subprocessfel filtreras bort. Backend har en fast GitHub-värd och tar inget externt Git-URL-val från användaren.

Tillfälliga objekt tas bort i `finally`. Vid processkrasch kan de finnas kvar under `WIKI_TEMP_DIR`. Serverdisk och desktopprofil måste därför behandlas som innehållslagring, även om SQLite endast innehåller sessioner. Storleksgränsen på 64 MiB kontrolleras efter hämtningen och ersätter inte driftens diskkvot. Nuvarande stöd är root-level `.md`, UTF-8, högst 1 MiB per sida; externa bilagor och andra markup-format bevaras utan redigering.

## Nuvarande drift- och skalgränser

En Node-process, beständig SQLite-disk och en inprocesskö. Det finns inte distribuerad låsning eller gemensam sessionslagring för flera instanser. SHA-skyddet hos GitHub finns även över separata processer men arbetsytekön är inte distribuerad.

Hela valda samlingar hämtas, men fulltextsökning och prestandatest med tusentals anteckningar återstår. Webben behöver ladda sitt skal från servern; Tauri paketerar det lokalt. Ingen synk körs när appen är stängd.

## Samlingscache och kö i version 0.2

IndexedDB-databasen behåller namnet `gitbsidian-v1` och migreras additivt till schema 2 med `workspaces` (kontoindex, arbetsyta, filmanifest, senaste kontroll, fel per fil). Befintliga utkastnycklar ändras inte. Kontoidentiteten i lokal profil ger endast lokal åtkomst. Varje synkomgång kontrollerar aktuell session, konto-ID och serverregistrerad arbetsyta; varje innehållsanrop kontrollerar aktuell GitHub-behörighet. `account` skickas på nätverksanrop och jämförs med sessionens konto, så ett cookiebyte inte kan skicka det tidigare kontots utkast till det nya kontot.

Utgången token lämnar lokal identitet kvar. Explicit logout skriver först en beständig lokal spärr och meddelar övriga flikar, därefter görs server/native-utloggning. En gammal servercookie återöppnar därför inte automatiskt data efter ett misslyckat offline-logout. En lyckad ny inloggning häver spärren. Desktop kan även migrera lokal identitet från en äldre utgången Credential Manager-session utan att exponera token. Cache är profilbaserad och okrypterad, inte en ny autentiseringsmetod mot GitHub.

En dirty `Draft` är själva beständiga köposten. `pending` innehåller exakt nätverksögonblicksbild. Därmed kan en separat kö inte hamna ur fas med editortexten. Efter 2,5 sekunders skrivpaus behandlas kandidater i ordning under ett kontogemensamt Web Lock. Filens redigeringslås hålls också; inaktiva utkast läses om från IndexedDB efter låsövertagning. Andra tidigare valda arbetsytor kontrolleras var tionde sekund medan appen är öppen. Det lokala provläget saknar GitHub-arbetsyta och ingår aldrig i dessa arbetare.

Alla snapshot-skrivningar måste vara beständiga innan nätverksskrivning. Vid osäkert svar återläser nästa försök filen och bekräftar endast den tidigare snapshoten, utan att byta nuvarande text. Konflikt sparas i utkastet och hoppar över nästa automatiska försök; oberoende anteckningar fortsätter. Fel per fil får återförsökstid. Nätfel ger ökande väntetid 5–60 sekunder, auth-fel 30 sekunder och GitHubs `Retry-After` går före manuella försök. Omstart bevarar utkast/pending/fel; nätverksoperationen återupptas endast med samma lokalt tillåtna konto och giltig session.

Filmanifest kontrolleras ungefär varje minut och vid manuell uppdatering. Två filer per begränsat `POST /api/notes` delar en behörighetskontrollerad trädläsning eller Wiki-klon. Klienten anger kända SHA men servern slår själv upp varje sökväg i aktuell samling; godtyckliga klient-SHA används aldrig för blobåtkomst. Oförändrade blobbar återanvänds. Repositoryfiler läses direkt från manifestets blob-SHA. Wiki använder samma öppnade snapshot inom batchen. Storleks-/kodningsfel visas per fil, globala nät-/auth-/rate-limit-fel pausar hämtningen och redan beständiga filer behålls.

Uppdateringar förenas via `reconcile`: rena filer uppdateras, lokala ändringar bevaras med konfliktgrund. Raderade fjärrfiler behålls lokalt för export/granskning och återskapas inte automatiskt. Vid delvis hämtad samling visar gränssnittet vilka filer eller senaste versioner som saknas. Web Locks skyddar mellan flikar; GitHubs versionskontroll behövs fortfarande mellan enheter. Ingen force-skrivning har tillkommit.

## Officiella underlag

- [GitHub App-användartoken, OAuth och PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [Åtkomst till appinstallationer och repositories](https://docs.github.com/en/rest/apps/installations)
- [GitHub Contents API](https://docs.github.com/en/rest/repos/contents)
- [Git Trees, inklusive hantering av trunkerade svar](https://docs.github.com/en/rest/git/trees)
- [Next.js installation och App Router](https://nextjs.org/docs/app/getting-started/installation)
- [CodeMirror API](https://codemirror.net/docs/)
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

## Beständigt arbetsyteval i 0.2.1

`useWorkspaceSelection` delar återställningsflödet mellan webb och Tauri (även Android-frontenden). Ett separat versionsmärkt `gitbsidian-selection-<konto>` innehåller hela arbetsytebeskrivningen. Det skrivs först efter lyckad öppning/cachelagring och endast vid användarens val; `checkedAt` och utkastens `updatedAt` väljer aldrig arbetsyta. Ingen sessionsbunden serveridentifierare återanvänds efter omstart: synkmotorn registrerar beskrivningen på nytt först efter giltig session/kontokontroll.

0.1-beskrivningar och 0.2:s explicita `gitbsidian-last-<konto>` kan fortfarande läsas. Saknas beskriven cache men den nya valbeskrivningen finns, används bevarade utkast och manifestet hämtas igen vid anslutning. Skadad valbeskrivning eller en äldre pekare utan cache ger en återställningsvy. Val från andra konton accepteras inte via gamla pekare. Asynkrona återställningar/val avbryts logiskt när kontogeneration eller ett senare aktivt val ändras. Vanliga storage-händelser får inte stänga en redan öppen arbetsyta.

`gitbsidian-note-<konto/arbetsyta>` bevarar senast visade läsbara anteckning, även utan redigering. Saknas den i både cache och utkast öppnas första tillgängliga anteckningen. Appen kastar aldrig bort utkast vid detta val.

Grenhämtning har en resultatnyckel per repository, installations-ID, lagringsläge och hämtningsförsök. Effekternas avslut blockerar sena svar. Tomt svar, väntande hämtning och misslyckat anrop har skilda tillstånd; inget API-anrop skapar första commit åt användaren.

## CSV i version 0.3

Repositorymanifest och gemensam sökvägsvalidering tillåter `.md` och `.csv`; Wiki har separat `.md`-kontroll. CSV använder oförändrad Draft/WorkspaceSync, kontoavgränsning, SHA-skydd, API-behörighetskontroll och storleksgräns. CSV-editorn laddas separat och använder [Papa Parse](https://www.papaparse.com/docs) 5.7.0 med `dynamicTyping: false`. Alla cellvärden hålls som strängar. Numerisk sortering jämför normaliserade decimalsträngar utan flyttalsavrundning. Identifiering är konservativ; manuell typvalidering ändrar inte data.

Filter och sortering härleder en vy med ursprungliga radindex. Redigering skriver tillbaka till rätt filrad, inte dess position i sorterad/filtrerad vy. Export serialiserar hela dokumentet. Inställningar ligger i `gitbsidian-csv-<draft key>` med konto/arbetsyta/sökväg. Lokal import lagras alltid i det separata lokala provutrymmet med nytt namn vid kollision, under import- och redigeringslås. Typinställningar är lokala; inga metadatafiler skapas på GitHub.
