// Armazón de la aplicación: barra superior, barra lateral y área de contenido.
import { useEffect, useMemo, useState } from "react";
import {
  IcSearch, IcLink, IcHelpOutline, IcAdd, IcClose, IcChevronLeft, IcChevronRight,
  IcExpandLess, IcExpandMore, IcCheck, IcMenu,
} from "./iconset.jsx";
import { useI18n } from "./i18n.jsx";
import { useStudio } from "./studio.jsx";
import { hrefFor, navigate } from "./router.js";
import { LIBRARY_NAV, SYSTEM_SECTIONS, ALL_SYSTEM_PAGES } from "./nav.js";
import { NAV_ICONS, componentIcon } from "./icons.jsx";
import { Menu, Modal, useClickOutside, useFlash } from "./kit.jsx";
import { readJSON, writeJSON, useStored } from "./storage.js";
import { musd, pct, tons, setNumberLocale } from "../lib/format.js";
import ModelDoc from "../components/ModelDoc.jsx";

export function Logo() {
  return (
    <a className="ui-logo" href="#/systems" aria-label="IETO">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <circle cx="6" cy="6" r="4" fill="currentColor" />
        <circle cx="20" cy="9" r="3.2" fill="currentColor" opacity="0.75" />
        <circle cx="10" cy="20" r="3.2" fill="currentColor" opacity="0.55" />
        <path d="M6 6 20 9 10 20Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      IETO
    </a>
  );
}

// ── indicadores KPI fijables en la barra superior ──
export function kpiCatalog(t, data) {
  const r = data?.result;
  const k = r?.kpis;
  const em = r?.emissions ?? [];
  const red = em.length > 1 && em[0].net > 0 ? 1 - em[em.length - 1].net / em[0].net : null;
  const opex = (r?.cost_breakdown ?? []).reduce((s, c) => s + (c.total - c.capex), 0);
  return [
    { id: "npv", label: t("kpi.npv"), value: k ? musd(k.npv) : "—" },
    { id: "capex", label: t("kpi.capex"), value: k ? musd(k.total_capex) : "—" },
    { id: "opex", label: t("kpi.opex"), value: r ? musd(opex) : "—" },
    { id: "net", label: t("kpi.netFinal"), value: k ? tons(k.final_net_emissions) : "—" },
    { id: "reduction", label: t("kpi.reduction"), value: red == null ? "—" : pct(red) },
    { id: "res", label: t("kpi.res"), value: k ? pct(k.res_share_final) : "—" },
  ];
}

function KpiBadges() {
  const { t } = useI18n();
  const { data, siteName } = useStudio();
  const [pinned, setPinned] = useStored("ieto.kpibadges", []);
  const cat = kpiCatalog(t, data);
  if (!siteName) return null;
  return (
    <div className="ui-top-center">
      {pinned.map((id) => {
        const k = cat.find((x) => x.id === id);
        if (!k) return null;
        return (
          <span key={id} className="ui-kpi-badge" title={k.label}>
            {k.label}: <span className="v">{k.value}</span>
            <button aria-label={t("kpi.remove")}
                    onClick={() => setPinned((p) => p.filter((x) => x !== id))}>
              <IcClose size={16} />
            </button>
          </span>
        );
      })}
      <Menu align="left" label={t("top.kpiBadge")}
            trigger={({ toggle }) => (
              <button className="ui-pill-btn" onClick={toggle}>
                <IcAdd size={20} /> {t("top.kpiBadge")}
              </button>)}
            items={[
              { header: data ? t("kpi.pick") : t("kpi.noRun") },
              ...cat.map((k) => ({
                label: `${k.label} · ${k.value}`,
                icon: pinned.includes(k.id) ? IcCheck : undefined,
                onClick: () => setPinned((p) => p.includes(k.id)
                  ? p.filter((x) => x !== k.id) : [...p, k.id]),
              })),
            ]} />
    </div>
  );
}

// ── perfil: nombre, idioma, estado del motor ──
function UserMenu() {
  const { t, lang, setLang } = useI18n();
  const { apiUp } = useStudio();
  const [user, setUser] = useStored("ieto.user", { name: "" });
  const initials = (user.name || "IETO").split(/\s+/).filter(Boolean)
    .map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <Menu label={t("user.profile")}
          trigger={({ toggle }) => (
            <button className="ui-avatar" onClick={toggle} aria-label={t("user.profile")}>
              {initials}
            </button>)}
          items={[
            { header: t("user.profile") },
            { render: () => (
                <div style={{ padding: "4px 12px 8px" }}>
                  <label className="ui-hint" style={{ margin: 0 }}>{t("user.name")}</label>
                  <input className="ui-input" value={user.name} style={{ height: 34, marginTop: 4 }}
                         onChange={(e) => setUser({ ...user, name: e.target.value })} />
                </div>) },
            { header: t("user.language") },
            { label: "Español", icon: lang === "es" ? IcCheck : undefined, onClick: () => setLang("es") },
            { label: "English", icon: lang === "en" ? IcCheck : undefined, onClick: () => setLang("en") },
            "-",
            { render: () => (
                <div style={{ padding: "4px 12px", fontSize: 13, color: "var(--ui-muted)" }}>
                  {t("user.engine")}:{" "}
                  {apiUp == null ? t("user.connecting") : apiUp ? t("user.engineApi") : t("user.engineWeb")}
                </div>) },
          ]} />
  );
}

