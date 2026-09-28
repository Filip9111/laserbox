const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "Lasertester";
const MQTT_PASS = "Swat@laser1!";

const BOX_COUNT = 4;

const BROWSER_CLIENT_ID =
    "LaserboxWeb-" + Math.random().toString(16).slice(2, 10);

const requestedBox = new URLSearchParams(window.location.search).get("box");
let selectedBox = /^[1-4]$/.test(requestedBox || "") ? Number(requestedBox) : 1;
const boxState = {};

for (let box = 1; box <= BOX_COUNT; box++) {
    boxState[box] = {
        status: "Wachten op status...",
        activeSequence: null,
        lasers: Array(8).fill(false),
        telemetry: null,
        availability: null
    };
}

const connectionEl = document.getElementById("connection");
const statusEl = document.getElementById("status");
const selectedBoxTitleEl = document.getElementById("selectedBoxTitle");
const logEl = document.getElementById("log");
const modemSignalEl = document.getElementById("modemSignal");
const signalBarEl = document.getElementById("signalBar");
const signalMeterEl = signalBarEl.parentElement;
const signalPercentEl = document.getElementById("signalPercent");
const modemLocationEl = document.getElementById("modemLocation");
const modemMapEl = document.getElementById("modemMap");
const modemUpdatedEl = document.getElementById("modemUpdated");

const sequenceButtons = {
    ALL: document.getElementById("btnAll"),
    SEQ14: document.getElementById("btn14"),
    SEQ58: document.getElementById("btn58")
};

function baseTopic(box) {
    return `filip/laserbox${String(box).padStart(2, "0")}`;
}

function commandTopic(box) {
    return `${baseTopic(box)}/command`;
}

function statusTopic(box) {
    return `${baseTopic(box)}/status`;
}

function telemetryTopic(box) {
    return `${baseTopic(box)}/telemetry`;
}

function log(message) {
    const time = new Date().toLocaleTimeString();
    logEl.value += `[${time}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}

function setConnected(connected) {
    if (!connected) {
        for (let box = 1; box <= BOX_COUNT; box++) {
            boxState[box].availability = null;
        }
    }
    renderBoxAvailability();
}

function setBoxAvailability(box, isOnline) {
    boxState[box].availability = isOnline;
    if (box === selectedBox) renderBoxAvailability();
}

function renderBoxAvailability() {
    const isOnline = boxState[selectedBox].availability;
    if (isOnline === null) {
        connectionEl.textContent = "Boxstatus: ONBEKEND";
        connectionEl.className = "unknown";
    } else {
        connectionEl.textContent = `Boxstatus: ${isOnline ? "ONLINE" : "OFFLINE"}`;
        connectionEl.className = isOnline ? "online" : "offline";
    }
}
function renderTelemetry(telemetry) {
    const signal = telemetry.signalDbm === null ? NaN : Number(telemetry.signalDbm);
    const csq = telemetry.rssi === null ? NaN : Number(telemetry.rssi);
    const lat = telemetry.lat === null ? NaN : Number(telemetry.lat);
    const lon = telemetry.lon === null ? NaN : Number(telemetry.lon);

    const hasSignal = Number.isFinite(csq) && csq >= 0 && csq <= 31;
    const signalPercent = hasSignal ? Math.round((csq / 31) * 100) : 0;
    signalBarEl.style.width = `${signalPercent}%`;
    signalMeterEl.setAttribute("aria-valuenow", String(signalPercent));
    signalPercentEl.textContent = hasSignal
        ? `Ontvangst: ${signalPercent}%`
        : "Ontvangst: geen meting";
    modemSignalEl.textContent = Number.isFinite(signal)
        ? `Signaalwaarde: ${signal} dBm${hasSignal ? ` (CSQ ${csq}/31)` : ""}`
        : "Signaalwaarde: geen meting";

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        modemLocationEl.textContent = `Locatie: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        modemMapEl.href = `https://maps.google.com/?q=${lat},${lon}`;
        modemMapEl.hidden = false;
    } else {
        const gpsMessages = {
            searching: "Locatie: GPS zoekt satellieten; zet de antenne buiten met vrij zicht op de hemel",
            command_failed: "Locatie: modem antwoordt niet op de GPS-statusaanvraag",
            start_failed: "Locatie: GPS kon niet worden gestart door de modem",
            info_failed: "Locatie: modem antwoordt niet op de GPS-locatieaanvraag",
            status_unknown: "Locatie: GPS-status van de modem is onbekend"
        };
        modemLocationEl.textContent = gpsMessages[telemetry.gpsStatus]
            || "Locatie: nog geen GPS-fix";
        modemMapEl.hidden = true;
    }

    const timestamp = Number(telemetry.timestamp);
    modemUpdatedEl.textContent = Number.isFinite(timestamp) && timestamp > 0
        ? `Laatste ontvangst: ${new Date(timestamp * 1000).toLocaleString("nl-BE")}`
        : "Laatste ontvangst: datum/tijd ontbreekt in deze telemetrie";
}

