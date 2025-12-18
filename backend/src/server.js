import express from 'express';
import dotenv from 'dotenv';
import mqtt from 'mqtt';


dotenv.config();
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://test.mosquitto.org:1883';
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC ?? 'bee_map';
const HTTP_PORT = Number(process.env.HTTP_PORT ?? 4000);


const app = express();
app.use(express.json({ limit: '1mb' }));

const client = mqtt.connect(MQTT_URL, {
  protocolVersion: 5,
  reconnectPeriod: 3000,
  connectTimeout: 5000,
});

client.on('connect', () => {
  console.log(`[mqtt] connected to ${MQTT_URL}`);
});

client.on('reconnect', () => {
  console.log('[mqtt] reconnecting…');
});

client.on('error', err => {
  console.error('[mqtt] error', err.message);
});

app.post('/ingest', (req, res) => {
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }

  const payload = req.body;
  if (!payload) {
    return res.status(400).json({ error: 'Missing JSON body' });
  }

  const msg = payload.DevEUI_location 
    ? payload.DevEUI_location
    : payload.DevEUI_uplink;
  
  if (typeof msg == 'undefined') {
    return res.json({ ok: true, published: false, reason: 'missing DevEUI_uplink or DevEUI_location data' });
  }
  if (typeof msg.DevEUI == 'undefined') {
    return res.status(400).json({ ok: false, published: false, reason: 'missing DevEUI in DevEUI_uplink or DevEUI_location' });
  }

  const topic = `${MQTT_TOPIC_PREFIX}/${msg.DevEUI}`;
  const message = JSON.stringify(payload);

  client.publish(topic , message, { qos: 0 }, err => {
    if (err) {
      console.error('[mqtt] publish error', err);
      return res.status(500).json({ error: 'Failed to publish to MQTT' });
    }
    res.json({ ok: true });
  });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(HTTP_PORT, () => {
  console.log(`[http] listening on port ${HTTP_PORT}`);
  console.log(`[http] POST JSON to /ingest -> publishes to ${MQTT_TOPIC_PREFIX}`);
});
