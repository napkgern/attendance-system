#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <ArduinoJson.h>

// ================= Config =================
const char* ssid = "N";
const char* password = "12345678";
const String SERVER_IP = "172.20.10.3";
const String SERVER_PORT = "3000";
const String DEVICE_ID = "ROOM_2_DUMMY"; // Update if testing on Room 1

// Pins
#define RX_PIN 16
#define TX_PIN 17

// OLED (SH1106)
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, U8X8_PIN_NONE);

// Fingerprint
HardwareSerial mySerial(2);
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&mySerial);

// Modes
enum Mode { MODE_IDLE, MODE_SCAN, MODE_ENROLL };
Mode currentMode = MODE_IDLE;
Mode lastMode = MODE_IDLE;

int currentSessionId = 0;
int enrollFingerId = 0;
int enrollCommandId = 0;

unsigned long lastPollTime = 0;
const unsigned long POLL_INTERVAL = 1500;

// Map
int slotToStudent[163];

// Forward declarations
void downloadSessionTemplates(int sessionId);
void sendEnrollDone(String templateHex);
void sendAttendance(int fid);
void writeTemplateToSensor(int id, String hexStr);
void checkModeFromServer();
void handleScan();
void handleEnroll();

// ================= UI =================
void displayStatus(String title, String sub) {
  u8g2.clearBuffer();

  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 15, title.c_str());

  u8g2.setFont(u8g2_font_ncenB14_tr);
  u8g2.drawStr(0, 45, sub.c_str());

  u8g2.sendBuffer();
}

void displayResult(String name, String status) {
  u8g2.clearBuffer();

  u8g2.setFont(u8g2_font_ncenB14_tr);
  u8g2.drawStr(0, 20, status.c_str());

  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 50, name.c_str());

  u8g2.sendBuffer();
}

// ================= Setup =================
void setup() {
  Serial.begin(115200);

  // OLED
  u8g2.begin();
  displayStatus("Booting...", "ESP32");

  // Fingerprint
  mySerial.begin(57600, SERIAL_8N1, RX_PIN, TX_PIN);
  finger.begin(57600);

  if (finger.verifyPassword()) {
    displayStatus("Sensor OK", "AS608");
    delay(1500);
  } else {
    displayStatus("Hardware Error", "No Sensor");
    while (1);
  }

  // WiFi
  WiFi.begin(ssid, password);
  displayStatus("Connecting", "WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
  }

  displayStatus("WiFi OK", WiFi.localIP().toString());
  delay(1500);

  // Force initial Ready screen
  displayStatus("Ready", "Waiting...");
}

// ================= Loop =================
void loop() {
  if (millis() - lastPollTime > POLL_INTERVAL) {
    checkModeFromServer();
    lastPollTime = millis();
  }

  if (currentMode != lastMode) {
    lastMode = currentMode;
    if (currentMode == MODE_IDLE) {
      displayStatus("Ready", "Waiting...");
    }
  }

  if (currentMode == MODE_SCAN) {
    handleScan();
  } else if (currentMode == MODE_ENROLL) {
    handleEnroll();
  }
}

// ================= Scan =================
int getFingerprintID() {
  uint8_t p = finger.getImage();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    return finger.fingerID;
  } 
  return -2; // Unknown fingerprint
}

void handleScan() {
  int localSlot = getFingerprintID();

  if (localSlot > 0 && localSlot <= 162) {
    int studentId = slotToStudent[localSlot];
    if (studentId > 0) {
      sendAttendance(studentId);
    } else {
      displayStatus("Error", "Unmapped");
      delay(2000);
      displayStatus("Ready", "Scan Now");
    }
  } else if (localSlot == -2) {
    displayStatus("Unknown", "Fingerprint");
    delay(1500);
    displayStatus("Ready", "Scan Now");
  }
}

