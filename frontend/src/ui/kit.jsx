// Piezas reutilizables de la interfaz: menú de tres puntos, modal, select con
// rótulo flotante, encabezado de página y estado vacío.
import { useEffect, useRef, useState } from "react";
import { MdMoreVert, MdHelpOutline, MdClose } from "react-icons/md";

export function useClickOutside(ref, onOut, active = true) {
  useEffect(() => {
    if (!active) return;
    const on = (e) => { if (ref.current && !ref.current.contains(e.target)) onOut(); };
    const key = (e) => e.key === "Escape" && onOut();
    document.addEventListener("mousedown", on);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("keydown", key); };
  }, [ref, onOut, active]);
}

/** Botón que abre un menú. `items`: [{label, icon, onClick, danger, hidden} | "-" | {header}] */
export function Menu({ trigger, items, align = "right", label = "menu", up = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useClickOutside(ref, () => setOpen(false), open);
  const shown = items.filter((i) => i && !i.hidden);
  return (
    <div className="ui-menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      {trigger
        ? trigger({ open, toggle: () => setOpen((o) => !o) })
        : <button className="ui-dots" aria-label={label} onClick={() => setOpen((o) => !o)}>
            <MdMoreVert />
          </button>}
      {open && (
        <div className={"ui-menu " + (align === "right" ? "right" : "")}
             style={up ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }}>
          {shown.map((it, i) =>
            it === "-" ? <hr key={i} />
            : it.header ? <div key={i} className="hd">{it.header}</div>
            : it.render ? <div key={i}>{it.render(() => setOpen(false))}</div>
            : (
              <button key={i} className={it.danger ? "danger" : ""} disabled={it.disabled}
                      onClick={() => { setOpen(false); it.onClick?.(); }}>
                {it.icon && <it.icon size={18} />}{it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, footer, wide = false }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="ui-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={"ui-modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="ui-modal-head">
          <h3>{title}</h3>
          <button className="ui-dots" style={{ marginLeft: "auto" }} onClick={onClose}
                  aria-label="cerrar"><MdClose /></button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function LabeledSelect({ label, value, onChange, options, style }) {
  return (
    <label className="ui-lsel" style={style}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function PageHead({ icon: Icon, title, help, children }) {
  return (
    <div className="ui-page-head">
      <h1 className="ui-page-title">{Icon && <Icon />}{title}</h1>
      {help && <span className="ui-help" title={help}><MdHelpOutline /></span>}
      <div className="ui-page-actions">{children}</div>
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="ui-empty">
      {Icon && <Icon />}
      <h3>{title}</h3>
      <div>{children}</div>
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}

/** Aviso flotante breve (copiado, guardado…). */
export function useFlash() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  const node = msg ? <div className="ui-toast" role="status">{msg}</div> : null;
  return [node, setMsg];
}
