// Bibliotecas globales (sin sistema abierto): escenarios (de partida y
// sensibilidades predefinidas), vectores, ubicaciones de todos los sistemas,
// tecnologías y contabilidad.
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored, uid } from "../storage.js";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import { siteMeta } from "../sitemeta.js";
import { TEMPLATES, rowsFor } from "../components/Sensitivities.jsx";
import { SCENARIO_COLORS } from "../../lib/scenarios.js";
import { fetchSite, fetchSiteConfig, saveSite } from "../../lib/api.js";
import { fromGeoJSON, toGeoJSON } from "../layout.js";
import { techKind } from "../techkind.js";
import { CARRIER_PRESETS, TECH_PRESETS, CARRIER_CATEGORY_META } from "../../lib/twin.js";
import { GRID_FACTORS } from "../../lib/gridFactors.js";
import { num } from "../../lib/format.js";

/** Número con la coma o el punto del idioma y hasta 3 decimales (0,202 · 0.202). */
const fmtN = (x, lang) => (x == null || x === "" ? "—" : (+x).toLocaleString(lang === "en" ? "en-US" : "es-CL", { maximumFractionDigits: 3 }));
/** Nombre de un vector del catálogo por su id (no «hot_water»). */
const presetCarrierKey = (id) => CARRIER_PRESETS.find((p) => p.key === id || p.carrier?.carrier_id === id)?.key;


// Biblioteca de escenarios: escenarios de partida y sensibilidades
// predefinidas que se aplican a cualquier sistema guardado. Aplicar = crear el
// escenario (con sus filas, si es una sensibilidad) en el layout del sistema;
// después se edita como cualquier escenario en Escenarios del sistema.
const STARTERS = [
  { key: "eo", es: "Economic Optimum", en: "Economic Optimum",
    d: ["Para las tecnologías candidatas opcionales: asígnalas a este escenario (Infraestructura → activo → Escenario del activo) y solo participan en las corridas que lo incluyan.",
        "For optional candidate technologies: assign them to this scenario (Infrastructure → asset → Asset scenario) and they only take part in runs that include it."] },
  { key: "supplier", es: "Proveedor alternativo", en: "Alternative supplier",
    d: ["Para comparar ofertas: CAPEX o eficiencia distintos de un activo bajo este escenario, sin tocar Base.",
        "To compare quotes: a different CAPEX or efficiency for an asset under this scenario, without touching Base."] },
  { key: "reliability", es: "Confiabilidad", en: "Reliability",
    d: ["Compras fijas de respaldo (infraestructura fija) y permisos de inversión que exige el cliente.",
        "Fixed backup purchases (fixed infrastructure) and investment permissions required by the client."] },
];

