#!/usr/bin/env python3
"""SMN weather by coordinates; locality lookup using Argentina's Georef."""
import json
import math
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode

BASE = "https://www.argentina.gob.ar/meteorologico"
ENDPOINTS = {"current": "temperatura", "forecast": "pronostico", "sun": "puesta-del-sol"}


def fetch(url):
    try:
        response = subprocess.run(
            ["curl", "--disable", "--silent", "--fail", "--proto", "=https", "--max-time", "14",
             "--max-filesize", "524288", "--header", "Accept: application/json", url],
            capture_output=True, check=True, timeout=16)
        data = json.loads(response.stdout)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def search(query):
    parts = query.strip().split(",", 1)
    params = {"nombre": parts[0].strip()[:100], "max": 10}
    if len(parts) > 1 and parts[1].strip():
        params["provincia"] = parts[1].strip()[:100]
    data = fetch("https://apis.datos.gob.ar/georef/api/localidades?" + urlencode(params))
    if data is None or not isinstance(data.get("localidades"), list):
        return {"results": [], "error": "No se pudo consultar el buscador. Probá nuevamente en unos minutos."}
    results, seen = [], set()
    for item in data["localidades"]:
        coord = item.get("centroide") or {}
        lat, lon = coord.get("lat"), coord.get("lon")
        if not all(isinstance(v, (float, int)) and math.isfinite(v) for v in (lat, lon)):
            continue
        name = item.get("nombre", "")
        province = (item.get("provincia") or {}).get("nombre", "")
        department = (item.get("departamento") or {}).get("nombre", "")
        key = (name.casefold(), province, department)
        identifier = str(item.get("id", ""))
        if key in seen or not identifier.isdigit():
            continue
        seen.add(key)
        results.append(dict(id=identifier, name=name, province=province, department=department, lat=lat, lon=lon))
    return {"results": results}


def weather(lat, lon, selection):
    lat, lon = float(lat), float(lon)
    if not math.isfinite(lat) or not math.isfinite(lon) or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("Invalid coordinates")
    def product(item):
        key, endpoint = item
        return key, fetch(f"{BASE}/{endpoint}/{lat}/{lon}")
    with ThreadPoolExecutor(max_workers=3) as executor:
        data = dict(executor.map(product, ENDPOINTS.items()))
    data["selection"] = selection
    return data


if __name__ == "__main__":
    try:
        if len(sys.argv) == 3 and sys.argv[1] == "search":
            result = search(sys.argv[2])
        elif len(sys.argv) == 5 and sys.argv[1] == "weather":
            result = weather(*sys.argv[2:])
        else:
            raise ValueError("Invalid arguments")
        print(json.dumps(result, ensure_ascii=True))
    except (ValueError, TypeError):
        sys.exit(2)
