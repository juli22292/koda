## Koda 0.2.5

- **Effort auswählen:** Neben dem Modell lässt sich bei unterstützten OpenAI-, Claude-, Gemini- und Grok-Modellen der Denkaufwand einstellen. Das Menü zeigt ausschließlich die Stufen des jeweiligen Modells; „Auto“ verwendet die Vorgabe des Anbieters.
- Die Auswahl wird pro Modell und im Chat gespeichert. Beim Wechseln und nach einem Neustart steht sie wieder bereit. Während einer laufenden Antwort ist die Auswahl gesperrt.
- Die Einstellung wird über die nativen Anbieterparameter übertragen, einschließlich adaptivem Denken bei unterstützten Claude-Modellen und passenden Thinking-Budgets bei Gemini 2.5. Höhere Stufen erhalten mehr Ausgabespielraum und können länger dauern bzw. mehr Tokens verwenden.
- **Build-Laufzeit korrigiert:** Befehle und Builds verwenden eine stabile Stoppuhr statt Differenzen aus Systemzeitstempeln. Uhrkorrekturen erzeugen damit keine künstlichen Sprünge auf 1.000+ Sekunden. Tatsächlich längere Ausführungen erscheinen lesbar in Minuten oder Stunden.
- Nach einem Neustart werden unterbrochene Aktionen als gestoppt angezeigt. Alte Laufzeit-Zähler und Animationen laufen nicht weiter. Abgeschlossene Aktionen behalten ihre gemessene Dauer.

### Installation

In einer bereits installierten Version unter **Einstellungen → Über Koda → Nach Updates suchen** prüfen oder die automatische Prüfung abwarten. Anschließend das Update-Symbol links neben „Minimieren“ verwenden. Alternativ **Koda-Setup-0.2.5-x64.exe** herunterladen und starten. Einstellungen, eigene API-Keys und Chats bleiben erhalten; der Installationsordner heißt weiterhin **KodaApp**.

Unbekannte Modelle und eigene OpenAI-kompatible Endpoints erhalten keine geratenen Effort-Parameter. Die Repositorys bleiben öffentlich. Der Installer ist derzeit nicht mit einem Windows-Herausgeberzertifikat signiert.
