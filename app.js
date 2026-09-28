const BOX_COUNT = 4;

const selectedBoxEl = document.getElementById("boxSelect");
const boxTitleEl = document.getElementById("selectedBoxTitle");
const availabilityEl = document.getElementById("connection");
const statusEl = document.getElementById("status");
const signalBarEl = document.getElementById("signalBar");
const signalMeterEl = signalBarEl.parentElement;
const signalPercentEl = document.getElementById("signalPercent");
const modemSignalEl = document.getElementById("modemSignal");
const modemLocationEl = document.getElementById("modemLocation");
const modemMapEl = document.getElementById("modemMap");
const modemUpdatedEl = document.getElementById("modemUpdated");

function renderBox(box, state) {
    boxTitleEl.textContent = `Laserbox ${String(box).padStart(2, "0")}`;
    if (state.availability === true) {
        availabilityEl.textContent = "Boxstatus: ONLINE";
        availabilityEl.className = "online";
    } else if (state.availability === false) {
        availabilityEl.textContent = "Boxstatus: OFFLINE";
        availabilityEl.className = "offline";
    } else {
        availabilityEl.textContent = "Boxstatus: ONBEKEND";
        availabilityEl.className = "unknown";
    }

    statusEl.textContent = state.status || "Nog geen status ontvangen";
    const telemetry = state.telemetry;
    if (!telemetry) {
        signalBarEl.style.width = "0%";
        signalMeterEl.setAttribute("aria-valuenow", "0");
        signalPercentEl.textContent = "Ontvangst: wachten op update...";
        modemSignalEl.textContent = "Signaalwaarde: wachten op update...";
        modemLocationEl.textContent = "Locatie: wachten op GPS-fix...";
        modemMapEl.hidden = true;
        modemUpdatedEl.textContent = "Laatste update: nog geen update ontvangen";
        return;
    }

    const rssi = telemetry.rssi === null ? NaN : Number(telemetry.rssi);
    const signal = telemetry.signalDbm === null ? NaN : Number(telemetry.signalDbm);
    const lat = telemetry.lat === null ? NaN : Number(telemetry.lat);
    const lon = telemetry.lon === null ? NaN : Number(telemetry.lon);
    const hasSignal = Number.isFinite(rssi) && rssi >= 0 && rssi <= 31;
    const percent = hasSignal ? Math.round((rssi / 31) * 100) : 0;
    signalBarEl.style.width = `${percent}%`;
    signalMeterEl.setAttribute("aria-valuenow", String(percent));
    signalPercentEl.textContent = hasSignal ? `Ontvangst: ${percent}%` : "Ontvangst: geen meting";
    modemSignalEl.textContent = Number.isFinite(signal)
        ? `Signaalwaarde: ${signal} dBm${hasSignal ? ` (CSQ ${rssi}/31)` : ""}`
        : "Signaalwaarde: geen meting";

    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        modemLocationEl.textContent = `Locatie: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        modemMapEl.href = `https://maps.google.com/?q=${lat},${lon}`;
        modemMapEl.hidden = false;
    } else {
        modemLocationEl.textContent = "Locatie: nog geen GPS-fix";
        modemMapEl.hidden = true;
    }

    const timestamp = Number(telemetry.timestamp);
    modemUpdatedEl.textContent = Number.isFinite(timestamp) && timestamp > 0
        ? `Laatste ontvangst: ${new Date(timestamp * 1000).toLocaleString("nl-BE")}`
        : "Laatste ontvangst: datum/tijd ontbreekt in deze telemetrie";
}

async function refresh() {
    try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const box = Number(selectedBoxEl.value);
        renderBox(box, data.boxes[box] || {});
    } catch (error) {
        availabilityEl.textContent = "Boxstatus: ONBEKEND";
        availabilityEl.className = "unknown";
        statusEl.textContent = "Status tijdelijk niet beschikbaar";
    }
}

selectedBoxEl.addEventListener("change", refresh);
refresh();
setInterval(refresh, 3000);
