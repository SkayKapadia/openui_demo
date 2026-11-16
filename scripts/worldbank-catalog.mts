/**
 * What the loader pulls from the World Bank API (no key needed).
 * Edit these lists to add countries or indicators, then re-run `npm run load:worldbank`.
 */

/** ISO3 codes. WLD is the World Bank's world aggregate. */
export const COUNTRIES = ["IND", "CHN", "BGD", "PAK", "IDN", "BRA", "USA", "WLD"];

export const INDICATORS: Array<{ code: string; topic: string; unit: string }> = [
  // Economy
  { code: "NY.GDP.MKTP.CD", topic: "Economy", unit: "current US$" },
  { code: "NY.GDP.PCAP.CD", topic: "Economy", unit: "current US$" },
  { code: "NY.GDP.MKTP.KD.ZG", topic: "Economy", unit: "% per year" },
  { code: "FP.CPI.TOTL.ZG", topic: "Economy", unit: "% per year" },
  { code: "NE.EXP.GNFS.ZS", topic: "Economy", unit: "% of GDP" },
  { code: "BX.KLT.DINV.CD.WD", topic: "Economy", unit: "current US$" },
  { code: "NV.AGR.TOTL.ZS", topic: "Economy", unit: "% of GDP" },
  { code: "SL.UEM.TOTL.ZS", topic: "Economy", unit: "% of labour force" },
  { code: "SI.POV.DDAY", topic: "Economy", unit: "% of population" },
  // People
  { code: "SP.POP.TOTL", topic: "People", unit: "people" },
  { code: "SP.URB.TOTL.IN.ZS", topic: "People", unit: "% of population" },
  { code: "SP.DYN.LE00.IN", topic: "People", unit: "years" },
  { code: "SP.DYN.TFRT.IN", topic: "People", unit: "births per woman" },
  { code: "SH.DYN.MORT", topic: "People", unit: "per 1,000 live births" },
  { code: "SE.ADT.LITR.ZS", topic: "People", unit: "% of ages 15+" },
  // Infrastructure & technology
  { code: "EG.ELC.ACCS.ZS", topic: "Infrastructure", unit: "% of population" },
  { code: "IT.NET.USER.ZS", topic: "Infrastructure", unit: "% of population" },
  { code: "IT.CEL.SETS.P2", topic: "Infrastructure", unit: "per 100 people" },
  // Environment
  { code: "EN.GHG.CO2.PC.CE.AR5", topic: "Environment", unit: "t CO2e per person" },
  { code: "EG.FEC.RNEW.ZS", topic: "Environment", unit: "% of final energy use" },
];

export const START_YEAR = 1960;
