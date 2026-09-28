# Openbaar laserboxstatusdashboard

Dit dashboard is alleen-lezen. De browser krijgt nooit de HiveMQ-inloggegevens en er is geen API om een box te bedienen. De server leest uitsluitend de `availability`, `status` en `telemetry`-onderwerpen van de vier boxen.

## Eerste keer online zetten

1. Open [Render](https://dashboard.render.com/) en meld je aan met GitHub.
2. Kies **New → Blueprint**, selecteer deze repository en laat Render `render.yaml` verwerken.
3. Vul bij de gevraagde omgevingsvariabelen `MQTT_USERNAME` en `MQTT_PASSWORD` in en start de deploy.

De credentials worden door Render als servergeheimen bewaard. Zet ze niet in `app.js`, `server.js` of `render.yaml`. De service gebruikt de bestaande HiveMQ-toegang alleen aan de serverkant; de website biedt geen publiceer- of bedienroute.

Na de eerste deploy toont Render een publieke `onrender.com`-URL. De gratis Render-service kan na een periode zonder bezoek in slaapstand gaan en bij een nieuw bezoek even nodig hebben om op te starten.

## Lokaal draaien

Vereist Node.js 20 of nieuwer. Stel `MQTT_USERNAME` en `MQTT_PASSWORD` als omgevingsvariabelen in en start met `npm install` gevolgd door `npm start`. De pagina opent op poort 3000, of op de poort uit `PORT`.
