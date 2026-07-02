# Unidades y convenciones (SPEC §13):
#   capacidad MW · dispatch MW por paso · precios USD/MWh · CAPEX USD/kW
#   emisiones tCO₂e · factores tCO₂e/MWh · año y ∈ {1,...,horizon_years}

"Horas de un año calendario; Σ weight_hours del año-plantilla debe igualarlo."
const HOURS_PER_YEAR = 8760.0

"Número de pasos del año-plantilla: 4 estaciones × 24 horas (SPEC §4)."
const STEPS_PER_YEAR = 96

const KW_PER_MW = 1000.0

kw_to_mw(kw::Real) = kw / KW_PER_MW
mw_to_kw(mw::Real) = mw * KW_PER_MW

"CAPEX total (USD) de instalar `capacity_mw` con costo unitario `capex_per_kw` (USD/kW)."
capex_total(capex_per_kw::Real, capacity_mw::Real) = capex_per_kw * KW_PER_MW * capacity_mw

"Energía (MWh) de un dispatch (MW) sostenido durante `weight_hours` horas."
energy_mwh(dispatch_mw::Real, weight_hours::Real) = dispatch_mw * weight_hours

"Factor de descuento del año `y` (año 1 = presente): 1/(1+wacc)^y (SPEC §6)."
discount_factor(wacc::Real, y::Integer) = 1.0 / (1.0 + wacc)^y

"Escala un valor base del año-plantilla al año `y` con tasa anual `rate` (SPEC §4)."
escalate(base::Real, rate::Real, y::Integer) = base * (1.0 + rate)^(y - 1)
