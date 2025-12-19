import { useEffect, useRef, useState } from 'react';
import * as L from 'leaflet';
import type { LayerGroup as LeafletLayerGroup } from 'leaflet';
import type { Feature, Geometry, GeoJsonObject, GeoJsonProperties } from 'geojson';
import 'leaflet/dist/leaflet.css';
import {
  MapContainer, TileLayer, Marker, Popup,
  LayerGroup, LayersControl, ScaleControl, // ZoomControl, 
  Polyline, Circle, GeoJSON, useMap, 
} from 'react-leaflet';
import { Badge, Button, Card, Label, TextInput, type CardTheme, type TextInputTheme } from 'flowbite-react';
import mqtt, { type MqttClient } from 'mqtt';

type Gateway = { id: string; coords: [number, number] };
type AppConfig = {
  zoomLevel?: number;
  mapCenter?: [number, number];
  gateways?: Gateway[];
  mqttUrl?: string;
  mqttTopic?: string;
};

const DEFAULT_ZOOM_LEVEL: number = 13;
const DEFAULT_MAP_CENTER: [number, number] = [48.8566, 2.3522]; // Paris
const DEFAULT_MQTT_URL = 'wss://test.mosquitto.org:8081/mqtt';
const DEFAULT_TOPIC = 'bee_map/#';

const INITIAL_CONNECTION_DELAY = 500;
const MQTT_OPTIONS = {
  protocolVersion: 4 as const,
  clean: true,
  reconnectPeriod: 3000,
  connectTimeout: 5000,
};

const defaultIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const fixedObjectsIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

const oldIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [20, 32],
  iconAnchor: [10, 32],
  className: 'marker-old-icon',
});


L.Marker.prototype.options.icon = defaultIcon;

// type Position = {
//   id: string;
//   name: string;
//   coords: [number, number];
//   receivedAt?: string;
//   receivedAtTs?: number;
//   sourceId?: string;
// };

