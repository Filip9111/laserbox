
void stopAll();

#include <Arduino.h>
#include <PPP.h>
#include <NetworkClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include <cstring>

#ifndef LASERBOX_ID
#define LASERBOX_ID 1
#endif

#if LASERBOX_ID < 1 || LASERBOX_ID > 4
#error "LASERBOX_ID must be between 1 and 4"
#endif

#define STRINGIFY_IMPL(value) #value
#define STRINGIFY(value) STRINGIFY_IMPL(value)
#define LASERBOX_TOPIC(suffix) "filip/laserbox0" STRINGIFY(LASERBOX_ID) suffix


// ============================================================
// SIM7600 4G MODEM
// ============================================================

constexpr char CELLULAR_APN[] = "gprs.base.be";
constexpr int MODEM_TX_PIN = 17; // ESP32 TX -> modem RX
constexpr int MODEM_RX_PIN = 16; // ESP32 RX <- modem TX
constexpr int MODEM_BAUD = 115200;
constexpr unsigned long MODEM_TELEMETRY_INTERVAL = 10000;


// ============================================================
// LASERS
// ============================================================
// Laser 1 = GPIO 13
// Laser 2 = GPIO 14
// Laser 3 = GPIO 7
// Laser 4 = GPIO 6
// Laser 5 = GPIO 12
// Laser 6 = GPIO 11
// Laser 7 = GPIO 5
// Laser 8 = GPIO 4

const byte laserPin[8] = {
  13, 14, 7, 6,
  12, 11, 5, 4
};


// ============================================================
// LASER TIMING
// ============================================================

#define BLINK 167
#define PAUSE 1000
#define LONGON 1500
#define SHORTOFF 500


// ============================================================
// AUTOMATISCHE SHUTDOWN
// ============================================================

// 2 uur = 7.200.000 milliseconden

#define AUTO_SHUTDOWN 7200000UL


// ============================================================
// POWERBANK KEEP-ALIVE OP GPIO 8
// ============================================================

// GPIO 8 blijft 45 seconden LOW en wordt daarna 10 seconden HIGH.
// De timing is volledig non-blocking en stoort MQTT of de lasers niet.

const byte keepAlivePin = 8;

#define KEEPALIVE_INTERVAL 45000UL
#define KEEPALIVE_ON_TIME  10000UL

bool keepAliveActive = false;
unsigned long keepAliveTimer = 0;


// ============================================================
// HIVEMQ MQTT
// ============================================================

const char* mqtt_server =
  "97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud";

const int mqtt_port = 8883;

const char* mqtt_username = "Lasertester";

// VUL HIER JE HIVEMQ WACHTWOORD IN
const char* mqtt_password = "Swat@laser1!";


// Each PlatformIO environment gets its own MQTT identity and topics.
#if LASERBOX_ID == 1
const char* mqtt_client_id = "LaserControllerESP32";
#else
const char* mqtt_client_id = "LaserController0" STRINGIFY(LASERBOX_ID);
#endif

const char* mqtt_control_topic = LASERBOX_TOPIC("/command");
const char* mqtt_status_topic = LASERBOX_TOPIC("/status");
const char* mqtt_telemetry_topic = LASERBOX_TOPIC("/telemetry");


// ============================================================
// LET'S ENCRYPT / ISRG ROOT X1
// ============================================================

static const char* root_ca PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";


// ============================================================
// OBJECTEN
// ============================================================

NetworkClientSecure espClient;
PubSubClient mqttClient(espClient);


// ============================================================
// LASER STATES
// ============================================================

enum State {
  BLINKING,
  PAUSE1,
  LONG_ON,
  SHORT_PAUSE,
  PAUSE2
};


struct Laser {

  State state;

  bool out;

  bool autoRun;

  bool manual;

  bool manualOn;

  unsigned long t;

  byte blink;

  byte count;
};


Laser L[8];


// ============================================================
// STATUS
// ============================================================

String status = "STARTING";

bool manualMode = false;

unsigned long autoStartTime = 0;


// ============================================================
// MQTT RECONNECT TIMER
// ============================================================

unsigned long lastMQTTAttempt = 0;

const unsigned long MQTT_RECONNECT_INTERVAL = 5000;

const unsigned long CONNECTION_FALLBACK_DELAY = 10000;

unsigned long badConnectionSince = 0;

bool fallbackSequenceActive = false;

unsigned long lastTelemetryAttempt = 0;
int modemRssi = -1;
double gpsLatitude = 0;
double gpsLongitude = 0;
bool gpsFix = false;
bool modemStarted = false;
bool modemCmuxStarted = false;
bool cellularTimeSyncStarted = false;
unsigned long lastAttachCheck = 0;


