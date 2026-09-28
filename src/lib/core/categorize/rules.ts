/**
 * Curated merchant/keyword -> categoryId table (Indian context).
 *
 * categoryIds follow the `cat.<group>.<sub>` convention and must match the ids
 * seeded in `src/lib/core/db/seed.ts` verbatim. `group` here is informational
 * (it mirrors the `CategoryGroup` the id belongs to) and is not itself the id.
 */

import type { TxnKind } from '../domain/types';

export interface CategoryRule {
  categoryId: string;
  /** Priority: higher wins when multiple keyword rules match. Exact merchant
   *  matches always beat keyword matches regardless of priority. */
  priority: number;
  /** Hint for TxnKind inference in classify.ts. */
  kind?: TxnKind;
}

// ---------------------------------------------------------------------------
// Exact merchant -> category. Merchant names are matched post-normalizeMerchant
// (uppercased, alias-folded).
// ---------------------------------------------------------------------------

export const EXACT_MERCHANT_RULES: Record<string, CategoryRule> = {
  // -- Food delivery -------------------------------------------------------
  SWIGGY: { categoryId: 'cat.food.food_delivery', priority: 10 },
  ZOMATO: { categoryId: 'cat.food.food_delivery', priority: 10 },
  ZEPTO: { categoryId: 'cat.food.groceries', priority: 10 },
  BLINKIT: { categoryId: 'cat.food.groceries', priority: 10 },
  INSTAMART: { categoryId: 'cat.food.groceries', priority: 10 },
  DUNZO: { categoryId: 'cat.food.food_delivery', priority: 10 },
  BIGBASKET: { categoryId: 'cat.food.groceries', priority: 10 },
  FRESHTOHOME: { categoryId: 'cat.food.groceries', priority: 10 },
  LICIOUS: { categoryId: 'cat.food.groceries', priority: 10 },
  FAASOS: { categoryId: 'cat.food.food_delivery', priority: 10 },
  BOX8: { categoryId: 'cat.food.food_delivery', priority: 10 },
  EATSURE: { categoryId: 'cat.food.food_delivery', priority: 10 },
  DOMINOS: { categoryId: 'cat.food.restaurants', priority: 10 },
  'DOMINOS PIZZA': { categoryId: 'cat.food.restaurants', priority: 10 },
  PIZZAHUT: { categoryId: 'cat.food.restaurants', priority: 10 },
  MCDONALDS: { categoryId: 'cat.food.restaurants', priority: 10 },
  KFC: { categoryId: 'cat.food.restaurants', priority: 10 },
  BURGERKING: { categoryId: 'cat.food.restaurants', priority: 10 },
  SUBWAY: { categoryId: 'cat.food.restaurants', priority: 10 },
  STARBUCKS: { categoryId: 'cat.food.restaurants', priority: 10 },
  'CAFE COFFEE DAY': { categoryId: 'cat.food.restaurants', priority: 10 },
  CCD: { categoryId: 'cat.food.restaurants', priority: 10 },
  BARBEQUENATION: { categoryId: 'cat.food.restaurants', priority: 10 },
  HALDIRAMS: { categoryId: 'cat.food.restaurants', priority: 10 },

  // -- Transport -------------------------------------------------------
  UBER: { categoryId: 'cat.transport.cab_auto', priority: 10 },
  OLA: { categoryId: 'cat.transport.cab_auto', priority: 10 },
  RAPIDO: { categoryId: 'cat.transport.cab_auto', priority: 10 },
  MERU: { categoryId: 'cat.transport.cab_auto', priority: 10 },
  IRCTC: { categoryId: 'cat.transport.public_transit', priority: 10 },
  'INDIAN RAILWAYS': { categoryId: 'cat.transport.public_transit', priority: 10 },
  INDIANOIL: { categoryId: 'cat.transport.fuel', priority: 10 },
  'INDIAN OIL': { categoryId: 'cat.transport.fuel', priority: 10 },
  IOCL: { categoryId: 'cat.transport.fuel', priority: 10 },
  HPCL: { categoryId: 'cat.transport.fuel', priority: 10 },
  'HP PETROL': { categoryId: 'cat.transport.fuel', priority: 10 },
  BPCL: { categoryId: 'cat.transport.fuel', priority: 10 },
  SHELL: { categoryId: 'cat.transport.fuel', priority: 10 },
  'SHELL INDIA': { categoryId: 'cat.transport.fuel', priority: 10 },
  ESSAR: { categoryId: 'cat.transport.fuel', priority: 10 },
  NAYARA: { categoryId: 'cat.transport.fuel', priority: 10 },
  FASTAG: { categoryId: 'cat.transport.parking_tolls', priority: 10 },
  NETC: { categoryId: 'cat.transport.parking_tolls', priority: 10 },
  NHAI: { categoryId: 'cat.transport.parking_tolls', priority: 10 },
  DMRC: { categoryId: 'cat.transport.public_transit', priority: 10 },
  'DELHI METRO': { categoryId: 'cat.transport.public_transit', priority: 10 },
  BMRCL: { categoryId: 'cat.transport.public_transit', priority: 10 },
  'NAMMA METRO': { categoryId: 'cat.transport.public_transit', priority: 10 },
  BEST: { categoryId: 'cat.transport.public_transit', priority: 10 },
  BMTC: { categoryId: 'cat.transport.public_transit', priority: 10 },
  REDBUS: { categoryId: 'cat.transport.public_transit', priority: 10 },

  // -- Utilities -------------------------------------------------------
  AIRTEL: { categoryId: 'cat.utilities.mobile', priority: 10 },
  JIO: { categoryId: 'cat.utilities.mobile', priority: 10 },
  'RELIANCE JIO': { categoryId: 'cat.utilities.mobile', priority: 10 },
  VI: { categoryId: 'cat.utilities.mobile', priority: 10 },
  VODAFONE: { categoryId: 'cat.utilities.mobile', priority: 10 },
  BSNL: { categoryId: 'cat.utilities.mobile', priority: 10 },
  BESCOM: { categoryId: 'cat.utilities.electricity', priority: 10 },
  MSEB: { categoryId: 'cat.utilities.electricity', priority: 10 },
  MSEDCL: { categoryId: 'cat.utilities.electricity', priority: 10 },
  'TATA POWER': { categoryId: 'cat.utilities.electricity', priority: 10 },
  TATAPOWER: { categoryId: 'cat.utilities.electricity', priority: 10 },
  BSES: { categoryId: 'cat.utilities.electricity', priority: 10 },
  'BSES RAJDHANI': { categoryId: 'cat.utilities.electricity', priority: 10 },
  'BSES YAMUNA': { categoryId: 'cat.utilities.electricity', priority: 10 },
  TNEB: { categoryId: 'cat.utilities.electricity', priority: 10 },
  TANGEDCO: { categoryId: 'cat.utilities.electricity', priority: 10 },
  TSSPDCL: { categoryId: 'cat.utilities.electricity', priority: 10 },
  APSPDCL: { categoryId: 'cat.utilities.electricity', priority: 10 },
  PSPCL: { categoryId: 'cat.utilities.electricity', priority: 10 },
  INDANE: { categoryId: 'cat.utilities.gas', priority: 10 },
  'INDANE GAS': { categoryId: 'cat.utilities.gas', priority: 10 },
  HPGAS: { categoryId: 'cat.utilities.gas', priority: 10 },
  'HP GAS': { categoryId: 'cat.utilities.gas', priority: 10 },
  BHARATGAS: { categoryId: 'cat.utilities.gas', priority: 10 },
  'MAHANAGAR GAS': { categoryId: 'cat.utilities.gas', priority: 10 },
  MGL: { categoryId: 'cat.utilities.gas', priority: 10 },
  IGL: { categoryId: 'cat.utilities.gas', priority: 10 },
  ACT: { categoryId: 'cat.utilities.internet', priority: 10 },
  'ACT FIBERNET': { categoryId: 'cat.utilities.internet', priority: 10 },
  HATHWAY: { categoryId: 'cat.utilities.internet', priority: 10 },
  'TATA PLAY': { categoryId: 'cat.utilities.internet', priority: 10 },
  TATASKY: { categoryId: 'cat.utilities.internet', priority: 10 },
  EXCITEL: { categoryId: 'cat.utilities.internet', priority: 10 },
  SITI: { categoryId: 'cat.utilities.internet', priority: 10 },

  // -- Subscriptions / entertainment -------------------------------------------------------
  NETFLIX: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  'PRIME VIDEO': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  'AMAZON PRIME': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  HOTSTAR: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  SONYLIV: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  ZEE5: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  JIOCINEMA: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  SPOTIFY: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  'YOUTUBE PREMIUM': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  YOUTUBEMUSIC: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  APPLEMUSIC: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  'GAANA MUSIC': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  WYNK: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  BOOKMYSHOW: { categoryId: 'cat.entertainment.movies_events', priority: 10 },
  PVR: { categoryId: 'cat.entertainment.movies_events', priority: 10 },
  INOX: { categoryId: 'cat.entertainment.movies_events', priority: 10 },

  // -- Software / productivity subscriptions -------------------------------------------------------
  APPLE: { categoryId: 'cat.entertainment.streaming', priority: 9 },
  'GOOGLE ONE': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  'GOOGLE CLOUD': { categoryId: 'cat.entertainment.streaming', priority: 10 },
  ADOBE: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  CHATGPT: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  NOTION: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  MICROSOFT: { categoryId: 'cat.entertainment.streaming', priority: 9 },
  DROPBOX: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  CANVA: { categoryId: 'cat.entertainment.streaming', priority: 10 },
  LINKEDIN: { categoryId: 'cat.entertainment.streaming', priority: 10 },

  // -- Shopping -------------------------------------------------------
  AMAZON: { categoryId: 'cat.shopping.general', priority: 8 },
  FLIPKART: { categoryId: 'cat.shopping.general', priority: 10 },
  MEESHO: { categoryId: 'cat.shopping.general', priority: 10 },
  MYNTRA: { categoryId: 'cat.shopping.clothing', priority: 10 },
  AJIO: { categoryId: 'cat.shopping.clothing', priority: 10 },
  NYKAA: { categoryId: 'cat.shopping.clothing', priority: 10 },
  NYKAAFASHION: { categoryId: 'cat.shopping.clothing', priority: 10 },
  TATACLIQ: { categoryId: 'cat.shopping.general', priority: 10 },
  DMART: { categoryId: 'cat.food.groceries', priority: 10 },
  RELIANCE: { categoryId: 'cat.shopping.general', priority: 8 },
  'RELIANCE DIGITAL': { categoryId: 'cat.shopping.electronics', priority: 10 },
  CROMA: { categoryId: 'cat.shopping.electronics', priority: 10 },
  VIJAYSALES: { categoryId: 'cat.shopping.electronics', priority: 10 },
  'H&M': { categoryId: 'cat.shopping.clothing', priority: 10 },
  ZARA: { categoryId: 'cat.shopping.clothing', priority: 10 },
  DECATHLON: { categoryId: 'cat.shopping.clothing', priority: 10 },
  IKEA: { categoryId: 'cat.shopping.home_goods', priority: 10 },
  PEPPERFRY: { categoryId: 'cat.shopping.home_goods', priority: 10 },
  URBANLADDER: { categoryId: 'cat.shopping.home_goods', priority: 10 },
  LENSKART: { categoryId: 'cat.shopping.general', priority: 10 },
  FIRSTCRY: { categoryId: 'cat.shopping.general', priority: 10 },

  // -- Health -------------------------------------------------------
  APOLLO: { categoryId: 'cat.health.pharmacy', priority: 9 },
  'APOLLO PHARMACY': { categoryId: 'cat.health.pharmacy', priority: 10 },
  'APOLLO HOSPITALS': { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  PHARMEASY: { categoryId: 'cat.health.pharmacy', priority: 10 },
  '1MG': { categoryId: 'cat.health.pharmacy', priority: 10 },
  NETMEDS: { categoryId: 'cat.health.pharmacy', priority: 10 },
  MEDPLUS: { categoryId: 'cat.health.pharmacy', priority: 10 },
  PRACTO: { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  'CULT.FIT': { categoryId: 'cat.health.fitness', priority: 10 },
  CULTFIT: { categoryId: 'cat.health.fitness', priority: 10 },
  CULTSPORT: { categoryId: 'cat.health.fitness', priority: 10 },
  'GOLDS GYM': { categoryId: 'cat.health.fitness', priority: 10 },
  ANYTIMEFITNESS: { categoryId: 'cat.health.fitness', priority: 10 },
  FITTR: { categoryId: 'cat.health.fitness', priority: 10 },
  MEDANTA: { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  FORTIS: { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  MANIPAL: { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  'MAX HEALTHCARE': { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  THYROCARE: { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  'DR LAL PATHLABS': { categoryId: 'cat.health.doctor_hospital', priority: 10 },
  SRLDIAGNOSTICS: { categoryId: 'cat.health.doctor_hospital', priority: 10 },

  // -- Investments -------------------------------------------------------
  ZERODHA: { categoryId: 'cat.investment.stocks', priority: 10 },
  GROWW: { categoryId: 'cat.investment.stocks', priority: 10 },
  UPSTOX: { categoryId: 'cat.investment.stocks', priority: 10 },
  ANGELONE: { categoryId: 'cat.investment.stocks', priority: 10 },
  'ANGEL BROKING': { categoryId: 'cat.investment.stocks', priority: 10 },
  '5PAISA': { categoryId: 'cat.investment.stocks', priority: 10 },
  KUVERA: { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  INDMONEY: { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  PAYTMMONEY: { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  COIN: { categoryId: 'cat.investment.sip_mutual_fund', priority: 9 },
  'CAMS ONLINE': { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  KFINTECH: { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  'ICICI PRUDENTIAL MF': { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  'HDFC MUTUAL FUND': { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  'SBI MUTUAL FUND': { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  'AXIS MUTUAL FUND': { categoryId: 'cat.investment.sip_mutual_fund', priority: 10 },
  WAZIRX: { categoryId: 'cat.investment.crypto', priority: 10 },
  COINDCX: { categoryId: 'cat.investment.crypto', priority: 10 },
  COINSWITCH: { categoryId: 'cat.investment.crypto', priority: 10 },

  // -- Insurance -------------------------------------------------------
  LIC: { categoryId: 'cat.insurance.life', priority: 10 },
  'LIC OF INDIA': { categoryId: 'cat.insurance.life', priority: 10 },
  'HDFC LIFE': { categoryId: 'cat.insurance.life', priority: 10 },
  'ICICI PRUDENTIAL LIFE': { categoryId: 'cat.insurance.life', priority: 10 },
  'MAX LIFE': { categoryId: 'cat.insurance.life', priority: 10 },
  'SBI LIFE': { categoryId: 'cat.insurance.life', priority: 10 },
  'TATA AIA': { categoryId: 'cat.insurance.life', priority: 10 },
  'STAR HEALTH': { categoryId: 'cat.insurance.health', priority: 10 },
  'ICICI LOMBARD': { categoryId: 'cat.insurance.health', priority: 10 },
  'HDFC ERGO': { categoryId: 'cat.insurance.health', priority: 10 },
  'CARE HEALTH': { categoryId: 'cat.insurance.health', priority: 10 },
  'NIVA BUPA': { categoryId: 'cat.insurance.health', priority: 10 },
  'MAX BUPA': { categoryId: 'cat.insurance.health', priority: 10 },
  POLICYBAZAAR: { categoryId: 'cat.insurance.other', priority: 9 },
  ACKO: { categoryId: 'cat.insurance.other', priority: 10 },
  DIGIT: { categoryId: 'cat.insurance.other', priority: 9 },
  'GO DIGIT': { categoryId: 'cat.insurance.other', priority: 10 },
  'NEW INDIA ASSURANCE': { categoryId: 'cat.insurance.other', priority: 10 },
  'BAJAJ ALLIANZ': { categoryId: 'cat.insurance.other', priority: 10 },

  // -- Education -------------------------------------------------------
  BYJUS: { categoryId: 'cat.education.tuition_coaching', priority: 10 },
  UNACADEMY: { categoryId: 'cat.education.tuition_coaching', priority: 10 },
  UDEMY: { categoryId: 'cat.education.tuition_coaching', priority: 10 },
  COURSERA: { categoryId: 'cat.education.tuition_coaching', priority: 10 },
  VEDANTU: { categoryId: 'cat.education.tuition_coaching', priority: 10 },
  UPGRAD: { categoryId: 'cat.education.tuition_coaching', priority: 10 },

  // -- Personal care -------------------------------------------------------
  URBANCOMPANY: { categoryId: 'cat.personal_care.salon_grooming', priority: 10 },
  'URBAN COMPANY': { categoryId: 'cat.personal_care.salon_grooming', priority: 10 },
  LAKME: { categoryId: 'cat.personal_care.salon_grooming', priority: 10 },
  NATURALS: { categoryId: 'cat.personal_care.salon_grooming', priority: 10 },

  // -- Housing -------------------------------------------------------
  NOBROKER: { categoryId: 'cat.housing.rent', priority: 10 },
  NESTAWAY: { categoryId: 'cat.housing.rent', priority: 10 },
  MAGICBRICKS: { categoryId: 'cat.housing.rent', priority: 9 },
  HOUSING: { categoryId: 'cat.housing.rent', priority: 8 },

  // -- Travel -------------------------------------------------------
  MAKEMYTRIP: { categoryId: 'cat.travel.vacation', priority: 10 },
  GOIBIBO: { categoryId: 'cat.travel.vacation', priority: 10 },
  YATRA: { categoryId: 'cat.travel.vacation', priority: 10 },
  CLEARTRIP: { categoryId: 'cat.travel.vacation', priority: 10 },
  IXIGO: { categoryId: 'cat.travel.vacation', priority: 10 },
  OYO: { categoryId: 'cat.travel.vacation', priority: 10 },
  AIRBNB: { categoryId: 'cat.travel.vacation', priority: 10 },
  INDIGO: { categoryId: 'cat.travel.vacation', priority: 10 },
  AIRINDIA: { categoryId: 'cat.travel.vacation', priority: 10 },
  VISTARA: { categoryId: 'cat.travel.vacation', priority: 10 },
  SPICEJET: { categoryId: 'cat.travel.vacation', priority: 10 },

  // -- Gifts / donations -------------------------------------------------------
  KETTO: { categoryId: 'cat.gifts_donations.charity', priority: 10 },
  MILAAP: { categoryId: 'cat.gifts_donations.charity', priority: 10 },
  GIVEINDIA: { categoryId: 'cat.gifts_donations.charity', priority: 10 },
  AKSHAYAPATRA: { categoryId: 'cat.gifts_donations.charity', priority: 10 },
};

// ---------------------------------------------------------------------------
// Keyword rules — matched against the normalized merchant AND raw narration
// when no exact merchant match is found. `fee` and `investment` rules run at
// the highest priority so they beat generic shopping/keyword matches.
// ---------------------------------------------------------------------------

export interface KeywordRule extends CategoryRule {
  pattern: RegExp;
}

export const KEYWORD_RULES: KeywordRule[] = [
  // -- Fees (highest priority: a card txn narration can otherwise look like "shopping") --
  { pattern: /\bannual\s*fee\b/i, categoryId: 'cat.fees.bank_charges', priority: 100, kind: 'fee' },
  { pattern: /\bjoining\s*fee\b/i, categoryId: 'cat.fees.bank_charges', priority: 100, kind: 'fee' },
  { pattern: /\blate\s*(payment|fee|charges?)\b/i, categoryId: 'cat.fees.late_penalty', priority: 100, kind: 'fee' },
  { pattern: /\bpenal\s*(interest|charge)\b/i, categoryId: 'cat.fees.late_penalty', priority: 100, kind: 'fee' },
  { pattern: /\boverlimit\s*fee\b/i, categoryId: 'cat.fees.bank_charges', priority: 100, kind: 'fee' },
  { pattern: /\bATM\b.*\bfee|charge\b/i, categoryId: 'cat.fees.bank_charges', priority: 95, kind: 'fee' },
  { pattern: /\bfinance\s*charges?\b/i, categoryId: 'cat.fees.interest_charged', priority: 100, kind: 'fee' },
  { pattern: /\binterest\s*(charged|levied)\b/i, categoryId: 'cat.fees.interest_charged', priority: 100, kind: 'fee' },
  { pattern: /\bgst\s*on\s*charges?\b/i, categoryId: 'cat.fees.bank_charges', priority: 95, kind: 'fee' },
  { pattern: /\b(sms|amc|maintenance)\s*charges?\b/i, categoryId: 'cat.fees.bank_charges', priority: 90, kind: 'fee' },
  { pattern: /\bcheque\s*bounce\b/i, categoryId: 'cat.fees.bank_charges', priority: 100, kind: 'fee' },
  { pattern: /\bminimum\s*balance\s*charge\b/i, categoryId: 'cat.fees.bank_charges', priority: 95, kind: 'fee' },

  // -- Investments / SIP mandates --
  { pattern: /\bsip\b/i, categoryId: 'cat.investment.sip_mutual_fund', priority: 90, kind: 'investment' },
  { pattern: /\bmutual\s*fund\b/i, categoryId: 'cat.investment.sip_mutual_fund', priority: 90, kind: 'investment' },
  { pattern: /\bnps\b/i, categoryId: 'cat.investment.nps', priority: 90, kind: 'investment' },
  { pattern: /\bppf\b/i, categoryId: 'cat.investment.ppf_epf', priority: 90, kind: 'investment' },
  { pattern: /\brd\s*(instal?ment)?\b/i, categoryId: 'cat.investment.fd_rd', priority: 70, kind: 'investment' },
  { pattern: /\bfixed\s*deposit\b/i, categoryId: 'cat.investment.fd_rd', priority: 85, kind: 'investment' },
  { pattern: /\bmandate\b/i, categoryId: 'cat.investment.sip_mutual_fund', priority: 60, kind: 'investment' },
  { pattern: /\bbrokerage\b/i, categoryId: 'cat.investment.stocks', priority: 85, kind: 'investment' },

  // -- EMI / loans --
  { pattern: /\bemi\b/i, categoryId: 'cat.debt.other_emi', priority: 90, kind: 'emi_payment' },
  { pattern: /\bloan\s*(a\/?c|account|instal?ment)\b/i, categoryId: 'cat.debt.other_emi', priority: 85, kind: 'emi_payment' },
  { pattern: /\bnach\b/i, categoryId: 'cat.debt.other_emi', priority: 70, kind: 'emi_payment' },

  // -- Income --
  { pattern: /\bsalary\b/i, categoryId: 'cat.income.salary', priority: 90, kind: 'income' },
  { pattern: /\binterest\s*(credit(ed)?|earned|paid)\b/i, categoryId: 'cat.income.interest', priority: 85, kind: 'income' },
  { pattern: /\bdividend\b/i, categoryId: 'cat.income.dividend', priority: 90, kind: 'income' },
  { pattern: /\bcashback\b/i, categoryId: 'cat.income.refund_cashback', priority: 85, kind: 'income' },
  { pattern: /\brefund\b/i, categoryId: 'cat.income.refund_cashback', priority: 85, kind: 'refund' },
  { pattern: /\breversal\b/i, categoryId: 'cat.income.refund_cashback', priority: 80, kind: 'refund' },

  // -- Food --
  { pattern: /\b(restaurant|dine|dining|hotel food|eatery)\b/i, categoryId: 'cat.food.restaurants', priority: 40 },
  { pattern: /\b(grocery|groceries|supermarket|kirana)\b/i, categoryId: 'cat.food.groceries', priority: 40 },
  { pattern: /\bswiggy|zomato|instamart\b/i, categoryId: 'cat.food.food_delivery', priority: 40 },

  // -- Transport --
  { pattern: /\b(petrol|diesel|fuel|filling station)\b/i, categoryId: 'cat.transport.fuel', priority: 45 },
  { pattern: /\b(cab|taxi|auto\s*rickshaw)\b/i, categoryId: 'cat.transport.cab_auto', priority: 40 },
  { pattern: /\b(metro|bus\s*pass)\b/i, categoryId: 'cat.transport.public_transit', priority: 40 },
  { pattern: /\bparking\b/i, categoryId: 'cat.transport.parking_tolls', priority: 40 },
  { pattern: /\btoll\b/i, categoryId: 'cat.transport.parking_tolls', priority: 40 },

  // -- Utilities --
  { pattern: /\b(electricity|power)\s*bill\b/i, categoryId: 'cat.utilities.electricity', priority: 45 },
  { pattern: /\bbroadband|wifi|internet bill\b/i, categoryId: 'cat.utilities.internet', priority: 40 },
  { pattern: /\bmobile\s*(recharge|bill)\b/i, categoryId: 'cat.utilities.mobile', priority: 40 },
  { pattern: /\blpg|cooking gas\b/i, categoryId: 'cat.utilities.gas', priority: 40 },
  { pattern: /\bwater\s*bill\b/i, categoryId: 'cat.utilities.water', priority: 40 },
  { pattern: /\bdth\b/i, categoryId: 'cat.utilities.internet', priority: 35 },

  // -- Shopping --
  { pattern: /\becommerce|e-commerce|online\s*store\b/i, categoryId: 'cat.shopping.general', priority: 20 },

  // -- Health --
  { pattern: /\b(pharmacy|chemist|medical\s*store|medicines?)\b/i, categoryId: 'cat.health.pharmacy', priority: 40 },
  { pattern: /\b(hospital|clinic|diagnostic|pathology|doctor)\b/i, categoryId: 'cat.health.doctor_hospital', priority: 40 },
  { pattern: /\b(gym|fitness)\b/i, categoryId: 'cat.health.fitness', priority: 40 },

  // -- Housing --
  { pattern: /\brent\b/i, categoryId: 'cat.housing.rent', priority: 45 },
  { pattern: /\bmaintenance\s*(charges?|fee)?\b/i, categoryId: 'cat.housing.maintenance', priority: 30 },
  { pattern: /\bsociety\b/i, categoryId: 'cat.housing.maintenance', priority: 30 },

  // -- Education --
  { pattern: /\b(tuition|school fee|college fee|university)\b/i, categoryId: 'cat.education.tuition_coaching', priority: 40 },

  // -- Taxes --
  { pattern: /\bincome\s*tax\b/i, categoryId: 'cat.taxes.income_tax_tds', priority: 60 },
  { pattern: /\bgst\b/i, categoryId: 'cat.taxes.gst', priority: 30 },
  { pattern: /\btds\b/i, categoryId: 'cat.taxes.income_tax_tds', priority: 50 },

  // -- Transfers (self) --
  { pattern: /\bself\s*transfer\b/i, categoryId: 'cat.transfer.internal', priority: 90, kind: 'transfer' },
  { pattern: /\bown\s*account\b/i, categoryId: 'cat.transfer.internal', priority: 85, kind: 'transfer' },

  // -- Gifts / donations --
  { pattern: /\bdonation\b/i, categoryId: 'cat.gifts_donations.charity', priority: 45 },
  { pattern: /\bgift\b/i, categoryId: 'cat.gifts_donations.gifts', priority: 30 },
];

export const UNCATEGORIZED = 'cat.uncategorized.general';
