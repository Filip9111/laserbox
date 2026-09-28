const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";

const BROWSER_CLIENT_ID =
    "LaserboxStatus-" + Math.random().toString(16).slice(2, 10);

const requestedBox = new URLSearchParams(window.location.search).get("box");
const selectedBox = /^[1-4]$/.test(requestedBox || "")
    ? Number(requestedBox)
    : 1;

const boxState = {
    status: "Wachten op status...",
    telemetry: null,
    availability: null
};

const statusEl = document.getElementById("status");
const connectionEl = document.getElementById("connection");
const selectedBoxTitleEl = document.getElementById("selectedBoxTitle");
const modemSignalEl = document.getElementById("modemSignal");
const signalBarEl = document.getElementById("signalBar");
const signalMeterEl = signalBarEl.parentElement;
const signalPercentEl = document.getElementById("signalPercent");
const modemLocationEl = document.getElementById("modemLocation");
const modemLocationUpdatedEl = document.getElementById("modemLocationUpdated");
const gpsReceptionEl = document.getElementById("gpsReception");
const gpsAccuracyEl = document.getElementById("gpsAccuracy");
const modemMapEl = document.getElementById("modemMap");
const modemUpdatedEl = document.getElementById("modemUpdated");
let activeAddressKey = null;
let addressRequestId = 0;
let pendingAddressKey = null;
let lastAddressRequestAt = 0;
let lastAddressFailureKey = null;
let lastAddressFailureAt = 0;

function baseTopic() {
    return `filip/laserbox${String(selectedBox).padStart(2, "0")}`;
}

function addressCacheKey(lat, lon) {
    // Rond af om GPS-ruis te negeren; dit cachevak is ongeveer 100 meter.
    return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function readCachedAddress(key) {
    try {
        const cached = JSON.parse(localStorage.getItem(`laserbox-address-${key}`));
        if (cached && Date.now() - cached.savedAt < 30 * 24 * 60 * 60 * 1000) {
            return cached.address;
        }
        localStorage.removeItem(`laserbox-address-${key}`);
    } catch (error) {
        // De pagina blijft werken wanneer lokale browseropslag niet beschikbaar is.
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
        // De pagina blijft werken wanneer lokale browseropslag niet beschikbaar is.
    }
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
    const locality = address.city
        || address.town
        || address.village
        || address.municipality
        || address.hamlet
        || "";
    const localityLine = [address.postcode, locality].filter(Boolean).join(" ");

    return [streetLine, localityLine].filter(Boolean).join(", ");
}

async function renderAddress(lat, lon, hasCurrentFix) {
    const label = hasCurrentFix ? "Adres" : "Laatst bekende adres";
    const key = addressCacheKey(lat, lon);
    const cachedAddress = readCachedAddress(key);

    if (cachedAddress) {
        activeAddressKey = key;
        addressRequestId++;
        modemLocationEl.textContent = `${label}: ${cachedAddress}`;
        return;
    }

    if (lastAddressFailureKey === key && Date.now() - lastAddressFailureAt < 5 * 60 * 1000) {
        modemLocationEl.textContent = `${label}: adres tijdelijk niet beschikbaar`;
        return;
    }

    if (activeAddressKey === key && pendingAddressKey === key) {
        modemLocationEl.textContent = `${label}: adres wordt opgezocht...`;
        return;
    }

    activeAddressKey = key;
    const requestId = ++addressRequestId;
    pendingAddressKey = key;

    modemLocationEl.textContent = `${label}: adres wordt opgezocht...`;

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
        if (!formattedAddress) {
            cacheAddress(key, "Geen adres gevonden");
            modemLocationEl.textContent = `${label}: geen adres gevonden`;
            return;
        }

        cacheAddress(key, formattedAddress);
        modemLocationEl.textContent = `${label}: ${formattedAddress}`;
    } catch (error) {
        if (requestId === addressRequestId && key === activeAddressKey) {
            lastAddressFailureKey = key;
            lastAddressFailureAt = Date.now();
            modemLocationEl.textContent = `${label}: adres tijdelijk niet beschikbaar`;
        }
    } finally {
        if (pendingAddressKey === key) pendingAddressKey = null;
    }
}

function renderBoxAvailability() {
    if (boxState.availability === null) {
        connectionEl.textContent = "Boxstatus: ONBEKEND";
        connectionEl.className = "unknown";
        return;
    }

    const isOnline = boxState.availability;
    connectionEl.textContent = `Boxstatus: ${isOnline ? "ONLINE" : "OFFLINE"}`;
    connectionEl.className = isOnline ? "online" : "offline";
}