// ============================================================
// RESET LASER
// ============================================================

void resetLaser(byte i) {

  L[i].state = BLINKING;

  L[i].out = false;

  L[i].blink = 0;

  L[i].count = 0;

  L[i].t = millis();

  digitalWrite(laserPin[i], LOW);
}


// ============================================================
// MQTT STATUS
// ============================================================

void publishStatus() {

  if (!mqttClient.connected())
    return;

  mqttClient.publish(
    mqtt_status_topic,
    status.c_str(),
    true
  );
}


// ============================================================
// AUTOMATISCHE SHUTDOWN
// ============================================================

void checkAutoShutdown() {

  if (manualMode)
    return;

  if (autoStartTime == 0)
    return;

  if (millis() - autoStartTime >= AUTO_SHUTDOWN) {

    for (byte i = 0; i < 8; i++) {

      L[i].autoRun = false;

      L[i].manual = false;

      L[i].manualOn = false;

      digitalWrite(laserPin[i], LOW);
    }

    manualMode = true;

    autoStartTime = 0;

    status = "AUTO SHUTDOWN - 2 HOURS";

    publishStatus();

    Serial.println("AUTO SHUTDOWN - 2 HOURS");
  }
}


// ============================================================
// POWERBANK KEEP-ALIVE
// ============================================================

void updateKeepAlive() {

  unsigned long now = millis();

  if (!keepAliveActive) {

    if (now - keepAliveTimer >= KEEPALIVE_INTERVAL) {

      digitalWrite(keepAlivePin, HIGH);

      keepAliveActive = true;
      keepAliveTimer = now;

      Serial.println("Keep-alive GPIO 8: HIGH gedurende 10 seconden");
    }

  } else {

    if (now - keepAliveTimer >= KEEPALIVE_ON_TIME) {

      digitalWrite(keepAlivePin, LOW);

      keepAliveActive = false;
      keepAliveTimer = now;

      Serial.println("Keep-alive GPIO 8: LOW gedurende 45 seconden");
    }
  }
}


// ============================================================
// START ALL
// ============================================================

void startAll() {

  manualMode = false;

  autoStartTime = millis();

  for (byte i = 0; i < 8; i++) {

    L[i].autoRun = true;

    L[i].manual = false;

    L[i].manualOn = false;

    resetLaser(i);
  }

  status = "ALL SEQUENCE";

  publishStatus();

  Serial.println("ALL SEQUENCE");
}


// ============================================================
// START LASER 1-4
// ============================================================

void start14() {

  stopAll();

  manualMode = false;

  autoStartTime = millis();

  for (byte i = 0; i < 4; i++) {

    L[i].autoRun = true;

    resetLaser(i);
  }

  status = "SEQUENCE LASER 1-4";

  publishStatus();

  Serial.println("SEQUENCE LASER 1-4");
}


// ============================================================
// START LASER 5-8
// ============================================================

void start58() {

  stopAll();

  manualMode = false;

  autoStartTime = millis();

  for (byte i = 4; i < 8; i++) {

    L[i].autoRun = true;

    resetLaser(i);
  }

  status = "SEQUENCE LASER 5-8";

  publishStatus();

  Serial.println("SEQUENCE LASER 5-8");
}


// ============================================================
// STOP ALL
// ============================================================

void stopAll() {

  for (byte i = 0; i < 8; i++) {

    L[i].autoRun = false;

    L[i].manual = false;

    L[i].manualOn = false;

    digitalWrite(laserPin[i], LOW);
  }

  manualMode = true;

  autoStartTime = 0;

  status = "STOP";

  publishStatus();

  Serial.println("STOP / MANUAL MODE");
}


// ============================================================
// TOGGLE INDIVIDUAL LASER
// ============================================================

void toggleLaser(byte i) {

  L[i].autoRun = false;

  manualMode = true;

  autoStartTime = 0;

  if (L[i].manualOn) {

    L[i].manualOn = false;

    digitalWrite(laserPin[i], LOW);

  } else {

    L[i].manualOn = true;

    digitalWrite(laserPin[i], HIGH);
  }

  // Deze tekst wordt ook door de externe webinterface gebruikt om
  // de toestand van de bijbehorende knop bij te werken.
  status = "LASER " + String(i + 1) + " TOGGLE";

  publishStatus();

  Serial.print("Manual Laser ");

  Serial.println(i + 1);
}


// ============================================================
// LASER SEQUENCE
// ============================================================

