"""
bom_library.py — FlowSeer Pricing Discovery Engine
Directive 53 — W251 BOP Component Decomposition Library

For each of the 19 BOP categories, defines:
  - Sub-component breakdown with low/mid/high pricing
  - Integration/installation factor
  - Key suppliers per component
  - Search terms for catalog pricing discovery

All values in USD. Base year 2024.
Integration factor applied on top of hardware total.
"""
from __future__ import annotations

from typing import Dict, List
from models import BomItem, CONF_BUDGETARY


# Integration/installation factors by system complexity
INTEGRATION_FACTORS = {
    "simple":   0.25,   # simple mechanical, few connections
    "standard": 0.35,   # typical BOP system
    "complex":  0.45,   # complex instrumentation, multi-system integration
    "critical": 0.55,   # safety-critical, extensive testing/commissioning
}


def apply_integration(items: List[BomItem], factor: float) -> BomItem:
    """Return integration cost BomItem based on hardware subtotal."""
    hw_mid = sum(i.mid_usd for i in items)
    return BomItem(
        component="Integration / Installation / Commissioning",
        description=f"Field installation, mechanical integration, wiring, loop checks, commissioning ({int(factor*100)}% of hardware)",
        low_usd=hw_mid * factor * 0.85,
        mid_usd=hw_mid * factor,
        high_usd=hw_mid * factor * 1.20,
        unit="lump sum",
        source="Industry standard EPC factor",
        confidence=CONF_BUDGETARY,
    )


# ── Category BOM definitions ──────────────────────────────────────────────────
# Each entry: category_code → {"name": str, "factor": str, "suppliers": [...], "search_terms": [...], "bom": [...]}

