/*
 * PigeonHub ESP32 Server - MINIMAL TEST VERSION
 * Just AP + Web Server, NO WASM
 */

#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>

const char* AP_SSID = "PigeonHub-Setup";
const char* AP_PASSWORD = "pigeonhub123";
const int DNS_PORT = 53;

WebServer webServer(80);
DNSServer dnsServer;

const char HTML[] PROGMEM = R"(
<html><head><title>PigeonHub</title></head>
<body><h1>PigeonHub is Working!</h1>
<p>If you see this, the AP and web server are functional.</p>
</body></html>
)";

void handleRoot() {
    webServer.send(200, "text/html", HTML);
}

void setup() {
    Serial.begin(115200);
    delay(1000);
    
    Serial.println("\n\nPigeonHub MINIMAL TEST");
    Serial.printf("Free heap: %d\n", ESP.getFreeHeap());
    
    // Start AP
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    delay(100);
    
    IPAddress apIP = WiFi.softAPIP();
    Serial.printf("AP: %s\n", AP_SSID);
    Serial.printf("IP: %s\n", apIP.toString().c_str());
    
    // Start DNS for captive portal
    dnsServer.start(DNS_PORT, "*", apIP);
    
    // Start web server
    webServer.on("/", handleRoot);
    webServer.onNotFound(handleRoot);
    webServer.begin();
    
    Serial.println("Ready!");
}

void loop() {
    dnsServer.processNextRequest();
    webServer.handleClient();
    delay(1);
}
