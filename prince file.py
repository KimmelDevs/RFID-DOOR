import network
import time
import ubinascii
import machine
import hashlib
from hmac import HMAC
from machine import Pin, PWM, I2C
from umqtt.simple import MQTTClient
from mfrc522 import MFRC522
import ssd1306

# ================= WIFI SETTINGS =================
WIFI_SSID     = "OPPO Reno4"
WIFI_PASSWORD = "123456789"

# ================= MQTT SETTINGS =================
MQTT_CLIENT_ID  = b"esp32-" + ubinascii.hexlify(machine.unique_id())
MQTT_BROKER     = "broker.emqx.io"
MQTT_TOPIC_SUB  = b"esp32/led"
MQTT_TOPIC_DOOR = b"esp32/led"
MQTT_TOPIC_UID  = b"esp32/card_uid"
MQTT_TOPIC_ROOF = b"esp32/roof"

# ================= HMAC SECRET =================
HMAC_SECRET = b"my_rfid_door_secret_key_2026_bruh"

# ================= DOOR =================
CLOSED_ANGLE = 90
OPEN_ANGLE   = 0

# ================= ROOF =================
# Continuous rotation servo: duty controls direction, not angle
# ~3276 = full CW, ~4915 = stop, ~6553 = full CCW
ROOF_CW      = 3276   # clockwise  → opens roof
ROOF_STOP    = 4915   # neutral    → stops servo
ROOF_CCW     = 6553   # counter-clockwise → closes roof
ROOF_SPIN_MS = 500    # spin for 0.5 seconds

# ================= HARDWARE =================
led    = Pin(2, Pin.OUT)
buzzer = PWM(Pin(26), freq=1000, duty=0)

servo         = PWM(Pin(13), freq=50)
current_angle = CLOSED_ANGLE
door_open     = False

roof_servo = PWM(Pin(25), freq=50)
roof_servo.duty_u16(ROOF_STOP)
roof_open = False

dino_button = Pin(33, Pin.IN, Pin.PULL_UP)

i2c  = I2C(0, scl=Pin(18), sda=Pin(5))
oled = ssd1306.SSD1306_I2C(128, 64, i2c)

# ================= OLED =================
def draw_star(x, y):
    oled.pixel(x,   y-2, 1)
    oled.pixel(x,   y+2, 1)
    oled.pixel(x-2, y,   1)
    oled.pixel(x+2, y,   1)
    oled.pixel(x,   y,   1)
    oled.pixel(x-1, y-1, 1)
    oled.pixel(x+1, y-1, 1)
    oled.pixel(x-1, y+1, 1)
    oled.pixel(x+1, y+1, 1)

def draw_crown(x, y):
    for dx in range(20):
        oled.pixel(x+dx, y+6, 1)
        oled.pixel(x+dx, y+7, 1)
    oled.pixel(x,    y+5, 1)
    oled.pixel(x,    y+4, 1)
    oled.pixel(x+1,  y+3, 1)
    oled.pixel(x+1,  y+2, 1)
    oled.pixel(x+2,  y+1, 1)
    oled.pixel(x+2,  y,   1)
    oled.pixel(x+9,  y+5, 1)
    oled.pixel(x+9,  y+4, 1)
    oled.pixel(x+10, y+3, 1)
    oled.pixel(x+10, y+2, 1)
    oled.pixel(x+10, y+1, 1)
    oled.pixel(x+10, y,   1)
    oled.pixel(x+10, y-1, 1)
    oled.pixel(x+11, y-1, 1)
    oled.pixel(x+11, y,   1)
    oled.pixel(x+11, y+1, 1)
    oled.pixel(x+11, y+2, 1)
    oled.pixel(x+11, y+3, 1)
    oled.pixel(x+11, y+4, 1)
    oled.pixel(x+11, y+5, 1)
    oled.pixel(x+19, y+5, 1)
    oled.pixel(x+19, y+4, 1)
    oled.pixel(x+18, y+3, 1)
    oled.pixel(x+18, y+2, 1)
    oled.pixel(x+17, y+1, 1)
    oled.pixel(x+17, y,   1)
    oled.pixel(x+5,  y+4, 1)
    oled.pixel(x+14, y+4, 1)

idle_frame = 0

def show_idle_screen():
    global idle_frame
    oled.fill(0)
    for x in range(128):
        oled.pixel(x, 0,  1)
        oled.pixel(x, 1,  1)
        oled.pixel(x, 62, 1)
        oled.pixel(x, 63, 1)
    for y in range(64):
        oled.pixel(0,   y, 1)
        oled.pixel(1,   y, 1)
        oled.pixel(126, y, 1)
        oled.pixel(127, y, 1)
    draw_crown(54, 4)
    oled.text("COOL KIDS", 22, 22, 1)
    oled.text("  CLUB  ",  22, 34, 1)
    if idle_frame % 8 < 4:
        draw_star(10,  32)
        draw_star(118, 32)
    else:
        draw_star(10,  28)
        draw_star(118, 28)
    oled.text("We have dino", 12, 50, 1)
    oled.show()
    idle_frame += 1

# ================= DOOR =================
def set_angle(angle):
    global current_angle
    duty = int((angle / 180) * 102 + 26)
    servo.duty(duty)
    current_angle = angle

def move_smooth(target_angle, speed=0.005):
    global current_angle
    step = 1 if target_angle > current_angle else -1
    for angle in range(current_angle, target_angle + step, step):
        set_angle(angle)
        time.sleep(speed)

