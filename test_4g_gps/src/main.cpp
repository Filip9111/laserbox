#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>

#ifndef MODEM_RX_PIN
#define MODEM_RX_PIN 17
#endif
#ifndef MODEM_TX_PIN
#define MODEM_TX_PIN 16
#endif
#ifndef MODEM_BAUD
#define MODEM_BAUD 115200
#endif

// The modem's RX is wired to ESP32 GPIO16 (ESP32 TX); modem TX to GPIO17 (ESP32 RX).
// Join grounds.
HardwareSerial modem(2);
WebServer server(80);
String modemLine;
String gpsRaw = "Waiting for GPS data";
String registration = "Unknown";
int signalRssi = -1;
unsigned long lastPoll = 0;
constexpr unsigned long POLL_INTERVAL_MS = 5000;
const char *AP_SSID = "ESP32-GPS";
const char *AP_PASSWORD = "gpssetup1"; // At least 8 characters; change if desired.

const char PAGE[] PROGMEM = R"HTML(
<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ESP32 GPS</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#172033;font:16px system-ui, sans-serif}.wrap{max-width:760px;margin:32px auto;padding:16px}.card{background:white;border-radius:16px;padding:22px;margin:14px 0;box-shadow:0 5px 20px #0f172a12}h1{margin:0 0 6px}h2{font-size:1.1rem;margin:0 0 14px}.muted{color:#64748b}.value{font-size:1.45rem;font-weight:650;overflow-wrap:anywhere}.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.buttons{display:flex;gap:10px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:12px 18px;background:#2563eb;color:white;font-weight:600;font-size:1rem}button.secondary{background:#475569}.status{font-size:.95rem}.map{display:inline-block;margin-top:12px;color:#2563eb}@media(max-width:540px){.grid{grid-template-columns:1fr}.wrap{margin:10px auto}}
</style></head><body><main class="wrap"><section class="card"><h1>ESP32 GPS</h1><div class="muted">SIM7600 status · verversen elke 5 seconden</div></section>
<div class="grid"><section class="card"><h2>Mobiel ontvangstniveau</h2><div class="value" id="signal">--</div><div class="muted" id="signalHint">Wachten op modem</div></section>
<section class="card"><h2>Netwerkregistratie</h2><div class="value" id="network">--</div><div class="muted">Status SIM/modem</div></section></div>
<section class="card"><h2>GPS-positie</h2><div class="value" id="gps">Wachten op GPS-data</div><a class="map" id="map" target="_blank" rel="noopener" hidden>Open positie in kaart</a><div class="muted" style="margin-top:10px">Een eerste GPS-fix kan enkele minuten duren; zet de antenne met vrij zicht op de hemel.</div></section>
<section class="card"><h2>Modem bedienen</h2><div class="buttons"><button type="button" data-cmd="g">GPS starten</button><button type="button" class="secondary" data-cmd="s">Signaal meten</button><button type="button" class="secondary" data-cmd="n">Netwerk meten</button></div><div class="status muted" id="status" role="status" aria-live="polite" style="margin-top:12px">Tik op een knop om een modemcommando te sturen.</div></section>
<section class="card muted">Verbind je telefoon of computer met wifi <b>ESP32-GPS</b> (wachtwoord <b>gpssetup1</b>) en open <b>http://192.168.4.1</b>.</section></main>
<script>
async function refresh(){try{const d=await (await fetch('/api')).json();document.querySelector('#signal').textContent=d.signalDbm===null?'Onbekend':d.signalDbm+' dBm';document.querySelector('#signalHint').textContent=d.rssi===null?'Geen meting (CSQ 99)':`CSQ ${d.rssi} / 31`;document.querySelector('#network').textContent=d.network;document.querySelector('#gps').textContent=d.gps;const a=document.querySelector('#map');if(d.lat!==null&&d.lon!==null){a.href=`https://maps.google.com/?q=${d.lat},${d.lon}`;a.hidden=false}else a.hidden=true}catch(e){document.querySelector('#status').textContent='Geen verbinding met ESP32'}}
const statusEl=document.querySelector('#status');
document.querySelectorAll('button[data-cmd]').forEach(button=>button.addEventListener('click',()=>act(button)));
async function act(button){const labels={g:'GPS starten',s:'Signaal meten',n:'Netwerk meten'};const cmd=button.dataset.cmd;statusEl.textContent=labels[cmd]+'…';button.disabled=true;try{const response=await fetch('/api/action?cmd='+encodeURIComponent(cmd),{cache:'no-store'});const detail=await response.text();if(!response.ok)throw new Error(detail||'HTTP '+response.status);statusEl.textContent=labels[cmd]+': commando naar modem gestuurd.';setTimeout(refresh,1200)}catch(e){statusEl.textContent='Actie mislukt: '+e.message}finally{button.disabled=false}}
refresh();setInterval(refresh,5000);
</script></body></html>
)HTML";

void sendCommand(const char *command) {
  Serial.printf("\n>> %s\n", command);
  modem.print(command);
  modem.print("\r\n");
}

String jsonEscape(const String &input) {
  String out;
  for (size_t i = 0; i < input.length(); ++i) {
    char c = input[i];
    if (c == '"' || c == '\\') out += '\\';
    if (c >= 32) out += c;
  }
  return out;
}

void parseGps(const String &line) {
  int colon = line.indexOf(':');
  String fields = colon >= 0 ? line.substring(colon + 1) : line;
  fields.trim();
  if (fields.length() == 0 || fields.startsWith(",,,,,")) return;
  gpsRaw = fields;
}

