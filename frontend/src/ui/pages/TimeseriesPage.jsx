import { useI18n } from "../i18n.jsx";
import { useStudio } from "../studio.jsx";
import { PageHead } from "../kit.jsx";
import { NAV_ICONS } from "../icons.jsx";
import SeriesEditor from "../../components/twin/SeriesEditor.jsx";


export default function TimeseriesPage() {
  const { t } = useI18n();
  const { twin, patchSite } = useStudio();
  return (
    <div className="ui-page ui-legacy">
      <PageHead icon={NAV_ICONS.timeseries} title={t("nav.timeseries")} help={t("ts.help")} />
      <SeriesEditor siteJson={twin.siteJson} patchSite={(fn) => patchSite(fn, "Series de tiempo editadas")} />
    </div>
  );
}
