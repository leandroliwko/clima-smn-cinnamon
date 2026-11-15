"use strict";

const { Clutter, Gdk, Gio, GLib, St } = imports.gi;
const ByteArray = imports.byteArray;
const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;
const Mainloop = imports.mainloop;
const Cairo = imports.cairo;
const Pango = imports.gi.Pango;

function label(text, styleClass) {
    return new St.Label({text, style_class: styleClass, y_align: St.Align.MIDDLE});
}

function icon(name, size = 16) {
    return new St.Icon({icon_name: name, icon_type: St.IconType.SYMBOLIC, icon_size: size});
}

function parseTint(value) {
    const tint = new Gdk.RGBA();
    if (typeof value !== "string" || !tint.parse(value.trim())) tint.parse("#249e96");
    return [tint.red, tint.green, tint.blue].map(channel => Math.round(255 * channel));
}

function mix(from, to, amount) {
    return from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount));
}

function rgba(channels, alpha) {
    return `rgba(${channels.join(", ")}, ${alpha.toFixed(2)})`;
}

function glassStyle(tint, transparency, blur) {
    const color = parseTint(tint);
    const amount = Number.isFinite(transparency) ? Math.min(95, Math.max(0, transparency)) : 55;
    const alpha = 1 - amount / 100;
    const top = mix([16, 21, 31], color, 0.81);
    const bottom = mix([9, 14, 23], color, 0.58);
    const rim = mix(color, [255, 255, 255], 0.36);
    const accent = mix(color, [255, 255, 255], 0.57);

    return {
        card: `background-gradient-direction: vertical; ` +
            `background-gradient-start: ${rgba(top, alpha)}; ` +
            `background-gradient-end: ${rgba(bottom, alpha)}; ` +
            `border-top-color: ${rgba(rim, 0.82)}; border-left-color: ${rgba(rim, 0.57)}; ` +
            `border-right-color: ${rgba(rim, 0.39)}; border-bottom-color: ${rgba(rim, 0.34)}; ` +
            `background-blur: ${blur && alpha < 1 ? 8 : 0}px;`,
        accent: rgba(accent, 1)
    };
}