function renderTelemetry(telemetry) {
    const signal = telemetry.signalDbm === null
        ? NaN
        : Number(telemetry.signalDbm);
    const csq = telemetry.rssi === null ? NaN : Number(telemetry.rssi);
    const lat = telemetry.lat === null ? NaN : Number(telemetry.lat);
    const lon = telemetry.lon === null ? NaN : Number(telemetry.lon);
    const satellites = telemetry.gpsSatellites === null
        ? NaN
        : Number(telemetry.gpsSatellites);
    const hdop = telemetry.gpsHdop === null ? NaN : Number(telemetry.gpsHdop);
    const fixTimestamp = Number(telemetry.gpsFixTimestamp);

    const hasSignal = Number.isFinite(csq) && csq >= 0 && csq <= 31;
    const signalPercent = hasSignal ? Math.round((csq / 31) * 100) : 0;
    signalBarEl.style.width = `${signalPercent}%`;
    signalMeterEl.setAttribute("aria-valuenow", String(signalPercent));
    signalPercentEl.textContent = hasSignal
        ? `4G-ontvangst: ${signalPercent}%`
        : "4G-ontvangst: geen meting";
    modemSignalEl.textContent = Number.isFinite(signal)
        ? `4G-signaalwaarde: ${signal} dBm${hasSignal ? ` (CSQ ${csq}/31)` : ""}`
        : "4G-signaalwaarde: geen meting";

    gpsReceptionEl.textContent = Number.isFinite(satellites)
        ? `GPS-ontvangst: ${satellites} bruikbare satellieten`
        : "GPS-ontvangst: satellietgegevens nog niet beschikbaar";
    gpsAccuracyEl.textContent = Number.isFinite(hdop)
        ? `HDOP: ${hdop.toFixed(1)} (lager is nauwkeuriger)`
        : "HDOP: nog niet beschikbaar";

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        const hasCurrentFix = telemetry.gpsStatus === "fix";
        renderAddress(lat, lon, hasCurrentFix);
        modemMapEl.href = `https://maps.google.com/?q=${lat},${lon}`;
        modemMapEl.hidden = false;
        modemLocationUpdatedEl.textContent = Number.isFinite(fixTimestamp) && fixTimestamp > 0
            ? `Tijdstip laatste GPS-fix: ${new Date(fixTimestamp * 1000).toLocaleString("nl-BE")}`
            : "Tijdstip van de laatste GPS-fix is niet beschikbaar";
    } else {
        activeAddressKey = null;
        addressRequestId++;
        pendingAddressKey = null;
        const gpsMessages = {
            searching: "Locatie: GPS zoekt satellieten; zet de antenne buiten met vrij zicht op de hemel",
            command_failed: "Locatie: modem antwoordt niet op de GPS-statusaanvraag",
            start_failed: "Locatie: GPS kon niet worden gestart door de modem",
            info_failed: "Locatie: modem antwoordt niet op de GPS-locatieaanvraag",
            status_unknown: "Locatie: GPS-status van de modem is onbekend"
        };
        modemLocationEl.textContent = gpsMessages[telemetry.gpsStatus]
            || "Locatie: nog geen GPS-fix";
        modemLocationUpdatedEl.textContent = "Laatste GPS-fix: nog geen bekende locatie";
        modemMapEl.hidden = true;
    }

    const timestamp = Number(telemetry.timestamp);
    modemUpdatedEl.textContent = Number.isFinite(timestamp) && timestamp > 0
        ? `Laatste telemetrie: ${new Date(timestamp * 1000).toLocaleString("nl-BE")}`
        : "Laatste telemetrie: datum/tijd ontbreekt";
}

function render() {
    selectedBoxTitleEl.textContent =
        `Laserbox ${String(selectedBox).padStart(2, "0")}`;
    statusEl.textContent = boxState.status;
    renderBoxAvailability();

    if (boxState.telemetry) {
        renderTelemetry(boxState.telemetry);
        return;
    }

    signalBarEl.style.width = "0%";
    signalMeterEl.setAttribute("aria-valuenow", "0");
    signalPercentEl.textContent = "4G-ontvangst: wachten op update...";
    modemSignalEl.textContent = "4G-signaalwaarde: wachten op update...";
    gpsReceptionEl.textContent = "GPS-ontvangst: wachten op satellietgegevens...";
    gpsAccuracyEl.textContent = "HDOP: wachten op satellietgegevens...";
    modemLocationEl.textContent = "Adres: wachten op GPS-fix...";
    modemLocationUpdatedEl.textContent = "Laatste GPS-fix: wachten op update...";
    modemMapEl.hidden = true;
    modemUpdatedEl.textContent = "Laatste telemetrie: nog geen update ontvangen";
}

const pageUrl = new URL(window.location.href);
pageUrl.searchParams.set("box", String(selectedBox));
window.history.replaceState(null, "", pageUrl);
render();

const client = mqtt.connect(MQTT_HOST, {
    clientId: BROWSER_CLIENT_ID,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
    keepalive: 30
});

client.on("connect", () => {
    const base = baseTopic();
    for (const topic of [`${base}/availability`, `${base}/status`, `${base}/telemetry`]) {
        client.subscribe(topic, { qos: 1 });
    }
});

client.on("close", () => {
    boxState.availability = null;
    renderBoxAvailability();
});

client.on("offline", () => {
    boxState.availability = null;
    renderBoxAvailability();
});

client.on("message", (topic, payload) => {
    const message = payload.toString().trim();
    const base = baseTopic();

    if (topic === `${base}/availability`) {
        boxState.availability = message === "online";
        renderBoxAvailability();
    } else if (topic === `${base}/status`) {
        boxState.status = message;
        statusEl.textContent = message;
    } else if (topic === `${base}/telemetry`) {
        try {
            boxState.telemetry = JSON.parse(message);
            renderTelemetry(boxState.telemetry);
        } catch (error) {
            console.error("Ongeldige laserboxtelemetrie", error);
        }
    }
});

client.on("error", (error) => {
    console.error("MQTT-fout", error.message);
});
