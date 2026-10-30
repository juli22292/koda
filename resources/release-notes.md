## Koda 0.2.4

- Koda kann Java- und Minecraft-Plugin-Projekte auf Wunsch direkt kompilieren. Im Code-Modus beispielsweise schreiben: „Erstelle das Plugin und kompiliere es auch.“
- Neue Build-Werkzeuge erkennen Maven oder Gradle, vorhandene Wrapper und Java-Vorgaben aus der Projektkonfiguration. Auch unterschiedliche Java-Versionen für Gradle-Laufzeit und Compiler werden berücksichtigt.
- Fehlende JDKs und Build-Werkzeuge werden automatisch in Kodas eigenem Werkzeugordner eingerichtet. Von Koda verwaltete Downloads kommen aus offiziellen Quellen und werden vor dem Entpacken per Prüfsumme kontrolliert. Vorhandene passende Installationen und der Werkzeug-Cache werden wiederverwendet.
- Build-Ausgabe, Downloads und Laufzeit erscheinen live im Chat. Bei Compilerfehlern kann Koda den Quellcode korrigieren und erneut bauen.
- Die fertige Plugin-JAR erscheint mit relativem Dateipfad und „Im Ordner anzeigen“. Quellcode-, Javadoc- und originale Sicherungs-JARs werden dabei ausgefiltert.
- „Nachfragen“ bestätigt Build und Werkzeugeinrichtung vor dem Start. „Vollzugriff“ führt sie direkt aus; „Nur lesen“ kann die Build-Umgebung prüfen. Stoppen bricht auch laufende Downloads und Prozesse ab.
- Update-Prüfung jede Minute, Reload-Sperre, öffentliche Repositorys und Installationsordner „KodaApp“ bleiben erhalten.

### Installation

In einer bereits installierten Version unter **Einstellungen → Über Koda → Nach Updates suchen** prüfen und anschließend das Update-Symbol links neben „Minimieren“ verwenden. Alternativ die Datei **Koda-Setup-0.2.4-x64.exe** herunterladen und starten. Einstellungen, eigene API-Keys und Chats bleiben erhalten.

Der Installer ist derzeit nicht mit einem Windows-Herausgeberzertifikat signiert.