BOM_LIBRARY: Dict[str, dict] = {

    "VIB_MON": {
        "name": "Vibration Monitoring System",
        "factor": "complex",
        "target_mw": 50.0,
        "suppliers": ["Bently Nevada", "Emerson", "PCB Piezotronics", "Brüel & Kjær"],
        "search_terms": [
            '"gas turbine" "vibration monitoring" "budgetary price"',
            'site:bently.com "vibration monitoring system" price',
            '"Bently Nevada 3500" price quote',
            '"vibration monitoring" "50MW" OR "W251" price',
            'vibration monitoring gas turbine BOP cost filetype:pdf',
        ],
        "bom": [
            BomItem("Proximity probes (radial + thrust)", "Eddy-current proximity probes, 8-12 per bearing", 18000, 24000, 32000, source="Bently Nevada catalog"),
            BomItem("Vibration transmitters / monitors", "3500 series or equivalent rack-mount monitors", 35000, 48000, 65000, source="Bently Nevada"),
            BomItem("Accelerometers (casing vibration)", "Industrial accelerometers, seismic mounts", 8000, 12000, 18000, source="PCB Piezotronics"),
            BomItem("Junction boxes and cabling", "Shielded cable, junction boxes, conduit", 15000, 22000, 30000, source="EPC estimate"),
            BomItem("Keyphasor / speed probes", "Shaft speed and phase reference sensors", 6000, 9000, 13000, source="Bently Nevada"),
            BomItem("DCS/PLC integration cards", "Signal conditioning, I/O modules, MODBUS/OPC", 12000, 18000, 25000, source="Emerson"),
            BomItem("Software / licensing", "System 1 or equivalent condition monitoring software", 20000, 30000, 45000, source="Bently Nevada"),
            BomItem("Engineering / FAT testing", "Engineering hours, factory acceptance test", 15000, 22000, 32000, source="Industry rate"),
        ],
    },

    "INLET_AIR": {
        "name": "Inlet Air Filtering System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Donaldson", "Camfil", "AAF International", "Parker Hannifin"],
        "search_terms": [
            '"inlet air filter" "gas turbine" "budgetary" OR "list price"',
            'site:donaldson.com "gas turbine" "inlet" price',
            '"inlet air filtration" "50MW" cost OR price filetype:pdf',
            '"pulse jet" "inlet filter house" price quote',
            'gas turbine inlet filter house EPC cost FERC',
        ],
        "bom": [
            BomItem("Filter housing / plenum structure", "Structural steel housing, weather hood, access doors", 70000, 95000, 130000, source="EPC estimate"),
            BomItem("Primary filter elements", "High-efficiency barrier filters, MERV-14+", 25000, 38000, 52000, source="Donaldson catalog"),
            BomItem("Pre-filter elements", "Coarse inlet screens and pre-separators", 8000, 12000, 18000, source="Donaldson"),
            BomItem("Pulse cleaning system", "Compressed air pulse jet cleaning, timer controls", 18000, 28000, 40000, source="Donaldson"),
            BomItem("Inlet silencer / acoustic treatment", "Splitter silencer, acoustic lining", 45000, 62000, 85000, source="Industrial Acoustics"),
            BomItem("Anti-icing system", "Electric heat trace or steam coil, controls", 22000, 32000, 45000, source="EPC estimate"),
            BomItem("Inlet ducting", "Expansion joints, transition pieces, ductwork", 35000, 50000, 70000, source="EPC fabrication"),
            BomItem("Moisture separators", "Inertial separators, drain system", 15000, 22000, 32000, source="Ceco Environmental"),
            BomItem("Instrumentation", "DP transmitters, temperature, airflow", 12000, 18000, 26000, source="Emerson"),
            BomItem("Structural support steel", "Foundation frame, access platforms", 22000, 32000, 45000, source="EPC fabrication"),
        ],
    },

    "FUEL_GAS": {
        "name": "Fuel Gas System",
        "factor": "critical",
        "target_mw": 50.0,
        "suppliers": ["Emerson", "Cameron (Baker Hughes)", "Flowserve", "Kimray", "Heliogen"],
        "search_terms": [
            '"fuel gas system" "gas turbine" cost OR price',
            '"fuel gas conditioning" "50MW" filetype:pdf',
            '"gas pressure regulation" "gas turbine" BOP cost',
            'site:emerson.com "fuel gas" "gas turbine" price',
            '"fuel gas skid" "W251" OR "frame 6" price quote',
        ],
        "bom": [
            BomItem("Gas pressure regulation skid", "Two-stage pressure regulation, relief valves, bypass", 80000, 115000, 160000, source="Cameron/Emerson"),
            BomItem("Gas filtration / coalescer", "High-pressure gas filter, liquid knockout", 35000, 50000, 70000, source="Peerless"),
            BomItem("Gas flow metering", "Ultrasonic or orifice meter, flow computer", 25000, 38000, 55000, source="Emerson"),
            BomItem("Gas heater (electric or hot water)", "Prevent hydrate formation, maintain Wobbe index", 30000, 45000, 65000, source="Exotherm"),
            BomItem("Emergency shutoff valves", "ESD valves, solenoids, limit switches", 20000, 30000, 45000, source="Flowserve"),
            BomItem("Gas chromatograph / BTU analyzer", "Continuous gas quality monitoring", 28000, 40000, 58000, source="Emerson"),
            BomItem("Piping, valves, fittings", "High-pressure CS/SS piping, instrumentation valves", 35000, 52000, 75000, source="EPC estimate"),
            BomItem("Skid structure / enclosure", "Structural steel skid, weatherproof enclosure", 18000, 26000, 38000, source="EPC fabrication"),
            BomItem("Controls / PLC panel", "Safety PLC, HMI, interlock logic", 25000, 38000, 55000, source="Emerson"),
            BomItem("Insulation / heat tracing", "Pipe insulation, electric heat trace on condensate risk lines", 12000, 18000, 26000, source="EPC estimate"),
        ],
    },

    "LUBE_OIL": {
        "name": "Lube Oil System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Voith", "Waukesha Bearings", "Rexnord", "SKF", "Castrol (BP)"],
        "search_terms": [
            '"lube oil system" "gas turbine" price OR cost',
            '"lube oil console" "50MW" OR "W251" budgetary',
            '"lube oil skid" "gas turbine" EPC cost filetype:pdf',
            'gas turbine lube oil system BOP cost FERC filing',
        ],
        "bom": [
            BomItem("Lube oil reservoir / tank", "Carbon steel reservoir, heating, level indicators", 22000, 32000, 46000),
            BomItem("Main lube oil pumps (2x)", "AC motor-driven, 100% redundancy", 18000, 26000, 38000),
            BomItem("Emergency DC lube oil pump", "Battery-backed DC pump for coastdown", 12000, 18000, 26000),
            BomItem("Oil coolers (air or water)", "Plate-frame or air-cooled heat exchangers", 25000, 36000, 52000),
            BomItem("Oil filters (duplex)", "Duplex filters, transfer valve, 10 micron", 8000, 12000, 18000),
            BomItem("Oil conditioning system", "Centrifugal separator or vacuum dehydrator", 15000, 22000, 32000),
            BomItem("Piping, valves, instrumentation", "Carbon steel piping, flow/temp/pressure instrumentation", 20000, 30000, 43000),
            BomItem("Lube oil console / control panel", "Integrated control panel, alarms, shutdowns", 18000, 26000, 38000),
            BomItem("Oil mist eliminator", "Bearing housing vents, oil mist collection", 8000, 12000, 18000),
        ],
    },

    "EXHAUST": {
        "name": "Exhaust System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["CECO Environmental", "Burgess-Manning", "Jensen Industries", "Maxim Silencers"],
        "search_terms": [
            '"exhaust system" "gas turbine" "50MW" cost',
            '"exhaust silencer" "gas turbine" price quote',
            '"exhaust stack" "W251" OR "frame 6" EPC cost',
            '"exhaust diffuser" "gas turbine" budgetary price',
            'gas turbine exhaust system BOP cost filetype:pdf',
        ],
        "bom": [
            BomItem("Exhaust diffuser / transition", "Refractory-lined expansion from turbine exit", 35000, 50000, 72000),
            BomItem("Exhaust silencer", "Splitter-type reactive silencer, CS/refractory", 45000, 65000, 92000),
            BomItem("Exhaust stack / bypass stack", "Self-supporting stack, weather cap, drain", 55000, 78000, 110000),
            BomItem("Expansion joints (flexible)", "High-temp fabric or metal expansion joints", 12000, 18000, 26000),
            BomItem("Stack damper / diverter", "Butterfly damper, actuator, position feedback", 18000, 26000, 38000),
            BomItem("Emissions monitoring (CEMS)", "Continuous emissions monitoring, NOx/CO/O2", 35000, 52000, 75000),
            BomItem("Refractory lining", "Castable refractory, ceramic fiber blanket", 15000, 22000, 32000),
            BomItem("Stack lighting / aviation warning", "FAA obstruction lighting, conduit", 5000, 8000, 12000),
        ],
    },

    "COOLING": {
        "name": "Cooling / Cooling Water System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Evapco", "SPX Cooling Technologies", "Baltimore Aircoil", "Harsco"],
        "search_terms": [
            '"cooling system" "gas turbine" "50MW" cost OR price',
            '"evaporative cooler" "gas turbine" BOP price',
            '"closed cooling water" "gas turbine" skid price',
            'gas turbine cooling water system EPC cost FERC',
        ],
        "bom": [
            BomItem("Air-cooled heat exchangers or cooling tower", "Fin-fan or evaporative cooling for GT auxiliaries", 55000, 80000, 115000),
            BomItem("Closed cooling water pumps (2x)", "Centrifugal pumps, AC motors, 100% redundancy", 15000, 22000, 32000),
            BomItem("Expansion tank / pressurization", "Diaphragm expansion tank, makeup water", 6000, 9000, 13000),
            BomItem("Chemical treatment system", "Corrosion inhibitor dosing, conductivity monitoring", 8000, 12000, 18000),
            BomItem("Piping, valves, instrumentation", "Carbon steel piping, flow/pressure/temp instruments", 18000, 26000, 38000),
            BomItem("Cooling water skid / control panel", "Integrated skid, PLC controls", 12000, 18000, 26000),
        ],
    },

    "FIRE_FIGHT": {
        "name": "Fire Fighting System",
        "factor": "critical",
        "target_mw": 50.0,
        "suppliers": ["Amerex", "Kidde (UTC)", "Ansul (Tyco)", "Fike", "Hochiki"],
        "search_terms": [
            '"fire suppression" "gas turbine" enclosure cost',
            '"CO2 system" OR "FM-200" "gas turbine" price quote',
            '"fire fighting system" "50MW" BOP cost',
            '"gas turbine" "fire detection" "suppression" EPC cost filetype:pdf',
        ],
        "bom": [
            BomItem("Fire detection system", "Linear heat, UV/IR flame detectors, smoke", 18000, 26000, 38000, source="Hochiki/Siemens"),
            BomItem("Suppression agent storage (CO2/FM-200)", "Cylinders, manifold, distribution piping", 25000, 36000, 52000, source="Kidde/Fike"),
            BomItem("Nozzles and distribution", "Spray nozzles, high-pressure piping, check valves", 12000, 18000, 26000),
            BomItem("Control panel / release unit", "Fire panel, manual release stations, alarm", 15000, 22000, 32000),
            BomItem("Foam/water system (if applicable)", "Deluge system for oil-bearing areas", 18000, 26000, 38000, source="Amerex"),
            BomItem("Portable extinguishers", "CO2 and dry chemical portables, cabinets", 3000, 5000, 8000),
            BomItem("Engineering / NFPA compliance", "System design, hydraulic calcs, AHJ approval", 10000, 15000, 22000),
        ],
    },

    "PIPING_VALVES": {
        "name": "Piping and Valves (BOP interconnect)",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Flowserve", "Emerson (Fisher)", "CIRCOR", "Velan", "Trillium Flow Technologies"],
        "search_terms": [
            '"BOP piping" "gas turbine" "50MW" cost',
            '"piping and valves" "gas turbine" EPC cost filetype:pdf',
            'gas turbine auxiliary piping BOP cost FERC filing',
            '"control valve" "gas turbine" "Fisher" OR "Flowserve" price',
            '"piping" "W251" OR "frame 6" BOP cost estimate',
        ],
        "bom": [
            BomItem("Process piping (CS/SS/alloy)", "Fuel gas, lube oil, cooling water, drain headers", 85000, 125000, 175000),
            BomItem("Control valves", "Fisher or Flowserve modulating valves, positioners", 35000, 52000, 75000),
            BomItem("Isolation valves (manual)", "Gate, globe, ball valves per P&ID", 25000, 38000, 55000),
            BomItem("Check valves and safety relief valves", "Non-return and PSV/PRV devices", 15000, 22000, 32000),
            BomItem("Pipe supports and hangers", "Engineered supports, spring hangers, clamps", 18000, 26000, 38000),
            BomItem("Insulation and cladding", "Pipe insulation, aluminum jacketing", 12000, 18000, 26000),
            BomItem("Pipe fittings and flanges", "Elbows, tees, reducers, gaskets, bolting", 20000, 30000, 43000),
            BomItem("Pipe fabrication and erection labor", "Spool fabrication, field erection", 45000, 65000, 92000),
        ],
    },

    "ELEC_DIST": {
        "name": "Electrical Distribution (Auxiliary)",
        "factor": "complex",
        "target_mw": 50.0,
        "suppliers": ["Eaton", "Schneider Electric", "ABB", "Siemens Energy", "GE Grid"],
        "search_terms": [
            '"auxiliary electrical" "gas turbine" "50MW" cost',
            '"MCC" "motor control center" "gas turbine" BOP price',
            '"auxiliary transformer" "gas turbine" EPC cost',
            'gas turbine electrical BOP FERC Account 353 cost',
            '"switchgear" "gas turbine" "4160V" OR "480V" price filetype:pdf',
        ],
        "bom": [
            BomItem("Auxiliary transformer (unit aux)", "Stepdown from generator bus to 4160V or 480V aux", 85000, 125000, 175000, source="ABB/Eaton"),
            BomItem("Motor control centers (MCC)", "Bucket-type MCC for pumps, fans, auxiliaries", 55000, 80000, 115000, source="Eaton/Schneider"),
            BomItem("Battery and UPS system", "125VDC station battery, charger, UPS for controls", 35000, 52000, 75000),
            BomItem("Lighting and small power distribution", "Lighting panels, receptacles, area lighting", 18000, 26000, 38000),
            BomItem("Grounding and lightning protection", "Ground grid extension, lightning rods", 8000, 12000, 18000),
            BomItem("Cable and conduit (auxiliary)", "Control and power cable, trays, conduit", 35000, 52000, 75000),
            BomItem("Electrical enclosures and panels", "Local control panels, junction boxes", 15000, 22000, 32000),
        ],
    },

    "CONTROLS_DCS": {
        "name": "Controls / DCS Integration",
        "factor": "complex",
        "target_mw": 50.0,
        "suppliers": ["Emerson DeltaV", "ABB 800xA", "Honeywell Experion", "Yokogawa", "Siemens PCS7"],
        "search_terms": [
            '"DCS integration" "gas turbine" BOP cost',
            '"controls system" "gas turbine" "50MW" EPC price',
            '"SCADA" "gas turbine" BOP integration cost',
            'gas turbine controls BOP FERC cost filing',
            '"HMI" "historian" "gas turbine" BOP price filetype:pdf',
        ],
        "bom": [
            BomItem("DCS I/O cabinets and controllers", "DeltaV or equivalent, redundant controllers, I/O", 65000, 95000, 135000),
            BomItem("Operator workstations and HMI", "Engineering station, operator consoles, screens", 25000, 36000, 52000),
            BomItem("Historian and data server", "OSIsoft PI or equivalent process historian", 20000, 30000, 43000),
            BomItem("Control room furniture / panels", "Operator consoles, CCTV, annunciator", 15000, 22000, 32000),
            BomItem("Instrument air system", "Compressors, dryers, receiver for pneumatic instruments", 25000, 36000, 52000),
            BomItem("Field instruments (BOP loop)", "Pressure, temperature, flow, level transmitters", 35000, 52000, 75000),
            BomItem("Control wiring and cable trays", "Control cable, marshalling cabinets, trays", 22000, 32000, 46000),
            BomItem("System integration / FAT / SAT", "DCS configuration, loop testing, commissioning", 30000, 45000, 65000),
        ],
    },

    "ACOUSTIC": {
        "name": "Acoustic Enclosure / Noise Control",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["IAC Acoustics", "Noise Barriers LLC", "Kinetics", "Acoustics First"],
        "search_terms": [
            '"acoustic enclosure" "gas turbine" "50MW" cost',
            '"noise enclosure" "gas turbine" BOP price',
            '"sound attenuation" "gas turbine" EPC cost filetype:pdf',
            '"gas turbine enclosure" acoustic treatment cost FERC',
        ],
        "bom": [
            BomItem("Acoustic enclosure panels (walls/roof)", "Modular acoustic panels, STC 40+", 85000, 125000, 175000),
            BomItem("Acoustic doors and access panels", "Acoustic-rated doors, ventilation baffles", 18000, 26000, 38000),
            BomItem("Ventilation / cooling for enclosure", "Forced ventilation, louvers, fire dampers", 25000, 36000, 52000),
            BomItem("Interior acoustic treatment", "Absorptive lining, vibration isolation", 12000, 18000, 26000),
            BomItem("Foundation isolation / anti-vibration mounts", "Spring mounts, inertia pads", 8000, 12000, 18000),
            BomItem("Noise monitoring instrumentation", "Perimeter noise monitoring, logging", 6000, 9000, 13000),
        ],
    },

    "WATER_WASH": {
        "name": "Compressor Washing System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Turbotect", "Gas Turbine Efficiency", "Fogco", "Rochem"],
        "search_terms": [
            '"compressor washing" "gas turbine" system price',
            '"turbine washing" "W251" OR "50MW" cost',
            '"online washing" "offline washing" gas turbine BOP cost',
            'site:turbotect.com price OR cost',
            '"compressor wash skid" gas turbine price quote',
        ],
        "bom": [
            BomItem("Wash skid (pumps, tank, controls)", "High-pressure wash water skid, demineralised water", 35000, 50000, 72000, source="Turbotect"),
            BomItem("Detergent injection system", "Detergent storage, metering pump, injection nozzles", 8000, 12000, 18000),
            BomItem("Inlet wash nozzle manifold", "Spray nozzles, manifold at inlet bellmouth", 6000, 9000, 13000),
            BomItem("Water treatment (demineralizer)", "RO or deionizer for wash water quality", 12000, 18000, 26000),
            BomItem("Piping and instrumentation", "Stainless piping, pressure gauges, flow meters", 6000, 9000, 13000),
        ],
    },

    "CIVIL_STRUCT": {
        "name": "Civil and Structural Works",
        "factor": "simple",
        "target_mw": 50.0,
        "suppliers": ["Various EPC contractors"],
        "search_terms": [
            '"gas turbine foundation" "50MW" cost',
            '"turbine foundation" civil works EPC cost FERC',
            '"gas turbine" civil structural BOP cost per kW',
            'peaker plant civil works cost EIA 860',
        ],
        "bom": [
            BomItem("GT baseplate / mat foundation", "Reinforced concrete GT foundation, anchor bolts", 85000, 125000, 175000),
            BomItem("Auxiliary equipment foundations", "BOP equipment pads, trenches, pits", 25000, 36000, 52000),
            BomItem("Paving and site grading", "Hardstand, drainage, access roads", 18000, 26000, 38000),
            BomItem("Building / control room", "Pre-engineered metal building, control room", 35000, 52000, 75000),
            BomItem("Fencing and site security", "Security fencing, lighting, access control", 8000, 12000, 18000),
            BomItem("Drainage / spill containment", "Oil/water separator, containment berms", 12000, 18000, 26000),
        ],
    },

    "EMISSIONS": {
        "name": "Emissions Control (SCR / CO Catalyst)",
        "factor": "complex",
        "target_mw": 50.0,
        "suppliers": ["CECO Environmental", "Haldor Topsoe", "BASF", "Cormetech", "Johnson Matthey"],
        "search_terms": [
            '"SCR" "selective catalytic reduction" "gas turbine" "50MW" cost',
            '"CO catalyst" "gas turbine" BOP price',
            '"emissions control" "50MW" OR "W251" EPC cost filetype:pdf',
            '"urea injection" "gas turbine" SCR cost',
            'SCR gas turbine cost FERC rate case filing',
        ],
        "bom": [
            BomItem("SCR catalyst and housing", "V2O5/TiO2 catalyst modules, insulated housing", 250000, 350000, 490000, source="Cormetech/BASF"),
            BomItem("CO oxidation catalyst", "Precious metal CO catalyst, housing", 65000, 95000, 135000, source="Johnson Matthey"),
            BomItem("Urea/ammonia storage and handling", "Day tank, dilution, injection skid", 35000, 52000, 75000),
            BomItem("Urea injection grid", "Distribution grid, nozzles, vanes", 15000, 22000, 32000),
            BomItem("AIG (ammonia injection grid) mixing", "Static mixers, flow distribution", 12000, 18000, 26000),
            BomItem("CEMS (emissions monitoring)", "Continuous emissions monitoring system", 35000, 52000, 75000, source="Emerson"),
            BomItem("Bypass damper and ducting", "Hot gas bypass for catalyst protection", 18000, 26000, 38000),
        ],
    },

    "FUEL_OIL": {
        "name": "Fuel Oil / Backup Fuel System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Emerson", "Flowserve", "Baldor (ABB)", "Pump Engineering"],
        "search_terms": [
            '"fuel oil system" "gas turbine" "50MW" cost',
            '"distillate oil" "backup fuel" gas turbine BOP price',
            '"fuel oil storage" "gas turbine" EPC cost',
            'gas turbine fuel oil system BOP cost FERC',
        ],
        "bom": [
            BomItem("Fuel oil storage tank", "Above-ground CS tank, secondary containment", 45000, 65000, 92000),
            BomItem("Fuel oil forwarding pumps (2x)", "Gear pumps, strainers, AC motors", 15000, 22000, 32000),
            BomItem("Fuel oil heater", "Electric immersion or heat trace for viscosity", 8000, 12000, 18000),
            BomItem("Fuel oil filtration / coalescer", "Duplex strainers, water separation", 8000, 12000, 18000),
            BomItem("Transfer and return piping", "CS piping, valves, instrumentation", 15000, 22000, 32000),
            BomItem("Day tank and level controls", "Small local day tank, high-low level alarms", 8000, 12000, 18000),
        ],
    },

    "STARTING": {
        "name": "Starting System",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["Voith", "Regal-Beloit", "Howden", "Ingersoll Rand"],
        "search_terms": [
            '"starting system" "gas turbine" "50MW" cost',
            '"torque converter" "gas turbine" starting BOP price',
            '"variable frequency drive" "gas turbine" start price',
            '"static frequency converter" SFC gas turbine cost',
        ],
        "bom": [
            BomItem("Starting motor or torque converter", "AC motor with fluid coupling or SFC system", 65000, 95000, 135000),
            BomItem("Starting drive (VFD/SFC)", "Variable speed drive for ramp-up control", 35000, 52000, 75000),
            BomItem("Starting gear/ratchet device", "Barring/ratchet gear for slow-roll", 12000, 18000, 26000),
            BomItem("Starting controls integration", "PLC logic, turbine control interface", 8000, 12000, 18000),
        ],
    },

    "TRANSFORMER": {
        "name": "Step-up Transformer (GSU)",
        "factor": "simple",
        "target_mw": 50.0,
        "suppliers": ["ABB", "Siemens Energy", "GE Grid", "SPX Transformer Solutions"],
        "search_terms": [
            '"generator step-up transformer" "50MVA" OR "60MVA" price',
            '"GSU transformer" "gas turbine" cost',
            '"power transformer" "50MVA" list price 2024',
            'site:abb.com "power transformer" price OR cost',
            '"step-up transformer" EPC cost FERC Account 353',
        ],
        "bom": [
            BomItem("GSU transformer (50-65MVA)", "Oil-filled, ONAN/ONAF, HV bushings", 350000, 500000, 700000, source="ABB/Siemens quote basis"),
            BomItem("Transformer protective relays", "Differential, overcurrent, buchholz protection", 18000, 26000, 38000),
            BomItem("HV disconnect switch / breaker", "SF6 or air-insulated switchgear on HV side", 35000, 52000, 75000),
            BomItem("Oil containment / fire protection", "Oil pit, drain to containment, CO2 system", 12000, 18000, 26000),
            BomItem("Foundation and support structure", "Reinforced pad, rollers, firewall if needed", 8000, 12000, 18000),
        ],
    },

    "TELECOMS": {
        "name": "Telecommunications / Plant Network",
        "factor": "complex",
        "target_mw": 50.0,
        "suppliers": ["Cisco", "Belden", "Hirschmann", "Sierra Wireless"],
        "search_terms": [
            '"plant network" "gas turbine" BOP telecom cost',
            '"industrial ethernet" "gas turbine" control network price',
            '"SCADA communications" peaker plant cost',
        ],
        "bom": [
            BomItem("Industrial ethernet switches / network", "Managed switches, fiber backbone, patch panels", 15000, 22000, 32000),
            BomItem("SCADA / remote monitoring RTU", "Remote terminal unit, cellular/fiber comms", 12000, 18000, 26000),
            BomItem("CCTV security cameras", "IP cameras, NVR, monitor in control room", 8000, 12000, 18000),
            BomItem("Public address / intercom", "PA system, handsets, speakers", 5000, 8000, 12000),
            BomItem("Fiber optic cabling", "Single-mode fiber, connectors, splice enclosures", 8000, 12000, 18000),
        ],
    },

    "GENERATOR": {
        "name": "Generator and Electrical Switchgear",
        "factor": "standard",
        "target_mw": 50.0,
        "suppliers": ["GE", "Siemens Energy", "WEG", "Brush (Colfax)", "Nidec"],
        "search_terms": [
            '"generator" "50MW" OR "60MVA" price OR cost',
            '"synchronous generator" "gas turbine" price quote',
            '"generator excitation system" cost',
            '"generator protection relay" cost',
            '"60MVA generator" budgetary price filetype:pdf',
        ],
        "bom": [
            BomItem("Synchronous generator (60MVA nominal)", "Air or hydrogen-cooled, Class F insulation", 850000, 1200000, 1650000, source="GE/Siemens Energy"),
            BomItem("Excitation system", "Static excitation, AVR, field breaker", 65000, 95000, 135000, source="GE"),
            BomItem("Generator protection relays", "Differential, loss-of-field, stator ground", 25000, 36000, 52000, source="SEL/GE"),
            BomItem("Generator switchgear / main breaker", "13.8kV or 15kV generator circuit breaker", 85000, 125000, 175000, source="ABB/Eaton"),
            BomItem("Generator bus duct / isophase bus", "Isolated phase bus, 3-phase, from GT to GSU", 45000, 65000, 92000),
            BomItem("Neutral grounding", "High-resistance grounding unit, transformer", 8000, 12000, 18000),
            BomItem("Generator monitoring instruments", "Stator RTDs, flux probes, partial discharge", 12000, 18000, 26000),
        ],
    },

}


def get_category_bom(category_code: str) -> List[BomItem]:
    """Return BOM items for a category, with integration cost appended."""
    entry = BOM_LIBRARY.get(category_code)
    if not entry:
        return []
    items = list(entry["bom"])
    factor = INTEGRATION_FACTORS.get(entry["factor"], INTEGRATION_FACTORS["standard"])
    items.append(apply_integration(items, factor))
    return items


def get_all_categories() -> List[str]:
    return list(BOM_LIBRARY.keys())


def get_bom_total(category_code: str) -> tuple[float, float, float]:
    """Returns (low, mid, high) total for a category including integration."""
    items = get_category_bom(category_code)
    return (
        sum(i.low_usd for i in items),
        sum(i.mid_usd for i in items),
        sum(i.high_usd for i in items),
    )
