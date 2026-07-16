// Paleta categórica para series por UNIDAD en la vista general.
//
// El color de sensor (SENSORS en utils/sensors.js) codifica "qué se mide"; aquí el
// color codifica "de qué totem viene". No hay conflicto porque la gráfica general
// muestra un solo sensor a la vez: dentro de ella el color solo distingue unidad.
//
// Orden derivado, no elegido a ojo: se enumeraron las permutaciones de los hues
// del DS (más magenta, que cubre el hueco que dejan ámbar y rojo — reservados a
// estados y prohibidos como serie) y se tomó la que maximiza el ΔE adyacente
// mínimo bajo deuteranopia/protanopia. Resultado: ΔE 13.9 (objetivo ≥ 8) y piso
// de visión normal 15.8, en modo claro y oscuro. No reordenar ni sustituir un hex
// sin volver a validar — el orden ES el mecanismo de seguridad para daltonismo.
const SERIES_COLORS = [
  '#0077AA', // blue-700 (DS)
  '#00A99D', // teal-500 (DS)
  '#7C5CBF', // morado — el mismo que el DS ya usa para CO₂
  '#6fa733', // lime-600 (DS)
  '#C2528B', // magenta
]

// Tope de series simultáneas = tamaño de la paleta. Un 6º totem no recibe un hue
// inventado: la regla es asignar en orden fijo y nunca ciclar, porque dos unidades
// del mismo color mienten sobre la identidad de la línea.
export const MAX_SERIES = SERIES_COLORS.length

// Asigna el primer slot libre respetando los colores ya entregados. Se asigna por
// ENTIDAD, no por posición en la selección: si el usuario quita una unidad, las
// que quedan conservan su color en vez de repintarse en cascada.
export function assignColor(assigned, unitId) {
  if (assigned[unitId]) return assigned
  const taken = new Set(Object.values(assigned))
  const free = SERIES_COLORS.find(c => !taken.has(c))
  if (!free) return assigned
  return { ...assigned, [unitId]: free }
}

export function releaseColor(assigned, unitId) {
  const { [unitId]: _, ...rest } = assigned
  return rest
}
