// ==== CONFIG ====
const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "Lasertester";
const MQTT_PASS = "Swat@laser1!"; // zelfde als mqtt_pass in de .ino

const BASE_TOPIC = "filip/laserbox01";
const STATUS_TOPIC = BASE_TOPIC + "/status";
const SUB_ALL_TOPIC = BASE_TOPIC + "/#";
const CMD_TOPIC = BASE_TOPIC + "/command"; // let op: "command", niet "cmd"

// ==== DOM ELEMENTEN ====
const connectionEl = document.getElementById("connection");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

// ==== LOG HELPER ====
function log(msg) {
    const time = new Date().toLocaleTimeString();
    logEl.value += `[${time}] ${msg}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}

// ==== VERBINDING ====
function setConnected(isConnected) {
    if (isConnected) {
        connectionEl.textContent = "● ONLINE";
        connectionEl.className = "online";
    } else {
        connectionEl.textContent = "● OFFLINE";
        connectionEl.className = "offline";
    }
}

setConnected(false);
log("Verbinden met HiveMQ...");

const client = mqtt.connect(MQTT_HOST, {
    username: MQTT_USER,
    password: MQTT_PASS,
    reconnectPeriod: 3000,   // automatische reconnect elke 3s
    connectTimeout: 8000,
    clean: true
});

// ==== EVENTS ====
client.on("connect", () => {
    setConnected(true);
    log("Verbonden met HiveMQ ✅");

    client.subscribe(SUB_ALL_TOPIC, (err) => {
        if (err) {
            log("Fout bij abonneren: " + err.message);
        } else {
            log("Geabonneerd op " + SUB_ALL_TOPIC);
        }
    });
});

client.on("reconnect", () => {
    log("Opnieuw verbinden...");
});

client.on("close", () => {
    setConnected(false);
    log("Verbinding verbroken ❌");
});

client.on("error", (err) => {
    log("MQTT fout: " + err.message);
});

client.on("message", (topic, payload) => {
    const msg = payload.toString();
    log(`${topic} → ${msg}`);

    if (topic === STATUS_TOPIC) {
        statusEl.textContent = msg;
        updateLaserButtonStates(msg);
    }
});

// ==== COMMANDO'S VERSTUREN ====
function sendCommand(cmd) {
    if (!client.connected) {
        log("Kan niet versturen: niet verbonden.");
        return;
    }
    client.publish(CMD_TOPIC, cmd);
    log(`Verzonden → ${CMD_TOPIC}: ${cmd}`);
}

// ==== VASTE KNOPPEN (sequenties) ====
document.getElementById("btnAll").addEventListener("click", () => sendCommand("ALL"));
document.getElementById("btnStop").addEventListener("click", () => sendCommand("STOP"));
document.getElementById("btn14").addEventListener("click", () => sendCommand("SEQ14"));
document.getElementById("btn58").addEventListener("click", () => sendCommand("SEQ58"));

// ==== HANDMATIGE LASERS (toggle, ESP32 beheert eigen aan/uit-status) ====
for (let i = 1; i <= 8; i++) {
    const btn = document.getElementById("l" + i);
    btn.addEventListener("click", () => {
        sendCommand("L" + i);
    });
}

// Optioneel: knop groen kleuren op basis van het statusbericht "LASER X TOGGLE"
// Dit is een best-effort weergave; de ESP32 stuurt geen expliciete ON/OFF-status per laser,
// dus we kunnen de knopkleur niet 100% betrouwbaar synchroniseren zonder extra statusberichten.
function updateLaserButtonStates(msg) {
    // Placeholder: hier zou je op kunnen bouwen als de ESP32 later
    // per laser een eigen status-topic/payload stuurt (bv. "LASER 3 ON").
}