const SITE_URL = "https://www.argentina.gob.ar/smn";
const ZONE = "America/Argentina/Buenos_Aires";
const REFRESH_SECONDS = 900;
const DEFAULT_LOCATION = {id: "pinamar", name: "Pinamar", province: "Buenos Aires", lat: -37.1146, lon: -56.8685};
const GESELL_ID = 87663;
const SECTIONS = [
    ["early_morning", "Madrugada"], ["morning", "Mañana"], ["afternoon", "Tarde"], ["night", "Noche"]
];
const DAY_NAME = new Intl.DateTimeFormat("es-AR", {timeZone: "UTC", weekday: "short"});
const LOCAL_HOUR = new Intl.DateTimeFormat("es-AR", {timeZone: ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23"});
const NUM = new Intl.NumberFormat("es-AR", {maximumFractionDigits: 1});
const PINAMAR_DAY = new Intl.DateTimeFormat("en-CA", {timeZone: ZONE, day: "2-digit", month: "2-digit", year: "numeric"});

function shortDay(date) {
    const day = DAY_NAME.format(new Date(date + "T12:00:00Z")).replace(/\.$/, "");
    return day.charAt(0).toUpperCase() + day.slice(1);
}

function localDay(now) {
    const parts = Object.fromEntries(PINAMAR_DAY.formatToParts(now).map(field => [field.type, field.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function dayAfter(date, amount) {
    const day = new Date(date + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() + amount);
    return day.toISOString().slice(0, 10);
}

function displayNumber(value, unit = "") {
    return Number.isFinite(value) ? NUM.format(value) + unit : "—";
}

function text(value) {
    return typeof value === "string" ? value.trim().slice(0, 90) : "";
}

function temp(value) {
    return displayNumber(value, "°");
}

function numericRange(values, unit) {
    if (!Array.isArray(values) || values.length !== 2 || !values.every(Number.isFinite)) return "—";
    return values[0] === values[1] ? displayNumber(values[0], unit) :
        `${NUM.format(values[0])}–${NUM.format(values[1])}${unit}`;
}

function weatherType(weather, night = false) {
    const words = text(weather?.description).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/torment|granizo|tronad/.test(words)) return "storm";
    if (/nieve|nevadas|aguanieve/.test(words)) return "snow";
    if (/lluv|llov|chaparr|precipit/.test(words)) return "rain";
    if (/niebla|neblina|bruma|humo|polvo/.test(words)) return "fog";
    if (/ventoso|vientos fuertes/.test(words)) return "wind";
    if (/algo nubl|parcial|poco nubl/.test(words)) return night ? "partlyNight" : "partly";
    if (/nubl|cubierto/.test(words)) return "cloud";
    if (/despejad|solead|claro/.test(words)) return night ? "moon" : "sun";
    return "unknown";
}

function model(previous, fresh, now, selection) {
    const data = previous?.selection === selection ? {...previous} : {selection};
    if (fresh?.selection !== selection) return data;
    if (fresh?.current?.location?.id != null &&
        Number.isFinite(Date.parse(fresh.current.date)) &&
        [fresh.current.temperature, fresh.current.humidity, fresh.current.wind?.speed].some(Number.isFinite) &&
        (!data.current || Date.parse(fresh.current.date) >= Date.parse(data.current.date))) {
        data.current = fresh.current;
    }
    if (fresh?.forecast?.location?.id != null && Number.isFinite(Date.parse(fresh.forecast.updated)) &&
        Array.isArray(fresh.forecast.forecast) && fresh.forecast.forecast.some(day => /^\d{4}-\d{2}-\d{2}$/.test(day?.date ?? "") && day.date >= localDay(now)) &&
        (!data.forecast || Date.parse(fresh.forecast.updated) >= Date.parse(data.forecast.updated))) {
        data.forecast = fresh.forecast;
    }
    if (localDay(now) === fresh?.sun?.results?.sunrise?.slice?.(0, 10) &&
        Number.isFinite(Date.parse(fresh.sun.results.sunrise)) && Number.isFinite(Date.parse(fresh.sun.results.sunset))) {
        data.sun = fresh.sun;
    }
    return data;
}

function daily(data, now) {
    const today = localDay(now);
    const items = data.forecast?.forecast ?? [];
    const find = date => items.find(item => item?.date === date) ?? {date};
    return {today: find(today), tomorrow: [1, 2, 3].map(offset => find(dayAfter(today, offset)))};
}

function daySummary(day) {
    const periods = SECTIONS.map(([key]) => day[key]).filter(Boolean);
    const weather = day.afternoon?.weather ?? day.morning?.weather ?? day.night?.weather ?? day.early_morning?.weather;
    const chances = periods.map(period => period.rain_prob_range?.[1]).filter(Number.isFinite);
    return {weather, rain: chances.length ? Math.max(...chances) : null};
}

function ageHours(date, now) {
    return Math.max(0, (now.getTime() - Date.parse(date)) / 3600000);
}

function timeStamp(date, now) {
    if (!Number.isFinite(Date.parse(date))) return "—";
    const moment = new Date(date);
    const time = LOCAL_HOUR.format(moment);
    return localDay(now) === localDay(moment) ? time :
        `${localDay(moment).slice(8, 10)}/${localDay(moment).slice(5, 7)} · ${time}`;
}

function flow(vertical, style_class = "") {
    return new St.BoxLayout({vertical, style_class});
}

function add(parent, ...children) {
    for (const child of children) parent.add_child(child);
}

function expanded(actor) {
    actor.x_expand = true;
    return actor;
}

function wrapLabel(value, style) {
    const actor = label(value, style);
    actor.clutter_text.line_wrap = true;
    actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    return actor;
}

function action(content, tooltip, fn, style_class) {
    const button = new St.Button({child: content, accessible_name: tooltip, style_class, can_focus: true});
    button.connect("clicked", fn);
    return button;
}

function sourceLink(url) {
    try {
        Gio.AppInfo.launch_default_for_uri(url, null);
    } catch (error) {
        logError(error);
    }
}

function paintWeather(cr, type, time) {
    const tau = 2 * Math.PI;
    const phase = time * 1.7;
    const bob = Math.sin(phase) * 2;
    function color(r, g, b, alpha = 1) {
        cr.setSourceRGBA(r, g, b, alpha);
    }
    function disc(x, y, radius) {
        cr.newSubPath();
        cr.arc(x, y, radius, 0, tau);
    }
    function line(x, y, endX, endY) {
        cr.moveTo(x, y);
        cr.lineTo(endX, endY);
    }
    function glow(x, y, palette) {
        const halo = new Cairo.RadialGradient(x, y, 4, x, y, 34);
        halo.addColorStopRGBA(0, ...palette, 0.34);
        halo.addColorStopRGBA(1, ...palette, 0);
        cr.setSource(halo);
        disc(x, y, 34);
        cr.fill();
    }
    function sun(x, y, size) {
        glow(x, y, [1, 0.63, 0.17]);
        color(1, 0.77, 0.34);
        cr.setLineWidth(2.2);
        for (let i = 0; i < 9; i++) {
            const angle = i * tau / 9 + time * 0.27;
            const dx = Math.cos(angle), dy = Math.sin(angle);
            line(x + dx * (size + 5), y + dy * (size + 5), x + dx * (size + 10), y + dy * (size + 10));
        }
        cr.stroke();
        const glass = new Cairo.LinearGradient(x, y - size, x, y + size);
        glass.addColorStopRGB(0, 1, 0.95, 0.63);
        glass.addColorStopRGB(1, 1, 0.64, 0.25);
        cr.setSource(glass);
        disc(x, y, size);
        cr.fill();
    }
    function moon(x, y, size) {
        glow(x, y, [0.52, 0.67, 1]);
        color(0.79, 0.88, 1);
        cr.save();
        cr.setFillRule(Cairo.FillRule.EVEN_ODD);
        disc(x, y, size);
        cr.clip();
        disc(x, y, size);
        disc(x + size * 0.42, y - size * 0.31, size * 0.85);
        cr.fill();
        cr.restore();
        for (const [sx, sy, opacity] of [[66, 25, 0.7], [69, 41, 0.85], [56, 15, 0.6]]) {
            color(0.88, 0.97, 1, opacity + 0.12 * Math.cos(phase + sx));
            disc(sx, sy, 1.3);
            cr.fill();
        }
    }
    function cloud(x, y, shaded) {
        const glass = new Cairo.LinearGradient(x, y - 20, x, y + 15);
        glass.addColorStopRGBA(0, 0.94, 0.98, 1, 1);
        if (shaded) glass.addColorStopRGBA(1, 0.46, 0.67, 0.85, 1);
        else glass.addColorStopRGBA(1, 0.69, 0.86, 0.93, 1);
        cr.setSource(glass);
        cr.moveTo(x - 21, y + 11);
        cr.curveTo(x - 36, y + 11, x - 36, y - 7, x - 20, y - 8);
        cr.curveTo(x - 15, y - 26, x + 9, y - 27, x + 15, y - 10);
        cr.curveTo(x + 33, y - 12, x + 35, y + 9, x + 20, y + 11);
        cr.closePath();
        cr.fillPreserve();
        color(0.95, 0.99, 1, 0.62);
        cr.setLineWidth(1.2);
        cr.stroke();
    }

    cr.setLineCap(Cairo.LineCap.ROUND);
    if (type === "unknown") {
        color(0.79, 0.89, 0.95, 0.78);
        for (const x of [31, 48, 65]) disc(x, 46, 3);
        cr.fill();
        return;
    }
    if (type === "sun" || type === "moon") {
        if (type === "sun") sun(48, 45, 20);
        else moon(46, 45, 23);
        return;
    }
    if (type === "wind") {
        color(0.78, 0.96, 1);
        cr.setLineWidth(3);
        for (let i = 0; i < 3; i++) {
            const x = 15 + (i % 2) * 12 + bob;
            const y = 33 + i * 13;
            cr.moveTo(x, y);
            cr.lineTo(62 + bob, y);
            cr.curveTo(78 + bob, y, 76 + bob, y - 13, 68 + bob, y - 13);
            cr.stroke();
        }
        return;
    }
    if (type === "partly") sun(57, 35, 14);
    if (type === "partlyNight") moon(53, 35, 17);
    const dry = ["cloud", "partly", "partlyNight"].includes(type);
    cloud(47 + bob, dry ? 51 : 39, !dry || type === "partlyNight");
    if (dry) return;

    cr.setLineWidth(2.6);
    if (type === "fog") {
        for (let i = 0; i < 3; i++) {
            color(0.78, 0.94, 0.96, 0.75 - i * 0.15);
            line(24 + bob * (i + 1), 58 + i * 7, 70 + bob * (i + 1), 58 + i * 7);
            cr.stroke();
        }
        return;
    }
    if (type === "storm") {
        const opacity = 0.82 + 0.18 * Math.cos(phase * 3);
        color(1, 0.88, 0.44, opacity);
        cr.moveTo(51, 45);
        cr.lineTo(37, 64);
        cr.lineTo(48, 64);
        cr.lineTo(43, 80);
        cr.lineTo(63, 57);
        cr.lineTo(52, 57);
        cr.closePath();
        cr.fill();
    }
    const drops = type === "storm" ? [25, 72] : [27, 46, 65];
    drops.forEach((x, i) => {
        const fall = (time * 0.9 + 0.37 * i) % 1;
        const y = 55 + 17 * fall;
        color(0.54, 0.86, 1, 0.92 - 0.58 * fall);
        if (type === "snow") {
            disc(x + Math.sin(phase + i) * 3, y, 2.1);
            cr.fill();
        } else {
            line(x, y, x - 4, y + 7);
            cr.stroke();
        }
    });
}

class PinamarWeather extends Desklet.Desklet {
    constructor(metadata, id) {
        super(metadata, id);
        this.alive = true;
        this.icons = [];
        this.setHeader(metadata.name);
        this.settings = new Settings.DeskletSettings(this, metadata.uuid, id);
        this.settings.bind("color-vidrio", "tint", this.applyGlass);
        this.settings.bind("transparencia-vidrio", "transparency", this.applyGlass);
        this.settings.bind("desenfocar-fondo", "blur", this.applyGlass);
        this.settings.bind("animar-iconos", "animate", this.syncAnimation);
        this.settings.bind("buscar-localidad", "locationQuery", this.queueSearch);
        this.settings.bind("localidad-elegida", "selectedLocation", this.changeLocation);
        this.location = this.parseLocation();
        this.requestSerial = 0;
        this.searchSerial = 0;
        this.cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), "mint-widgets"]);
        this.cachePath = GLib.build_filenamev([this.cacheDir, `smn-${this.location.id}.json`]);
        this.data = this.readCache();
        this.loading = false;
        this.showDetails = false;
        this.createLayout();
        this.setContent(this.card);
        this.content.set_style("background-color: transparent; background-gradient-direction: none; background-image: none; background-blur: 0px; border: 0; box-shadow: none;");
        this.render();
        this.refresh();
        this.poll = Mainloop.timeout_add_seconds(REFRESH_SECONDS, () => {
            this.refresh();
            return true;
        });
    }

    parseLocation() {
        try {
            const loc = JSON.parse(this.selectedLocation);
            if (/^[a-zA-Z0-9_-]{1,40}$/.test(loc.id) && typeof loc.name === "string" &&
                typeof loc.province === "string" && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) &&
                loc.lat >= -90 && loc.lat <= 90 && loc.lon >= -180 && loc.lon <= 180) return loc;
        } catch (e) {}
        return {...DEFAULT_LOCATION};
    }

    locationKey() {
        return `${this.location.id}:${this.location.lat}:${this.location.lon}`;
    }

    changeLocation() {
        if (!this.card) return;
        ++this.requestSerial;
        ++this.searchSerial;
        if (this.searchTimer) Mainloop.source_remove(this.searchTimer);
        this.searchTimer = 0;
        if (this.searchProc) this.searchProc.force_exit();
        if (this.cancellable) this.cancellable.cancel();
        if (this.proc) this.proc.force_exit();
        if (this.deadline) Mainloop.source_remove(this.deadline);
        this.deadline = 0;
        this.loading = false;
        this.location = this.parseLocation();
        this.cachePath = GLib.build_filenamev([this.cacheDir, `smn-${this.location.id}.json`]);
        this.data = this.readCache();
        this.searchResults = [];
        this.searchMessage = "";
        this.attempt = null;
        this.incomplete = false;
        this.refresh();
    }

    queueSearch() {
        if (!this.card) return;
        ++this.searchSerial;
        if (this.searchTimer) Mainloop.source_remove(this.searchTimer);
        if (this.searchProc) this.searchProc.force_exit();
        this.searchResults = [];
        const query = (this.locationQuery || "").trim();
        this.searchMessage = query.length < 2 ? "Escribí al menos dos letras en Configuración → Localidad." : "Buscando localidades…";
        this.render();
        this.searchTimer = Mainloop.timeout_add(800, () => {
            this.searchTimer = 0;
            if (query.length >= 2) this.searchLocality(query);
            return false;
        });
    }

    searchLocality(query) {
        const serial = ++this.searchSerial;
        try {
            const helper = GLib.build_filenamev([this.metadata.path, "smn.py"]);
            const proc = Gio.Subprocess.new(["/usr/bin/python3", "-I", helper, "search", query],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this.searchProc = proc;
            proc.communicate_utf8_async(null, null, (self, result) => {
                if (!this.alive || serial !== this.searchSerial) return;
                this.searchProc = null;
                try {
                    const [ok, output] = self.communicate_utf8_finish(result);
                    const response = ok && self.get_successful() ? JSON.parse(output) : {};
                    this.searchResults = Array.isArray(response.results) ? response.results.slice(0, 10) : [];
                    this.searchMessage = response.error || (this.searchResults.length ?
                        "Elegí tu localidad (clic en una opción):" : "Sin coincidencias. Probá otro nombre o agregá la provincia tras una coma.");
                } catch (e) {
                    this.searchMessage = "No se pudo buscar. Revisá la conexión y volvé a intentar.";
                }
                this.render();
            });
        } catch (e) {
            this.searchMessage = "No se pudo iniciar la búsqueda.";
            this.render();
        }
    }

    createLayout() {
        this.card = flow(true, "mintwx-card");
        const top = flow(false, "mintwx-header");
        const location = expanded(flow(true, "mintwx-location"));
        this.locationTitle = wrapLabel(this.location.name, "mintwx-title");
        this.locationProvince = wrapLabel(this.location.province, "mintwx-subtitle");
        add(location, this.locationTitle, this.locationProvince);
        this.refreshButton = action(icon("view-refresh-symbolic", 17), "Actualizar el tiempo", () => this.refresh(), "mintwx-action");
        this.refreshButton.x_align = St.Align.END;
        this.refreshButton.y_align = St.Align.MIDDLE;
        add(top, location, this.refreshButton);
        this.body = flow(true, "mintwx-body");
        add(this.card, top, this.body);
    }

    render() {
        this.icons = [];
        this.body.destroy_all_children();
        this.locationTitle.set_text(this.location.name);
        this.locationProvince.set_text(this.location.province);
        if (this.searchMessage) this.body.add_child(wrapLabel(this.searchMessage, "mintwx-observation"));
        for (const candidate of this.searchResults || []) {
            const choice = action(wrapLabel(`${candidate.name} · ${candidate.province} · ${candidate.department}`, "mintwx-muted"),
                "Usar esta localidad", () => {
                    this.selectedLocation = JSON.stringify(candidate);
                    this.changeLocation();
                }, "mintwx-action");
            this.body.add_child(choice);
        }
        const now = new Date();
        const current = this.data.current;
        const forecast = daily(this.data, now);
        const sun = this.data.sun?.results;
        const sunrise = localDay(now) === sun?.sunrise?.slice(0, 10) ? sun.sunrise : null;
        const sunset = sunrise ? sun.sunset : null;
        const forecastAge = ageHours(this.data.forecast?.updated, now);
        const currentAge = ageHours(current?.date, now);

        const hero = flow(false, "mintwx-hero");
        const currentText = expanded(flow(true, "mintwx-readout"));
        const isNight = sunrise && sunset ? now < new Date(sunrise) || now > new Date(sunset) :
            Number(LOCAL_HOUR.format(now).split(":")[0]) >= 20 || Number(LOCAL_HOUR.format(now).split(":")[0]) < 6;
        const condition = currentAge <= 24 ? current?.weather : null;
        const recent = currentAge <= 24 ? current : null;
        const temperature = Number.isFinite(recent?.temperature) ? NUM.format(recent.temperature) + "°C" : "— °C";
        add(currentText, label(temperature, "mintwx-temp"),
            wrapLabel(text(condition?.description) || "Observación sin datos", "mintwx-condition"),
            label(`Hoy · Mín. ${temp(forecast.today.temp_min)}  ·  Máx. ${temp(forecast.today.temp_max)}`, "mintwx-muted"));
        add(hero, currentText, this.weatherIcon(weatherType(condition, isNight), 103));

        const observation = this.observationLabel(recent, currentAge, now);
        add(this.body, hero, wrapLabel(observation, "mintwx-observation"));
        this.renderMetrics(recent, sunrise, sunset);
        this.renderForecast(forecast, forecastAge, now);
        this.renderFooter(now);
        this.applyGlass();
        this.syncAnimation();
    }

    observationLabel(current, age, now) {
        if (!current) return "Observación del SMN no disponible";
        const station = current.station_id === GESELL_ID ? "Villa Gesell Aero" :
            Number.isFinite(current.station_id) ? `Estación ${current.station_id}` : "Estación SMN";
        const distance = Number.isFinite(current.location?.distance) ? ` · ${NUM.format(Math.round(current.location.distance))} km` : "";
        const prefix = age > 2 ? "Dato demorado · " : "";
        return `${prefix}${station}${distance} · ${timeStamp(current.date, now)}`;
    }

    renderMetrics(current, sunrise, sunset) {
        const wind = current?.wind;
        const windSpeed = displayNumber(wind?.speed, " km/h");
        const direction = text(wind?.direction);
        const values = [
            ["Humedad", displayNumber(current?.humidity, " %")],
            ["Viento", Number.isFinite(wind?.speed) && direction ? `${direction} ${windSpeed}` : windSpeed],
            ["Sensación", displayNumber(current?.feels_like, " °C")],
            ["Presión", displayNumber(current?.pressure, " hPa")],
            ["Visibilidad", displayNumber(current?.visibility, " km")],
            ["Salida / puesta", sunrise && sunset ? `${LOCAL_HOUR.format(new Date(sunrise))} / ${LOCAL_HOUR.format(new Date(sunset))}` : "—"]
        ];
        const group = flow(true, "mintwx-metrics");
        for (let i = 0; i < values.length; i += 2) {
            const row = flow(false, "mintwx-metric-row");
            for (const [name, value] of values.slice(i, i + 2)) {
                const block = expanded(flow(true, "mintwx-metric"));
                add(block, label(name, "mintwx-muted"), label(value, "mintwx-metric-value"));
                row.add_child(block);
            }
            group.add_child(row);
        }
        this.body.add_child(group);
    }

    renderForecast(days, age, now) {
        const header = flow(false, "mintwx-forecast-header");
        add(header, expanded(label("Próximos 3 días", "mintwx-section")),
            label(Number.isFinite(age) ? `Emisión ${timeStamp(this.data.forecast.updated, now)}` : "Sin datos", "mintwx-muted"));
        this.body.add_child(header);
        if (age > 24) {
            this.body.add_child(label(Number.isFinite(age) ? "Pronóstico guardado · puede estar desactualizado" :
                "Esperando el pronóstico del SMN", "mintwx-observation"));
        }
        const row = flow(false, "mintwx-days");
        for (const day of days.tomorrow) {
            const summary = daySummary(day);
            const item = expanded(flow(true, "mintwx-day"));
            const figure = this.weatherIcon(weatherType(summary.weather), 39);
            figure.x_align = St.Align.MIDDLE;
            const caption = wrapLabel(text(summary.weather?.description) || "Sin datos", "mintwx-day-condition");
            add(item, label(`${shortDay(day.date)} ${Number(day.date.slice(8, 10))}`, "mintwx-day-title"), figure, caption,
                label(`${temp(day.temp_min)} / ${temp(day.temp_max)}`, "mintwx-day-temp"),
                label(Number.isFinite(summary.rain) ? `Lluvia máx. ${summary.rain} %` : "Lluvia —", "mintwx-muted"));
            row.add_child(item);
        }
        this.body.add_child(row);

        if (!this.showDetails) return;
        const detail = flow(true, "mintwx-detail");
        const options = [days.today, ...days.tomorrow];
        const selection = Math.min(3, Math.max(0, this.detailDay ?? 0));
        const tabs = flow(false, "mintwx-detail-tabs");
        options.forEach((day, i) => {
            const tab = action(label(i === 0 ? "Hoy" : shortDay(day.date), "mintwx-small-label"),
                `Mostrar pronóstico de ${i === 0 ? "hoy" : shortDay(day.date)}`, () => {
                    this.detailDay = i;
                    this.render();
                }, i === selection ? "mintwx-action mintwx-selected" : "mintwx-action");
            tab.x_expand = true;
            tabs.add_child(tab);
        });
        detail.add_child(tabs);
        for (const [key, name] of SECTIONS) {
            const period = options[selection][key];
            const first = period ? `${name} · ${temp(period.temperature)} · ${text(period.weather?.description) || "Sin estado"}` : `${name} · Sin datos`;
            detail.add_child(wrapLabel(first, "mintwx-period"));
            if (!period) continue;
            const rain = numericRange(period.rain_prob_range, " %");
            const speed = numericRange(period.wind?.speed_range, " km/h");
            const gust = numericRange(period.gust_range, " km/h");
            detail.add_child(wrapLabel(`Lluvia ${rain}  ·  Viento ${text(period.wind?.direction)} ${speed}  ·  Ráfagas ${gust}`, "mintwx-muted"));
        }
        this.body.add_child(detail);
    }

    renderFooter(now) {
        const links = flow(false, "mintwx-links");
        const detailText = this.showDetails ? "Ocultar detalle" : "Ver por franja";
        const details = action(label(detailText, "mintwx-small-label"), detailText, () => {
            this.showDetails = !this.showDetails;
            this.render();
        }, "mintwx-action");
        const official = action(label("Pronóstico SMN ↗", "mintwx-small-label"), "Abrir pronóstico oficial del SMN", () => sourceLink(this.data.forecast?.location?.id ? `https://www.smn.gob.ar/pronostico/?loc=${encodeURIComponent(this.data.forecast.location.id)}` : SITE_URL), "mintwx-action");
        add(links, expanded(details), expanded(official));
        this.body.add_child(links);
        const status = this.loading ? "Consultando el SMN…" : this.incomplete ? "Fuente incompleta · mostrando datos disponibles" :
            this.attempt ? `SMN · consultado ${timeStamp(this.attempt, now)} · cada 15 min` : "SMN · actualiza cada 15 min";
        const source = action(label(status, "mintwx-muted"), "Abrir información oficial del SMN", () => sourceLink(SITE_URL), "mintwx-source");
        this.body.add_child(source);
    }

    applyGlass() {
        if (!this.card) return;
        const styles = glassStyle(this.tint, this.transparency, this.blur);
        this.card.set_style(styles.card);
        this.refreshButton.set_style(`color: ${styles.accent};`);
    }

    weatherIcon(type, size) {
        const actor = new St.DrawingArea({width: size, height: size, reactive: false});
        actor.connect("repaint", area => {
            const cr = area.get_context();
            try {
                const [width, height] = area.get_surface_size();
                const scale = Math.min(width, height) / 96;
                cr.translate((width - scale * 96) / 2, (height - scale * 96) / 2);
                cr.scale(scale, scale);
                const seconds = this.animate ? (GLib.get_monotonic_time() / 1000000) % 300 : 0;
                paintWeather(cr, type, seconds);
            } finally {
                cr.$dispose();
            }
        });
        if (type !== "unknown") this.icons.push(actor);
        return actor;
    }

    syncAnimation() {
        if (this.animation) {
            Mainloop.source_remove(this.animation);
            this.animation = 0;
        }
        if (this.animate && this.icons.length) {
            this.animation = Mainloop.timeout_add(100, () => {
                for (const actor of this.icons) if (actor.mapped) actor.queue_repaint();
                return true;
            });
        }
        for (const actor of this.icons) actor.queue_repaint();
    }

    readCache() {
        try {
            const [ok, bytes] = GLib.file_get_contents(this.cachePath);
            if (ok && bytes.length < 200000) {
                const sample = JSON.parse(ByteArray.toString(bytes));
                return model({}, sample, new Date(), this.locationKey());
            }
        } catch (error) {
            // A missing or damaged cache is rebuilt from the official endpoint.
        }
        return {};
    }

    saveCache() {
        try {
            GLib.mkdir_with_parents(this.cacheDir, 0o700);
            GLib.file_set_contents(this.cachePath, JSON.stringify(this.data));
        } catch (error) {
            // A cache failure does not prevent rendering the latest response.
        }
    }

    refresh() {
        if (!this.alive || this.loading) return;
        const serial = ++this.requestSerial;
        this.loading = true;
        this.render();
        this.cancellable = new Gio.Cancellable();
        let proc;
        try {
            const helper = GLib.build_filenamev([this.metadata.path, "smn.py"]);
            proc = Gio.Subprocess.new(["/usr/bin/python3", "-I", helper, "weather", String(this.location.lat), String(this.location.lon), this.locationKey()],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
            this.proc = proc;
        } catch (error) {
            this.finishRefresh(null);
            return;
        }
        this.deadline = Mainloop.timeout_add_seconds(22, () => {
            this.deadline = 0;
            proc.force_exit();
            return false;
        });
        proc.communicate_utf8_async(null, this.cancellable, (self, result) => {
            if (!this.alive || serial !== this.requestSerial) return;
            let fresh = null;
            try {
                const [success, stdout] = self.communicate_utf8_finish(result);
                if (success && self.get_successful()) fresh = JSON.parse(stdout);
            } catch (error) {
                // The UI retains its last valid values when the fetch fails.
            }
            this.finishRefresh(fresh);
        });
    }

    finishRefresh(fresh) {
        if (this.deadline) Mainloop.source_remove(this.deadline);
        this.deadline = 0;
        this.proc = null;
        this.cancellable = null;
        this.loading = false;
        const now = new Date();
        this.data = model(this.data, fresh, now, this.locationKey());
        this.attempt = now.toISOString();
        this.incomplete = this.data.current !== fresh?.current || this.data.forecast !== fresh?.forecast ||
            !this.data.current || !this.data.forecast;
        if (this.data.current || this.data.forecast) this.saveCache();
        this.render();
    }

    on_desklet_removed() {
        this.alive = false;
        for (const timer of [this.poll, this.animation, this.deadline, this.searchTimer]) if (timer) Mainloop.source_remove(timer);
        if (this.cancellable) this.cancellable.cancel();
        if (this.proc) this.proc.force_exit();
        if (this.searchProc) this.searchProc.force_exit();
        this.settings.finalize();
    }
}

function main(metadata, id) {
    return new PinamarWeather(metadata, id);
}