void updateLaser(byte i) {

  if (!L[i].autoRun)
    return;

  unsigned long now = millis();

  switch (L[i].state) {


    // --------------------------------------------------------
    // BLINKING
    // --------------------------------------------------------

    case BLINKING:

      if (now - L[i].t >= BLINK) {

        L[i].t = now;

        L[i].out = !L[i].out;

        digitalWrite(
          laserPin[i],
          L[i].out
        );

        if (!L[i].out) {

          L[i].blink++;

          if (L[i].blink >= 10) {

            L[i].blink = 0;

            L[i].state = PAUSE1;

            digitalWrite(
              laserPin[i],
              LOW
            );
          }
        }
      }

      break;


    // --------------------------------------------------------
    // PAUSE
    // --------------------------------------------------------

    case PAUSE1:

      if (now - L[i].t >= PAUSE) {

        digitalWrite(
          laserPin[i],
          HIGH
        );

        L[i].t = now;

        L[i].state = LONG_ON;
      }

      break;


    // --------------------------------------------------------
    // LONG ON
    // --------------------------------------------------------

    case LONG_ON:

      if (now - L[i].t >= LONGON) {

        digitalWrite(
          laserPin[i],
          LOW
        );

        L[i].t = now;

        L[i].count++;

        if (L[i].count >= i + 1) {

          L[i].count = 0;

          L[i].state = PAUSE2;

        } else {

          L[i].state = SHORT_PAUSE;
        }
      }

      break;


    // --------------------------------------------------------
    // SHORT PAUSE
    // --------------------------------------------------------

    case SHORT_PAUSE:

      if (now - L[i].t >= SHORTOFF) {

        digitalWrite(
          laserPin[i],
          HIGH
        );

        L[i].t = now;

        L[i].state = LONG_ON;
      }

      break;


    // --------------------------------------------------------
    // END PAUSE
    // --------------------------------------------------------

    case PAUSE2:

      if (now - L[i].t >= PAUSE) {

        resetLaser(i);
      }

      break;
  }
}


// ============================================================
// MQTT COMMAND
// ============================================================

void mqttCallback(
  char* topic,
  byte* payload,
  unsigned int length
) {

  String message = "";

  for (unsigned int i = 0; i < length; i++) {

    message += (char)payload[i];
  }

  message.trim();

  message.toUpperCase();

  Serial.println();

  Serial.print("MQTT ontvangen: ");

  Serial.println(message);


  // ----------------------------------------------------------
  // ALL
  // ----------------------------------------------------------

  if (message == "ALL") {

    startAll();

    return;
  }


  // ----------------------------------------------------------
  // LASER 1-4
  // ----------------------------------------------------------

  if (message == "SEQ14" || message == "14") {

    start14();

    return;
  }


  // ----------------------------------------------------------
  // LASER 5-8
  // ----------------------------------------------------------

  if (message == "SEQ58" || message == "58") {

    start58();

    return;
  }


  // ----------------------------------------------------------
  // STOP
  // ----------------------------------------------------------

  if (message == "STOP") {

    stopAll();

    return;
  }


  // ----------------------------------------------------------
  // INDIVIDUELE LASERS
  // ----------------------------------------------------------

  if (message.length() == 2 &&
      message.charAt(0) == 'L') {

    int number =
      message.substring(1).toInt();

    if (number >= 1 && number <= 8) {

      toggleLaser(number - 1);

      return;
    }
  }


  Serial.println("Onbekend MQTT commando");
}


// ============================================================
// MQTT CONNECT
// ============================================================

void connectMQTT() {

  if (!PPP.connected())
    return;

  // HiveMQ TLS validates server certificates against the current time.
  if (time(nullptr) < 100000)
    return;

  if (mqttClient.connected())
    return;

  unsigned long now = millis();

  if (now - lastMQTTAttempt <
      MQTT_RECONNECT_INTERVAL)
    return;

  lastMQTTAttempt = now;

  Serial.println();
  Serial.println("MQTT verbinden...");

  Serial.print("Broker: ");

  Serial.println(mqtt_server);

  Serial.print("Poort: ");

  Serial.println(mqtt_port);


  if (mqttClient.connect(
        mqtt_client_id,
        mqtt_username,
        mqtt_password
      )) {

    Serial.println("MQTT VERBONDEN!");

    bool subscribed = mqttClient.subscribe(
      mqtt_control_topic,
      1
    );

    if (subscribed) {
      Serial.print("Subscribed op: ");
      Serial.println(mqtt_control_topic);
    } else {
      Serial.println("FOUT: MQTT subscribe mislukt");
    }

    // Publiceer de werkelijke laserstatus. Bij het opstarten is dit
    // standaard "ALL SEQUENCE", zodat de webpagina de juiste knop activeert.
    publishStatus();

  } else {

    Serial.print("MQTT verbinding mislukt. State = ");

    Serial.println(
      mqttClient.state()
    );
  }
}


