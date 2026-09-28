const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";

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
        allLasersBlinking: false,
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
const mqttLoginDialog = document.getElementById("mqttLoginDialog");
const mqttLoginForm = document.getElementById("mqttLoginForm");
const cancelMqttLoginButton = document.getElementById("cancelMqttLogin");
const mqttUsernameEl = document.getElementById("mqttUsername");
const mqttPasswordEl = document.getElementById("mqttPassword");
const mqttLoginMessageEl = document.getElementById("mqttLoginMessage");
const lockControlsButton = document.getElementById("lockControls");
let client = null;
let controlsAuthorized = false;

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
    const allLasersButton = document.getElementById("btnAllOn");

    selectedBoxTitleEl.textContent =
        `Laserbox ${String(selectedBox).padStart(2, "0")}`;

    allLasersButton.textContent = state.allLasersBlinking
        ? "ALLE LASERS UIT"
        : "ALLE LASERS AAN";
    allLasersButton.classList.toggle("laser-on", state.allLasersBlinking);

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

function handleMqttMessage(topic, payload) {
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
}

function connectToBroker(credentials = null) {
    const previousClient = client;
    client = null;
    if (previousClient) previousClient.end(true);

    controlsAuthorized = false;
    lockControlsButton.hidden = true;
    setConnected(false);

    const options = {
        clientId: BROWSER_CLIENT_ID + "-" + Math.random().toString(16).slice(2, 6),
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true,
        keepalive: 30
    };
    if (credentials) {
        options.username = credentials.username;
        options.password = credentials.password;
    }

    const connection = mqtt.connect(MQTT_HOST, options);
    client = connection;

    connection.on("connect", () => {
        if (client !== connection) return;

        setConnected(true);
        controlsAuthorized = Boolean(credentials);
        lockControlsButton.hidden = !controlsAuthorized;
        if (controlsAuthorized) {
            mqttLoginMessageEl.textContent = "Bediening verbonden.";
            mqttPasswordEl.value = "";
            mqttLoginDialog.close();
        }
        log(`Verbonden met HiveMQ voor Laserbox ${selectedBox}`);

        const base = baseTopic(selectedBox);
        for (const topic of [`${base}/availability`, statusTopic(selectedBox), telemetryTopic(selectedBox)]) {
            connection.subscribe(topic, { qos: 1 }, (error) => {
                if (error) log(`Abonneerfout ${topic}: ${error.message}`);
                else log(`Geabonneerd op ${topic}`);
            });
        }
    });

    connection.on("reconnect", () => {
        if (client === connection) log("Opnieuw verbinden met HiveMQ...");
    });

    connection.on("close", () => {
        if (client !== connection) return;
        setConnected(false);
        if (credentials && !controlsAuthorized) {
            mqttLoginMessageEl.textContent = "Aanmelden mislukt. Controleer de login.";
        }
        log("MQTT-verbinding verbroken");
    });

    connection.on("offline", () => {
        if (client === connection) setConnected(false);
    });

    connection.on("error", (error) => {
        if (client !== connection) return;
        if (credentials && !controlsAuthorized) {
            mqttLoginMessageEl.textContent = "Aanmelden mislukt. Controleer de login.";
        }
        log(`MQTT-fout: ${error.message}`);
    });

    connection.on("message", handleMqttMessage);
}

function openMqttLogin() {
    mqttLoginMessageEl.textContent = "Voer de MQTT-login in om de lasers te bedienen.";
    mqttLoginDialog.showModal();
}

mqttLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const username = mqttUsernameEl.value.trim();
    const password = mqttPasswordEl.value;
    if (!username || !password) {
        mqttLoginMessageEl.textContent = "Vul gebruikersnaam en wachtwoord in.";
        return;
    }

    mqttLoginMessageEl.textContent = "Aanmelden bij de laserbox...";
    connectToBroker({ username, password });
});

cancelMqttLoginButton.addEventListener("click", () => {
    mqttLoginDialog.close();
    mqttPasswordEl.value = "";
    if (!controlsAuthorized) connectToBroker();
});

lockControlsButton.addEventListener("click", () => {
    controlsAuthorized = false;
    mqttUsernameEl.value = "";
    mqttPasswordEl.value = "";
    connectToBroker();
    mqttLoginMessageEl.textContent = "Bediening vergrendeld.";
});

setConnected(false);
log(`Verbinden met HiveMQ voor Laserbox ${selectedBox}...`);
connectToBroker();

function handleStatusMessage(box, message) {
    const state = boxState[box];

    state.status = message;

    if (message === "ALL SEQUENCE") {
        state.allLasersBlinking = false;
        state.activeSequence = "ALL";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 1-4") {
        state.allLasersBlinking = false;
        state.activeSequence = "SEQ14";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 5-8") {
        state.allLasersBlinking = false;
        state.activeSequence = "SEQ58";
        resetLasers(box);

    } else if (
        message === "ALL LASERS BLINKING" ||
        message === "ALL LASERS ON"
    ) {
        state.allLasersBlinking = true;
        state.activeSequence = null;
        state.lasers.fill(true);

    } else if (
        message === "STOP" ||
        message === "AUTO SHUTDOWN - 2 HOURS"
    ) {
        state.allLasersBlinking = false;
        state.activeSequence = null;
        resetLasers(box);

    } else {
        const laserMatch =
            message.match(/^LASER ([1-8]) TOGGLE$/);

        if (laserMatch) {
            if (state.allLasersBlinking) {
                state.allLasersBlinking = false;
                resetLasers(box);
            }

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
    if (!controlsAuthorized) {
        if (!mqttLoginDialog.open) openMqttLogin();
        return false;
    }

    if (!client || !client.connected) {
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
    boxState[selectedBox].allLasersBlinking = false;
    resetLasers(selectedBox);

    renderSelectedBox();
}

function stopBox() {
    if (!sendCommand("STOP")) {
        return;
    }

    // STOP knippert bewust nooit.
    boxState[selectedBox].activeSequence = null;
    boxState[selectedBox].allLasersBlinking = false;
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
        if (!sendCommand("ALL_BLINK")) {
            return;
        }

        const state = boxState[selectedBox];
        state.allLasersBlinking = !state.allLasersBlinking;
        state.activeSequence = null;
        state.status = state.allLasersBlinking
            ? "ALL LASERS BLINKING"
            : "STOP";
        state.lasers.fill(state.allLasersBlinking);
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
