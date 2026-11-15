#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/mint-weather@liwko"
target_dir="$HOME/.local/share/cinnamon/desklets/mint-weather@liwko"
for tool in python3 curl; do command -v "$tool" >/dev/null || { echo "Falta instalar $tool"; exit 1; }; done
if [ -d "$target_dir" ]; then
    backup_dir="$HOME/.local/share/mint-widgets-respaldos/mint-weather-$(date +%Y%m%d-%H%M%S)-$$"
    mkdir -p "$(dirname "$backup_dir")"
    cp -a "$target_dir" "$backup_dir"
    echo "Respaldo: $backup_dir"
fi
mkdir -p "$target_dir"
cp "$source_dir/desklet.js" "$source_dir/settings-schema.json" "$source_dir/smn.py" "$source_dir/stylesheet.css" "$source_dir/metadata.json" "$source_dir/icon.png" "$target_dir/"
echo 'Instalado. Reiniciá Cinnamon con Alt+F2, r, Enter (sesión X11).'
echo 'Después: clic derecho en el widget → Configurar → Localidad.'
