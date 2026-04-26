#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>

// ================= Config =================
const char* ssid = "N";
const char* password = "12345678"; // Replace with actual password if needed or keep existing
const String SERVER_IP = "172.20.10.4";
const String SERVER_PORT = "3000";
const String DEVICE_ID = "ROOM_1_SCANNER";

// Pins
#define RX_PIN 16
#define TX_PIN 17

// OLED Config
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// Fingerprint Config
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// Globals
enum Mode { MODE_IDLE, MODE_SCAN, MODE_ENROLL };
Mode currentMode = MODE_IDLE;
Mode lastMode = MODE_IDLE;

int currentSessionId = 0;
int enrollFingerId = 0;
int enrollCommandId = 0;
int currentFingerprintId = 0;

unsigned long lastPollTime = 0;
const unsigned long POLL_INTERVAL = 1500; // Check mode every 1.5s

// Dynamic loading map
int slotToStudent[163]; // map local slot ID (1-162) to actual student/fingerprint ID

// Forward declarations
void syncTemplates();
void writeTemplateToSensor(int id, String hexStr);
void sendRawPacket(uint8_t packetType, uint8_t *payload, uint16_t length);
void checkModeFromServer();
void sendAttendance(int fid);
void sendEnrollDone(String templateHex);
void handleScan();
void handleEnroll();
int getFingerprintID();
void displayStatus(String title, String sub);
void displayResult(String name, String status);

void setup() {
  Serial.begin(115200);

  // Init OLED
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { 
    Serial.println(F("SSD1306 allocation failed"));
    for(;;);
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0,0);
  display.println("Booting...");
  display.display();

  // Init Fingerprint
  mySerial.begin(57600, SERIAL_8N1, RX_PIN, TX_PIN);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("Fingerprint sensor found!");
    displayStatus("Sensor OK!", "AS608 active");
    delay(2000);
  } else {
    Serial.println("Fingerprint sensor NOT found :(");
    displayStatus("Hardware Error", "No AS608 Found!");
    while (1) { delay(1); }
  }

  // Connect WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting");
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("Connecting WiFi...");
  display.display();
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected!");
  Serial.println(WiFi.localIP());
  
  display.clearDisplay();
  display.setCursor(0,0);
  display.println("WiFi Connected");
  display.display();
  delay(1000);

  // We don't sync templates on boot anymore (Option A)
  // syncTemplates();
}

void loop() {
  // 1. Poll Mode
  if (millis() - lastPollTime > POLL_INTERVAL) {
    checkModeFromServer();
    lastPollTime = millis();
  }

  // 2. Handle Logic
  if (currentMode != lastMode) {
     lastMode = currentMode;
     if (currentMode == MODE_IDLE) displayStatus("Ready", "Waiting...");
  }

  if (currentMode == MODE_SCAN) {
    handleScan();
  } else if (currentMode == MODE_ENROLL) {
    handleEnroll();
  }
}

// ================= UI Helper =================
void displayStatus(String title, String sub) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println(title);
  display.setTextSize(2);
  display.setCursor(0, 20);
  display.println(sub);
  display.display();
}

void displayResult(String name, String status) {
  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(0, 0);
  display.println(status); // "Present" or "Late"
  display.setTextSize(1);
  display.setCursor(0, 30);
  display.println(name);
  display.display();
}

// ================= Network =================
void checkModeFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/iot/mode?device_id=" + DEVICE_ID;
  http.begin(url);
  
  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    StaticJsonDocument<512> doc;
    deserializeJson(doc, payload);

    String mode = doc["mode"]; // "idle", "scan", "enroll"
    
    if (mode == "scan" && currentMode != MODE_SCAN) {
      currentMode = MODE_SCAN;
      currentSessionId = doc["session_id"];
      
      // OPTION A: Dynamic loading!
      displayStatus("Clearing Memory", "Please wait");
      finger.emptyDatabase();      // Wipe hardware
      memset(slotToStudent, 0, sizeof(slotToStudent)); // Clear map
      downloadSessionTemplates(currentSessionId);
    } else if (mode == "enroll") {
      currentMode = MODE_ENROLL;
      enrollCommandId = doc["command_id"];
      enrollFingerId = doc["fingerprint_id"];
    } else if (mode == "idle" && currentMode != MODE_IDLE) {
      currentMode = MODE_IDLE;
      // Clear memory to protect privacy/space after class
      finger.emptyDatabase();
      memset(slotToStudent, 0, sizeof(slotToStudent));
    } else if (mode == "scan") {
      // already in scan mode, just update session just in case
      currentSessionId = doc["session_id"];
    }
  }
  http.end();
}