void handleModemLine(const String &line) {
  Serial.println(line);
  if (line.startsWith("+CSQ:")) {
    int comma = line.indexOf(',');
    int value = line.substring(5, comma < 0 ? line.length() : comma).toInt();
    signalRssi = (value >= 0 && value <= 31) ? value : -1;
  } else if (line.startsWith("+CEREG:")) {
    int comma = line.lastIndexOf(',');
    int status = line.substring(comma + 1).toInt();
    if (status == 1) registration = "Geregistreerd (thuisnetwerk)";
    else if (status == 5) registration = "Geregistreerd (roaming)";
    else if (status == 2) registration = "Zoekt netwerk";
    else if (status == 3) registration = "Registratie geweigerd";
    else if (status == 0) registration = "Niet geregistreerd";
    else registration = "Status " + String(status);
  } else if (line.startsWith("+CGPSINFO:")) {
    parseGps(line);
  }
}

void handleApi() {
  String gps = gpsRaw;
  String lat = "null", lon = "null";
  if (gps != "Waiting for GPS data") {
    // SIM7600 CGPSINFO: latitude,N/S,longitude,E/W,date,time,altitude,speed,course
    int c1 = gps.indexOf(',');
    int c2 = c1 < 0 ? -1 : gps.indexOf(',', c1 + 1);
    int c3 = c2 < 0 ? -1 : gps.indexOf(',', c2 + 1);
    int c4 = c3 < 0 ? -1 : gps.indexOf(',', c3 + 1);
    if (c1 > 0 && c2 > c1 && c3 > c2 && c4 > c3) {
      String latText = gps.substring(0, c1); latText.trim();
      String ns = gps.substring(c1 + 1, c2); ns.trim();
      String lonText = gps.substring(c2 + 1, c3); lonText.trim();
      String ew = gps.substring(c3 + 1, c4); ew.trim();
      double latValue = latText.toDouble();
      double lonValue = lonText.toDouble();
      int dot = latText.indexOf('.');
      int degrees = dot >= 0 ? dot - 2 : latText.length() - 2;
      if (degrees > 0) latValue = latText.substring(0, degrees).toDouble() + latText.substring(degrees).toDouble() / 60.0;
      dot = lonText.indexOf('.');
      degrees = dot >= 0 ? dot - 2 : lonText.length() - 2;
      if (degrees > 0) lonValue = lonText.substring(0, degrees).toDouble() + lonText.substring(degrees).toDouble() / 60.0;
      if (ns == "S") latValue = -latValue;
      if (ew == "W") lonValue = -lonValue;
      lat = String(latValue, 6); lon = String(lonValue, 6);
    }
  }
  String signalDbm = "null";
  if (signalRssi >= 0) signalDbm = String(-113 + 2 * signalRssi);
  String json = "{\"rssi\":" + (signalRssi < 0 ? String("null") : String(signalRssi)) +
      ",\"signalDbm\":" + signalDbm + ",\"network\":\"" + jsonEscape(registration) +
      "\",\"gps\":\"" + jsonEscape(gps) + "\",\"lat\":" + lat + ",\"lon\":" + lon + "}";
  server.send(200, "application/json", json);
}

void setup() {
  Serial.begin(115200);
  modem.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(500);
  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASSWORD);
  server.on("/", HTTP_GET, []() { server.send_P(200, "text/html; charset=utf-8", PAGE); });
  server.on("/api", HTTP_GET, handleApi);
  server.on("/api/action", HTTP_GET, []() {
    String cmd = server.arg("cmd");
    if (cmd == "g") sendCommand("AT+CGPS=1");
    else if (cmd == "s") sendCommand("AT+CSQ");
    else if (cmd == "n") sendCommand("AT+CEREG?");
    else { server.send(400, "text/plain", "Unknown command"); return; }
    server.send(200, "text/plain", "OK");
  });
  server.onNotFound([]() { server.send(404, "text/plain", "Not found"); });
  server.begin();
  Serial.printf("Wi-Fi: %s  password: %s  address: http://%s\n", AP_SSID, AP_PASSWORD, WiFi.softAPIP().toString().c_str());
  Serial.printf("Modem UART2 RX=%d TX=%d baud=%d\n", MODEM_RX_PIN, MODEM_TX_PIN, MODEM_BAUD);
  sendCommand("AT");
  sendCommand("AT+CSQ");
  sendCommand("AT+CEREG?");
  sendCommand("AT+CGPS=1");
  sendCommand("AT+CGPSINFO");
  lastPoll = millis();
}

void loop() {
  server.handleClient();
  while (modem.available()) {
    char c = static_cast<char>(modem.read());
    if (c == '\r') continue;
    if (c == '\n') {
      if (modemLine.length()) handleModemLine(modemLine);
      modemLine = "";
    } else if (modemLine.length() < 256) modemLine += c;
  }
  while (Serial.available()) {
    char c = static_cast<char>(Serial.read());
    if (c == 'g' || c == 'G') sendCommand("AT+CGPS=1");
    else if (c == 'p' || c == 'P') sendCommand("AT+CGPSINFO");
    else if (c == 's' || c == 'S') sendCommand("AT+CSQ");
    else if (c == 'n' || c == 'N') sendCommand("AT+CEREG?");
    else if (c == 'i' || c == 'I') sendCommand("ATI");
  }
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    sendCommand("AT+CSQ");
    sendCommand("AT+CEREG?");
    sendCommand("AT+CGPSINFO");
  }
}