function clearSequenceHighlights() {
    Object.values(sequenceButtons).forEach((button) => {
        button.classList.remove("sequence-active");
    });
}

function resetLasers(box) {
    boxState[box].lasers.fill(false);
}

function renderSelectedBox() {
    const state = boxState[selectedBox];

    selectedBoxTitleEl.textContent =
        `Laserbox ${String(selectedBox).padStart(2, "0")}`;

    statusEl.textContent = state.status;

    if (state.telemetry) {
        renderTelemetry(state.telemetry);
    } else {
        signalBarEl.style.width = "0%";
        signalMeterEl.setAttribute("aria-valuenow", "0");
        signalPercentEl.textContent = "Ontvangst: wachten op update...";
        modemSignalEl.textContent = "Signaalwaarde: wachten op update...";
        modemLocationEl.textContent = "Locatie: wachten op GPS-fix...";
        modemMapEl.hidden = true;
        modemUpdatedEl.textContent = "Laatste update: nog geen update ontvangen";
    }

    renderBoxAvailability();

    clearSequenceHighlights();

    if (
        state.activeSequence &&
        sequenceButtons[state.activeSequence]
    ) {
        sequenceButtons[state.activeSequence]
            .classList.add("sequence-active");
    }

    for (let laser = 1; laser <= 8; laser++) {
        document
            .getElementById(`l${laser}`)
            .classList.toggle(
                "laser-on",
                state.lasers[laser - 1]
            );
    }
}

const pageUrl = new URL(window.location.href);
pageUrl.searchParams.set("box", String(selectedBox));
window.history.replaceState(null, "", pageUrl);

setConnected(false);
log(`Verbinden met HiveMQ voor Laserbox ${selectedBox}...`);

const client = mqtt.connect(MQTT_HOST, {
    username: MQTT_USER,
    password: MQTT_PASS,
    clientId: BROWSER_CLIENT_ID,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
    keepalive: 30
});

client.on("connect", () => {
    setConnected(true);
    log(`Verbonden met HiveMQ voor Laserbox ${selectedBox}`);

    const base = baseTopic(selectedBox);
    for (const topic of [`${base}/availability`, statusTopic(selectedBox), telemetryTopic(selectedBox)]) {
        client.subscribe(topic, { qos: 1 }, (error) => {
            if (error) log(`Abonneerfout ${topic}: ${error.message}`);
            else log(`Geabonneerd op ${topic}`);
        });
    }
});
client.on("reconnect", () => {
    log("Opnieuw verbinden met HiveMQ...");
});

client.on("close", () => {
    setConnected(false);
    log("MQTT-verbinding verbroken");
});

client.on("offline", () => {
    setConnected(false);
});

client.on("error", (error) => {
    log(`MQTT-fout: ${error.message}`);
});

