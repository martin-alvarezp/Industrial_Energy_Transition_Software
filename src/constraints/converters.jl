# Conversores (SPEC §7.3): output = input · efficiency, constante en el horizonte.
#
# La variable de decisión es el OUTPUT (`dispatch`, SPEC §5); el input se define
# como la expresión `conv_input[t,s,y] = dispatch[t,s,y] / efficiency[t]`, con lo
# que output = input·efficiency se cumple por construcción (sin fila extra en el
# MILP ni variables fuera del §5). heat_pump usa su COP como efficiency.
#
# `conv_input` es el consumo que entra al balance del carrier de entrada (§7.1)
# y la cantidad comprada de combustible en el objetivo (§6).

"""
    add_converter_relations!(m, sets, params) -> m

Registra `conv_input[conv, step, y]` (MW de input) en el modelo.
"""
function add_converter_relations!(m::JuMP.Model, sets::ModelSets, params::ModelParameters)
    dispatch = m[:dispatch]
    JuMP.@expression(m,
        conv_input[t in sets.converters, s in sets.steps, y in sets.years],
        dispatch[t, s, y] / params.efficiency[t])
    return m
end
