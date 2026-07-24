/* ==========================================================================
   ZGuard ESP32 Industrial IoT Firmware — Zero Trust Edge Gateway
   Hardware: ESP32 NodeMCU / WROOM-32 + MFRC522 RFID + Relay Module + Sensors
   Library: mobizt/Firebase-ESP-Client
   ========================================================================== */

#include <Arduino.h>
#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <SPI.h>
#include <MFRC522.h>
#include "addons/RTDBHelper.h"
#include "secrets.h" // Holds WIFI_SSID, WIFI_PASSWORD, FIREBASE_API_KEY, FIREBASE_DATABASE_URL

// Device Identification
#define DEVICE_ID "ESP32-01"

// Hardware Pin Assignments
#define RELAY_PIN 26
#define MOTOR_PIN 27
#define VOLTAGE_ADC_PIN 34
#define CURRENT_ADC_PIN 35
#define RFID_SS_PIN 5
#define RFID_RST_PIN 22

// Zero Trust Local Whitelist Array (Edge Check)
const String LOCAL_WHITELIST[] = {
    "A3-89-F1-02",
    "8C-12-99-B0",
    "04-91-B8-32"
};
const int WHITELIST_SIZE = sizeof(LOCAL_WHITELIST) / sizeof(LOCAL_WHITELIST[0]);

// Firebase Data Objects
FirebaseData fbdoStream;
FirebaseData fbdoWrite;
FirebaseAuth auth;
FirebaseConfig config;

// Timing Control
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL_MS = 2000;

MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);

// Helper Functions
bool checkZeroTrustWhitelist(String uid) {
    for (int i = 0; i < WHITELIST_SIZE; i++) {
        if (LOCAL_WHITELIST[i].equalsIgnoreCase(uid)) {
            return true;
        }
    }
    return false;
}

// Stream Callback for Command Listener (/devices/{DEVICE_ID}/commands/latest)
void streamCallback(FirebaseStream data) {
    if (data.dataTypeEnum() == firebase_rtdb_data_json || data.dataTypeEnum() == firebase_rtdb_data_string) {
        FirebaseJson &json = data.jsonObject();
        FirebaseJsonData jsonData;
        
        if (json.get(jsonData, "cmd")) {
            String command = jsonData.stringValue;
            Serial.printf("[ZGuard Command Received] -> %s\n", command.c_str());

            if (command == "DISABLE_RELAY") {
                digitalWrite(RELAY_PIN, LOW); // Cut Relay Output Sub-second
                digitalWrite(MOTOR_PIN, LOW);
                Serial.println("[ZGuard] RELAY CUT — Command Executed!");

                // Update /live/relay_status immediately
                Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/relay_status", "OFF");
                Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/motor_status", "STOPPED");
            } 
            else if (command == "ENABLE_RELAY") {
                digitalWrite(RELAY_PIN, HIGH);
                digitalWrite(MOTOR_PIN, HIGH);
                Serial.println("[ZGuard] RELAY ENABLED");

                Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/relay_status", "ON");
                Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/motor_status", "RUNNING");
            }
        }
    }
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) {
        Serial.println("[ZGuard Firebase Stream] Timeout occurred, resuming...");
    }
}

void setup() {
    Serial.begin(115200);
    pinMode(RELAY_PIN, OUTPUT);
    pinMode(MOTOR_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, HIGH); // Default ON
    digitalWrite(MOTOR_PIN, HIGH);

    SPI.begin();
    rfid.PCD_Init();

    // 1. Connect WiFi
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WiFi] Connecting");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println("\n[WiFi] Connected IP: " + WiFi.localIP().toString());

    // 2. Configure Firebase
    config.api_key = FIREBASE_API_KEY;
    config.database_url = FIREBASE_DATABASE_URL;
    config.token_status_callback = tokenStatusCallback;

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);

    // Set online status
    Firebase.RTDB.setBool(&fbdoWrite, "/devices/" DEVICE_ID "/live/online", true);

    // 3. Subscribe to Command Stream
    if (!Firebase.RTDB.beginStream(&fbdoStream, "/devices/" DEVICE_ID "/commands/latest")) {
        Serial.printf("[ZGuard Stream] Error: %s\n", fbdoStream.errorReason().c_str());
    }
    Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);
}

void processRfidScan() {
    if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;

    String uidStr = "";
    for (byte i = 0; i < rfid.uid.size; i++) {
        uidStr += String(rfid.uid.uidByte[i] < 0x10 ? "0" : "");
        uidStr += String(rfid.uid.uidByte[i], HEX);
        if (i < rfid.uid.size - 1) uidStr += "-";
    }
    uidStr.toUpperCase();

    bool isAuthorized = checkZeroTrustWhitelist(uidStr);
    String statusStr = isAuthorized ? "AUTHORIZED" : "UNAUTHORIZED";

    Serial.printf("[RFID Scan] UID: %s | Status: %s\n", uidStr.c_str(), statusStr.c_str());

    // Push new scan entry to /devices/{DEVICE_ID}/rfid_log
    FirebaseJson logJson;
    logJson.add("uid", uidStr);
    logJson.add("status", statusStr);
    logJson.add("user_name", isAuthorized ? "Authorized Operator" : "Unknown");
    logJson.set("timestamp", {".sv": "timestamp"});

    Firebase.RTDB.pushJSON(&fbdoWrite, "/devices/" DEVICE_ID "/rfid_log", &logJson);

    // Update rfid_last_uid and rfid_last_status in /live
    Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/rfid_last_uid", uidStr);
    Firebase.RTDB.setString(&fbdoWrite, "/devices/" DEVICE_ID "/live/rfid_last_status", statusStr);

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
}

void loop() {
    processRfidScan();

    // Telemetry Telemetry Push every 2 Seconds
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = millis();

        float rawVoltage = analogRead(VOLTAGE_ADC_PIN) * (3.3 / 4095.0) * 100.0;
        float rawCurrent = analogRead(CURRENT_ADC_PIN) * (3.3 / 4095.0) * 2.0;

        FirebaseJson liveJson;
        liveJson.add("relay_status", digitalRead(RELAY_PIN) == HIGH ? "ON" : "OFF");
        liveJson.add("motor_status", digitalRead(MOTOR_PIN) == HIGH ? "RUNNING" : "STOPPED");
        liveJson.add("online", true);
        liveJson.set("last_seen", {".sv": "timestamp"}); // Server timestamp

        if (Firebase.RTDB.updateNode(&fbdoWrite, "/devices/" DEVICE_ID "/live", &liveJson)) {
            Serial.println("[ZGuard] Telemetry Live Update Success");
        } else {
            Serial.printf("[ZGuard] Live Update Error: %s\n", fbdoWrite.errorReason().c_str());
        }
    }
}