// ============================================================
// ONAFHANKELIJKE LASER-TAAK
// ============================================================

// Deze taak blijft de lasers bijwerken, ook wanneer een trage LTE- of
// TLS/MQTT-verbinding de normale Arduino-loop tijdelijk ophoudt.
void laserUpdateTask(void* parameter) {

  TickType_t lastWakeTime = xTaskGetTickCount();

  while (true) {
    for (byte i = 0; i < 8; i++) {
      updateLaser(i);
    }

    vTaskDelayUntil(&lastWakeTime, pdMS_TO_TICKS(5));
  }
}


// ============================================================
// VEILIGE STANDAARD BIJ SLECHTE VERBINDING
// ============================================================

void checkConnectionFallback() {

  bool connectionGood =
    PPP.connected() && mqttClient.connected();

  if (connectionGood) {
    badConnectionSince = 0;
    fallbackSequenceActive = false;
    return;
  }

  unsigned long now = millis();

  if (badConnectionSince == 0) {
    badConnectionSince = now;
    return;
  }

  if (now - badConnectionSince >= CONNECTION_FALLBACK_DELAY &&
      (!fallbackSequenceActive || status != "ALL SEQUENCE")) {

    startAll();
    fallbackSequenceActive = true;

    Serial.println(
      "Geen goede verbinding: standaard ALL SEQUENCE actief"
    );
  }
}


void startCellular() {
  Serial.println("SIM7600 starten via 4G...");
  Serial.printf("UART1 ESP TX=%d -> modem RX, ESP RX=%d <- modem TX\n",
                MODEM_TX_PIN, MODEM_RX_PIN);

  PPP.setApn(CELLULAR_APN);
  PPP.setPins(MODEM_TX_PIN, MODEM_RX_PIN, -1, -1,
              ESP_MODEM_FLOW_CONTROL_NONE);

  if (!PPP.begin(PPP_MODEM_SIM7600, 1, MODEM_BAUD)) {
    Serial.println("SIM7600 starten mislukt");
    return;
  }
  modemStarted = true;

  Serial.println("SIM7600 gereed; CHAP-authenticatie instellen");
  // SIM7600 AT+CGAUTH auth type 2 = CHAP. Deze sim gebruikt geen
  // aparte gebruikersnaam of wachtwoord.
  Serial.println(PPP.cmd("AT+CGAUTH=1,2,\"\",\"\"", 3000));
  Serial.println(PPP.cmd("AT+CGPS=1", 3000));
}

void updateCellular() {
  if (!modemStarted || modemCmuxStarted) return;
  if (millis() - lastAttachCheck < 1000) return;
  lastAttachCheck = millis();

  if (!PPP.attached()) return;

  if (!PPP.mode(ESP_MODEM_MODE_CMUX)) {
    Serial.println("Modem kon niet naar CMUX-modus schakelen; nieuwe poging volgt");
    return;
  }

  modemCmuxStarted = true;
  Serial.println("4G-netwerk geregistreerd; dataverbinding starten...");
}

String extractAtField(const String& response, const char* prefix) {
  int start = response.indexOf(prefix);
  if (start < 0) return "";
  start += strlen(prefix);
  int end = response.indexOf('\n', start);
  String value = end < 0 ? response.substring(start) : response.substring(start, end);
  value.trim();
  return value;
}

bool parseGpsCoordinate(const String& degreesMinutes, bool latitude,
                        const String& hemisphere, double& coordinate) {
  if (degreesMinutes.length() < 4 || hemisphere.length() != 1) return false;
  int dot = degreesMinutes.indexOf('.');
  int degreeDigits = latitude ? 2 : 3;
  if (dot < degreeDigits) return false;
  double degrees = degreesMinutes.substring(0, degreeDigits).toDouble();
  double minutes = degreesMinutes.substring(degreeDigits).toDouble();
  coordinate = degrees + minutes / 60.0;
  if (hemisphere == "S" || hemisphere == "W") coordinate = -coordinate;
  return true;
}

