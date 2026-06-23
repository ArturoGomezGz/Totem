# Sistema de Conectividad — Tanque de Suministro

Responsabilidad: comunicar el ESP32 del tanque de suministro con la Capa 2 via MQTT — reportar nivel de solución disponible y enviar alertas cuando se requiere recarga.

**Protocolo: MQTT con broker Mosquitto** — mismo broker que el Totem Principal. El tanque de suministro se registra como una unidad más en la Capa 2 (misma API, mismo dashboard).

---

## Topics

**Publica:**

| Topic | Contenido | QoS |
|---|---|---|
| `totem/{unit_id}/alerts` | Nivel bajo — requiere recarga humana | 1 |

**Suscrito:**

| Topic | Contenido |
|---|---|
| `totem/{unit_id}/commands` | Comandos desde Capa 2 (por definir) |

---

## Pendientes

🔴 Topics específicos de calidad de solución (pH, EC, temperatura) — por definir si van en el MVP del tanque de suministro.

## Documentos relacionados

- `capa1/totem-principal/sistema-conectividad/sistema-conectividad.md` — sistema equivalente con detalle completo
- `capa2/api-contract.md` — topics MQTT compartidos
