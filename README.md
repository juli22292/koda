# Koda

Ein eigenständiger Desktop-Client für Chats und die Arbeit an lokalen Codeprojekten. Mit einer ruhigen, an Claude orientierten Oberfläche und eigenen API-Keys. Entwickelt mit Electron, React und TypeScript.

## Direkt starten

Den aktuellen Windows-Installer gibt es unter [Koda Releases](https://github.com/juli22292/koda-releases/releases/latest). Nach einem lokalen Build liegt er unter `release/Koda-Setup-<Version>-x64.exe`.

Der Assistent bietet eine Installation für den aktuellen Benutzer oder alle Benutzer an. Der Ordner heißt in beiden Fällen **KodaApp**: normalerweise `%LOCALAPPDATA%\Programs\KodaApp`, bei Installation für alle Benutzer `%ProgramFiles%\KodaApp`. Die Anwendung und Verknüpfungen heißen **Koda**. Vorher laufende portable Versionen schließen; die bisherigen Daten unter `%APPDATA%\Koda` werden weiterverwendet.

Anschließend **Einstellungen → Modelle & API-Keys** öffnen, einen Anbieter wählen und den eigenen Key speichern. **Verbindung prüfen** zeigt eine durchsuchbare Liste der verfügbaren Modell-IDs an. Ein Modell auswählen und speichern. Anschließend einen Projektordner öffnen und loslegen.

Ohne fertige EXE:

```powershell
npm install
npm run build
npm start
```

Für die Entwicklung:

```powershell
npm run dev
```

Benötigt Node.js 22.12+ oder 24+. `npm run preview:web` zeigt die Oberfläche im Browser; native Funktionen und die Key-Speicherung sind dort ausdrücklich deaktiviert.

## Enthalten

- OpenAI über die Responses API, Anthropic Claude über die Messages API, Google Gemini und xAI Grok über native SDK-Adapter.
- Ein eigener OpenAI-kompatibler Endpoint, z. B. für Ollama, LM Studio, OpenRouter oder andere Dienste. Bei lokalen Endpoints ist kein API-Key erforderlich.
- Frei einstellbare Modell-IDs; Modelllisten werden mit dem eigenen Konto geladen.
- Streaming-Chat, Markdown, hervorgehobene Codeblöcke und Kopieren.
- Chat/Code-Umschalter: allgemeine Gespräche ohne lokale Werkzeuge oder Arbeit am Projekt mit einzelnen Freigaben. Bestehende Chats behalten ihren Modus; beim Wechsel wird Werkzeugkontext nicht in den Chat-Modus übernommen.
- Lokale Projekte, Dateibaum, Textdateivorschau und Dateianhänge als Kontext.
- Coding-Agent mit `list_files`, `read_file`, `write_file`, `run_command`, `inspect_build` und `build_project`, bis zu 20 Schritten pro Anfrage.
- Projekt-Builds für Java-/Minecraft-Plugins mit Maven oder Gradle, automatischer JDK-/Werkzeugeinrichtung, Live-Ausgabe und JAR-Ergebnissen mit „Im Ordner anzeigen“.
- Rechte pro Chat: **Nur lesen**, **Nachfragen** und **Vollzugriff**. Neue Chats verwenden „Nachfragen“; vorhandene Chats ohne gespeicherte Auswahl ebenfalls. Die Auswahl gilt im Code-Modus; Chat hat keine lokalen Werkzeuge, Fragen bleibt lesend.
- Mit „Nachfragen“ erscheint vor Dateiänderungen der vollständige Diff und vor Shell-Befehlen der konkrete Befehl. Erst nach Freigabe wird ausgeführt. Mit „Vollzugriff“ werden Änderungen und Befehle ohne Einzelabfrage mit den Benutzerrechten des Betriebssystems ausgeführt. Dateiwerkzeuge bleiben an das Projekt gebunden; Terminalbefehle sind keine Betriebssystem-Sandbox.
- Befehle zeigen Live-Ausgabe, Laufzeit und einen animierten Status. Stoppen beendet auch Kindprozesse. Änderungen an inzwischen extern bearbeiteten Dateien werden abgebrochen.
- Fragen-Modus mit ausschließlich lesenden Werkzeugen.
- Stoppen laufender Antworten, lokale Chatsuche, Markdown-Export und Löschen einzelner Chats.
- Helles, dunkles oder vom System abhängiges Farbschema, eigene Systemanweisungen und Chat-Schriftgröße.
- Eigene Fenstertitelleiste, lokale Schriftarten und App-Icon.
- Kurze Begrüßungen passend zur lokalen Tageszeit, die sich automatisch und beim Zurückkehren in die App aktualisieren. Strg+R, Strg+Umschalt+R und F5 laden das Fenster nicht neu.
- Installationsassistent und automatische Update-Prüfung beim Start sowie jede Minute.
- Ein Update-Symbol direkt links neben „Minimieren“, sobald eine neuere Version verfügbar ist. Anklicken lädt das Update; nach erfolgreichem Download startet ein weiterer Klick Koda neu und installiert es.
- Laufende Antworten verhindern den Update-Neustart. Chats werden vor dem Neustart gespeichert; ein offener Entwurf wird nach dem Neustart wiederhergestellt.

## Java- und Minecraft-Projekte kompilieren

Im Code-Modus einen Projektordner öffnen und beispielsweise schreiben: **„Erstelle das Minecraft-Plugin und kompiliere es auch.“** Koda legt nötige Projektdateien an bzw. liest vorhandene Build-Vorgaben, prüft die Umgebung und startet den Build. Compilerfehler können anschließend mit den Dateiwerkzeugen korrigiert und erneut geprüft werden. Der lesende Fragen-Modus kann die Build-Umgebung prüfen, aber nicht bauen.

`inspect_build` erkennt Maven-POMs, Gradle-Dateien in Groovy/Kotlin, Wrapper-Versionen, gängige Java-Compiler-/Toolchain-Vorgaben und lokale Maven-Module/Parent-POMs. Explizite Java-Vorgaben haben Vorrang; Minecraft-API-Versionen sind nur ein Fallback. Ist keine Java-Vorgabe erkennbar, wird Java 21 mit einem Hinweis gewählt. Dynamisch berechnete Build-Konfigurationen können eine explizite Java-Auswahl erfordern.

`build_project` verwendet den Projekt-Wrapper bevorzugt. Fehlt er, wird die deklarierte Distribution oder eine feste kompatible Standardversion verwendet (Maven 3.10.0, Gradle 8.14.6, für Java 25+ ohne Wrapper Gradle 9.8.2). Vorhandene passende JDKs sowie Maven-/Gradle-Installationen werden gesucht. Fehlende Werkzeuge kommen als portable Archive nach `%APPDATA%\Koda\tools`; Downloads werden auf zugelassene HTTPS-Quellen begrenzt und mit SHA-256 bzw. SHA-512 geprüft. Unterordner des Werkzeug-Caches enthalten Maven-/Gradle-Abhängigkeiten und separate Maven-Toolchains. Dafür werden keine globalen PATH- oder Java-Einstellungen verändert. Die automatische Archiveinrichtung unterstützt Windows x64.

Mit **Nachfragen** gilt die Build-Freigabe auch für die nötige Werkzeugeinrichtung. Mit **Vollzugriff** erfolgt beides direkt. Ein Build führt die Skripte und Plugins des Projekts mit Benutzerrechten aus. Lokale Build-Ziele wie `package`, `build`, `shadowJar`, `reobfJar` oder `remapJar` sind möglich; der Build-Helfer führt keine Veröffentlichung oder `clean` aus. Ausgaben bleiben live sichtbar; Stoppen beendet Downloads und Prozesse. Der eigentliche Build hat ein Zeitlimit von 15 Minuten.

Erfolgreiche Paket-Builds suchen gültige JARs unter Maven-`target` und Gradle-`build/libs`, auch in Untermodulen. Plugin-Metadaten werden erkannt, Quellcode-/Javadoc-/Test-/Original-JARs ausgeschlossen und Plugin-JARs bevorzugt angezeigt. „Im Ordner anzeigen“ öffnet den Speicherort, ohne die JAR auszuführen. Spezielle Ausgabeordner oder ungewöhnliche Build-DSLs können zusätzliche Projektanpassungen benötigen. Ein erfolgreicher Build ersetzt keinen Test auf dem Minecraft-Server.

Grundlagen: [Adoptium API](https://github.com/adoptium/api.adoptium.net/blob/main/docs/cookbook.adoc), [Maven Wrapper](https://maven.apache.org/tools/wrapper/), [Gradle Java-Kompatibilität](https://docs.gradle.org/current/userguide/compatibility.html), [Gradle-Toolchains](https://docs.gradle.org/current/userguide/toolchains.html).

## Updates veröffentlichen

Der Entwicklungsquellcode liegt im öffentlichen Repository [juli22292/koda](https://github.com/juli22292/koda). Das öffentliche Repository [juli22292/koda-releases](https://github.com/juli22292/koda-releases) enthält ausschließlich Installer, Blockmaps und Update-Metadaten. Die Release-Skripte ändern niemals die Sichtbarkeit eines Repositorys. Freunde benötigen dafür kein GitHub-Konto. Es werden keine GitHub-Zugangsdaten in die App eingebaut.

Neue Änderungen zuerst auf `main` committen. Anschließend:

```powershell
npm run release -- patch
```

Alternativ eine konkrete höhere Version angeben:

```powershell
npm run release -- 0.3.0
```

Der Befehl erhöht die Version, führt Tests aus, baut den Installer, prüft den gepackten Desktop-Client und den echten Update-Download gegen einen lokalen Testserver, erstellt Commit und Tag im Quellcode-Repository und veröffentlicht anschließend einen Release im öffentlichen Download-Repository. Er nutzt die vorhandene Git-Credential-Manager-Anmeldung oder einen nur für den Veröffentlichungsprozess gesetzten `GH_TOKEN`. Geheimnisse werden nicht protokolliert oder in Dateien gespeichert.

Installer, `.blockmap` und `latest.yml` werden zunächst in einen Release-Entwurf hochgeladen. Erst nach vollständigem Upload wird der Release öffentlich. Scheitert ein Upload, bleibt der Entwurf unveröffentlicht. Ein bereits veröffentlichter Release wird nicht überschrieben.

Falls der Build bereits fertig geprüft ist, kann `npm run release:publish` die Dateien der aktuellen Version veröffentlichen. Für einen erneuten Versuch nach einem Uploadfehler ist ebenfalls dieser Befehl geeignet.

GitHub Actions führt bei Pushes, Tags und Pull Requests automatisch einen Windows-Build und dieselben Tests aus und speichert den Installer als Workflow-Artefakt. Die öffentliche Veröffentlichung erfolgt über den obigen Release-Befehl auf deinem angemeldeten Rechner; es muss dafür kein dauerhaftes persönliches GitHub-Token in Actions hinterlegt werden.

Der Installer ist derzeit nicht mit einem Windows-Herausgeberzertifikat signiert. Windows kann deshalb einen Hinweis auf einen unbekannten Herausgeber anzeigen. Downloads laufen über HTTPS; der Updater prüft den SHA-512-Hash des Installers und verwirft beschädigte Dateien. Ein Zertifikat lässt sich später ergänzen.

## Daten und Schlüssel

API-Keys liegen ausschließlich im Electron-Hauptprozess und werden mit `safeStorage` verschlüsselt. Unter Windows verwendet Electron dafür DPAPI. Die Oberfläche erhält nur den Status, ob ein Key hinterlegt ist; gespeicherte Keys werden nicht zurückgegeben. Ohne verfügbare Betriebssystemverschlüsselung lehnt die App das Speichern ab.

Einstellungen und Chatverläufe liegen im Electron-Benutzerdatenordner, unter Windows normalerweise `%APPDATA%/Koda`. Der Chatverlauf ist gewöhnliches lokales JSON, keine verschlüsselte Datenbank. Chatnachrichten, angehängte Dateiinhalte und Ergebnisse von Werkzeugen werden beim gewählten Anbieter verarbeitet. Die API-Nutzung wird über dessen Konto abgerechnet. Koda verwendet keinen eigenen Proxy und keine Telemetrie.

Dateiwerkzeuge sind auf über den nativen Ordnerdialog registrierte Projekte begrenzt. Pfadtraversal und Verweise aus dem Projekt werden abgewiesen. `.env`-Dateien, private Schlüssel und Git-Interna sind für automatische Dateiwerkzeuge gesperrt. Freigegebene Terminalbefehle laufen mit den Benutzerrechten des Betriebssystems; deren Arbeitsverzeichnis ist der Projektordner. Das ist keine Betriebssystem-Sandbox.

## Tastatur

| Shortcut | Aktion |
| --- | --- |
| `Ctrl N` | Neuer Chat |
| `Ctrl K` | Chats durchsuchen |
| `Ctrl ,` | Einstellungen |
| `Enter` | Nachricht senden |
| `Shift Enter` | Neue Zeile |
| `Escape` | Menü oder Einstellungen schließen |

## Prüfen und paketieren

```powershell
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run test:agent
npm run test:builds
npm run test:updates
npm run dist
```

Die Tests verwenden ausschließlich lokale HTTP-Testanbieter und temporäre Projektordner. Die End-to-End-Tests starten die echte Electron-App und prüfen Key-Verschlüsselung, Dateizugriff, Streaming, mehrstufige Werkzeugaufrufe, Freigaben, Ablehnen, Stoppen, Fehlerbehandlung und Verlauf. `test:agent` prüft zusätzlich Vollzugriff, lesende Rechte, Live-Ausgabe und Animation, das Stoppen von Kindprozessen, gespeicherte Rechte, Begrüßungen nach lokaler Tageszeit sowie gesperrte Reload-Tastenkürzel während eines laufenden Befehls. Anbieter-Vertragstests prüfen die nativen Request- und Response-Formate aller fünf Adapter. Update-Tests prüfen außerdem Symbolposition, Verfügbarkeit, Offline-Fälle, einen echten Download, die Ablehnung eines falschen Hashes, einen erneuten Download, den Neustartschutz und den Erhalt von Chat und Entwurf. Der Test-Installer wird heruntergeladen, aber nicht ausgeführt. Kostenpflichtige Live-Anfragen werden nicht ausgeführt.

`test:builds` prüft den kompletten Build-Chat mit einem lokalen Modell-Testserver und einem vorhandenen JDK 17 oder 21: Ablehnen ohne Einrichtung/Ausführung, Compilerfehler, freigegebene Korrektur, erfolgreicher Neubau, Java-Bytecode-Version, JAR-Anzeige, validiertes Öffnen des Ordners, Vollzugriff und lesende Rechte. Unit-Tests prüfen außerdem Erkennung, Prüfsummen, Cache, Abbruch und unsichere Archive.

Optional prüft `npm run build:smoke` **echte Downloads und echte Maven-/Gradle-Builds eines Spigot-Plugins**. `npm run build:smoke -- --legacy-only` prüft zusätzlich ein Java-8-Plugin mit Gradle 9 und separater neuerer Laufzeit-JVM. Diese Integrationstests benötigen Internet und laden portable JDK-/Build-Archive und Abhängigkeiten nach `.test-data/build-smoke`; sie sind nicht Teil der normalen Offline-Tests.

## Projektstruktur

```text
src/main/            Fenster, IPC, verschlüsselter Store, Provider und Coding-Agent
src/preload/         Eng begrenzte Schnittstelle zum Renderer
src/renderer/src/    React-Oberfläche und Designsystem
src/shared/          Gemeinsame Typen und Anbieterdefinitionen
tests/               Dateigrenzen und Provider-Vertragstests
scripts/e2e.cjs      Desktop-Integrationstests
resources/           App-Icon
```

Die erste Version fokussiert Text- und Coding-Workflows. MCP, integrierte Browser-Previews, ein interaktives Terminal, Git-Worktree-Verwaltung und Anhänge mit Bildern sind noch nicht enthalten.

Implementierungsreferenzen: [OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling), [AI SDK Provider](https://ai-sdk.dev/providers/ai-sdk-providers), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
