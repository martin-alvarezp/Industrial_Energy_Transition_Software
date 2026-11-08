// Catálogo para agregar un componente: los presets industriales de IETO
// agrupados (generación, conversión, almacenamiento) y los tipos genéricos
// "desde cero". Elegir uno devuelve el borrador listo para editar.
import { useState } from "react";
import { IcSearch } from "../iconset.jsx";
import { useI18n } from "../i18n.jsx";
import { Modal } from "../kit.jsx";
import { componentIcon } from "../icons.jsx";
import { TECH_PRESETS, TECH_TYPE_META, blankFromPreset, blankEquipment } from "../../lib/twin.js";


export default function CatalogModal({ siteJson, onPick, onClose }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const presets = TECH_PRESETS.filter((p) => !qq || `${p.label} ${t("preset." + p.key)} ${p.key}`.toLowerCase().includes(qq));
  const pickPreset = (key) => {
    const r = blankFromPreset(key, siteJson);
    if (r) onPick({ tech: { ...r.tech, name: t("preset." + key) }, siteJson: r.siteJson, added: r.added });
  };
  const pickRaw = (type) => onPick({ tech: blankEquipment(type, siteJson), siteJson, added: [] });
  return (
    <Modal title={t("cat.title")} onClose={onClose} wide>
      <div style={{ position: "relative", marginBottom: 14 }}>
        <IcSearch style={{ position: "absolute", left: 12, top: 11, color: "var(--ui-muted)" }} size={20} />
        <input className="ui-input" autoFocus style={{ paddingLeft: 40 }} placeholder={t("cat.search")}
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {["Generación", "Conversión", "Almacenamiento"].map((g) => {
        const list = presets.filter((p) => p.group === g);
        if (!list.length) return null;
        return (
          <section key={g} style={{ marginBottom: 16 }}>
            <div className="ui-group-title" style={{ marginBottom: 8 }}>{t("cat." + g)}</div>
            <div className="cat-grid">
              {list.map((p) => {
                const I = componentIcon({ tech_id: p.key, name: p.label, type: p.type,
                  output_carrier: p.tech?.output_carrier, ports: p.tech?.ports });
                return (
                  <button key={p.key} className="cat-item" onClick={() => pickPreset(p.key)}>
                    <span className="ui-comp-icon" style={{ width: 40, height: 40, fontSize: 22, background: "var(--ui-card-top)" }}><I /></span>
                    {t("preset." + p.key)}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!qq && (
        <section style={{ marginBottom: 8 }}>
          <div className="ui-group-title" style={{ marginBottom: 8 }}>{t("cat.scratch")}</div>
          <div className="cat-grid">
            {Object.keys(TECH_TYPE_META).map((type) => {
              const I = componentIcon({ tech_id: type, type });
              return (
                <button key={type} className="cat-item" onClick={() => pickRaw(type)}>
                  <span className="ui-comp-icon" style={{ width: 40, height: 40, fontSize: 22, background: "var(--ui-card-top)" }}><I /></span>
                  {t("cat.generic", { type: t("type." + type) })}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </Modal>
  );
}
