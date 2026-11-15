# Clima SMN para Cinnamon

Widget de escritorio (desklet) para consultar el clima de localidades argentinas,
con estética de vidrio, colores configurables e iconos animados.

Por Leandro Liwko · Liwko Design. Proyecto independiente, sin afiliación al SMN.

## Funciones

- Búsqueda de localidad y provincia mediante Georef, con selección de coincidencias.
- Temperatura, humedad, viento, sensación térmica, presión y visibilidad, según disponibilidad.
- Salida y puesta del sol.
- Pronóstico de los próximos tres días y detalle por franja horaria.
- Actualización cada 15 minutos y actualización manual.
- Caché independiente por localidad, con indicación de datos demorados.
- Color y transparencia configurables; animaciones opcionales.

## Requisitos y compatibilidad

Cinnamon, Python 3 y curl; conexión a Internet para consultar datos.
Probado por el autor en Linux Mint con Cinnamon y sesión X11. No probado en otros
escritorios ni en Wayland. El desenfoque depende del soporte del entorno y no está
garantizado. Las tipografías SF Pro e Inter son opcionales y no están incluidas.

## Instalar

1. En GitHub, pulsá **Code → Download ZIP** y extraé el archivo del proyecto.
2. Abrí una terminal dentro de la carpeta extraída y ejecutá:

```bash
bash instalar.sh
```

No uses sudo para el instalador. Instala únicamente en tu cuenta y respalda una
versión anterior en `~/.local/share/mint-widgets-respaldos/`.

3. En Cinnamon X11, presioná Alt+F2, escribí `r` y pulsá Enter. También podés cerrar
la sesión y volver a entrar.
4. Si es la primera instalación: Configuración del sistema → Desklets → Administrar
→ **Mint Widgets — Clima SMN** → añadir.

## Elegir localidad

Clic derecho en el widget → Configurar → Localidad → Buscar localidad.
Escribí, por ejemplo, `Mar del Plata` o `Córdoba, Córdoba`.
Las coincidencias aparecen **en el widget**: hacé clic en la opción correcta.
Hasta elegir un resultado se conserva la localidad anterior. La selección queda
guardada. El botón Buscar nuevamente permite repetir la consulta.

## Fuentes y límites

- [Servicio Meteorológico Nacional](https://www.argentina.gob.ar/smn): observación y pronóstico mediante los servicios públicos que utiliza el portal.
- [Georef](https://www.argentina.gob.ar/georef): búsqueda de localidades y coordenadas.
- Los horarios solares provienen del servicio publicado por el portal meteorológico.

El servicio meteorológico puede devolver un punto cercano a la localidad elegida:
no todas las localidades tienen una estación propia. Los campos sin datos se
muestran con un guion. La observación y la emisión del pronóstico tienen sus
propios horarios, independientes de la frecuencia de consulta del widget.
Los servicios externos pueden cambiar o estar temporalmente indisponibles.

Las consultas envían a Georef el nombre buscado y al portal meteorológico las
coordenadas seleccionadas. No requiere claves de API. Guarda configuración y
caché localmente. No incluye analítica propia.

## Problemas

Al informar un error, indicá versión de Mint/Cinnamon, localidad y pasos para
reproducirlo. Adjuntá únicamente las líneas relevantes del registro y revisá que
no contengan información privada. No se necesitan registros completos.

Para desactivarlo: clic derecho → Eliminar este desklet. Para desinstalar los
archivos, después de quitarlo, borrá la carpeta
`~/.local/share/cinnamon/desklets/mint-weather@liwko/`.

## Licencia

Código y recursos propios bajo licencia MIT; ver LICENSE. Los servicios y datos
externos conservan sus condiciones respectivas. Las marcas de terceros no forman
parte de esta licencia.