type Position = {
  id: string;
  // time: string;
  devEui: string;
  // name: string;
  // payloadHex: string;
  // fPort: number;
  // fCntUp: number;
  coords: [number, number];
  // devLat: number;
  // devLon: number;
  // devAlt: number;
  devLocRadius: number;
  // devLocTime: string;
  receivedAt?: string;
  receivedAtTs?: number;
};

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}`;
}

const initialPositions: Position[] = [
//   {
//     id: 'init-1',
//     name: 'Marker A',
//     coords: [47.4979, 19.0402],
//     receivedAtTs: Date.now(),
//     receivedAt: formatTimestamp(Date.now()),
//     sourceId: 'init-1',
//   },
//   {
//     id: 'init-2',
//     name: 'Marker B',
//     coords: [47.5, 19.06],
//     receivedAtTs: Date.now() + 1,
//     receivedAt: formatTimestamp(Date.now() + 1),
//     sourceId: 'init-2',
//   },
];

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const compactTextInputTheme: DeepPartial<TextInputTheme> = {
  field: {
    input: {
      sizes: {
        sm: 'px-2 py-1.5 text-xs',
      },
    },
  },
};

const compactCardTheme: DeepPartial<CardTheme> = {
  root: {
    children: 'flex h-full flex-col justify-center gap-2 p-2',
  },
};

function ZoomLevelUpdater({ level }: { level: number }) {
  const map = useMap();
  useEffect(() => {
    map.setZoom(level);
  }, [level, map]);
  return null;
}

function MapCenterUpdater({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center);
  }, [center, map]);
  return null;
}

function MapRefSetter({ onReady }: { onReady: (map: L.Map) => void }) {
  const map = useMap();
  useEffect(() => {
    onReady(map);
  }, [map, onReady]);
  return null;
}

export function MapView() {
  const [markers, setMarkers] = useState<Position[]>(initialPositions);
  const [zoomLevel, setZoomLevel] = useState<number>(DEFAULT_ZOOM_LEVEL);
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_MAP_CENTER);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const [historyVisible, setHistoryVisible] = useState<boolean>(true);
  const [latestVisible, setLatestVisible] = useState<boolean>(false);
  const [fixedObjects, setFixedObjects] = useState<GeoJsonObject | null>(null);
  const [fixedObjectsError, setFixedObjectsError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('connecting');
  const [lastError, setLastError] = useState<string | null>(null);
  const [topic, setTopic] = useState<string>(DEFAULT_TOPIC);
  const [brokerUrl, setBrokerUrl] = useState<string>(DEFAULT_MQTT_URL);
  const mapRef = useRef<L.Map | null>(null);
  const historyLayerRef = useRef<LeafletLayerGroup | null>(null);
  const latestLayerRef = useRef<LeafletLayerGroup | null>(null);
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const activeRef = useRef<boolean>(true);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef<boolean>(true);
  const initialConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSubscribedTopicRef = useRef<string>(DEFAULT_TOPIC);
  const connectRef = useRef<(() => void) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const cancelConnectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';
    const configUrl = new URL('config.json', window.location.origin + base).toString();
    fetch(configUrl)
      .then(resp => {
        if (!resp.ok) {
          throw new Error(`Failed to load config (${resp.status})`);
        }
        return resp.json() as Promise<AppConfig>;
      })
      .then(config => {
        if (cancelled || !config) return;

        if (typeof config.mqttUrl === 'string' && config.mqttUrl.trim().length > 0) {
          setBrokerUrl(config.mqttUrl);
        }
        if (typeof config.mqttTopic === 'string' && config.mqttTopic.trim().length > 0) {
          setTopic(config.mqttTopic);
          lastSubscribedTopicRef.current = config.mqttTopic;
        }
        if (typeof config.zoomLevel === 'number' && config.zoomLevel > 0) {
          setZoomLevel(config.zoomLevel);
        }
        if (Array.isArray(config.mapCenter) && config.mapCenter.length === 2) {
          const [lat, lon] = config.mapCenter;
          if (typeof lat === 'number' && typeof lon === 'number') {
            setMapCenter([lat, lon]);
          }
        }
      })
      .catch(err => {
        console.error('Config load error', err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.BASE_URL || '/';
    const geoUrl = new URL('fixed_objects.geojson', window.location.origin + base).toString();
    fetch(geoUrl)
      .then(resp => {
        if (!resp.ok) throw new Error(`Failed to load fixed_objects.geojson (${resp.status})`);
        return resp.json() as Promise<GeoJsonObject>;
      })
      .then(data => {
        if (cancelled) return;
        setFixedObjects(data);
        setFixedObjectsError(null);
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Fixed objects load error', err);
        setFixedObjectsError(err?.message ?? 'Failed to load fixed_objects.geojson');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    activeRef.current = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const disconnectClient = (reason: string) => {
      clearReconnectTimer();
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        client.end(true);
      }
      setStatus(reason);
    };

    const connectToEndpoint = () => {
      if (!activeRef.current) return;
      setStatus('connecting');
      setLastError(null);

      if (clientRef.current) {
        clientRef.current.end(true);
        clientRef.current = null;
      }

      const client = mqtt.connect(brokerUrl, MQTT_OPTIONS);
      clientRef.current = client;

      client.on('connect', () => {
        setStatus('connected');
        client.subscribe(topic, { qos: 0 }, err => {
          if (err) {
            console.error('MQTT subscribe error', err);
            setStatus('subscribe error');
          } else {
            lastSubscribedTopicRef.current = topic;
          }
        });
      });

      client.on('message', (_topic, payload) => {
        try {
          const message = JSON.parse(payload.toString());
          const msg = message.DevEUI_location 
            ? message.DevEUI_location
            : message.DevEUI_uplink;

          // console.log(msg);
          
          if (typeof msg == 'undefined') {
            return;
          }
          if (typeof msg.DevLAT !== 'number' || typeof msg.DevLON !== 'number') {
            console.warn('MQTT message missing numeric lat/lng', msg);
            return;
          }

          const receivedAtTs = Date.now();
          const receivedAt = formatTimestamp(receivedAtTs);
          const marker: Position = {
            id: `${msg.devEui}-${receivedAtTs}`,
            // time: msg.Time,                         // Always included in UL
            devEui: msg.DevEUI,                     // Always included in UL
            // name: msg.CustomerData?.name,           // Optionally included in UL
            // payloadHex: msg.payloadHex,             // Optionally included in UL
            // fPort: msg.FPort,                       // Optionally included in UL
            // fCntUp: msg.FCntUp,                     // Always included in UL
            coords: [msg.DevLAT, msg.DevLON],       // Always included in UL
            // devLat: msg.DevLat,
            // devLon: msg.DevLon,
            // devAlt: msg.DevAlt,
            devLocRadius: msg.DevLocRadius,         // Always included DevEUI_location, optionally in DevEUI_uplink
            // devLocTime: msg.DevLocTime,             // Optionally included in DevEUI_location, always in DevEUI_uplink
            receivedAt,
            receivedAtTs,
          };

          setMarkers(prev => [...prev, marker]);

        } catch (err) {
          console.error('MQTT message parse error', err);
        }
      });

      client.on('error', err => {
        setStatus('error');
        setLastError(err?.message ?? String(err));
        console.error('MQTT client error', err);
      });

      client.on('close', () => {
        setStatus('disconnected');
        if (activeRef.current && shouldReconnectRef.current && !reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connectToEndpoint();
          }, 1500);
        }
      });
    };

    connectRef.current = () => {
      shouldReconnectRef.current = true;
      setStatus('connecting');
      connectToEndpoint();
    };

    disconnectRef.current = () => {
      shouldReconnectRef.current = false;
      disconnectClient('disconnected (manual)');
    };

    cancelConnectRef.current = () => {
      shouldReconnectRef.current = false;
      disconnectClient('disconnected (cancelled)');
    };

    // initial delayed connect
    initialConnectTimerRef.current = setTimeout(() => {
      if (activeRef.current && shouldReconnectRef.current) {
        connectRef.current?.();
      }
    }, INITIAL_CONNECTION_DELAY);
  }, [brokerUrl, topic]);

  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (initialConnectTimerRef.current) {
        clearTimeout(initialConnectTimerRef.current);
        initialConnectTimerRef.current = null;
      }
      const client = clientRef.current;
      clientRef.current = null;
      if (client) {
        client.end(true);
      }
    };
  }, []);

  const sortedMarkers = [...markers].sort((a, b) => {
    if (a.receivedAtTs === undefined) return -1;
    if (b.receivedAtTs === undefined) return 1;
    return a.receivedAtTs - b.receivedAtTs;
  });

  const segments: [number, number][][] = [];
  for (let i = 1; i < sortedMarkers.length; i += 1) {
    const prev = sortedMarkers[i - 1];
    const curr = sortedMarkers[i];
    segments.push([prev.coords, curr.coords]);
  }
  const latestMarker = sortedMarkers[sortedMarkers.length - 1];
  const latestId = latestMarker?.id;
  const circlePathOptions = { color: '#2563eb', weight: 1, fillColor: '#60a5fa', fillOpacity: 0.25 };
  const onEachFixedObjectFeature = (feature: Feature<Geometry, GeoJsonProperties>, layer: L.Layer) => {
    const props = feature.properties as Record<string, unknown> | null;
    const name = typeof props?.name === 'string' ? props.name : null;
    if (name && name.trim().length > 0) {
      layer.bindPopup(name);
    }
  };
  const pointToLayerFixedObject = (_feature: Feature<Geometry, GeoJsonProperties>, latlng: L.LatLng) => {
    return L.marker(latlng, { icon: fixedObjectsIcon });
  };

  // Resubscribe when topic changes and client is connected
  useEffect(() => {
    const client = clientRef.current;
    if (!client || !client.connected) return;
    const prevTopic = lastSubscribedTopicRef.current;
    if (prevTopic === topic) return;
    client.unsubscribe(prevTopic, () => {
      client.subscribe(topic, { qos: 0 }, err => {
        if (err) {
          setLastError(err?.message ?? String(err));
          setStatus('subscribe error');
        } else {
          lastSubscribedTopicRef.current = topic;
          setLastError(null);
        }
      });
    });
  }, [topic]);

  useEffect(() => {
    const el = controlsRef.current;
    const map = mapRef.current;
    if (!el || !map) return;

    // Prevent map from reacting to scroll/clicks while interacting with controls
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);

    const handleWheel = (e: WheelEvent) => {
      e.stopPropagation();
    };
    const handleEnter = () => {
      map.dragging.disable();
      map.scrollWheelZoom.disable();
    };
    const handleLeave = () => {
      map.dragging.enable();
      map.scrollWheelZoom.enable();
    };

    el.addEventListener('wheel', handleWheel);
    el.addEventListener('mouseenter', handleEnter);
    el.addEventListener('mouseleave', handleLeave);
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('mouseenter', handleEnter);
      el.removeEventListener('mouseleave', handleLeave);
      handleLeave();
    };
  }, []);

  useEffect(() => {
    const map = mapInstance;
    if (!map) return;

    const handleOverlayAdd = (e: L.LayersControlEvent) => {
      if (e.layer === historyLayerRef.current) setHistoryVisible(true);
      if (e.layer === latestLayerRef.current) setLatestVisible(true);
    };
    const handleOverlayRemove = (e: L.LayersControlEvent) => {
      if (e.layer === historyLayerRef.current) setHistoryVisible(false);
      if (e.layer === latestLayerRef.current) setLatestVisible(false);
    };

    map.on('overlayadd', handleOverlayAdd);
    map.on('overlayremove', handleOverlayRemove);

    return () => {
      map.off('overlayadd', handleOverlayAdd);
      map.off('overlayremove', handleOverlayRemove);
    };
  }, [mapInstance]);

  return (
    <MapContainer
      center={mapCenter}
      zoom={zoomLevel}
      style={{ height: '100vh', width: '100%' }}
      zoomControl={false}
    >
      <MapCenterUpdater center={mapCenter} />
      <ZoomLevelUpdater level={zoomLevel} />
      <MapRefSetter
        onReady={map => {
          mapRef.current = map;
          setMapInstance(map);
        }}
      />
      <ScaleControl position="bottomright" />
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Streets">
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite">
          <TileLayer
            attribution="Tiles &copy; Esri &mdash; Source: Esri, Earthstar Geographics, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
        </LayersControl.BaseLayer>
        <LayersControl.Overlay checked name="Fixed objects">
          <LayerGroup>
            {fixedObjects ? (
              <GeoJSON
                key="fixed-objects"
                data={fixedObjects}
                onEachFeature={onEachFixedObjectFeature}
                pointToLayer={pointToLayerFixedObject}
                style={() => ({ color: '#374151', weight: 2, fillColor: '#374151', fillOpacity: 0.2 })}
              />
            ) : null}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay name="Latest location">
          <LayerGroup ref={latestLayerRef}>
            {sortedMarkers.length > 0 ? (
              <Marker
                key={`latest-${sortedMarkers[sortedMarkers.length - 1].id}`}
                position={sortedMarkers[sortedMarkers.length - 1].coords}
                icon={defaultIcon}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong>{sortedMarkers[sortedMarkers.length - 1].devEui} (latest)</strong>
                    <br />
                    {sortedMarkers[sortedMarkers.length - 1].coords[0].toFixed(5)},{' '}
                    {sortedMarkers[sortedMarkers.length - 1].coords[1].toFixed(5)}
                    <br />
                    Received: {sortedMarkers[sortedMarkers.length - 1].receivedAt ?? 'n/a'}
                  </div>
                </Popup>
              </Marker>
            ) : null}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="History (markers)">
          <LayerGroup ref={historyLayerRef}>
            {markers.map(p => (
              <Marker
                key={p.id}
                position={p.coords}
                icon={p.id === latestId ? defaultIcon : oldIcon}
              >
                <Popup>
                  <div style={{ minWidth: 160 }}>
                    <strong>{p.devEui}</strong>
                    <br />
                    {p.coords[0].toFixed(5)}, {p.coords[1].toFixed(5)}
                    <br />
                    {p.receivedAt ?? 'n/a'}
                  </div>
                </Popup>
              </Marker>
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="History (lines)">
          <LayerGroup>
            {segments.map((segment, idx) => (
              <Polyline key={`seg-${idx}`} positions={segment} color="#f05454" weight={3} />
            ))}
          </LayerGroup>
        </LayersControl.Overlay>
        <LayersControl.Overlay checked name="Accuracy radius">
          <LayerGroup>
            {latestVisible && sortedMarkers.length > 0 && typeof latestMarker?.devLocRadius === 'number' ? (
              <Circle
                key={`latest-circle-${latestMarker.id}`}
                center={latestMarker.coords}
                radius={latestMarker.devLocRadius}
                pathOptions={circlePathOptions}
              />
            ) : null}
            {historyVisible
              ? markers
                  .filter(p => typeof p.devLocRadius === 'number')
                  .map(p => (
                    <Circle
                      key={`circle-${p.id}`}
                      center={p.coords}
                      radius={p.devLocRadius}
                      pathOptions={circlePathOptions}
                    />
                  ))
              : null}
          </LayerGroup>
        </LayersControl.Overlay>

      </LayersControl>
      {/* <ZoomControl position="topright" /> */}
      <div
        ref={controlsRef}
        className="absolute z-[1000]"
        style={{ top: '12px', left: '16px', width: '15rem', maxWidth: '260px' }}
      >
        <Card className="p-1" theme={compactCardTheme}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-800">MQTT</span>
            <Badge color={status === 'connected' ? 'success' : status.includes('error') ? 'failure' : 'warning'}>
              {status}
            </Badge>
          </div>
          <div className="space-y-1 text-sm">
            <div className="space-y-1">
              <Label htmlFor="broker-url" className="text-xs font-medium text-gray-700">
                Broker URL
              </Label>
              <TextInput
                id="broker-url"
                sizing="sm"
                theme={compactTextInputTheme}
                value={brokerUrl}
                onChange={e => setBrokerUrl(e.target.value)}
                disabled={status === 'connected' || status === 'connecting'}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="topic" className="text-xs font-medium text-gray-700">
                Topic
              </Label>
              <TextInput
                id="topic"
                sizing="sm"
                theme={compactTextInputTheme}
                value={topic}
                onChange={e => setTopic(e.target.value)}
                disabled={status === 'connected' || status === 'connecting'}
              />
            </div>
            {lastError ? <div className="text-xs text-red-600">Last error: {lastError}</div> : null}
            {fixedObjectsError ? (
              <div className="text-xs text-red-600">Fixed objects: {fixedObjectsError}</div>
            ) : null}
            <div className="flex gap-2 mt-2">
              {status === 'connected' ? (
                <Button size="xs" onClick={() => disconnectRef.current?.()} color="light" className="w-full">
                  Disconnect
                </Button>
              ) : status === 'connecting' ? (
                <Button size="xs" onClick={() => cancelConnectRef.current?.()} color="light" className="w-full">
                  Cancel
                </Button>
              ) : (
                <Button size="xs" onClick={() => connectRef.current?.()} color="light" className="w-full">
                  Connect
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </MapContainer>
  );
}
