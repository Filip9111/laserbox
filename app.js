const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_LOGIN_STORAGE_KEY = "laserbox-mqtt-login-v1";

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
        allLasersOn: false,
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
const modemLocationMessageEl = document.getElementById("modemLocationMessage");
const modemLocationUpdatedEl = document.getElementById("modemLocationUpdated");
const modemMapEl = document.getElementById("modemMap");
const mqttLoginDialog = document.getElementById("mqttLoginDialog");
const mqttLoginForm = document.getElementById("mqttLoginForm");
const cancelMqttLoginButton = document.getElementById("cancelMqttLogin");
const mqttUsernameEl = document.getElementById("mqttUsername");
const mqttPasswordEl = document.getElementById("mqttPassword");
const rememberMqttLoginEl = document.getElementById("rememberMqttLogin");
const mqttLoginMessageEl = document.getElementById("mqttLoginMessage");
let client = null;
let controlsAuthorized = false;

const sequenceButtons = {
    ALL: document.getElementById("btnAll"),
    SEQ14: document.getElementById("btn14"),
    SEQ58: document.getElementById("btn58")
};

let activeAddressKey = null;
let pendingAddressKey = null;
let addressRequestId = 0;
let lastAddressRequestAt = 0;
let lastAddressFailureKey = null;
let lastAddressFailureAt = 0;
let gpsFreshnessTimeout = null;

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

function readRememberedMqttLogin() {
    try {
        const credentials = JSON.parse(localStorage.getItem(MQTT_LOGIN_STORAGE_KEY));
        if (
            credentials &&
            typeof credentials.username === "string" && credentials.username &&
            typeof credentials.password === "string" && credentials.password
        ) {
            return credentials;
        }
    } catch (error) {
        // Opgeslagen login is optioneel; zonder opslag blijft aanmelden mogelijk.
    }
    return null;
}

function rememberMqttLogin(credentials) {
    try {
        localStorage.setItem(MQTT_LOGIN_STORAGE_KEY, JSON.stringify(credentials));
        return true;
    } catch (error) {
        return false;
    }
}

function forgetMqttLogin() {
    try {
        localStorage.removeItem(MQTT_LOGIN_STORAGE_KEY);
    } catch (error) {
        // De sessie blijft werken als browseropslag niet beschikbaar is.
    }
}

