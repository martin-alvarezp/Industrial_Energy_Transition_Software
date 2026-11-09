// Bibliotecas globales (sin sistema abierto): escenarios, vectores,
// ubicaciones de todos los sistemas, tecnologías y contabilidad. Y el gestor
// de portafolio (dentro de un sistema).
import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { useStored } from "../storage.js";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS, componentIcon } from "../icons.jsx";
import { hrefFor, navigate } from "../router.js";
import { siteMeta } from "../sitemeta.js";
import { SCENARIOS } from "../components/RunModal.jsx";
import { techKind } from "../techkind.js";
import { CARRIER_PRESETS, TECH_PRESETS, CARRIER_CATEGORY_META } from "../../lib/twin.js";
import { GRID_FACTORS } from "../../lib/gridFactors.js";
import { num } from "../../lib/format.js";


export function LibScenariosPage() {
  const { t } = useI18n();
  return (
    <div className="ui-page">
      <PageHead icon={NAV_ICONS.scenarios} title={t("nav.scenarios")} help={t("lib.scenHelp")} />
      <div className="scen-grid">
        {SCENARIOS.map((s) => (
          <div key={s} className="ui-card ui-card-pad scen-card">
            <div style={{ fontWeight: 600, fontSize: 16 }}>{t("scn." + s)}</div>
            <p className="ui-card-sub">{t("desc." + s)}</p>
            <code className="ui-tag" style={{ alignSelf: "flex-start" }}>{s}</code>
          </div>
        ))}
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
              <td className="num">{p.factors.map((f) => `${f.scope === "scope1" ? "S1" : "S2"} ${f.factor}`).join(" · ") || "—"}</td>
              <td className="num">{p.price ?? "—"}</td>
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
  const { t } = useI18n();
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
            const tech = { tech_id: p.key, name: p.label, type: p.type, ...p.tech };
            const I = componentIcon(tech);
            const ins = p.tech.ports?.inputs?.map((x) => x.carrier) ?? (p.tech.input_carrier ? [p.tech.input_carrier] : []);
            const outs = p.tech.ports?.outputs?.map((x) => x.carrier) ?? (p.tech.output_carrier ? [p.tech.output_carrier] : []);
            return (
              <tr key={p.key}>
                <td><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><I size={18} /><b style={{ fontWeight: 600 }}>{t("preset." + p.key)}</b></span></td>
                <td>{t("cat." + p.group)}</td>
                <td>{t(techKind(tech))}</td>
                <td style={{ color: "var(--ui-muted)" }}>{ins.join(" + ") || "—"} → {outs.join(" + ") || "—"}</td>
                <td className="num">{p.tech.efficiency ?? (p.tech.cf_constant != null ? `cf ${p.tech.cf_constant}` : "—")}</td>
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

