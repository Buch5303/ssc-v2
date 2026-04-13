/**
 * RFQ Email Templates
 * Production-grade email content for all 13 RFQ packages.
 * Called by the automated dispatch system on May 25, 2026.
 */

export interface RFQEmailConfig {
  rfq_id:   string;
  to:       string;
  cc?:      string;
  subject:  string;
  body:     string;
  company:  string;
  contact:  string;
  category: string;
  value:    number;
}

const SENDER_SIG = `Greg Buchanan
CEO, Trans World Power LLC
Program Manager — TG20/W251
Email: buch5303@gmail.com`;

const PROGRAM_HEADER = `Program:   TG20/W251 — 50MW W251B8 Power Island
Client:    Borderplex — Santa Teresa, NM
GT OEM:    EthosEnergy Italia (MOU: March 13, 2026)
Send Date: May 25, 2026`;

export const RFQ_EMAIL_TEMPLATES: Record<string, Omit<RFQEmailConfig,'rfq_id'>> = {

  'RFQ-002': {
    to: 'bob.yeager@emerson.com',
    cc: 'lalit.tejwani@emerson.com',
    company: 'Emerson', contact: 'Bob Yeager',
    category: 'Fuel Gas System', value: 700600,
    subject: 'TG20/W251 — Fuel Gas Conditioning System — Request for Budgetary Pricing',
    body: `Dear Bob,

${PROGRAM_HEADER}

Trans World Power LLC is soliciting budgetary pricing from Emerson for the Fuel Gas Conditioning System for the TG20/W251 project.

SCOPE OF SUPPLY:
- Pressure regulation skid (Fisher controls)
- Flow metering (Daniel custody transfer meters)
- Gas filtration, heating, and moisture separation
- Emergency shutdown valves (SIL-rated)
- All instrumentation and DCS integration

EST. VALUE: $700,600 (budgetary — subject to RFQ response)
LEAD TIME: 16–24 weeks required

Please provide budgetary pricing (±20%), lead time, and key assumptions by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-003': {
    to: 'tod.carpenter@donaldson.com',
    cc: 'scott.spielvogel@donaldson.com',
    company: 'Donaldson Company', contact: 'Tod Carpenter',
    category: 'Inlet Air Filtering System', value: 525150,
    subject: 'TG20/W251 — Inlet Air Filtration System — Request for Budgetary Pricing',
    body: `Dear Tod,

${PROGRAM_HEADER}

Trans World Power LLC is soliciting budgetary pricing from Donaldson Company for the Inlet Air Filtration System.

SCOPE OF SUPPLY:
- Primary and secondary filter stages (Ultra-Web technology)
- Moisture separator and anti-icing system
- Inlet silencer and acoustic treatment
- Associated ductwork and structural support
- Controls integration

SITE CONDITIONS: Santa Teresa, NM — high desert, elevation ~4,100 ft, high dust loading
EST. VALUE: $525,150 | LEAD TIME: 14–20 weeks

Please provide budgetary pricing (±20%), lead time, and reference projects by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-004': {
    to: 'michael.wynblatt@donaldson.com',
    company: 'Donaldson Company', contact: 'Michael Wynblatt',
    category: 'Controls / DCS Integration', value: 504600,
    subject: 'TG20/W251 — BOP Controls & DCS Integration — Request for Budgetary Pricing',
    body: `Dear Michael,

${PROGRAM_HEADER}

We are soliciting budgetary pricing from Donaldson for the BOP Controls and DCS Integration package.

SCOPE: PLC-based BOP control system, HMI, SCADA interface, field instrumentation, and commissioning.
EST. VALUE: $504,600 | LEAD TIME: 20–28 weeks

Please respond by June 15, 2026 with budgetary pricing and key assumptions.

${SENDER_SIG}`,
  },

  'RFQ-005': {
    to: 'rod.christie@bakerhughes.com',
    company: 'Baker Hughes', contact: 'Rod Christie',
    category: 'Exhaust System', value: 430650,
    subject: 'TG20/W251 — Exhaust System — Request for Budgetary Pricing',
    body: `Dear Rod,

${PROGRAM_HEADER}

Following Lorenzo Simonelli's response on the VIB_MON package, we are now soliciting pricing for the W251B8 Exhaust System.

SCOPE: Exhaust diffuser, expansion joints, transition duct, silencer, and exhaust stack to grade.
EST. VALUE: $430,650 | LEAD TIME: 20–28 weeks

Please respond by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-006': {
    to: 'harrison@amerex.com',
    company: 'Amerex Corporation', contact: 'Harrison K',
    category: 'Fire Fighting System', value: 229400,
    subject: 'TG20/W251 — Fire Detection & Suppression System — Request for Budgetary Pricing',
    body: `Dear Harrison,

${PROGRAM_HEADER}

We are soliciting budgetary pricing for the Fire Detection and Suppression System.

SCOPE: Fire detection and suppression for turbine enclosure and transformer area, per NFPA 750.
EST. VALUE: $229,400 | LEAD TIME: 10–16 weeks

Please respond by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-007': {
    to: 'neil.ashford@turbotect.com',
    company: 'Turbotect Ltd.', contact: 'Neil Ashford',
    category: 'Compressor Washing System', value: 132300,
    subject: 'TG20/W251 — Compressor Washing System — Request for Budgetary Pricing',
    body: `Dear Neil,

${PROGRAM_HEADER}

We are soliciting pricing for the Online and Offline Compressor Washing System for the W251B8.

SCOPE: Wash fluid storage, pump, nozzle manifold, instrumentation, and controls.
EST. VALUE: $132,300 | LEAD TIME: 8–12 weeks

Please respond by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-008': {
    to: 'gas.power.sales@gevernova.com',
    company: 'GE Vernova', contact: 'Gas Power Business Development',
    category: 'Generator + Switchgear', value: 2093850,
    subject: 'TG20/W251 — 50MW Generator + Electrical Switchgear — CRITICAL PATH RFQ',
    body: `Dear GE Vernova Gas Power Team,

${PROGRAM_HEADER}

CRITICAL PATH NOTICE: Generator lead time of 40–56 weeks makes this our highest-priority procurement. Award by August 15, 2026 is required to support Q2 2027 First Power.

SCOPE: Synchronous generator (50MW class), static excitation system, ANSI protection relays, generator circuit breaker (GCB), isolated phase bus duct, neutral grounding unit.

EST. VALUE: $2,093,850 | LEAD TIME: 40–56 weeks | REQUIRED DELIVERY: Q4 2026

This RFQ is issued simultaneously to Siemens Energy. Competitive award based on price, lead time, and technical merit.

Please respond with budgetary pricing (±20%), firm lead time, and reference projects by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-009': {
    to: 'powergen.sales@siemens-energy.com',
    company: 'Siemens Energy', contact: 'Power Generation Sales',
    category: 'Generator + Switchgear', value: 2093850,
    subject: 'TG20/W251 — 50MW Generator + Electrical Switchgear — CRITICAL PATH RFQ',
    body: `Dear Siemens Energy Power Generation Team,

${PROGRAM_HEADER}

CRITICAL PATH: Generator lead time is the binding constraint on Q2 2027 First Power. Award by August 15, 2026 is required.

SCOPE: SGen synchronous generator (50MW class), SIPROTEC 5 protection, static excitation, GCB 13.8kV, isolated phase bus duct, neutral grounding.

EST. VALUE: $2,093,850 | LEAD TIME: 44–58 weeks | REQUIRED DELIVERY: Q4 2026

Competitive award with GE Vernova. Price, lead time, and technical merit are all weighted equally.

Please respond by June 15, 2026 with budgetary pricing and firm lead time commitment.

${SENDER_SIG}`,
  },

  'RFQ-010': {
    to: 'transformers.na@abb.com',
    company: 'ABB Power Grids', contact: 'Transformers North America',
    category: 'Step-up Transformer (GSU)', value: 760000,
    subject: 'TG20/W251 — Generator Step-Up Transformer (GSU) — CRITICAL PATH RFQ',
    body: `Dear ABB Power Grids — Transformers,

${PROGRAM_HEADER}

CRITICAL PATH: Transformer carries 52–70 week lead time. Award by August 15, 2026 is mandatory.

SCOPE: Oil-immersed GSU transformer, 13.8kV/115kV or 230kV (TBD pending EthosEnergy ICD), ONAN/ONAF cooling, full protection package and accessories per IEEE C57.12.

EST. VALUE: $760,000 | LEAD TIME: 52–70 weeks | EXPEDITE PREMIUM: Please quote

Competitive award with Siemens Energy. Please provide budgetary price, lead time, expedite options, and references by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-011': {
    to: 'transformers@siemens-energy.com',
    company: 'Siemens Energy', contact: 'Transformers Division',
    category: 'Step-up Transformer (GSU)', value: 760000,
    subject: 'TG20/W251 — Generator Step-Up Transformer (GSU) — CRITICAL PATH RFQ',
    body: `Dear Siemens Energy — Transformers,

${PROGRAM_HEADER}

CRITICAL PATH: 52–70 week lead time. August 15 award required for Q2 2027 First Power.

SCOPE: GSU transformer, 13.8kV to 115kV or 230kV, ONAN/ONAF, IEEE C57.12.
EST. VALUE: $760,000 | Competitive with ABB Power

Please respond by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-012': {
    to: 'mkarim@cecoenviro.com',
    cc: 'bsherwin@cecoenviro.com',
    company: 'CECO Environmental', contact: 'Matt Karam',
    category: 'Emissions Control (SCR + CO)', value: 891750,
    subject: 'TG20/W251 — Emissions Control System (SCR + CO Catalyst) — Request for Budgetary Pricing',
    body: `Dear Matt,

${PROGRAM_HEADER}

We are soliciting budgetary pricing for the combined SCR and CO Catalyst Emissions Control System.

SCOPE: SCR system (NOx reduction), CO catalyst, ammonia injection grid, storage and vaporization, ductwork, instrumentation, and DCS integration.

PERMIT BASIS: NM Air Quality permit limits TBD. Budget on typical 50MW NG GT: NOx ≤9 ppm, CO ≤10 ppm @ 15% O2.

EST. VALUE: $891,750 | LEAD TIME: 24–36 weeks

Competitive award with Peerless Manufacturing. Please respond by June 15, 2026.

${SENDER_SIG}`,
  },

  'RFQ-013': {
    to: 'power.generation@flowserve.com',
    company: 'Flowserve', contact: 'Power Generation Solutions',
    category: 'Piping & Valves', value: 507600,
    subject: 'TG20/W251 — BOP Piping & Valves Package — Request for Budgetary Pricing',
    body: `Dear Flowserve Power Generation Team,

${PROGRAM_HEADER}

We are soliciting budgetary pricing for the BOP Interconnect Piping and Valves package.

SCOPE: Lube oil piping and valves, fuel gas piping (ASME B31.3), cooling water piping, fire protection piping. Complete BOP interconnect package.

EST. VALUE: $507,600 | LEAD TIME: 10–16 weeks

Please respond by June 15, 2026 with budgetary pricing and key assumptions.

${SENDER_SIG}`,
  },
};
