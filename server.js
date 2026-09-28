const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const mqtt = require("mqtt");

const PORT = Number(process.env.PORT || 3000);
const MQTT_URL = process.env.MQTT_URL ||
    "wss://97a1520a4bff46d79cbb84c9d0e5468c.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const PUBLIC_DIR = __dirname;
const BOX_COUNT = 4;

const boxes = {};
for (let id = 1; id <= BOX_COUNT; id++) {
    boxes[id] = { availability: null, status: "", telemetry: null };
}

const mqttClient = MQTT_USERNAME && MQTT_PASSWORD
    ? mqtt.connect(MQTT_URL, {
        username: MQTT_USERNAME,
        password: MQTT_PASSWORD,
        clientId: `LaserboxReadOnly-${Math.random().toString(16).slice(2, 10)}`,
        reconnectPeriod: 3000,
        connectTimeout: 10000,
        clean: true,
        keepalive: 30
    })
    : null;

if (mqttClient) {
    mqttClient.on("connect", () => {
        for (let id = 1; id <= BOX_COUNT; id++) {
            const base = `filip/laserbox${String(id).padStart(2, "0")}`;
            mqttClient.subscribe([
                `${base}/availability`,
                `${base}/status`,
                `${base}/telemetry`
            ], { qos: 1 });
        }
    });

    mqttClient.on("close", () => {
        for (const box of Object.values(boxes)) box.availability = null;
    });

    mqttClient.on("message", (topic, payload) => {
        const match = topic.match(/^filip\/laserbox0([1-4])\/(availability|status|telemetry)$/);
        if (!match) return;
        const box = boxes[Number(match[1])];
        const value = payload.toString().trim();
        if (match[2] === "availability") {
            box.availability = value === "online";
        } else if (match[2] === "status") {
            box.status = value;
        } else {
            try {
                box.telemetry = JSON.parse(value);
            } catch {
                // Ignore malformed telemetry and keep the last valid reading.
            }
        }
    });

    mqttClient.on("error", (error) => {
        console.error("MQTT connection error:", error.message);
    });
} else {
    console.error("Set MQTT_USERNAME and MQTT_PASSWORD to connect the read-only dashboard.");
}

const contentTypes = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8"
};
const allowedFiles = new Set(["index.html", "app.js", "style.css"]);

const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");

    if (request.method === "GET" && pathname === "/health") {
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("ok");
        return;
    }

    if (request.method === "GET" && pathname === "/api/state") {
        response.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });
        response.end(JSON.stringify({ boxes }));
        return;
    }

    if (request.method !== "GET") {
        response.writeHead(405, { Allow: "GET" });
        response.end();
        return;
    }

    const filename = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!allowedFiles.has(filename)) {
        response.writeHead(404);
        response.end("Not found");
        return;
    }

    response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(filename)],
        "Cache-Control": filename === "index.html" ? "no-cache" : "public, max-age=300"
    });
    fs.createReadStream(path.join(PUBLIC_DIR, filename)).pipe(response);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Read-only dashboard listening on port ${PORT}`);
});

function shutdown() {
    if (mqttClient) mqttClient.end(true);
    server.close(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