void updateModemTelemetry() {
  if (!modemStarted) return;

  unsigned long now = millis();
  if (now - lastTelemetryAttempt < MODEM_TELEMETRY_INTERVAL) return;
  lastTelemetryAttempt = now;

  modemRssi = PPP.RSSI();
  String gps = extractAtField(PPP.cmd("AT+CGPSINFO", 3000), "+CGPSINFO:");
  int commas[4];
  int from = 0;
  bool fieldsFound = true;
  for (int i = 0; i < 4; ++i) {
    commas[i] = gps.indexOf(',', from);
    if (commas[i] < 0) { fieldsFound = false; break; }
    from = commas[i] + 1;
  }

  gpsFix = false;
  if (fieldsFound && commas[0] > 0 && commas[1] > commas[0] &&
      commas[2] > commas[1] && commas[3] > commas[2]) {
    String latText = gps.substring(0, commas[0]); latText.trim();
    String ns = gps.substring(commas[0] + 1, commas[1]); ns.trim();
    String lonText = gps.substring(commas[1] + 1, commas[2]); lonText.trim();
    String ew = gps.substring(commas[2] + 1, commas[3]); ew.trim();
    gpsFix = parseGpsCoordinate(latText, true, ns, gpsLatitude) &&
             parseGpsCoordinate(lonText, false, ew, gpsLongitude);
  }

  String rssi = (modemRssi >= 0 && modemRssi <= 31)
                    ? String(modemRssi) : String("null");
  String signalDbm = (modemRssi >= 0 && modemRssi <= 31)
                         ? String(-113 + 2 * modemRssi) : String("null");
  String lat = gpsFix ? String(gpsLatitude, 6) : String("null");
  String lon = gpsFix ? String(gpsLongitude, 6) : String("null");
  String payload = "{\"rssi\":" + rssi +
      ",\"signalDbm\":" + signalDbm +
      ",\"lat\":" + lat + ",\"lon\":" + lon + "}";

  // Toon de modemmeting ook lokaal als MQTT nog niet verbonden is.
  Serial.printf("4G/GNSS meting: %s\n", payload.c_str());

  if (!mqttClient.connected()) {
    Serial.println("Telemetrie niet gepubliceerd: MQTT niet verbonden");
    return;
  }

  if (mqttClient.publish(mqtt_telemetry_topic, payload.c_str(), true)) {
    Serial.printf("Telemetrie gepubliceerd op %s\n", mqtt_telemetry_topic);
  } else {
    Serial.printf("Telemetrie publiceren mislukt op %s\n", mqtt_telemetry_topic);
  }
}


// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  delay(500);


  // ----------------------------------------------------------
  // POWERBANK KEEP-ALIVE
  // ----------------------------------------------------------

  pinMode(keepAlivePin, OUTPUT);
  digitalWrite(keepAlivePin, LOW);
  keepAliveTimer = millis();


  // ----------------------------------------------------------
  // LASERS
  // ----------------------------------------------------------

  for (byte i = 0; i < 8; i++) {

    pinMode(
      laserPin[i],
      OUTPUT
    );

    digitalWrite(
      laserPin[i],
      LOW
    );
  }

  // Lasers starten direct; de mobiele verbinding komt daarna op.
  startAll();


  // ----------------------------------------------------------
  // TLS
  // ----------------------------------------------------------

  espClient.setCACert(
    root_ca
  );

  // Voorkom lange blokkering bij een zeer slechte 4G-verbinding.
  espClient.setHandshakeTimeout(3);


  // ----------------------------------------------------------
  // MQTT
  // ----------------------------------------------------------

  mqttClient.setServer(
    mqtt_server,
    mqtt_port
  );

  mqttClient.setCallback(
    mqttCallback
  );

  mqttClient.setBufferSize(512);
  mqttClient.setSocketTimeout(3);

  // De lasersturing draait los van LTE en MQTT op de tweede ESP32-kern.
  xTaskCreatePinnedToCore(
    laserUpdateTask,
    "LaserUpdate",
    4096,
    nullptr,
    2,
    nullptr,
    1
  );
  startCellular();
}


// ============================================================
// LOOP
// ============================================================

void loop() {

  // Mobiele verbinding en MQTT via de SIM7600 onderhouden.
  updateCellular();

  // Powerbank iedere 45 seconden gedurende 10 seconden belasten
  updateKeepAlive();

  // MQTT verbinding onderhouden
  connectMQTT();


  // MQTT berichten verwerken
  if (mqttClient.connected()) {

    mqttClient.loop();
  }

  if (PPP.connected()) {
    if (!cellularTimeSyncStarted) {
      configTime(0, 0, "pool.ntp.org", "time.nist.gov");
      cellularTimeSyncStarted = true;
      Serial.println("Tijd synchroniseren via 4G voor MQTT-TLS");
    }
  }

  updateModemTelemetry();

  // Zonder betrouwbare 4G + MQTT terugvallen op ALL SEQUENCE.
  checkConnectionFallback();


  // 2 uur timer controleren
  checkAutoShutdown();


}
