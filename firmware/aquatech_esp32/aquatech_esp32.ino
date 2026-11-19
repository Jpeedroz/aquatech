/*
  AquaTech - Firmware do ESP32
  Irrigacao automatica + envio dos dados para a API da equipe.

  Pinagem:
    D34 -> AOUT do sensor de umidade (capacitivo v1.2, alimentado em 3V3)
    D27 -> sinal do sensor de vazao (YF-S201, alimentado em 3V3)
    D26 -> IN do modulo rele (alimentado em 5V pelo VIN)

  A decisao de ligar e desligar a bomba e SEMPRE do ESP32.
  Se o Wi-Fi ou o servidor cairem, a irrigacao continua funcionando.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include "esp_wifi.h"

// ================= PREENCHER ANTES DE CARREGAR =================
const char* WIFI_NOME          = "NOME_DO_WIFI";
const char* WIFI_SENHA         = "SENHA_DO_WIFI";
const char* SERVIDOR           = "http://IP_DO_SERVIDOR:5000"; // IP do computador que roda o servidor
const char* CODIGO_DISPOSITIVO = "ESP32-001";
const char* CHAVE_DISPOSITIVO  = "COLE_A_CHAVE_AQUI";
// ===============================================================

// Esta placa veio com o MAC de fabrica zerado (00:00:00:00:00:00), que o roteador
// rejeita. Por isso definimos um MAC valido manualmente.
uint8_t MAC_ESP32[6] = {0x02, 0xA7, 0x7E, 0xC4, 0x00, 0x01};

// Pinos
const int PINO_SENSOR = 34;
const int PINO_RELE   = 26;
const int PINO_VAZAO  = 27;

// Calibracao do sensor de umidade (medida em 18/11/2026)
const int VALOR_SECO    = 2620;  // sensor no ar
const int VALOR_MOLHADO = 930;   // sensor na agua

// Sensor de vazao: pulsos por segundo para cada 1 L/min.
// O fabricante indica 7.5, mas com a bomba de diafragma a helice gera pulsos extras.
// Valor calibrado em 19/11/2026 passando 1 litro medido pelo sistema.
const float FATOR_VAZAO = 43.5;

// Limites padrao (%). Sao substituidos pelos limites cadastrados no sistema.
float limiteLigar    = 18;
float limiteDesligar = 30;

// Intervalos (milissegundos)
const unsigned long INTERVALO_LEITURA = 1000;   // le sensores e decide sobre a bomba
const unsigned long INTERVALO_ENVIO   = 10000;  // envia leituras para a API
const unsigned long INTERVALO_CONFIG  = 60000;  // busca os limites na API
const unsigned long INTERVALO_WIFI    = 15000;  // tenta reconectar o Wi-Fi

// Estado
volatile unsigned long pulsos = 0;
bool  bombaLigada     = false;
int   umidadeAtual    = 0;
float vazaoAtual      = 0;
float litrosTotais    = 0;
float litrosIrrigacao = 0;

// Aviso de liga/desliga ainda nao confirmado pelo servidor
bool  irrigacaoPendente = false;
bool  pendenteLigada    = false;
int   pendenteUmidade   = 0;
float pendenteLitros    = 0;

unsigned long ultimaLeitura = 0;
unsigned long ultimoEnvio   = 0;
unsigned long ultimaConfig  = 0;
unsigned long ultimoWifi    = 0;
unsigned long ultimaTentativaIrrigacao = 0;
bool configCarregada = false;

volatile unsigned long ultimoPulso = 0;

// Ignora pulsos com menos de 4 ms de intervalo (ruido na borda do sinal).
void IRAM_ATTR contarPulso() {
  unsigned long agora = micros();
  if (agora - ultimoPulso >= 4000) {
    pulsos++;
    ultimoPulso = agora;
  }
}

int lerUmidade() {
  long soma = 0;
  for (int i = 0; i < 10; i++) {
    soma += analogRead(PINO_SENSOR);
    delay(10);
  }
  int leitura = soma / 10;
  int umidade = map(leitura, VALOR_SECO, VALOR_MOLHADO, 0, 100);
  return constrain(umidade, 0, 100);
}

String url(const char* rota) {
  return String(SERVIDOR) + "/api/dispositivos/" + CODIGO_DISPOSITIVO + rota;
}

// Envia uma requisicao e devolve o codigo HTTP (ou negativo em caso de falha)
int requisicao(const char* metodo, const char* rota, const String& corpo, String* resposta) {
  HTTPClient http;
  http.setTimeout(3000);
  http.begin(url(rota));
  http.addHeader("X-Chave-Dispositivo", CHAVE_DISPOSITIVO);
  if (corpo.length() > 0) {
    http.addHeader("Content-Type", "application/json");
  }
  int codigo = http.sendRequest(metodo, corpo);
  if (resposta != nullptr && codigo > 0) {
    *resposta = http.getString();
  }
  http.end();
  return codigo;
}

void enviarLeituras() {
  String corpo = "{\"umidade_solo\":" + String(umidadeAtual) +
                 ",\"vazao_agua\":" + String(vazaoAtual, 2) + "}";
  int codigo = requisicao("POST", "/leituras", corpo, nullptr);
  Serial.print("[API] Leituras enviadas, resposta ");
  Serial.println(codigo);
}

bool enviarIrrigacao() {
  String corpo = "{\"ligada\":" + String(pendenteLigada ? "true" : "false") +
                 ",\"umidade\":" + String(pendenteUmidade);
  if (!pendenteLigada) {
    corpo += ",\"agua_utilizada_litros\":" + String(pendenteLitros, 3);
  }
  corpo += "}";
  int codigo = requisicao("PUT", "/irrigacao", corpo, nullptr);
  Serial.print("[API] Irrigacao ");
  Serial.print(pendenteLigada ? "LIGADA" : "DESLIGADA");
  Serial.print(" registrada, resposta ");
  Serial.println(codigo);
  return codigo == 200 || codigo == 201;
}

// Le um numero do JSON pela chave, ex.: "limite_umidade": 18.0
bool lerNumeroJson(const String& json, const char* chave, float& valor) {
  String procura = String("\"") + chave + "\"";
  int pos = json.indexOf(procura);
  if (pos < 0) return false;
  pos = json.indexOf(':', pos + procura.length());
  if (pos < 0) return false;
  pos++;
  while (pos < (int)json.length() && (json[pos] == ' ' || json[pos] == '"')) pos++;
  char c = json[pos];
  if (!(isDigit(c) || c == '-' || c == '.')) return false;
  valor = json.substring(pos).toFloat();
  return true;
}

void buscarConfiguracao() {
  String resposta;
  int codigo = requisicao("GET", "/configuracao", "", &resposta);
  if (codigo != 200) {
    Serial.print("[API] Falha ao buscar configuracao, resposta ");
    Serial.println(codigo);
    return;
  }
  float liga, desliga;
  if (lerNumeroJson(resposta, "limite_umidade", liga) &&
      lerNumeroJson(resposta, "limite_umidade_desliga", desliga) &&
      liga < desliga) {
    limiteLigar = liga;
    limiteDesligar = desliga;
    configCarregada = true;
    Serial.print("[API] Limites do sistema: liga abaixo de ");
    Serial.print(limiteLigar);
    Serial.print("%, desliga a partir de ");
    Serial.print(limiteDesligar);
    Serial.println("%");
  }
}

void lerSensoresEControlar(unsigned long agora) {
  noInterrupts();
  unsigned long contagem = pulsos;
  pulsos = 0;
  interrupts();

  float segundos = (agora - ultimaLeitura) / 1000.0;
  if (segundos <= 0) segundos = 1;
  vazaoAtual = (contagem / segundos) / FATOR_VAZAO;
  float litros = vazaoAtual * segundos / 60.0;
  litrosTotais += litros;
  if (bombaLigada) litrosIrrigacao += litros;

  umidadeAtual = lerUmidade();

  if (!bombaLigada && umidadeAtual < limiteLigar) {
    bombaLigada = true;
    digitalWrite(PINO_RELE, HIGH);
    litrosIrrigacao = 0;
    irrigacaoPendente = true;
    pendenteLigada = true;
    pendenteUmidade = umidadeAtual;
  } else if (bombaLigada && umidadeAtual >= limiteDesligar) {
    bombaLigada = false;
    digitalWrite(PINO_RELE, LOW);
    irrigacaoPendente = true;
    pendenteLigada = false;
    pendenteUmidade = umidadeAtual;
    pendenteLitros = litrosIrrigacao;
  }

  Serial.print("Umidade: ");
  Serial.print(umidadeAtual);
  Serial.print("%  |  Bomba: ");
  Serial.print(bombaLigada ? "LIGADA" : "DESLIGADA");
  Serial.print("  |  Vazao: ");
  Serial.print(vazaoAtual);
  Serial.print(" L/min  |  Total: ");
  Serial.print(litrosTotais, 2);
  Serial.print(" L  |  Wi-Fi: ");
  Serial.println(WiFi.status() == WL_CONNECTED ? "OK" : "sem conexao");
}

void setup() {
  Serial.begin(115200);
  pinMode(PINO_RELE, OUTPUT);
  digitalWrite(PINO_RELE, LOW);
  pinMode(PINO_VAZAO, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PINO_VAZAO), contarPulso, FALLING);

  WiFi.mode(WIFI_STA);
  esp_wifi_set_mac(WIFI_IF_STA, MAC_ESP32);
  WiFi.setSleep(false);  // evita quedas por "beacon timeout"
  WiFi.begin(WIFI_NOME, WIFI_SENHA);
  Serial.print("Conectando ao Wi-Fi");
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("Wi-Fi conectado. IP do ESP32: ");
    Serial.println(WiFi.localIP());
    buscarConfiguracao();
  } else {
    Serial.println("Sem Wi-Fi. A irrigacao funciona mesmo assim, com os limites padrao.");
  }

  unsigned long agora = millis();
  ultimaLeitura = agora;
  ultimoEnvio = agora;
  ultimaConfig = agora;
  ultimoWifi = agora;
}

void loop() {
  unsigned long agora = millis();

  if (agora - ultimaLeitura >= INTERVALO_LEITURA) {
    lerSensoresEControlar(agora);
    ultimaLeitura = agora;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (agora - ultimoWifi >= INTERVALO_WIFI) {
      Serial.println("Tentando reconectar o Wi-Fi...");
      WiFi.reconnect();
      ultimoWifi = agora;
    }
    return;
  }

  if (irrigacaoPendente && agora - ultimaTentativaIrrigacao >= 5000) {
    ultimaTentativaIrrigacao = agora;
    if (enviarIrrigacao()) {
      irrigacaoPendente = false;
    }
  }

  if (agora - ultimoEnvio >= INTERVALO_ENVIO) {
    enviarLeituras();
    ultimoEnvio = agora;
  }

  unsigned long intervaloConfig = configCarregada ? INTERVALO_CONFIG : 15000;
  if (agora - ultimaConfig >= intervaloConfig) {
    buscarConfiguracao();
    ultimaConfig = agora;
  }
}
