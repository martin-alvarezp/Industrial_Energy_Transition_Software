// Editor de componentes fuera del mapa (páginas Componentes y Potenciales):
// catálogo → panel de edición → guardar en el sitio. Devuelve las acciones y
// el nodo a renderizar.
import { useState } from "react";
import { useStudio } from "../studio.jsx";
import CatalogModal from "./CatalogModal.jsx";
import EquipmentDrawer from "../../components/twin/EquipmentDrawer.jsx";
import { upsertTech, removeTech, isMultiport } from "../../lib/twin.js";

export default function useComponentEditor({ defaults = {} } = {}) {
  const { twin, patchSite, patchLayout } = useStudio();
  const [catalog, setCatalog] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const siteJson = twin?.siteJson;

  const open = (tech) => setDrawer({ tech: { ...tech, ports_mode: isMultiport(tech) }, isNew: false });
  const add = () => setCatalog(true);
  const remove = (tech) => {
    patchSite((sj) => removeTech(sj, tech.tech_id), `Componente '${tech.name}' eliminado`);
    patchLayout((l) => {
      const { [tech.tech_id]: _a, ...equipment } = l.equipment ?? {};
      const { [tech.tech_id]: _b, ...equipmentLocation } = l.equipmentLocation ?? {};
      return { equipment, equipmentLocation };
    });
    setDrawer(null);
  };

  const node = (
    <>
      {catalog && siteJson && (
        <CatalogModal siteJson={siteJson} onClose={() => setCatalog(false)}
                      onPick={({ tech, siteJson: sj, added }) => {
                        if (added.length) patchSite(() => sj, `Vectores agregados: ${added.join(", ")}`);
                        setDrawer({ tech: { ...tech, ...defaults }, isNew: true });
                        setCatalog(false);
                      }} />
      )}
      {drawer && siteJson && (
        <EquipmentDrawer tech={drawer.tech} isNew={drawer.isNew} siteJson={siteJson}
                         center={twin.layout.center} onClose={() => setDrawer(null)}
                         onDelete={(id) => remove(siteJson.technologies.find((x) => x.tech_id === id) ?? { tech_id: id, name: id })}
                         onSave={(tech) => {
                           patchSite((sj) => upsertTech(sj, tech),
                                     drawer.isNew ? `Componente '${tech.name}' agregado` : `Componente '${tech.name}' editado`);
                           setDrawer(null);
                         }} />
      )}
    </>
  );
  return { open, add, remove, node, editing: drawer?.tech?.tech_id ?? null };
}