void sendAttendance(int fid) {
  if (WiFi.status() != WL_CONNECTED) return;
  displayStatus("Sending...", "Please wait");

  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/attendance";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> doc;
  doc["fingerprint_id"] = fid;
  doc["session_id"] = currentSessionId;
  doc["device_id"] = DEVICE_ID;

  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode == 200) {
    String resp = http.getString();
    // Parse response
    StaticJsonDocument<512> resDoc;
    DeserializationError error = deserializeJson(resDoc, resp);

    if (!error) {
      String name = resDoc["name"].as<String>();
      String code = resDoc["code"].as<String>();
      String status = resDoc["status"].as<String>();

      if (code != "null" && code.length() > 0) {
          // Display the student code, avoiding Thai font Adafruit errors
          displayResult("Code: " + code, status);
      } else if (name != "null" && name.length() > 0) {
          displayResult(name, status);
      } else {
          displayStatus("Success", "Scan OK");
      }
    } else {
       displayStatus("Success", "Scan OK");
    }
  } else {
    displayStatus("Error!", "Send Failed");
  }
  http.end();
  delay(2000); 
  displayStatus("Scan Mode", "Place Finger...");
}

void sendEnrollDone(String templateHex) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/iot/enroll/done";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  // Use Dynamic as hex string is large
  DynamicJsonDocument doc(2048);
  doc["command_id"] = enrollCommandId;
  if(templateHex.length() > 0) {
    doc["template_data"] = templateHex;
  }
  String body;
  serializeJson(doc, body);

  http.POST(body);
  http.end();
  
  displayStatus("Success!", "Enroll Done");
  delay(1500);
  currentMode = MODE_IDLE; 
}


// ================= Logic =================
void handleScan() {
  int localSlot = getFingerprintID();
  if (localSlot > 0 && localSlot <= 162) {
    int studentId = slotToStudent[localSlot];
    if (studentId > 0) {
      Serial.print("Matched slot "); Serial.print(localSlot);
      Serial.print(" -> Student ID: "); Serial.println(studentId);
      sendAttendance(studentId);
    } else {
      displayStatus("Error", "Unmapped Slot");
      delay(2000);
      displayStatus("Ready", "Scan Now");
    }
  } else if (localSlot == -2) {
    displayStatus("Unknown", "Fingerprint");
    delay(1500);
    displayStatus("Ready", "Scan Now");
  }
}

void handleEnroll() {
  displayStatus("Enroll Mode", "ID: " + String(enrollFingerId));
  
  int p = -1;
  // Step 1
  Serial.println("Waiting for valid finger to enroll as #"); Serial.println(enrollFingerId);
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() % 1000 == 0) checkModeFromServer();
    if (currentMode != MODE_ENROLL) return;
  }

  finger.image2Tz(1);
  displayStatus("Remove", "Finger");
  delay(2000);
  
  p = 0;
  while (p != FINGERPRINT_NOFINGER) {
    p = finger.getImage();
  }
  
  displayStatus("Place Again", "Same Finger");
  
  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
  }

  finger.image2Tz(2);
  
  p = finger.createModel();
  if (p == FINGERPRINT_OK) {
     // Cloud Architecture: Use Slot 1 as a temporary hardware buffer
     p = finger.storeModel(1);
     if (p == FINGERPRINT_OK) {
       displayStatus("Uploading...", "Please Wait");
       
       // Extracting Template from Slot 1
       finger.loadModel(1);
       finger.getModel();
       
       uint8_t fingerTemplate[512];
       int templateIndex = 0;
       uint32_t starttime = millis();
       
       while (templateIndex < 512 && (millis() - starttime) < 5000) {
         if (mySerial.available() >= 9) {
           if (mySerial.peek() == 0xEF) {
             mySerial.read(); // 0xEF
             if (mySerial.read() == 0x01) {
               for(int h=0; h<4; h++) mySerial.read(); // address
               uint8_t type = mySerial.read(); // pid
               uint16_t length = (mySerial.read() << 8) | mySerial.read();
               int payloadLen = length - 2;
               
               int readBytes = 0;
               while(readBytes < payloadLen && (millis() - starttime) < 5000) {
                 if (mySerial.available()) {
                   fingerTemplate[templateIndex++] = mySerial.read();
                   readBytes++;
                 }
               }
               
               while(mySerial.available() < 2 && (millis() - starttime) < 5000);
               mySerial.read(); mySerial.read(); // checksum
             }
           } else {
             mySerial.read(); // discard garbage
           }
         }
       }
       
       String templateHex = "";
       if (templateIndex == 512) {
         for(int j=0; j<512; j++) {
           char hexbuf[3];
           sprintf(hexbuf, "%02X", fingerTemplate[j]);
           templateHex += hexbuf;
         }
       }
       
       sendEnrollDone(templateHex);
     } else {
       displayStatus("Error", "Store Failed");
       delay(2000);
     }
  } else {
     displayStatus("Error", "Match Failed");
     delay(2000);
  }
  currentMode = MODE_IDLE; 
}

