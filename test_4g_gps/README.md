# SIM7600-H 4G/GNSS test with ESP32

Standalone PlatformIO project for checking that an ESP32-S3 can communicate with a SIMCom SIM7600-H family modem, read cellular signal/registration, and retrieve GNSS position. It also serves a simple local status website over its own Wi-Fi network.

## Wiring

This project assumes a separate ESP32 DevKit (`esp32dev`) and a SIM7600-H carrier/breakout that exposes UART pins:

| ESP32 DevKit | SIM7600 carrier UART |
| --- | --- |
| GPIO16 (TX) | RXD |
| GPIO17 (RX) | TXD |
| GND | GND |

Use the carrier board's specified power input and power-on procedure. Do not power the cellular modem from the ESP32 3.3 V pin. The modem needs a suitable supply for LTE transmit-current peaks. Confirm the carrier's UART voltage levels and pin labels before connecting; the photo identifies the SIM7600-H module but does not show its carrier pinout. Do not connect the raw module's PCIe edge contacts directly to ESP32 GPIO.

Connect cellular and GNSS antennas to their matching connectors and insert an active SIM with a usable subscription. GNSS usually needs a clear view of the sky and can take several minutes to get its first fix.

The modem RXD wire is connected to ESP32 GPIO16, and modem TXD to GPIO17. The UART pins and baud rate are set in `platformio.ini` as `MODEM_RX_PIN`, `MODEM_TX_PIN` and `MODEM_BAUD` (these name the ESP32-side pins). Change them to match your ESP32 and carrier wiring.

## Run

Open this folder as a PlatformIO project and build/upload to the ESP32-S3. On startup it creates a Wi-Fi network named `ESP32-GPS` (password `gpssetup1`). Connect a phone or computer to that network and open `http://192.168.4.1` to view the signal level, network registration and GPS data. The page refreshes every five seconds. The ESP32 has no internet connection in this mode; the map link requires internet access on the viewing device.

Open the Serial Monitor at 115200 baud to see modem replies. On startup, GNSS starts automatically and the ESP32 polls signal, registration and position every five seconds. `+CGPSINFO` fields stay empty until the receiver gets a fix.

Enter these letters in the Serial Monitor to repeat a check:

- `s`: cellular signal (`AT+CSQ`)
- `n`: cellular registration (`AT+CEREG?`)
- `p`: GNSS position (`AT+CGPSINFO`)
- `g`: start GNSS (`AT+CGPS=1`)
- `i`: modem identity (`ATI`)

The website's buttons can start GNSS or request a fresh signal and network reading. The cellular signal is shown as an approximate dBm value and the raw `CSQ` index. Change the Wi-Fi name and password in `src/main.cpp` if needed.

`AT+CSQ` returns an RSSI index. Values 0–31 correspond roughly to -113 through -51 dBm; 99 means unknown or undetectable. `AT+CEREG?` registration status 1 means registered at home, and 5 means registered while roaming.

The program tests modem AT communication and radio/GNSS status. It does not establish a mobile data connection or test internet access.
