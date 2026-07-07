// Motor MILP en el NAVEGADOR (deploy.md, arquitectura B): construye el
// archivo LP (formato CPLEX) que highs-js (HiGHS compilado a WebAssembly)
// resuelve en la laptop del visitante. Es un ESPEJO 1:1 del motor Julia
// (src/model + src/constraints) — la equivalencia se verifica contra
// resultados dorados generados por Julia (scripts/verify_wasm.mjs, golden/).
//
// Convenciones de nombres de variable (para extraer la solución):
//   d_<tech>_<s>_<y>   dispatch  · nc_<t>_<y> new_capacity · b_<t>_<y> build
//   soc/ch/dc_<st>_<s>_<y> storage · mf_<mk>_<s>_<y> mercado
//   pk_<mk>_<se>_<y> peak · ex_<mk>_<se>_<y> exceso · nm_<mk>_<p>_<y> neteo
//   off_<y> offsets · ge_<y>/ne_<y> emisiones gross/net

const BALANCED = ["energy", "heat", "cooling"];
const sane = (x) => String(x).replace(/[^A-Za-z0-9]/g, "_");

/** Mercados efectivos: los explícitos, o los sintetizados del esquema legacy
 * (espejo de effective_markets en types.jl). */
function effectiveMarkets(site) {
  if (site.markets?.length) return site.markets;
  const grid = site.technologies.find((t) => t.tech_id === "grid_import");
  if (!grid) return [];
  const c = grid.output_carrier;
  const out = [];
  if (site.prices?.[c])
    out.push({ market_id: "grid_buy", carrier_id: c, direction: "buy",
               price: site.prices[c], connection: "grid_import" });
  if (site.prices?.grid_export)
    out.push({ market_id: "grid_sell", carrier_id: c, direction: "sell",
               price: site.prices.grid_export, connection: "grid_import" });
  return out;
}

const portsOf = (t) => t.ports
  ? { ins: t.ports.inputs, outs: t.ports.outputs }
  : { ins: [{ carrier: t.input_carrier, ratio: 1 / (t.efficiency || 1) }],
      outs: [{ carrier: t.output_carrier, ratio: 1 }] };

/**
 * buildLP(siteJson, cfg) → { lp, constant, meta }
 * cfg = ScenarioConfig resuelto (mismos campos que Julia, post-escenario).
 * `constant` son los términos fijos del objetivo (OPEX de existentes, cargos
 * de conexión, renovaciones, contratada): VAN = objetivo_solver + constant.
 */