client.on("message", (topic, payload) => {
    const message = payload.toString().trim();

    const availabilityMatch = topic.match(
        /^filip\/laserbox(0[1-4])\/availability$/
    );
    if (availabilityMatch) {
        const box = Number(availabilityMatch[1]);
        setBoxAvailability(box, message === "online");
        log(`Laserbox ${box} ${message === "online" ? "online" : "offline"}`);
        return;
    }

    const telemetryMatch = topic.match(
        /^filip\/laserbox(0[1-4])\/telemetry$/
    );

    if (telemetryMatch) {
        const box = Number(telemetryMatch[1]);
        try {
            const telemetry = JSON.parse(message);
            boxState[box].telemetry = telemetry;
            if (box === selectedBox) renderTelemetry(telemetry);
        } catch (error) {
            log(`Ongeldige modemupdate op ${topic}`);
        }
        log(`${topic} bijgewerkt`);
        return;
    }

    const match = topic.match(
        /^filip\/laserbox(0[1-4])\/status$/
    );

    log(`${topic} → ${message}`);

    if (!match) {
        return;
    }

    const box = Number(match[1]);

    handleStatusMessage(box, message);
});

function handleStatusMessage(box, message) {
    const state = boxState[box];

    state.status = message;

    if (message === "ALL SEQUENCE") {
        state.activeSequence = "ALL";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 1-4") {
        state.activeSequence = "SEQ14";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 5-8") {
        state.activeSequence = "SEQ58";
        resetLasers(box);

    } else if (message === "ALL LASERS ON") {
        state.activeSequence = null;
        state.lasers.fill(true);

    } else if (
        message === "STOP" ||
        message === "AUTO SHUTDOWN - 2 HOURS"
    ) {
        state.activeSequence = null;
        resetLasers(box);

    } else {
        const laserMatch =
            message.match(/^LASER ([1-8]) TOGGLE$/);

        if (laserMatch) {
            const laserIndex =
                Number(laserMatch[1]) - 1;

            state.lasers[laserIndex] =
                !state.lasers[laserIndex];
        }
    }

    if (box === selectedBox) {
        renderSelectedBox();
    }
}

function sendCommand(command) {
    if (!client.connected) {
        log("Niet verzonden: geen verbinding met HiveMQ");
        return false;
    }

    const boxAtSendTime = selectedBox;
    const topic = commandTopic(boxAtSendTime);

    client.publish(
        topic,
        command,
        {
            qos: 1,
            retain: false
        },
        (error) => {
            if (error) {
                log(`Publicatiefout: ${error.message}`);
            } else {
                log(
                    `Laserbox ${boxAtSendTime} verzonden → ${command}`
                );
            }
        }
    );

    return true;
}

function startSequence(command) {
    if (!sendCommand(command)) {
        return;
    }

    boxState[selectedBox].activeSequence = command;
    resetLasers(selectedBox);

    renderSelectedBox();
}

function stopBox() {
    if (!sendCommand("STOP")) {
        return;
    }

    // STOP knippert bewust nooit.
    boxState[selectedBox].activeSequence = null;
    boxState[selectedBox].status = "STOP";

    resetLasers(selectedBox);
    renderSelectedBox();
}

document
    .getElementById("btnAll")
    .addEventListener("click", () => {
        startSequence("ALL");
    });

document
    .getElementById("btnStop")
    .addEventListener("click", stopBox);

document
    .getElementById("btnAllOn")
    .addEventListener("click", () => {
        if (!sendCommand("ALL_ON")) {
            return;
        }

        const state = boxState[selectedBox];
        state.activeSequence = null;
        state.status = "ALL LASERS ON";
        state.lasers.fill(true);
        renderSelectedBox();
    });

document
    .getElementById("btn14")
    .addEventListener("click", () => {
        startSequence("SEQ14");
    });

document
    .getElementById("btn58")
    .addEventListener("click", () => {
        startSequence("SEQ58");
    });

for (let laser = 1; laser <= 8; laser++) {
    document
        .getElementById(`l${laser}`)
        .addEventListener("click", () => {
            sendCommand(`L${laser}`);
        });
}

renderSelectedBox();