// ── paleta de comandos (Ctrl/⌘ K) ──
function CommandPalette({ onClose }) {
  const { t } = useI18n();
  const { siteName, twin, sites } = useStudio();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = useMemo(() => {
    const out = [];
    for (const n of LIBRARY_NAV)
      out.push({ label: t(n.key), sub: t("cmd.views"), icon: NAV_ICONS[n.page],
                 href: hrefFor({ scope: n.scope, page: n.page }) });
    if (siteName) {
      for (const n of ALL_SYSTEM_PAGES)
        out.push({ label: t(n.key), sub: siteName, icon: NAV_ICONS[n.icon ?? n.page],
                   href: hrefFor({ site: siteName, page: n.page }) });
      for (const tech of twin?.siteJson?.technologies ?? [])
        out.push({ label: tech.name, sub: t("nav.components"), icon: componentIcon(tech),
                   href: hrefFor({ site: siteName, page: "components", query: { c: tech.tech_id } }) });
      for (const loc of twin?.layout?.locations ?? [])
        out.push({ label: loc.name, sub: t("nav.locations"), icon: NAV_ICONS.locations,
                   href: hrefFor({ site: siteName, page: "infrastructure", query: { loc: loc.id } }) });
    }
    for (const s of sites ?? [])
      out.push({ label: s, sub: t("nav.systems"), icon: NAV_ICONS.systems,
                 href: hrefFor({ site: s, page: "infrastructure" }) });
    const qq = q.trim().toLowerCase();
    return qq ? out.filter((i) => `${i.label} ${i.sub}`.toLowerCase().includes(qq)) : out;
  }, [q, t, siteName, twin, sites]);
  const go = (it) => { navigate(it.href); onClose(); };
  return (
    <div className="ui-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ui-modal ui-cmd">
        <input className="ui-input" autoFocus placeholder={t("cmd.placeholder")} value={q}
               onChange={(e) => { setQ(e.target.value); setSel(0); }}
               onKeyDown={(e) => {
                 if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
                 if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                 if (e.key === "Enter" && items[sel]) go(items[sel]);
                 if (e.key === "Escape") onClose();
               }} />
        <div className="ui-cmd-list">
          {items.length === 0 && <div className="ui-empty" style={{ padding: 24 }}>{t("cmd.none")}</div>}
          {items.slice(0, 60).map((it, i) => (
            <div key={it.href + i} className={"ui-cmd-item" + (i === sel ? " on" : "")}
                 onMouseEnter={() => setSel(i)} onClick={() => go(it)}>
              {it.icon && <it.icon size={20} />} {it.label} <small>{it.sub}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TopBar({ route, onMenu }) {
  const { t, lang } = useI18n();
  const { siteName, twin } = useStudio();
  const [cmd, setCmd] = useState(false);
  const [help, setHelp] = useState(false);
  const [flash, setFlash] = useFlash();
  useEffect(() => { setNumberLocale(lang); }, [lang]);
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setCmd(true); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const loc = route.query?.loc ? twin?.layout?.locations?.find((l) => l.id === route.query.loc) : null;
  const libItem = route.scope === "library" ? LIBRARY_NAV.find((n) => n.page === route.page) : null;
  return (
    <header className="ui-topbar">
      {/* sólo en pantalla angosta (ui.css): abre la barra lateral como cajón */}
      <button className="ui-icon-btn ui-menu-btn" aria-label={t("nav.menu")} onClick={onMenu}>
        <IcMenu size={24} />
      </button>
      <Logo />
      <nav className="ui-crumbs" aria-label="breadcrumb">
        {route.scope === "system" && siteName && (
          <>
            <span className="sep"><IcChevronRight size={20} /></span>
            <a href={hrefFor({ site: siteName, page: "infrastructure" })}>{twin?.layout?.title || twin?.siteJson?.name || siteName}</a>
            {loc && <><span className="sep">/</span><span className="here">{loc.name}</span></>}
          </>
        )}
        {libItem && (
          <><span className="sep"><IcChevronRight size={20} /></span><span>{t(libItem.key)}</span></>
        )}
      </nav>
      {route.scope === "system" && <KpiBadges />}
      <div className="ui-top-right">
        <button className="ui-search" onClick={() => setCmd(true)} aria-label={t("top.search")}>
          <IcSearch size={20} /> <span className="ui-kbd">Ctrl K</span>
        </button>
        <button className="ui-icon-btn ui-hide-sm" title={t("top.copyLink")} aria-label={t("top.copyLink")}
                onClick={() => {
                  navigator.clipboard?.writeText(window.location.href)
                    .then(() => setFlash(t("top.linkCopied")), () => setFlash(window.location.href));
                }}>
          <IcLink size={24} style={{ transform: "rotate(-45deg)" }} />
        </button>
        <button className="ui-icon-btn" title={t("top.help")} aria-label={t("top.help")}
                onClick={() => setHelp(true)}>
          <IcHelpOutline size={24} />
        </button>
        <UserMenu />
      </div>
      {cmd && <CommandPalette onClose={() => setCmd(false)} />}
      {help && <ModelDoc onClose={() => setHelp(false)} />}
      {flash}
    </header>
  );
}

export function Sidebar({ route, collapsed, setCollapsed, onNavigate }) {
  const { t } = useI18n();
  const { siteName } = useStudio();
  const [closed, setClosed] = useStored("ieto.nav.closed",
    Object.fromEntries(SYSTEM_SECTIONS.filter((s) => s.collapsed).map((s) => [s.id, true])));
  const inSystem = route.scope === "system" && siteName;
  const Item = ({ href, iconKey, label, active }) => {
    const I = NAV_ICONS[iconKey];
    return (
      <a className={"ui-nav-item" + (active ? " active" : "")} href={href} title={collapsed ? label : undefined}>
        {I && <I />}<span>{label}</span>
      </a>
    );
  };
  return (
    <aside className="ui-sidebar" onClick={(e) => { if (e.target.closest("a")) onNavigate?.(); }}>
      <nav className="ui-nav">
        {!inSystem && LIBRARY_NAV.map((n) => (
          <Item key={n.page} href={hrefFor({ scope: n.scope, page: n.page })} iconKey={n.page}
                label={t(n.key)}
                active={(n.scope === "home" && route.scope === "home") ||
                        (route.scope === "library" && route.page === n.page)} />
        ))}
        {inSystem && SYSTEM_SECTIONS.map((sec) => {
          const SecIcon = NAV_ICONS[sec.icon];
          const isClosed = !!closed[sec.id];
          return (
            <div key={sec.id}>
              <button className={"ui-nav-section" + (isClosed ? " muted" : "")}
                      onClick={() => setClosed((c) => ({ ...c, [sec.id]: !c[sec.id] }))}
                      aria-expanded={!isClosed}>
                {SecIcon && <SecIcon />}<span>{t(sec.key)}</span>
                {!isClosed && <IcExpandLess className="chev" />}
              </button>
              {!isClosed && sec.items.map((n, i) => n.sub
                ? <div key={"sub" + i} className="ui-nav-sub">{t(n.sub)}</div>
                : <Item key={n.page} href={hrefFor({ site: siteName, page: n.page })}
                        iconKey={n.icon ?? n.page} label={t(n.key)} active={route.page === n.page} />)}
            </div>
          );
        })}
      </nav>
      <div className="ui-sidebar-foot">
        <button className="ui-nav-item" onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <IcChevronRight /> : <IcChevronLeft />}
          <span>{collapsed ? t("nav.expand") : t("nav.minimize")}</span>
        </button>
      </div>
    </aside>
  );
}

/** Aviso de "último ingreso" al abrir la app (como en la referencia). */
let LOGIN = null;   // se calcula una sola vez por carga de la página
export function LastLoginToast() {
  const { t, lang } = useI18n();
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!LOGIN) {
      LOGIN = { prev: readJSON("ieto.lastLogin", null) };
      writeJSON("ieto.lastLogin", new Date().toISOString());
    }
    const d = LOGIN.prev ? new Date(LOGIN.prev) : null;
    const fmt = d && d.toLocaleString(lang === "en" ? "en-US" : "es-CL",
      { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setMsg(d ? t("top.lastLogin", { date: fmt }) : t("top.firstLogin"));
    const tm = setTimeout(() => setMsg(null), 5000);
    return () => clearTimeout(tm);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return msg ? <div className="ui-toast" role="status" onClick={() => setMsg(null)}>{msg}</div> : null;
}

export function useCollapsed() {
  return useStored("ieto.nav.collapsed", false);
}
// re-export para las páginas
export { Modal, useClickOutside };
