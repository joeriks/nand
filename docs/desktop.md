# Tauri för Windows

## Namnbyte till nand i 0.3.1

Produktnamn, fönstertitel och gränssnitt heter **nand — Notes and more**. Repositoryt är `joeriks/nand`. Windows app-ID `se.gitbsidian.desktop`, interna binärnamn, Credential Manager-tjänst, IndexedDB och övriga lagringsnycklar behålls för befintlig data. Android behåller på samma sätt sitt tidigare app-ID och Kotlin-paket.

NSIS använder produktnamnet för installationskatalog och registrering i Windows. Därför installeras nand som en egen programpost och tidigare gitbsidian-installation/genvägar kan finnas kvar. Apparna använder samma profil. Radering av appdata vid avinstallation påverkar därför båda. Automatisk migrering av den gamla installationsposten är inte implementerad; faktisk installation/uppgradering har inte verifierats.

## Start och paketering

Tauri 2 laddar Vite-byggda React-filer från installationspaketet i Windows WebView2. Editorn, Markdown-renderaren, stilarna och typsnitten är samma som i webbappen. Det beständiga arbetsytevalet läses från lokal profil utan att invänta synkningsdelen eller nätverk. Utan tidigare val öppnas den lokala skrivytan. Någon jämförande starttidsmätning mot Electron har inte gjorts.

Node ingår som en sidecar för att återanvända GitHub-, Wiki-, validerings- och sparningskoden. Det kostar paketstorlek, men innebär att en redan testad implementation används på båda plattformarna. Rust startar synkningsprocessen vid första API-anropet; editorn väntar inte på den. Ingen Next.js-server, HTTP-port eller global Node-installation behövs. Ett framtida byte av synkningsdelen till Rust kan minska paketstorleken utan att byta editor.

`npm run desktop:prepare` bygger backend med esbuild och kopierar byggdatorns Node 24-exekverbara fil med licenser. `.env.local`, privata anteckningar, utkast och GitHub-hemligheter ingår inte. `npm run desktop:frontend` bygger gränssnittet. `npm run desktop:build` skapar ett NSIS-paket för Windows x64 under `src-tauri/target/release/bundle/nsis`. Installationen sker per användare. Node- och npm-beroenden är låsta i package-lock; Rust-beroenden i Cargo.lock.

Windows är den enda paketerade plattformen. Plattformsvillkoret i prepare-scriptet stoppar andra byggen tills matchande runtime och säker tokenlagring har konfigurerats. Kodsignering, automatisk uppdatering och appbutiksdistribution återstår. WebView2 kan hämtas av installationsprogrammet om det saknas.

## Inloggning och kommandogräns

Desktop använder GitHub Apps dokumenterade device flow. Användaren matar in offentligt Client ID och appslug; godkännande sker via systemets vanliga webbläsare. Ingen client secret följer med appen. Device-koden hålls i Node-processen, polling följer GitHubs intervall och `slow_down`, och refresh tokens kasseras. Högst åtta timmars inloggning återanvänds.

Rust lagrar token och användaridentitet i Windows Credential Manager via keyring. Svarens interna sessionsfält konsumeras av Rust och skickas aldrig till WebView. Frontend får bara användaridentitet, status och resultat. Logout tar bort inloggningen ur Credential Manager. Inställningarna `github.json` i appens lokala datamapp innehåller endast offentliga appuppgifter.

Rust erbjuder ett begränsat API-anrop, lokal fillagring i Dokument/nand och export av Markdown/CSV med native spara-dialog. Endast lokala huvudfönstret har capabilities. Frontend får inte välja någon godtycklig rotmapp eller något program genom filkommandona. Lokala kommandon validerar relativa sökvägar, filtyp, storlek och att målet stannar i samlingen. Backend tar enbart emot privata JSON-meddelanden via stdin/stdout och utför fasta API-rutter; godtyckliga program, adresser eller serverkommandon kan inte skickas in. Barnprocessen ärver varken NODE_OPTIONS, proxyinställningar eller Git-traceloggar. Standardfel exponeras inte för gränssnittet.

