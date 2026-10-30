## Koda 0.2.7

- **Effort bei UnoRouter korrigiert:** Die Auswahl erscheint bei unterstützten Router-Modellen direkt links neben dem Modellnamen. Sie funktioniert auch mit der UnoRouter-Adresse unter „Eigener Anbieter“.
- **Qwen-Fehler behoben:** Für `qwen3.8-27b:free` werden die bestätigten Stufen Niedrig, Mittel und Sehr hoch angeboten. „Auto“ sendet die Routenvorgabe `xhigh`, damit keine inkompatible `high`-Voreinstellung greift. Das bekannte Ausgabelimit von 32.768 Tokens wird berücksichtigt.
- Router-Routen werden getrennt von nativen Modell-APIs behandelt. Für die bestätigten Fable-5- und GPT-6.1-Sol-Routen steht Maximum zur Verfügung. Explizite Stufen und Ausgabelimits aus Modellabfragen werden übernommen.
- Nennt die API bei einem Routenfehler unterstützte Effort-Stufen, aktualisiert Koda das Menü und speichert diese. Anschließend kann eine passende Stufe gewählt und erneut gesendet werden. Laufende Aktionen werden nicht automatisch wiederholt.
- Die Effort-Auswahl wird pro Modell und im Chat gespeichert und nach einem Neustart wiederhergestellt. Ein Key- oder Endpoint-Wechsel verwirft veraltete Routendaten.
- **Windows-Werkzeug-Cache repariert:** Bereits eingerichtete Werkzeuge werden auch über Windows-Ordnerverknüpfungen und Kurzpfade wiederverwendet. Die Build-Prüfung vergleicht für gebaute JAR-Dateien den tatsächlichen Dateipfad.

### Installation

In einer bereits installierten Version unter **Einstellungen → Über Koda → Nach Updates suchen** prüfen oder die automatische Prüfung abwarten. Anschließend das Update-Symbol links neben „Minimieren“ verwenden. Alternativ **Koda-Setup-0.2.7-x64.exe** herunterladen und starten. API-Keys, Einstellungen und Chats bleiben erhalten. Der Installationsordner heißt weiterhin **KodaApp**.

Kontolimits, Guthaben und die Verfügbarkeit einzelner Routen werden weiterhin vom Anbieter bestimmt. Die Repositorys bleiben öffentlich. Der Installer ist derzeit nicht mit einem Windows-Herausgeberzertifikat signiert.