export function buildLP(site, cfg) {
  const ts = site.timesteps;
  const S = ts.length, N = cfg.horizon_years;
  const w = ts.map((t) => t.weight_hours);
  const years = Array.from({ length: N }, (_, i) => i + 1);
  const steps = Array.from({ length: S }, (_, i) => i + 1);
  const disc = years.map((y) => 1 / Math.pow(1 + cfg.wacc, y));
  const growth = (y) => Math.pow(1 + cfg.demand_growth, y - 1);
  const esc = (c, y) => Math.pow(1 + (cfg.price_escalation?.[c] ?? 0), y - 1);
  const catOf = Object.fromEntries(site.carriers.map((c) => [c.carrier_id, c.category]));
  const efTab = {};
  for (const f of site.emission_factors ?? [])
    efTab[`${f.carrier_id}|${f.scope}`] = f.factor;

  const allowed = (id) =>
    !cfg.allowed_techs?.length || cfg.allowed_techs.includes(id);
  const techs = site.technologies.filter((t) => allowed(t.tech_id));
  const convs = techs.filter((t) => t.type === "converter");
  const gens = techs.filter((t) => t.type === "generator");
  const stors = techs.filter((t) => t.type === "storage");
  const sources = site.technologies.filter((t) => t.type === "source");
  const cands = [...convs, ...gens, ...stors].filter((t) => t.investable);
  const mkts = effectiveMarkets(site);
  const buys = mkts.filter((m) => m.direction === "buy");
  const grid = site.technologies.find((t) => t.tech_id === "grid_import");
  const gridCarrier = grid?.output_carrier ?? "electricity";

  // estaciones en orden de primera aparición (espejo de parameters.jl)
  const seasonOrder = [];
  const seasonSteps = [];
  ts.forEach((t) => {
    let i = seasonOrder.indexOf(t.season);
    if (i < 0) { seasonOrder.push(t.season); seasonSteps.push([]); i = seasonOrder.length - 1; }
    seasonSteps[i].push(t.step_id);
  });
  const nse = seasonSteps.length, monthsSe = 12 / Math.max(nse, 1);

  // combustible con mercado de compra ⇒ lleva balance
  const fuelWithMkt = new Set(buys.map((m) => m.carrier_id)
    .filter((c) => catOf[c] === "fuel"));
  const balanced = site.carriers.map((c) => c.carrier_id)
    .filter((c) => BALANCED.includes(catOf[c]) || fuelWithMkt.has(c));

  // factor de emisión del mercado por año (espejo M7/M11)
  const mktEF = {};
  for (const mk of mkts) {
    if (mk.direction !== "buy" || catOf[mk.carrier_id] === "fuel") {
      mktEF[mk.market_id] = years.map(() => 0);
    } else if (mk.emission_factor != null) {
      mktEF[mk.market_id] = years.map(() => mk.emission_factor);
    } else {
      const base = efTab[`${mk.carrier_id}|scope2`] ?? 0;
      const onGrid = mk.carrier_id === gridCarrier;
      mktEF[mk.market_id] = years.map((y) =>
        onGrid && cfg.grid_ef_by_year?.length ? cfg.grid_ef_by_year[y - 1] : base);
    }
  }

  // vida útil: existente vivo hasta remaining (0 = siempre; renew ⇒ siempre)
  const alive = (t, y) => {
    const rl = t.remaining_life ?? 0;
    return rl === 0 || cfg.renew_existing || y <= rl;
  };
  // términos de available_capacity(t,y): constante + ventana de nc
  const avail = (t, y) => ({
    k: alive(t, y) ? t.existing_capacity : 0,
    ncs: t.investable
      ? years.filter((yp) => yp <= y && y - yp < t.lifetime_years)
             .map((yp) => `nc_${sane(t.tech_id)}_${yp}`)
      : [],
  });

  // renovación determinística (constante del objetivo)
  const renewalCapex = years.map(() => 0);
  if (cfg.renew_existing)
    for (const t of [...convs, ...gens, ...stors]) {
      const rl = t.remaining_life ?? 0;
      if (rl > 0 && t.existing_capacity > 0)
        for (let y = rl + 1; y <= N; y += Math.max(t.lifetime_years, 1))
          renewalCapex[y - 1] += t.capex_per_kw * 1000 * t.existing_capacity;
    }
  const fixedCharges = sources.filter((s) => allowed(s.tech_id))
    .reduce((a, s) => a + (s.fixed_charge ?? 0), 0);

  // ── objetivo ──
  const obj = {};   // var → coef
  const add = (v, c) => { if (c) obj[v] = (obj[v] ?? 0) + c; };
  let constant = 0;
  const capNet = (y) => N === 1 ? cfg.emissions_cap_net_start :
    cfg.emissions_cap_net_start +
    (cfg.emissions_cap_net_end - cfg.emissions_cap_net_start) * (y - 1) / (N - 1);
  const cprice = (y) => cfg.carbon_price_by_year?.length
    ? cfg.carbon_price_by_year[y - 1] : cfg.carbon_price;

  for (const y of years) {
    const D = disc[y - 1];
    constant += D * (fixedCharges + renewalCapex[y - 1]);
    for (const t of cands) {
      add(`nc_${sane(t.tech_id)}_${y}`, D * t.capex_per_kw * 1000);
      if (cfg.salvage_value) {
        const frac = Math.max(0, (t.lifetime_years - (N - y + 1)) / t.lifetime_years);
        add(`nc_${sane(t.tech_id)}_${y}`, -disc[N - 1] * t.capex_per_kw * 1000 * frac);
      }
    }
    for (const t of [...convs, ...gens, ...stors]) {
      const a = avail(t, y);
      constant += D * t.fixed_opex * a.k;
      for (const v of a.ncs) add(v, D * t.fixed_opex);
      if (t.type !== "storage")
        for (const s of steps)
          add(`d_${sane(t.tech_id)}_${s}_${y}`, D * t.variable_opex * w[s - 1]);
      else
        for (const s of steps)
          add(`dc_${sane(t.tech_id)}_${s}_${y}`, D * t.variable_opex * w[s - 1]);
    }
    for (const mk of mkts) {
      const sign = mk.direction === "buy" ? 1 : -1;   // venta = ingreso
      const nm = mk.direction === "sell" && mk.scheme === "net_metering";
      if (nm) continue;                                // su ingreso va por nm_
      for (const s of steps)
        add(`mf_${sane(mk.market_id)}_${s}_${y}`,
            sign * D * mk.price[s - 1] * esc(mk.carrier_id, y) * w[s - 1]);
    }
    // compra implícita de combustibles SIN mercado
    for (const t of convs)
      for (const p of portsOf(t).ins)
        if (catOf[p.carrier] === "fuel" && !fuelWithMkt.has(p.carrier) &&
            site.prices?.[p.carrier])
          for (const s of steps)
            add(`d_${sane(t.tech_id)}_${s}_${y}`,
                D * site.prices[p.carrier][s - 1] * esc(p.carrier, y) *
                p.ratio * w[s - 1]);
    add(`ge_${y}`, D * cprice(y));
    add(`off_${y}`, D * cfg.offset_price);
    // cargos por demanda (M2/M2b)
    for (const mk of buys) {
      const dc = mk.demand_charge ?? 0;
      const cp = mk.contracted_power;
      const pen = mk.excess_penalty ?? 0;
      if (!(dc > 0 || (cp != null && pen > 0))) continue;
      for (let se = 1; se <= nse; se++) {
        if (cp != null) {
          constant += D * dc * 1000 * monthsSe * cp;
          add(`ex_${sane(mk.market_id)}_${se}_${y}`, D * pen * 1000 * monthsSe);
        } else {
          add(`pk_${sane(mk.market_id)}_${se}_${y}`, D * dc * 1000 * monthsSe);
        }
      }
    }
    // ingreso net metering: O_p · retail medio del período
    for (const mk of mkts) {
      if (!(mk.direction === "sell" && mk.scheme === "net_metering")) continue;
      const periods = mk.netting === "season" ? seasonSteps : [steps];
      const paired = buys.filter((b) =>
        b.connection === mk.connection && b.carrier_id === mk.carrier_id);
      periods.forEach((p, pi) => {
        const wsum = p.reduce((a, s) => a + w[s - 1], 0);
        const retail = paired.length === 0 ? 0 :
          paired.reduce((a, b) =>
            a + p.reduce((x, s) => x + b.price[s - 1] * esc(b.carrier_id, y) * w[s - 1], 0)
              / wsum, 0) / Math.max(paired.length, 1);
        add(`nm_${sane(mk.market_id)}_${pi + 1}_${y}`, -disc[y - 1] * retail);
      });
    }
  }

  // ── restricciones ──
  const rows = [];
  const row = (name, terms, op, rhs) => {
    const body = Object.entries(terms).filter(([, c]) => c !== 0)
      .map(([v, c]) => `${c >= 0 ? "+" : "-"} ${Math.abs(c)} ${v}`).join(" ");
    if (body) rows.push(` ${name}: ${body} ${op} ${rhs}`);
  };
  const T = () => ({});
  const inc = (t, v, c) => { t[v] = (t[v] ?? 0) + c; };

  for (const y of years) {
    // balance por carrier con balance
    for (const c of balanced) {
      for (const s of steps) {
        const t = T();
        for (const cv of convs) {
          const p = portsOf(cv);
          for (const o of p.outs) if (o.carrier === c)
            inc(t, `d_${sane(cv.tech_id)}_${s}_${y}`, o.ratio);
          for (const i of p.ins) if (i.carrier === c)
            inc(t, `d_${sane(cv.tech_id)}_${s}_${y}`, -i.ratio);
        }
        for (const g of gens) if (g.output_carrier === c)
          inc(t, `d_${sane(g.tech_id)}_${s}_${y}`, 1);
        for (const st of stors) {
          const cid = st.output_carrier ?? st.input_carrier;
          if (cid === c) {
            inc(t, `dc_${sane(st.tech_id)}_${s}_${y}`, 1);
            inc(t, `ch_${sane(st.tech_id)}_${s}_${y}`, -1);
          }
        }
        for (const mk of mkts) if (mk.carrier_id === c)
          inc(t, `mf_${sane(mk.market_id)}_${s}_${y}`,
              mk.direction === "buy" ? 1 : -1);
        const dem = (site.demands?.[c]?.[s - 1] ?? 0) * growth(y);
        row(`bal_${sane(c)}_${s}_${y}`, t, "=", dem);
      }
    }
    // capacidad de conversores (disponibilidad M4 + ciclo de vida M5)
    for (const cv of convs) {
      const av = site.generation_profiles?.[cv.tech_id];   // availability
      for (const s of steps) {
        const a = avail(cv, y);
        const f = av ? av[s - 1] : 1;
        const t = { [`d_${sane(cv.tech_id)}_${s}_${y}`]: 1 };
        for (const v of a.ncs) inc(t, v, -f);
        row(`cap_${sane(cv.tech_id)}_${s}_${y}`, t, "<=", f * a.k);
      }
    }
    // generadores: dispatch ≤ cf·capacidad
    for (const g of gens) {
      const cf = site.generation_profiles?.[g.tech_id] ?? steps.map(() => 0);
      for (const s of steps) {
        const a = avail(g, y);
        const t = { [`d_${sane(g.tech_id)}_${s}_${y}`]: 1 };
        for (const v of a.ncs) inc(t, v, -cf[s - 1]);
        row(`gcap_${sane(g.tech_id)}_${s}_${y}`, t, "<=", cf[s - 1] * a.k);
      }
    }
    // storage: SOC cíclico por estación (hora anterior con wrap), límites
    for (const st of stors) {
      const id = sane(st.tech_id);
      const eta = st.efficiency, hrs = st.storage_hours ?? 4;
      for (const grp of seasonSteps) {
        const ordered = [...grp].sort((a, b) => ts[a - 1].hour - ts[b - 1].hour);
        ordered.forEach((s, k) => {
          const prev = ordered[k === 0 ? ordered.length - 1 : k - 1];
          row(`soc_${id}_${s}_${y}`, {
            [`soc_${id}_${s}_${y}`]: 1, [`soc_${id}_${prev}_${y}`]: -1,
            [`ch_${id}_${s}_${y}`]: -eta, [`dc_${id}_${s}_${y}`]: 1 / eta,
          }, "=", 0);
        });
      }
      for (const s of steps) {
        const a = avail(st, y);
        for (const [pref, mult] of [["soc", hrs], ["ch", 1], ["dc", 1]]) {
          const t = { [`${pref}_${id}_${s}_${y}`]: 1 };
          for (const v of a.ncs) inc(t, v, -mult);
          row(`${pref}cap_${id}_${s}_${y}`, t, "<=", mult * a.k);
        }
      }
    }
    // conexiones: Σ compras ≤ import, Σ ventas ≤ export (0 si excluida)
    for (const src of sources) {
      const impL = allowed(src.tech_id) ? src.existing_capacity : 0;
      const expL = allowed(src.tech_id)
        ? (src.export_capacity ?? src.existing_capacity) : 0;
      const bvia = mkts.filter((m) => m.direction === "buy" && m.connection === src.tech_id);
      const svia = mkts.filter((m) => m.direction === "sell" && m.connection === src.tech_id);
      for (const s of steps) {
        if (bvia.length) {
          const t = T();
          bvia.forEach((m) => inc(t, `mf_${sane(m.market_id)}_${s}_${y}`, 1));
          row(`imp_${sane(src.tech_id)}_${s}_${y}`, t, "<=", impL);
        }
        if (svia.length) {
          const t = T();
          svia.forEach((m) => inc(t, `mf_${sane(m.market_id)}_${s}_${y}`, 1));
          row(`exp_${sane(src.tech_id)}_${s}_${y}`, t, "<=", expL);
        }
      }
    }
    // topes propios de mercado + peaks tarifarios + neteo
    for (const mk of mkts) {
      const id = sane(mk.market_id);
      if (mk.max_power != null)
        for (const s of steps)
          row(`mp_${id}_${s}_${y}`, { [`mf_${id}_${s}_${y}`]: 1 }, "<=", mk.max_power);
      if (mk.max_annual != null) {
        const t = T();
        steps.forEach((s) => inc(t, `mf_${id}_${s}_${y}`, w[s - 1]));
        row(`ma_${id}_${y}`, t, "<=", mk.max_annual);
      }
      const dc = mk.demand_charge ?? 0, cp = mk.contracted_power,
            pen = mk.excess_penalty ?? 0;
      if (mk.direction === "buy" && (dc > 0 || (cp != null && pen > 0)))
        seasonSteps.forEach((grp, sei) => {
          const se = sei + 1;
          for (const s of grp)
            row(`pkd_${id}_${se}_${s}_${y}`,
                { [`pk_${id}_${se}_${y}`]: 1, [`mf_${id}_${s}_${y}`]: -1 }, ">=", 0);
          if (cp != null)
            row(`exd_${id}_${se}_${y}`,
                { [`ex_${id}_${se}_${y}`]: 1, [`pk_${id}_${se}_${y}`]: -1 }, ">=", -cp);
        });
      if (mk.direction === "sell" && mk.scheme === "net_metering") {
        const periods = mk.netting === "season" ? seasonSteps : [steps];
        const paired = buys.filter((b) =>
          b.connection === mk.connection && b.carrier_id === mk.carrier_id);
        periods.forEach((p, pi) => {
          const tE = { [`nm_${id}_${pi + 1}_${y}`]: 1 };
          p.forEach((s) => inc(tE, `mf_${id}_${s}_${y}`, -w[s - 1]));
          row(`nme_${id}_${pi + 1}_${y}`, tE, "<=", 0);
          const tI = { [`nm_${id}_${pi + 1}_${y}`]: 1 };
          paired.forEach((b) =>
            p.forEach((s) => inc(tI, `mf_${sane(b.market_id)}_${s}_${y}`, -w[s - 1])));
          row(`nmi_${id}_${pi + 1}_${y}`, tI, "<=", 0);
        });
      }
    }
    // emisiones: gross = scope1 + scope2 · net = gross − off · caps
    const tg = { [`ge_${y}`]: 1 };
    for (const cv of convs)
      for (const p of portsOf(cv).ins)
        if (catOf[p.carrier] === "fuel") {
          const f = efTab[`${p.carrier}|scope1`] ?? 0;
          for (const s of steps)
            inc(tg, `d_${sane(cv.tech_id)}_${s}_${y}`, -f * p.ratio * w[s - 1]);
        }
    for (const mk of buys) {
      const f = mktEF[mk.market_id][y - 1];
      if (f) for (const s of steps)
        inc(tg, `mf_${sane(mk.market_id)}_${s}_${y}`, -f * w[s - 1]);
    }
    row(`gedef_${y}`, tg, "=", 0);
    row(`nedef_${y}`, { [`ne_${y}`]: 1, [`ge_${y}`]: -1, [`off_${y}`]: 1 }, "=", 0);
    if (cfg.allow_offsets) {
      row(`offsh_${y}`, { [`off_${y}`]: 1, [`ge_${y}`]: -cfg.max_offset_share }, "<=", 0);
      row(`offav_${y}`, { [`off_${y}`]: 1 }, "<=", cfg.offset_availability);
    } else {
      row(`offz_${y}`, { [`off_${y}`]: 1 }, "=", 0);
    }
    row(`ncap_${y}`, { [`ne_${y}`]: 1 }, "<=", capNet(y));
    row(`gcapE_${y}`, { [`ge_${y}`]: 1 }, "<=", cfg.emissions_cap_gross);
  }
  // inversión: nc ≤ maxnew·b · a-lo-más-una compra · forzadas
  const binaries = [];
  for (const t of cands) {
    const id = sane(t.tech_id);
    for (const y of years) {
      binaries.push(`b_${id}_${y}`);
      row(`link_${id}_${y}`,
          { [`nc_${id}_${y}`]: 1, [`b_${id}_${y}`]: -t.max_new_capacity }, "<=", 0);
    }
    if (!cfg.repeat_investments) {
      const tr = T();
      years.forEach((y) => inc(tr, `b_${id}_${y}`, 1));
      row(`once_${id}`, tr, "<=", 1);
    }
  }
  for (const [tech, yr, mw] of (cfg.forced_builds ?? []).map((f) =>
       Array.isArray(f) ? f : [f.tech, f.year, f.mw])) {
    const yrel = cfg.base_year > 0 && yr > 1900 ? yr - cfg.base_year + 1 : yr;
    if (yrel >= 1 && yrel <= N && cands.some((t) => t.tech_id === tech))
      row(`forced_${sane(tech)}_${yrel}`,
          { [`nc_${sane(tech)}_${yrel}`]: 1 }, ">=", mw);
  }

  const objBody = Object.entries(obj).filter(([, c]) => c !== 0)
    .map(([v, c]) => `${c >= 0 ? "+" : "-"} ${Math.abs(c)} ${v}`).join(" ");
  const lp = `Minimize\n obj: ${objBody}\nSubject To\n${rows.join("\n")}\n` +
    (binaries.length ? `Binary\n ${binaries.join(" ")}\n` : "") + "End\n";
  return { lp, constant, meta: { S, N, binaries: binaries.length, rows: rows.length } };
}