def open_door():
    global door_open
    if not door_open:
        print("Opening door...")
        move_smooth(OPEN_ANGLE)
        led.value(1)
        door_open = True
        print("Door opened")
    else:
        print("Door already open")

def close_door():
    global door_open
    if door_open:
        print("Closing door...")
        move_smooth(CLOSED_ANGLE)
        led.value(0)
        door_open = False
        print("Door closed")
    else:
        print("Door already closed")

# ================= ROOF =================
def open_roof():
    global roof_open
    if not roof_open:
        print("Opening roof...")
        roof_servo.duty_u16(ROOF_CCW)   # was ROOF_CW
        time.sleep_ms(ROOF_SPIN_MS)
        roof_servo.duty_u16(ROOF_STOP)
        time.sleep_ms(500)
        roof_open = True
        print("Roof opened")
    else:
        print("Roof already open")

def close_roof():
    global roof_open
    if roof_open:
        print("Closing roof...")
        roof_servo.duty_u16(ROOF_CW)    # was ROOF_CCW
        time.sleep_ms(ROOF_SPIN_MS)
        roof_servo.duty_u16(ROOF_STOP)
        time.sleep_ms(500)
        roof_open = False
        print("Roof closed")
    else:
        print("Roof already closed")

# ================= BUZZER =================
def tone(freq, duration):
    buzzer.freq(freq)
    buzzer.duty(512)
    time.sleep(duration)
    buzzer.duty(0)
    time.sleep(0.05)

def beep_granted():
    tone(523, 0.1)
    tone(659, 0.1)
    tone(784, 0.2)

def beep_denied():
    tone(600, 0.15)
    tone(400, 0.3)

# ================= HMAC =================
def sign_message(message: str) -> str:
    h = HMAC(HMAC_SECRET, message.encode(), hashlib.sha256)
    return ubinascii.hexlify(h.digest()).decode()

# Start door closed
set_angle(CLOSED_ANGLE)

# ================= WIFI =================
print("Connecting to WiFi...", end="")
sta_if = network.WLAN(network.STA_IF)
sta_if.active(True)
sta_if.connect(WIFI_SSID, WIFI_PASSWORD)
while not sta_if.isconnected():
    print(".", end="")
    time.sleep(0.2)
print(" Connected!", sta_if.ifconfig()[0])

# ================= NTP =================
import ntptime
print("Syncing time...", end="")
for attempt in range(5):
    try:
        ntptime.settime()
        print(" OK! Unix time:", time.time())
        break
    except:
        print(".", end="")
        time.sleep(1)
else:
    print(" FAILED")

# ================= MQTT CALLBACK =================
def mqtt_callback(topic, msg):
    topic   = topic.decode()
    command = msg.decode().strip().upper()
    print("MQTT <-", topic, command)

    if topic == "esp32/led":
        if command == "ON":
            beep_granted()
            open_door()
        elif command == "OFF":
            close_door()
            beep_granted()
        elif command == "DENY":
            beep_denied()

    elif topic == "esp32/roof":
        if command in ("OPEN", "ON", "C"):
            open_roof()
        elif command in ("CLOSE", "OFF", "RC"):
            close_roof()

# ================= MQTT =================
def connect_mqtt():
    c = MQTTClient(MQTT_CLIENT_ID, MQTT_BROKER, keepalive=60)
    c.set_callback(mqtt_callback)
    c.connect()
    c.subscribe(MQTT_TOPIC_SUB)
    c.subscribe(MQTT_TOPIC_ROOF)
    print("MQTT Connected")
    return c

print("Connecting to MQTT...")
client = connect_mqtt()
print("System Ready. Scan card...")

# ================= RFID =================
rdr       = MFRC522(sck=22, mosi=21, miso=19, rst=14, cs=23)
last_card = None

show_idle_screen()

# ================= MAIN LOOP =================
last_ui = 0

while True:
    try:
        now = time.ticks_ms()

        # MQTT
        client.check_msg()

        # OLED throttled to every 200ms
        if time.ticks_diff(now, last_ui) > 200:
            show_idle_screen()
            last_ui = now

        # DINO BUTTON
        if dino_button.value() == 0:
            time.sleep(0.05)
            if dino_button.value() == 0:
                print("Launching Dino Game...")
                while dino_button.value() == 0:
                    time.sleep(0.05)
                import dino
                dino.run()
                print("Back in main loop.")
                show_idle_screen()

        # RFID
        stat, _ = rdr.request(rdr.REQIDL)
        if stat == rdr.OK:
            stat, raw_uid = rdr.anticoll()
            if stat == rdr.OK:
                uid = "".join("{:02X}".format(x) for x in raw_uid)
                if uid != last_card:
                    last_card = uid
                    ts      = str(int(time.time()))
                    msg     = "{}|{}".format(uid, ts)
                    sig     = sign_message(msg)
                    payload = "{}|{}".format(msg, sig)
                    print("Card:", payload)
                    client.publish(MQTT_TOPIC_UID, payload.encode())
        else:
            last_card = None

    except OSError as e:
        print("MQTT error, reconnecting...", e)
        time.sleep(2)
        try:
            client = connect_mqtt()
        except Exception as e2:
            print("Reconnect failed:", e2)
            time.sleep(5)

    time.sleep(0.1)