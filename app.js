const MQTT_HOST = "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "Lasertester";
const MQTT_PASS = "Swat@laser1!";

const BOX_COUNT = 3;

const BROWSER_CLIENT_ID =
    "LaserboxWeb-" + Math.random().toString(16).slice(2, 10);

let selectedBox = 1;
const boxState = {};

for (let box = 1; box <= BOX_COUNT; box++) {
    boxState[box] = {
        status: "Wachten op status...",
        activeSequence: null,
        lasers: Array(8).fill(false)
    };
}

const connectionEl = document.getElementById("connection");
const statusEl = document.getElementById("status");
const selectedBoxTitleEl = document.getElementById("selectedBoxTitle");
const logEl = document.getElementById("log");

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

function log(message) {
    const time = new Date().toLocaleTimeString();
    logEl.value += `[${time}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
}

function setConnected(connected) {
    connectionEl.textContent = connected ? "● ONLINE" : "● OFFLINE";
    connectionEl.className = connected ? "online" : "offline";
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

    for (let box = 1; box <= BOX_COUNT; box++) {
        document
            .getElementById(`box${box}`)
            .classList.toggle("box-active", box === selectedBox);
    }

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

setConnected(false);
log("Verbinden met HiveMQ...");

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
    log("Verbonden met HiveMQ");

    for (let box = 1; box <= BOX_COUNT; box++) {
        const topic = statusTopic(box);

        client.subscribe(topic, { qos: 1 }, (error) => {
            if (error) {
                log(`Abonneerfout ${topic}: ${error.message}`);
            } else {
                log(`Geabonneerd op ${topic}`);
            }
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

    const match = topic.match(
        /^filip\/laserbox(0[1-3])\/status$/
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

for (let box = 1; box <= BOX_COUNT; box++) {
    document
        .getElementById(`box${box}`)
        .addEventListener("click", () => {
            selectedBox = box;
            renderSelectedBox();

            log(`Laserbox ${box} geselecteerd`);
        });
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