Repositorymedlemskap verifieras på GitHub inför varje nätverksoperation. Återöppning av en cachad arbetsyta registrerar endast det lokala valet; den hoppar inte över nästa behörighetskontroll. Wiki använder samma Git-adapter som webben och kräver Git for Windows. Befintlig installation under Program Files känns igen. Git behöver inte finnas för lokal skrivyta eller vanliga repositoryfiler.

## Lokal data och stängning

Version 0.3.2 lagrar den lokala samlingen som vanliga `.md`- och `.csv`-filer i användarens Dokument/nand, med **Öppna i Utforskaren** under arbetsytans namn. Windows mappupplösning används även när Dokument är omdirigerad. Befintliga lokala utkast flyttas inte eller raderas: de skrivs till filer och behålls som redigeringsbuffert i IndexedDB. Om en fil med samma namn har annat innehåll visas konflikt utan automatisk överskrivning. Nya/ändrade filer upptäcks vid fokus och ungefär varannan sekund. Extern radering kräver ett granskat beslut innan filen återskapas. Från 0.3.3 är mappen valbar; se README för storleksgränser.

Lokala skrivningar kontrollerar förväntat innehåll och använder en temporär fil i samma mapp, följt av namnbyte. Nya filnamn skapas utan att ersätta ett befintligt namn. Filsystemet behöver stödja hårda länkar för skapandet (som NTFS); ett fel lämnar utkastet kvar. Ändringar utanför appen kontrolleras igen före ersättning. Det finns ingen gemensam transaktion med andra redigeringsprogram, så samtidiga skrivningar från andra program bör undvikas. Vid skrivfel bevaras utkastet och appens normala stängning visar felet.

Import, export, uppdatering, GitHub-anslutning från lokalt läge och dokumentinformation finns under **Fler alternativ**. Skriv-/läsläge är flyttat till toppfältet; den dubbla dokumentfliken och de permanenta förklaringsblocken är borttagna/förenklade.

IndexedDB och tema lagras i Tauri-appens egen WebView-profil, separat från Edge/Chrome och den tidigare webbappen. Lokala utkast är okrypterade, avgränsade per konto/lagringssätt/arbetsyta och kräver samma Windows-profil. Appens kontoavgränsning skyddar inte mot någon med åtkomst till datorns profilfiler. Exportera viktigt innehåll eller spara till GitHub.

Appen återöppnar senast aktivt valda GitHub-arbetsyta från lokal cache, utan nätverk och även efter tokenutgång. Repository/Wiki, konto, gren, undermapp och senast öppnade anteckning bevaras. Bakgrundssynk ändrar inte valet. Saknad eller oläsbar valbeskrivning visar fel med återförsök/annat val utan att radera utkast eller tyst växla till lokalt provläge. Hela den stödda samlingen hämtas vid arbetsyteval, inte bara öppnade sidor. En delvis hämtad samling visar saknade filer. Ny autentisering krävs för nätverk/synk. Uttrycklig utloggning döljer kontots lokala data tills samma konto loggat in på nytt. Utan tidigare arbetsyta öppnas det separata lokala provläget. Kön återupptas när appen är öppen och anslutning, inloggning och aktuell behörighet fungerar. Den vanliga webbappen har ännu ingen service worker eller full offlineöppning.

Stängning väntar på en pågående sparning och lokala IndexedDB-skrivningar. Vid lagringsfel bevaras fönstret och export erbjuds. En andra start fokuserar det befintliga fönstret. Export använder native spara-dialog med en uttryckligt vald filsökväg.

CSV-redigeraren använder samma lokala lagring och synkkö. Befintliga CSV-filer visas i arbetsytans fillista. **Importera fil** skapar en beständig arbetskopia i den aktiva arbetsytan: Markdown/CSV lokalt eller i repositoryts valda gren/undermapp, och Markdown i Wiki. GitHub-importer synkas automatiskt när anslutning och behörighet finns. Befintliga filnamn får en numrerad kopia i stället för att skrivas över. **Exportera CSV** sparar kopian via native spara-dialog; importen ger ingen permanent koppling till originalfilen. Kolumntyper och tabellinställningar sparas per fil i den lokala WebView-profilen. Felaktiga värden markeras men konverteras inte och blockerar inte sparning. Länken under arbetsytans namn öppnar repositoryt eller wikin i systemets webbläsare.

## Officiella källor