function addressCacheKey(lat, lon) {
    // Rond GPS-ruis af; dezelfde plek vraagt zo niet steeds opnieuw een adres op.
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function readCachedAddress(key) {
    try {
        const item = JSON.parse(localStorage.getItem(`laserbox-address-${key}`));
        if (item && Date.now() - item.savedAt < 30 * 24 * 60 * 60 * 1000) {
            return item.address;
        }
        localStorage.removeItem(`laserbox-address-${key}`);
    } catch (error) {
        // De pagina blijft werken als lokale browseropslag niet beschikbaar is.
    }
    return null;
}

function cacheAddress(key, address) {
    try {
        localStorage.setItem(`laserbox-address-${key}`, JSON.stringify({
            address,
            savedAt: Date.now()
        }));
    } catch (error) {
        // Cache is optioneel; de adresopvraag zelf kan nog steeds werken.
    }
}

function showAddressOnMap(address) {
    if (!address || address === "Geen adres gevonden") {
        modemMapEl.hidden = true;
        return;
    }

    const mapUrl = new URL("https://maps.google.com/");
    mapUrl.searchParams.set("q", address);
    modemMapEl.textContent = address;
    modemMapEl.href = mapUrl.toString();
    modemMapEl.hidden = false;
    modemLocationMessageEl.hidden = true;
}

function formatAddress(result) {
    const address = result.address || {};
    const street = address.road
        || address.pedestrian
        || address.residential
        || address.footway
        || address.path
        || "";
    const streetLine = [street, address.house_number].filter(Boolean).join(" ");
    const municipality = address.city
        || address.town
        || address.village
        || address.municipality
        || address.hamlet
        || "";
    const municipalityLine = [address.postcode, municipality].filter(Boolean).join(" ");
    return [streetLine, municipalityLine].filter(Boolean).join(", ");
}

async function renderAddress(lat, lon) {
    const key = addressCacheKey(lat, lon);
    const cachedAddress = readCachedAddress(key);

    if (cachedAddress) {
        activeAddressKey = key;
        pendingAddressKey = null;
        addressRequestId++;
        if (cachedAddress === "Geen adres gevonden") {
            modemLocationMessageEl.textContent = cachedAddress;
            modemLocationMessageEl.hidden = false;
            modemMapEl.hidden = true;
        } else {
            showAddressOnMap(cachedAddress);
        }
        return;
    }

    if (lastAddressFailureKey === key && Date.now() - lastAddressFailureAt < 5 * 60 * 1000) {
        modemLocationMessageEl.textContent = "adres tijdelijk niet beschikbaar";
        modemLocationMessageEl.hidden = false;
        modemMapEl.hidden = true;
        return;
    }

    if (activeAddressKey === key && pendingAddressKey === key) {
        modemLocationMessageEl.textContent = "adres wordt opgezocht...";
        modemLocationMessageEl.hidden = false;
        return;
    }

    activeAddressKey = key;
    pendingAddressKey = key;
    const requestId = ++addressRequestId;
    modemLocationMessageEl.textContent = "adres wordt opgezocht...";
    modemLocationMessageEl.hidden = false;
    modemMapEl.hidden = true;

    const waitMs = Math.max(0, 1100 - (Date.now() - lastAddressRequestAt));
    if (waitMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, waitMs));
    }
    if (requestId !== addressRequestId || key !== activeAddressKey) {
        if (pendingAddressKey === key) pendingAddressKey = null;
        return;
    }

    lastAddressRequestAt = Date.now();
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("layer", "address");
    url.searchParams.set("zoom", "18");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));

    try {
        const response = await fetch(url, {
            headers: { "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.5" }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        if (requestId !== addressRequestId || key !== activeAddressKey) return;
        lastAddressFailureKey = null;

        const formattedAddress = formatAddress(result);
        const address = formattedAddress || "Geen adres gevonden";
        cacheAddress(key, address);
        if (formattedAddress) {
            showAddressOnMap(address);
        } else {
            modemLocationMessageEl.textContent = address;
            modemLocationMessageEl.hidden = false;
            modemMapEl.hidden = true;
        }
    } catch (error) {
        if (requestId === addressRequestId && key === activeAddressKey) {
            lastAddressFailureKey = key;
            lastAddressFailureAt = Date.now();
            modemLocationMessageEl.textContent = "adres tijdelijk niet beschikbaar";
            modemLocationMessageEl.hidden = false;
            modemMapEl.hidden = true;
        }
    } finally {
        if (pendingAddressKey === key) pendingAddressKey = null;
    }
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

function updateGpsLocationFreshness(fixTimestamp) {
    if (gpsFreshnessTimeout !== null) {
        window.clearTimeout(gpsFreshnessTimeout);
        gpsFreshnessTimeout = null;
    }

    const timestamp = Number(fixTimestamp);
    const hasFixTime = Number.isFinite(timestamp) && timestamp > 0;
    const ageMs = Date.now() - timestamp * 1000;
    const freshnessLimitMs = 30 * 60 * 1000;
    const isFresh = hasFixTime && ageMs <= freshnessLimitMs && ageMs >= -5 * 60 * 1000;

    modemLocationEl.classList.toggle("gps-fresh", isFresh);
    modemLocationEl.classList.toggle("gps-stale", !isFresh);

    if (isFresh) {
        gpsFreshnessTimeout = window.setTimeout(
            () => updateGpsLocationFreshness(timestamp),
            Math.max(1, freshnessLimitMs - ageMs + 1)
        );
    }
}

function renderTelemetry(telemetry) {
    const signal = telemetry.signalDbm === null ? NaN : Number(telemetry.signalDbm);
    const csq = telemetry.rssi === null ? NaN : Number(telemetry.rssi);
    const lat = telemetry.lat === null ? NaN : Number(telemetry.lat);
    const lon = telemetry.lon === null ? NaN : Number(telemetry.lon);
    const fixTimestamp = Number(telemetry.gpsFixTimestamp);

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
        const hasFixTime = Number.isFinite(fixTimestamp) && fixTimestamp > 0;
        updateGpsLocationFreshness(fixTimestamp);
        modemLocationUpdatedEl.textContent = hasFixTime
            ? ` — ${new Date(fixTimestamp * 1000).toLocaleString("nl-BE")}`
            : " — datum en tijd onbekend";
        renderAddress(lat, lon);
    } else {
        activeAddressKey = null;
        pendingAddressKey = null;
        addressRequestId++;
        updateGpsLocationFreshness(null);
        modemLocationMessageEl.textContent = "nog geen bekend adres";
        modemLocationMessageEl.hidden = false;
        modemLocationUpdatedEl.textContent = " — datum en tijd onbekend";
        modemMapEl.hidden = true;
    }
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
    const allLasersActive = state.allLasersBlinking || state.allLasersOn;

    selectedBoxTitleEl.textContent =
        `Laserbox ${String(selectedBox).padStart(2, "0")}`;

    allLasersButton.textContent = allLasersActive
        ? "ALLE LASERS UIT"
        : "ALLE LASERS AAN";
    allLasersButton.classList.toggle("laser-on", allLasersActive);

    statusEl.textContent = state.status;

    if (state.telemetry) {
        renderTelemetry(state.telemetry);
    } else {
        signalBarEl.style.width = "0%";
        signalMeterEl.setAttribute("aria-valuenow", "0");
        signalPercentEl.textContent = "Ontvangst: wachten op update...";
        modemSignalEl.textContent = "Signaalwaarde: wachten op update...";
        updateGpsLocationFreshness(null);
        modemLocationMessageEl.textContent = "wachten op GPS-fix...";
        modemLocationMessageEl.hidden = false;
        modemLocationUpdatedEl.textContent = " — datum en tijd nog niet beschikbaar";
        modemMapEl.hidden = true;
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

function connectToBroker(credentials = null, rememberCredentials = false) {
    const previousClient = client;
    client = null;
    if (previousClient) previousClient.end(true);

    controlsAuthorized = false;
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
        if (controlsAuthorized) {
            const wasRemembered = rememberCredentials
                ? rememberMqttLogin(credentials)
                : (forgetMqttLogin(), true);
            mqttLoginMessageEl.textContent = wasRemembered
                ? "Bediening verbonden."
                : "Bediening verbonden, maar de browser kon de login niet onthouden.";
            mqttPasswordEl.value = "";
            if (mqttLoginDialog.open) mqttLoginDialog.close();
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
    connectToBroker(
        { username, password },
        rememberMqttLoginEl.checked
    );
});

cancelMqttLoginButton.addEventListener("click", () => {
    mqttLoginDialog.close();
    mqttPasswordEl.value = "";
    if (!controlsAuthorized) connectToBroker();
});

setConnected(false);
log(`Verbinden met HiveMQ voor Laserbox ${selectedBox}...`);
const rememberedMqttLogin = readRememberedMqttLogin();
rememberMqttLoginEl.checked = Boolean(rememberedMqttLogin);
connectToBroker(rememberedMqttLogin, Boolean(rememberedMqttLogin));

function handleStatusMessage(box, message) {
    const state = boxState[box];

    state.status = message;

    if (message === "ALL SEQUENCE") {
        state.allLasersBlinking = false;
        state.allLasersOn = false;
        state.activeSequence = "ALL";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 1-4") {
        state.allLasersBlinking = false;
        state.allLasersOn = false;
        state.activeSequence = "SEQ14";
        resetLasers(box);

    } else if (message === "SEQUENCE LASER 5-8") {
        state.allLasersBlinking = false;
        state.allLasersOn = false;
        state.activeSequence = "SEQ58";
        resetLasers(box);

    } else if (message === "ALL LASERS BLINKING") {
        state.allLasersBlinking = true;
        state.allLasersOn = false;
        state.activeSequence = null;
        state.lasers.fill(true);

    } else if (message === "ALL LASERS ON") {
        state.allLasersBlinking = false;
        state.allLasersOn = true;
        state.activeSequence = null;
        state.lasers.fill(true);

    } else if (
        message === "STOP" ||
        message === "AUTO SHUTDOWN - 2 HOURS"
    ) {
        state.allLasersBlinking = false;
        state.allLasersOn = false;
        state.activeSequence = null;
        resetLasers(box);

    } else {
        const laserMatch =
            message.match(/^LASER ([1-8]) TOGGLE$/);

        if (laserMatch) {
            if (state.allLasersBlinking) {
                state.allLasersBlinking = false;
                state.allLasersOn = false;
                resetLasers(box);
            }

            const laserIndex =
                Number(laserMatch[1]) - 1;

            state.lasers[laserIndex] =
                !state.lasers[laserIndex];
            state.allLasersOn = state.lasers.every(Boolean);
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
    boxState[selectedBox].allLasersOn = false;
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
    boxState[selectedBox].allLasersOn = false;
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
        const state = boxState[selectedBox];
        const allLasersActive = state.allLasersBlinking || state.allLasersOn;

        if (allLasersActive) {
            if (!sendCommand("STOP")) return;
            state.allLasersBlinking = false;
            state.allLasersOn = false;
            state.activeSequence = null;
            state.status = "STOP";
            resetLasers(selectedBox);
        } else {
            if (!sendCommand("STOP")) return;
            for (let laser = 1; laser <= 8; laser++) {
                if (!sendCommand(`L${laser}`)) return;
            }

            state.allLasersBlinking = false;
            state.allLasersOn = true;
            state.activeSequence = null;
            state.status = "ALL LASERS ON";
            state.lasers.fill(true);
        }

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
