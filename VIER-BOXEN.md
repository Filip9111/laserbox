# Vier laserboxen

De firmware en webpagina ondersteunen vier laserboxen. Elke box moet een
unieke `LASERBOX_ID` en MQTT-client-ID gebruiken. De PlatformIO-configuraties
zetten dit automatisch:

| Box | PlatformIO-omgeving | Client-ID | MQTT-topics |
| --- | --- | --- | --- |
| 1 | `esp32-s3-devkitc-1` | `LaserControllerESP32` | `filip/laserbox01/{command,status,telemetry}` |
| 2 | `box02` | `LaserController02` | `filip/laserbox02/{command,status,telemetry}` |
| 3 | `box03` | `LaserController03` | `filip/laserbox03/{command,status,telemetry}` |
| 4 | `box04` | `LaserController04` | `filip/laserbox04/{command,status,telemetry}` |

Sluit een controller aan en kies in PlatformIO **Project Tasks > box02**
(of `box03`/`box04`) **> General > Upload**. Box 1 blijft de standaardomgeving;
de bestaande box 1 hoeft niet opnieuw geprogrammeerd te worden zolang de
firmware daar niet wijzigt.

De bedieningspagina toont één box per link. Gebruik `?box=1`, `?box=2`,
`?box=3` of `?box=4` om de gewenste box te kiezen. Om de GitHub Pages-versie
bij te werken moeten `index.html`, `app.js` en `style.css` naar GitHub worden
gepusht.

Gebruik dezelfde hardware en bedrading voor elke controller en label deze met
het boxnummer. Gebruik elk nummer precies één keer. Alle boxen gebruiken
dezelfde MQTT-server.

De bedieningsknoppen zijn zichtbaar. De MQTT-login wordt alleen in de browser
ingevoerd en niet in de webbestanden opgeslagen.