- [Tauri och paketerade sidecar-program](https://v2.tauri.app/develop/sidecar/)
- [Tauris processmodell](https://v2.tauri.app/concept/process-model/)
- [Tauri capabilities](https://v2.tauri.app/security/capabilities/)
- [GitHub Apps device flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-device-flow-to-generate-a-user-access-token)

## Isolerad native-verifiering

`npm run test:desktop` bygger samma kod med en unik identifierare under `se.gitbsidian.verification…` och ett separat Cargo-mål under `src-tauri/target/verification`. Datamapp och Credential Manager-tjänst följer appidentifieraren. Testet använder dessutom en ny WebView-profil för varje körning. Alternativa appidentiteter lagrar lokala filer under sin egen appdatamapp, aldrig i användarens Dokument/nand. Den vanliga identifieraren `se.gitbsidian.desktop` och dess befintliga inloggning är oförändrade. Testbygget distribueras inte.

Testet avbryts om verifieringsidentiteten redan har en giltig eller utgången credential. Syntetisk cache används enbart i testprofilen. Inga testkommandon, autentiseringsgenvägar eller simulerade GitHub-svar läggs i produktionsappen. Installationsfilen byggs separat med `npm run desktop:build`.

## Automatiska uppdateringar från 0.3.3

Windows-appen söker efter signerade uppdateringar tio sekunder efter att arbetsytan öppnats och sedan högst var sjätte timme. En ny version visas diskret i toppfältet; en manuell kontroll finns under Fler alternativ → Appuppdateringar. Användaren väljer Uppdatera och starta om. Dialogen blockerar redigering under hämtningen. Import och sparning inväntas, lokala utkast skrivs beständigt och synkprocessen stängs innan installationen startar. Sparfel eller signaturfel stoppar installationen. Installationsfel frigör redigeringen och återaktiverar synkprocessen. GitHub-kön behöver inte vara uppladdad: dess beständiga utkast återupptas efter omstart.

Uppdateraren använder Tauris officiella plugin med TLS och obligatorisk signaturkontroll. Den publika nyckeln ligger i tauri.conf.json. Privat signeringsnyckel ligger endast lokalt i den Git-ignorerade .data/update-signing/nand.key. Säkerhetskopiera den separat; en ersättningsnyckel fungerar inte för redan installerade appar. Nyckeln får aldrig committas eller laddas upp som releasebilaga. Tauri-signaturen är separat från Windows Authenticode; installationsfilen är fortfarande inte Authenticode-signerad.

Bygg signerade releaser med powershell -File scripts/build-update.ps1. TAURI_SIGNING_PRIVATE_KEY kan ange en extern befintlig nyckel. Skriptet skapar installationsfil, .sig, latest.json och SHA256SUMS.txt i releases/vVERSION. Publicera alla fyra som tillgångar i samma stabila GitHub-release; latest.json innehåller en versionslåst URL till installationsfilen. Publicera inte en senare stabil release utan latest.json. Uppdateringsadressen är https://github.com/joeriks/nand/releases/latest/download/latest.json.

Version 0.3.2 saknar uppdateraren och måste uppgraderas manuellt en gång. Funktionen gäller Windows x64; webbversionen och Android har ingen installationsuppdaterare.

## Valbar lokal rotmapp i 0.3.3

Välj rotmapp under Fler alternativ. Mappen väljs med Windows mappdialog och sparas i appens local-folder.json. Varje kanonisk mappsökväg har separat utkast- och anteckningsval i IndexedDB. Standardmappen behåller local-notebook för kompatibilitet. Ett mappbyte kopierar eller flyttar inga filer. Nya tomma valda mappar får ingen automatisk exempelanteckning. En otillgänglig vald mapp återskapas inte; utkasten bevaras tills mappen åter blir tillgänglig eller en annan mapp väljs.

Filanrop från arbetsytan är bundna till dess mappsökväg och avvisas om den sparade rotmappen har bytts. Mappval och filskrivningar delar native-låset. Filer i underkataloger läses med samma gränser och sökvägsskydd som standardmappen. Omläsning sker varannan sekund och vid fokus. Detta är direkt filåtkomst med automatisk sparning, inte en import av hela mappen till en separat databas; IndexedDB används som återställningsbart utkast.