export function LibScenariosPage() {
  const { t, lang } = useI18n();
  const { sites, apiUp, siteName, loadSite } = useStudio();
  const editable = (sites ?? []).filter((s) => s !== "demo");
  const [target, setTarget] = useState("");
  const [site, setSite] = useState(null);        // { siteJson, layout, cfg }
  const [vals, setVals] = useState({});
  const [years, setYears] = useState({});
  const [picks, setPicks] = useState({});
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!target) { setSite(null); return; }
    let alive = true;
    (async () => {
      const { source, site: s } = await fetchSite(target);
      if (source !== "api") throw new Error("sin API");   // nunca guardar sobre un mock
      const { layout, site_version, ...siteJson } = s;
      const cfg = (await fetchSiteConfig(target)) ?? {};
      if (alive) setSite({ siteJson, layout: layout ? fromGeoJSON(layout) : fromGeoJSON(null), cfg });
    })().catch(() => setSite(null));
    return () => { alive = false; };
  }, [target]);
  const save = async (mutate, msg) => {
    const layout = mutate({ ...site.layout });
    await saveSite(target, site.siteJson, toGeoJSON(layout));
    setSite({ ...site, layout });
    if (target === siteName) await loadSite(target, { force: true });
    setFlash(msg); setTimeout(() => setFlash(null), 3000);
  };
  const addStarter = (st) => save((l) => ({ ...l, scenarios: [...(l.scenarios ?? []),
    { id: uid(), name: lang === "en" ? st.en : st.es, description: lang === "en" ? st.d[1] : st.d[0],
      color: SCENARIO_COLORS[(l.scenarios ?? []).length % SCENARIO_COLORS.length], created_at: new Date().toISOString() }] }),
    t("lib.scenAdded", { s: target }));
  const addSens = (tp) => {
    const v = +(vals[tp.id] ?? tp.def);
    const opts = tp.pick ? tp.pick(site.siteJson) : [];
    const pickObj = tp.pick ? opts.find((o) => (o.carrier_id ?? o.tech_id) === (picks[tp.id] ?? (opts[0]?.carrier_id ?? opts[0]?.tech_id))) : null;
    if (tp.pick && !pickObj) return;
    const yr = tp.yearable && years[tp.id] ? +years[tp.id] : null;
    const rows = rowsFor(tp, v, pickObj, site.siteJson, site.cfg).map((r) => (yr != null && r.year == null ? { ...r, year: yr } : r));
    if (!rows.length) return;
    const id = uid();
    save((l) => ({ ...l,
      scenarios: [...(l.scenarios ?? []), { id, name: tp.name(v, pickObj) + (yr != null ? ` ${t("sens.fromYear", { y: yr })}` : ""),
        description: lang === "en" ? tp.q[1] : tp.q[0], color: SCENARIO_COLORS[(l.scenarios ?? []).length % SCENARIO_COLORS.length],
        sensitivity: tp.id, created_at: new Date().toISOString() }],
      params: [...(l.params ?? []), ...rows.map((r) => ({ id: uid(), year: null, ...r, scenario: id }))] }),
      t("lib.scenAdded", { s: target }));
  };
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.scenarios} title={t("nav.scenarios")} help={t("lib.scenHelp")} />
      <div className="pg-toolbar">
        <label>{t("lib.applyTo")}</label>
        <select className="ui-select" style={{ maxWidth: 280 }} value={target} onChange={(e) => setTarget(e.target.value)}
                data-testid="lib-scen-target">
          <option value="">{t("lib.pickSystem")}</option>
          {editable.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {flash && <span className="ui-tag ok">{flash}</span>}
        {!apiUp && <span className="ui-hint">{t("common.apiRequired")}</span>}
      </div>

      <h3 className="ui-card-title" style={{ margin: "18px 0 8px" }}>{t("lib.starters")}</h3>
      <div className="sens-grid">
        {STARTERS.map((st) => (
          <div key={st.key} className="ui-card ui-card-pad sens-card" data-testid={`lib-starter-${st.key}`}>
            <div className="sens-name">{lang === "en" ? st.en : st.es}</div>
            <p className="ui-card-sub">{lang === "en" ? st.d[1] : st.d[0]}</p>
            <button className="ui-btn outline sm" disabled={!site} onClick={() => addStarter(st)} style={{ alignSelf: "flex-start" }}>
              {t("lib.apply")}</button>
          </div>
        ))}
      </div>

      <h3 className="ui-card-title" style={{ margin: "24px 0 8px" }}>{t("lib.sensTitle")}</h3>
      <p className="ui-hint" style={{ marginTop: 0 }}>{t("lib.sensHint")}</p>
      <div className="sens-grid">
        {TEMPLATES.map((tp) => {
          const opts = site && tp.pick ? tp.pick(site.siteJson) : null;
          return (
            <div key={tp.id} className="ui-card ui-card-pad sens-card" data-testid={`lib-sens-${tp.id}`}>
              <div className="sens-name">{lang === "en" ? tp.en : tp.es}</div>
              <p className="ui-card-sub">{lang === "en" ? tp.q[1] : tp.q[0]}</p>
              {opts && opts.length > 0 && (
                <select className="ui-select" value={picks[tp.id] ?? (opts[0].carrier_id ?? opts[0].tech_id)}
                        onChange={(e) => setPicks({ ...picks, [tp.id]: e.target.value })}>
                  {opts.map((o) => <option key={o.carrier_id ?? o.tech_id} value={o.carrier_id ?? o.tech_id}>{o.name}</option>)}
                </select>
              )}
              <div className="sens-row">
                <input className="ui-input" type="number" step="any" value={vals[tp.id] ?? tp.def}
                       onChange={(e) => setVals({ ...vals, [tp.id]: e.target.value })} />
                <span className="sens-unit">{tp.unit}</span>
                {tp.yearable && (
                  <input className="ui-input sens-year" type="number" placeholder={t("sens.yearPh")} value={years[tp.id] ?? ""}
                         onChange={(e) => setYears({ ...years, [tp.id]: e.target.value })} />
                )}
                <button className="ui-btn outline sm" disabled={!site || (opts && !opts.length)} onClick={() => addSens(tp)}
                        data-testid={`lib-sens-${tp.id}-apply`}>{t("lib.apply")}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LibCarriersPage() {
  const { t, lang } = useI18n();
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.carriers} title={t("nav.carriers")} help={t("lib.carHelp")} />
      <h3 className="ui-card-title" style={{ marginBottom: 12 }}>{t("lib.presets")}</h3>
      <div className="ui-card" style={{ overflow: "auto" }}>
        <table className="ui-table">
          <thead><tr><th>{t("common.name")}</th><th>{t("lib.category")}</th><th>{t("lib.unit")}</th>
            <th className="num">{t("lib.factor")} (tCO₂e/MWh)</th><th className="num">{t("lib.price")} (USD/MWh)</th></tr></thead>
          <tbody>{CARRIER_PRESETS.filter((p) => p.key !== "custom").map((p) => (
            <tr key={p.key}>
              <td><b style={{ fontWeight: 600 }}>{t("cpreset." + p.key)}</b>{p.askLevel ? <span className="ui-hint"> · {p.askLevel}</span> : ""}</td>
              <td>{lang === "en" ? CARRIER_CATEGORY_META[p.carrier.category]?.label_en : CARRIER_CATEGORY_META[p.carrier.category]?.label}</td>
              <td>{p.carrier.unit}</td>
              <td className="num">{p.factors.map((f) => `${lang === "en" ? (f.scope === "scope1" ? "Scope 1" : "Scope 2") : (f.scope === "scope1" ? "Alcance 1" : "Alcance 2")}: ${fmtN(f.factor, lang)}`).join(" · ") || "—"}</td>
              <td className="num">{fmtN(p.price, lang)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3 className="ui-card-title" style={{ margin: "26px 0 12px" }}>{t("lib.gridFactors")}</h3>
      <div className="ui-card" style={{ overflow: "auto", maxHeight: 520 }}>
        <table className="ui-table">
          <thead><tr><th>{t("lib.country")}</th><th className="num">tCO₂e/MWh</th><th>{t("lib.source")}</th></tr></thead>
          <tbody>{GRID_FACTORS.map((g) => (
            <tr key={g.code}><td>{g.pais}</td><td className="num">{g.factor}</td><td>{g.fuente}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

const pin = L.divIcon({ className: "", html: '<div class="lib-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

export function LibLocationsPage() {
  const { t } = useI18n();
  const { sites } = useStudio();
  const [metas, setMetas] = useState([]);
  useEffect(() => {
    Promise.all((sites ?? []).map((s) => siteMeta(s))).then(setMetas);
  }, [sites]);
  const located = metas.filter((m) => m.center);
  const center = located[0]?.center ?? [-33.45, -70.66];
  return (
    <div className="ui-page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <PageHead icon={NAV_ICONS.locations} title={t("nav.locations")} help={t("lib.locHelp")} />
      {metas.length > located.length && <p className="ui-hint">{t("lib.noGeo", { n: metas.length - located.length })}</p>}
      <div style={{ flex: 1, minHeight: 480, borderRadius: 12, overflow: "hidden", position: "relative" }}>
        <MapContainer center={center} zoom={located.length ? 10 : 4} style={{ position: "absolute", inset: 0 }}
                      scrollWheelZoom>
          <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" className="sm-tiles-light"
                     attribution="© OpenStreetMap contributors" />
          {located.map((m) => (
            <Marker key={m.name} position={m.center} icon={pin}
                    eventHandlers={{ click: () => navigate(hrefFor({ site: m.name, page: "infrastructure" })) }}>
              <Tooltip direction="top" offset={[0, -10]} permanent>{m.title}</Tooltip>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}

export function LibTechnologiesPage() {
  const { t, lang } = useI18n();
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.technologies} title={t("nav.technologies")} help={t("lib.techHelp")} />
      <div className="ui-card" style={{ overflow: "auto" }}>
        <table className="ui-table">
          <thead><tr>
            <th>{t("common.name")}</th><th>{t("lib.group")}</th><th>{t("cc.kind")}</th><th>{t("lib.io")}</th>
            <th className="num">{t("cc.eff")}</th><th className="num">{t("cc.capex")}</th>
            <th className="num">{t("lib.fixedOpex")}</th><th className="num">{t("lib.varOpex")}</th><th className="num">{t("cc.life")}</th>
          </tr></thead>
          <tbody>{TECH_PRESETS.map((p) => {
            const cl = (id) => (presetCarrierKey(id) ? t("cpreset." + presetCarrierKey(id)) : id);
            const tech = { tech_id: p.key, name: p.label, type: p.type, ...p.tech };
            const I = componentIcon(tech);
            const ins = p.tech.ports?.inputs?.map((x) => x.carrier) ?? (p.tech.input_carrier ? [p.tech.input_carrier] : []);
            const outs = p.tech.ports?.outputs?.map((x) => x.carrier) ?? (p.tech.output_carrier ? [p.tech.output_carrier] : []);
            return (
              <tr key={p.key}>
                <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I size={18} /><b style={{ fontWeight: 600 }}>{t("preset." + p.key)}</b></span></td>
                <td>{t("cat." + p.group)}</td>
                <td>{t(techKind(tech))}</td>
                <td style={{ color: "var(--ui-muted)" }}>{ins.map(cl).join(" + ") || "—"} → {outs.map(cl).join(" + ") || "—"}</td>
                <td className="num">{p.tech.efficiency != null ? fmtN(p.tech.efficiency, lang) : (p.tech.cf_constant != null ? `${lang === "en" ? "CF" : "FP"} ${fmtN(p.tech.cf_constant, lang)}` : "—")}</td>
                <td className="num">{num(p.tech.capex_per_kw, 0)}</td>
                <td className="num">{num(p.tech.fixed_opex, 0)}</td>
                <td className="num">{num(p.tech.variable_opex, 1)}</td>
                <td className="num">{p.tech.lifetime_years ?? "—"}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

export function AccountingPage() {
  const { t } = useI18n();
  const [acc, setAcc] = useStored("ieto.accounting", { inflation: 0.02 });
  const [defaults, setDefaults] = useStored("ieto.cfg._default", {});
  return (
    <div className="ui-page" style={{ maxWidth: 900 }}>
      <PageHead icon={NAV_ICONS.accounting} title={t("nav.accounting")} help={t("lib.accHelp")} />
      <section className="ui-card ui-card-pad">
        <div className="par-row" style={{ marginTop: 0 }}>
          <div className="par-field">
            <label>{t("lib.inflation")}</label>
            <div className="par-input">
              <input className="ui-input" type="number" step="any" value={+(acc.inflation * 100).toFixed(4)}
                     onChange={(e) => setAcc({ ...acc, inflation: (+e.target.value || 0) / 100 })} />
              <span className="unit">%/año</span>
            </div>
            <p className="ui-hint">{t("lib.inflationHint")}</p>
          </div>
          <div className="par-field">
            <label>{t("lib.defaultCurrency")}</label>
            <input className="ui-input" value={defaults.currency ?? "USD"}
                   onChange={(e) => setDefaults({ ...defaults, currency: e.target.value.toUpperCase().slice(0, 5) })} />
          </div>
          <div className="par-field">
            <label>{t("lib.defaultTax")}</label>
            <div className="par-input">
              <input className="ui-input" type="number" value={+((defaults.tax_rate ?? 0) * 100).toFixed(4)}
                     onChange={(e) => setDefaults({ ...defaults, tax_rate: (+e.target.value || 0) / 100 })} />
              <span className="unit">%</span>
            </div>
          </div>
          <div className="par-field">
            <label>{t("lib.defaultDep")}</label>
            <input className="ui-input" type="number" min={0} value={defaults.depreciation_years ?? 0}
                   onChange={(e) => setDefaults({ ...defaults, depreciation_years: +e.target.value })} />
          </div>
        </div>
      </section>
    </div>
  );
}