void sendAttendance(int fid) {
  if (WiFi.status() != WL_CONNECTED) return;
  displayStatus("Sending...", "Wait");

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
    StaticJsonDocument<512> resDoc;
    DeserializationError error = deserializeJson(resDoc, resp);

    if (!error) {
      String name = resDoc["name"].as<String>();
      String code = resDoc["code"].as<String>();
      String status = resDoc["status"].as<String>();

      if (code != "null" && code.length() > 0) {
          // Display the student code, avoiding Thai font U8G2 errors
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
    displayStatus("Error", "Send Failed");
  }
  http.end();
  delay(2000); 
  displayStatus("Ready", "Scan Now");
}


// ================= Enroll =================
void handleEnroll() {
  displayStatus("Enroll Mode", "Wait...");

  int p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    if (millis() % 1000 == 0) checkModeFromServer();
    if (currentMode != MODE_ENROLL) return;
  }

  finger.image2Tz(1);
  displayStatus("Remove", "Finger");
  delay(1500);

  while (finger.getImage() != FINGERPRINT_NOFINGER);

  displayStatus("Place Again", "Finger");

  p = -1;
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
  }

  finger.image2Tz(2);

  p = finger.createModel();
  if (p == FINGERPRINT_OK) {
     p = finger.storeModel(1); // Temp slot 1
     if (p == FINGERPRINT_OK) {
       displayStatus("Uploading...", "Wait");
       
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
               for(int h=0; h<4; h++) mySerial.read();
               uint8_t type = mySerial.read();
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
             mySerial.read();
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
       displayStatus("Error", "Store Fail");
       delay(2000);
     }
  } else {
     displayStatus("Error", "Match Fail");
     delay(2000);
  }
  currentMode = MODE_IDLE;
}

void sendEnrollDone(String templateHex) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String url = String("http://") + SERVER_IP + ":" + SERVER_PORT + "/api/iot/enroll/done";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  DynamicJsonDocument doc(2048);
  doc["command_id"] = enrollCommandId;
  if(templateHex.length() > 0) {
    doc["template_data"] = templateHex;
  }
  String body;
  serializeJson(doc, body);

  http.POST(body);
  http.end();
  
  displayStatus("Success", "Enrolled");
  delay(1500);
  currentMode = MODE_IDLE; 
}


// ================= Network =================
void checkModeFromServer() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String url = "http://" + SERVER_IP + ":" + SERVER_PORT + "/api/iot/mode?device_id=" + DEVICE_ID;
  http.begin(url);

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    StaticJsonDocument<512> doc;
    deserializeJson(doc, payload);

    String mode = doc["mode"];

    if (mode == "scan" && currentMode != MODE_SCAN) {
      currentMode = MODE_SCAN;
      currentSessionId = doc["session_id"];
      
      displayStatus("Clearing", "Memory");
      finger.emptyDatabase();
      memset(slotToStudent, 0, sizeof(slotToStudent));
      
      downloadSessionTemplates(currentSessionId);
    } else if (mode == "enroll") {
      currentMode = MODE_ENROLL;
      enrollCommandId = doc["command_id"];
      enrollFingerId = doc["fingerprint_id"];
    } else if (mode == "idle" && currentMode != MODE_IDLE) {
      currentMode = MODE_IDLE;
      finger.emptyDatabase();
      memset(slotToStudent, 0, sizeof(slotToStudent));
      displayStatus("Ready", "Waiting...");
    } else if (mode == "scan") {
      currentSessionId = doc["session_id"];
    }
  } else if (code < 0) {
    // If the ESP32 cannot reach the server, print a warning so the user knows the IP might be wrong
    Serial.println("Error: Cannot reach server!");
    displayStatus("Network", "Error - IP?");
  }
  http.end();
}

void sendRawPacket(uint8_t packetType, uint8_t *payload, uint16_t length) {
  uint16_t wire_length = length + 2;
  uint16_t sum = packetType + (wire_length >> 8) + (wire_length & 0xFF);
  mySerial.write(0xEF);
  mySerial.write(0x01);
  mySerial.write(0xFF); mySerial.write(0xFF); mySerial.write(0xFF); mySerial.write(0xFF);
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

  while(mySerial.available()) mySerial.read();
  
  uint8_t downcmd[] = { 0x09, 0x01 };
  sendRawPacket(0x01, downcmd, 2);
  
  uint32_t timer = millis();
  while(mySerial.available() < 12 && (millis() - timer) < 1000);
  while(mySerial.available()) mySerial.read();
  
  for(int p=0; p<4; p++) {
    uint8_t pType = (p == 3) ? 0x08 : 0x02;
    sendRawPacket(pType, fingerTemplate + (p*128), 128);
    delay(20);
  }
  
  timer = millis();
  while(mySerial.available() < 12 && (millis() - timer) < 1000);
  while(mySerial.available()) mySerial.read();
  
  finger.storeModel(id);
}

void downloadSessionTemplates(int sessionId) {
  if (WiFi.status() != WL_CONNECTED) return;
  displayStatus("Loading", "Templates");
  
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
           slotToStudent[localSlot] = studentId;
           localSlot++;
           loadedCount++;
        }
      }
      displayStatus("Loaded", String(loadedCount) + " Users");
      delay(2000);
    }
  }
  http.end();
  
  displayStatus("Ready", "Scan Now");
}