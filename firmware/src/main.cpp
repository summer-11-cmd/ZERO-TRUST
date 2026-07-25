/* ==========================================================================
   ZGuard ESP32 Industrial IoT Firmware — Zero Trust Edge Gateway
   Hardware: ESP32 NodeMCU / WROOM-32 + MFRC522 RFID + Relay Module + Motors
   Library: mobizt/Firebase-ESP-Client
   Path: devices/ESP32-01/live
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

// Global Canonical State (Matches exact ZGuard Firebase Schema)
int currentHealthScore = 100;
int currentIsi = 100;
int currentTrustScore = 100;
String currentRfidStatus = "VALID";
String currentTamperStatus = "SAFE";
String currentMotorStatus = "RUNNING";
String currentDecision = "ACCESS_GRANTED";

// Helper Functions
bool checkZeroTrustWhitelist(String uid) {
    for (int i = 0; i < WHITELIST_SIZE; i++) {
        if (LOCAL_WHITELIST[i].equalsIgnoreCase(uid)) {
            return true;
        }
    }
    return false;
}

// Push clean single write to devices/ESP32-01/live
void sendLiveTelemetry() {
    FirebaseJson liveJson;
    liveJson.add("healthScore", currentHealthScore);
    liveJson.add("isi", currentIsi);
    liveJson.add("trustScore", currentTrustScore);
    liveJson.add("rfidStatus", currentRfidStatus);
    liveJson.add("tamperStatus", currentTamperStatus);
    liveJson.add("motorStatus", currentMotorStatus);
    liveJson.add("decision", currentDecision);
    liveJson.set("lastSeen", {".sv": "timestamp"}); // Server timestamp

    if (Firebase.RTDB.setJSON(&fbdoWrite, "/devices/" DEVICE_ID "/live", &liveJson)) {
        Serial.println("[ZGuard] Clean Telemetry Written to /devices/ESP32-01/live");
    } else {
        Serial.printf("[ZGuard Write Error] %s\n", fbdoWrite.errorReason().c_str());
    }
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
                digitalWrite(RELAY_PIN, LOW); // Cut Relay Output
                digitalWrite(MOTOR_PIN, LOW);
                
                currentMotorStatus = "STOPPED";
                currentDecision = "ACCESS_DENIED";
                currentTamperStatus = "RELAY_DISABLED";
                currentIsi = 40;
                currentHealthScore = 50;

                sendLiveTelemetry();
            } 
            else if (command == "ENABLE_RELAY") {
                digitalWrite(RELAY_PIN, HIGH);
                digitalWrite(MOTOR_PIN, HIGH);
                
                currentMotorStatus = "RUNNING";
                currentDecision = "ACCESS_GRANTED";
                currentTamperStatus = "SAFE";
                currentIsi = 100;
                currentHealthScore = 100;

                sendLiveTelemetry();
            }
        }
    }
}

void streamTimeoutCallback(bool timeout) {
    if (timeout) {
        Serial.println("[ZGuard Firebase Stream] Timeout, retrying...");
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

    // Initial Clean Telemetry Write to /devices/ESP32-01/live
    sendLiveTelemetry();

    // 3. Subscribe to Command Stream
    if (!Firebase.RTDB.beginStream(&fbdoStream, "/devices/" DEVICE_ID "/commands/latest")) {
        Serial.printf("[ZGuard Stream Error] %s\n", fbdoStream.errorReason().c_str());
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
    
    // Coordinated state update — decision and rfidStatus MUST agree
    if (isAuthorized) {
        currentRfidStatus = "VALID";
        currentDecision = "ACCESS_GRANTED";
        currentMotorStatus = "RUNNING";
        currentTamperStatus = "SAFE";
        currentHealthScore = 100;
        currentIsi = 100;
        currentTrustScore = 100;
        digitalWrite(RELAY_PIN, HIGH);
        digitalWrite(MOTOR_PIN, HIGH);
    } else {
        currentRfidStatus = "UNAUTHORIZED";
        currentDecision = "ACCESS_DENIED";
        currentMotorStatus = "STOPPED";
        currentTamperStatus = "TAMPER_WARNING";
        currentHealthScore = 60;
        currentIsi = 50;
        currentTrustScore = 40;
        digitalWrite(RELAY_PIN, LOW);
        digitalWrite(MOTOR_PIN, LOW);
    }

    Serial.printf("[RFID Scan] UID: %s | Status: %s | Decision: %s\n", uidStr.c_str(), currentRfidStatus.c_str(), currentDecision.c_str());

    // Push audit entry to /devices/{DEVICE_ID}/rfid_log
    FirebaseJson logJson;
    logJson.add("uid", uidStr);
    logJson.add("status", currentRfidStatus);
    logJson.add("decision", currentDecision);
    logJson.add("user_name", isAuthorized ? "Authorized Operator" : "Unknown Operator");
    logJson.set("timestamp", {".sv": "timestamp"});

    Firebase.RTDB.pushJSON(&fbdoWrite, "/devices/" DEVICE_ID "/rfid_log", &logJson);

    // Immediately push live state update
    sendLiveTelemetry();

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
}

void loop() {
    processRfidScan();

    // Telemetry Push every 2 Seconds
    if (millis() - lastSendTime >= SEND_INTERVAL_MS) {
        lastSendTime = millis();
        sendLiveTelemetry();
    }
}
