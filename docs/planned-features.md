# Features planificadas

Funcionalidades identificadas como valiosas que quedan fuera del alcance del MVP. No son requerimientos formales — no tienen número de FR. Cuando llegue el momento de implementar alguna, se formaliza en `docs/requirements.md` con sus FR correspondientes.

---

## Bot bidireccional de Telegram

El bot del MVP solo envía notificaciones pasivas. Una iteración futura añadiría comandos desde el chat: consultar el estado actual de cada unidad, forzar encendido/apagado de la bomba, cambiar el perfil de cultivo activo, ver las últimas lecturas de sensores. Esto convertiría el bot en una interfaz alternativa al dashboard — especialmente útil cuando el dashboard no es accesible fuera de la red local.

## Estrategia de versionamiento del firmware

A medida que el sistema escale a múltiples unidades en campo con distintas versiones de firmware instaladas, será necesario definir cómo el backend gestiona la compatibilidad: qué versiones de firmware son compatibles con qué versiones de la API, cómo se comunican los cambios de contrato, y hasta dónde atrás se mantiene compatibilidad. No urgente en el MVP, crítico cuando haya unidades en campo que no se pueden actualizar simultáneamente.

## App móvil nativa

Si la combinación de dashboard web responsive y bot de Telegram resultara insuficiente para el uso móvil, una app nativa permitiría notificaciones push nativas y una experiencia más fluida en celular. Dado que el frontend ya es React, React Native sería la opción natural por la familiaridad compartida y la reutilización de lógica de negocio.

## Sistema de Abastecimiento por Gravedad

Tanque padre elevado físicamente sobre el Totem que abastece agua por gravedad — sin bomba en el tanque padre. El Totem controla su propia entrada mediante la válvula NC ya implementada. Compatible con la Capa 1 sin cambios de código — la integración física es una manguera. Ver `docs/gravity-feed.md` para el diseño completo.