int getFingerprintID() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    return finger.fingerID;
  } 
  return -2; // Indicates a finger was placed but no match was found
}

// ================= Template Sync =================

void sendRawPacket(uint8_t packetType, uint8_t *payload, uint16_t length) {
  uint16_t wire_length = length + 2;
  uint16_t sum = packetType + (wire_length >> 8) + (wire_length & 0xFF);
  mySerial.write(0xEF);
  mySerial.write(0x01);
  mySerial.write(0xFF); mySerial.write(0xFF); mySerial.write(0xFF); mySerial.write(0xFF); // address
  mySerial.write(packetType);
  mySerial.write((uint8_t)(wire_length >> 8));
  mySerial.write((uint8_t)(wire_length & 0xFF));
  for(int i=0; i<length; i++) {
    mySerial.write(payload[i]);
    sum += payload[i];
  }
  mySerial.write((uint8_t)(sum >> 8));
  mySerial.write((uint8_t)(sum & 0xFF));
}

void writeTemplateToSensor(int id, String hexStr) {
  if (hexStr.length() != 1024) return;
  uint8_t fingerTemplate[512];
  for(int i=0; i<512; i++) {
    char sub[3] = {hexStr.charAt(i*2), hexStr.charAt(i*2+1), '\0'};
    fingerTemplate[i] = (uint8_t)strtol(sub, NULL, 16);
  }

  // Clear any existing serial garbage
  while(mySerial.available()) mySerial.read();
  
  // Send downChar command to Buffer 1 (Instruction 0x09)
  uint8_t downcmd[] = { 0x09, 0x01 };
  sendRawPacket(0x01, downcmd, 2);
  
  // Wait for Acknowledge Packet (typically 12 bytes long)
  uint32_t timer = millis();
  while(mySerial.available() < 12 && (millis() - timer) < 1000);
  while(mySerial.available()) mySerial.read(); // Flush ACK
  
  // Send 4 data packets of 128 bytes
  for(int p=0; p<4; p++) {
    uint8_t pType = (p == 3) ? 0x08 : 0x02; // ENDDATAPACKET or DATAPACKET
    sendRawPacket(pType, fingerTemplate + (p*128), 128);
    delay(20); // Small grace period for hardware buffer
  }
  
  // Wait for Acknowledge Packet after EndDataPacket
  timer = millis();
  while(mySerial.available() < 12 && (millis() - timer) < 1000);
  while(mySerial.available()) mySerial.read(); // Flush ACK
  
  // Store it using adafruit library
  finger.storeModel(id);
}

void downloadSessionTemplates(int sessionId) {
  if (WiFi.status() != WL_CONNECTED) return;
  displayStatus("Downloading...", "Templates");
  
  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/iot/templates?session_id=" + String(sessionId);
  http.begin(url);
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    String payload = http.getString();
    DynamicJsonDocument doc(32768);
    DeserializationError error = deserializeJson(doc, payload);
    
    if (!error) {
      JsonArray arr = doc["templates"].as<JsonArray>();
      int localSlot = 1;
      int loadedCount = 0;
      for(JsonObject tmpl : arr) {
        int studentId = tmpl["fingerprint_id"];
        String hexStr = tmpl["template_data"].as<String>();
        
        if (localSlot <= 162 && hexStr.length() >= 512) {
           writeTemplateToSensor(localSlot, hexStr);
           slotToStudent[localSlot] = studentId; // Map slot to actual student DB ID
           localSlot++;
           loadedCount++;
        }
      }
      displayStatus("Loaded", String(loadedCount) + " Students");
      delay(2000);
    }
  }
  http.end();
  
  displayStatus("Ready", "Scan Now");
  delay(1000);
}