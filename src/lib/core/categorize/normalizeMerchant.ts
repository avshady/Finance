/**
 * Turn raw bank/UPI narration into a clean, canonical merchant name.
 *
 * "UPI/P2M/412345678901/SWIGGY LIMITED BANGALORE" -> "SWIGGY"
 */

const CITY_STATE_WORDS = [
  'BANGALORE', 'BENGALURU', 'MUMBAI', 'DELHI', 'NEW DELHI', 'GURGAON', 'GURUGRAM',
  'NOIDA', 'PUNE', 'HYDERABAD', 'CHENNAI', 'KOLKATA', 'AHMEDABAD', 'JAIPUR',
  'LUCKNOW', 'CHANDIGARH', 'KOCHI', 'COCHIN', 'SURAT', 'INDORE', 'BHOPAL',
  'PATNA', 'NAGPUR', 'THANE', 'VADODARA', 'COIMBATORE', 'KARNATAKA', 'MAHARASHTRA',
  'TAMILNADU', 'TELANGANA', 'KERALA', 'GUJARAT', 'HARYANA', 'PUNJAB', 'IN', 'INDIA',
];

const LEGAL_SUFFIXES = ['PVT LTD', 'PRIVATE LIMITED', 'PVT. LTD.', 'LIMITED', 'LTD', 'LLP', 'INC'];

/** Canonical alias map — variants that should fold to one merchant name. */
export const MERCHANT_ALIASES: Record<string, string> = {
  'SWIGGY INSTAMART': 'SWIGGY',
  SWIGGYIT: 'SWIGGY',
  'SWIGGY LIMITED': 'SWIGGY',
  ZOMATO: 'ZOMATO',
  'ZOMATO LIMITED': 'ZOMATO',
  'ZOMATO GOLD': 'ZOMATO',
  'AMAZON PAY': 'AMAZON',
  AMZN: 'AMAZON',
  'AMAZON RETAIL': 'AMAZON',
  'AMAZON SELLER SERVICES': 'AMAZON',
  'AMAZON.IN': 'AMAZON',
  OLACABS: 'OLA',
  'OLA CABS': 'OLA',
  'ANI TECHNOLOGIES': 'OLA', // Ola's registered entity name
  UBERINDIA: 'UBER',
  'UBER INDIA': 'UBER',
  'FLIPKART INTERNET': 'FLIPKART',
  'MYNTRA DESIGNS': 'MYNTRA',
  'BUNDL TECHNOLOGIES': 'SWIGGY', // Swiggy's registered entity name
  'GOOGLE PAY': 'GPAY',
  GOOGLEPAY: 'GPAY',
  'PHONE PE': 'PHONEPE',
  PHONEPEPVTLTD: 'PHONEPE',
  'PAYTM PAYMENTS': 'PAYTM',
  'NETFLIX.COM': 'NETFLIX',
  'NETFLIX COM': 'NETFLIX',
  'SPOTIFY INDIA': 'SPOTIFY',
  'APPLE.COM/BILL': 'APPLE',
  'APPLE SERVICES': 'APPLE',
  'GOOGLE ONE': 'GOOGLE ONE',
  'GOOGLE CLOUD': 'GOOGLE CLOUD',
  'ZEPTO MARKETPLACE': 'ZEPTO',
  'BLINKIT (GROFERS)': 'BLINKIT',
  GROFERS: 'BLINKIT',
  'BIGBASKET.COM': 'BIGBASKET',
  'INNOVATIVE RETAIL': 'BIGBASKET', // BigBasket's registered entity name
  'DUNZO DIGITAL': 'DUNZO',
  'RAPIDO BIKE TAXI': 'RAPIDO',
  ROPPEN: 'RAPIDO', // Rapido's registered entity name
  'IRCTC WEBSITE': 'IRCTC',
  'INDIAN RAILWAY': 'IRCTC',
  'BHARTI AIRTEL': 'AIRTEL',
  AIRTELPREPAID: 'AIRTEL',
  'RELIANCE JIO': 'JIO',
  JIOMONEY: 'JIO',
  VODAFONEIDEA: 'VI',
  VODAFONE: 'VI',
  IDEACELLULAR: 'VI',
  'D MART': 'DMART',
  'AVENUE SUPERMARTS': 'DMART',
  'RELIANCE RETAIL': 'RELIANCE',
  'RELIANCE FRESH': 'RELIANCE',
  'RELIANCE TRENDS': 'RELIANCE',
  NYKAA: 'NYKAA',
  'FSN E-COMMERCE': 'NYKAA', // Nykaa's registered entity name
  'ZERODHA BROKING': 'ZERODHA',
  'ZERODHA COIN': 'ZERODHA',
  GROWWPAY: 'GROWW',
  'NEXTBILLION TECHNOLOGY': 'GROWW', // Groww's registered entity name
  UPSTOX: 'UPSTOX',
  'RKSV SECURITIES': 'UPSTOX', // Upstox's older registered entity name
  'CRED CLUB': 'CRED',
  DREAMPLUG: 'CRED', // CRED's registered entity name
  '1MG TECHNOLOGIES': '1MG',
  TATA1MG: '1MG',
  PHARMEASY: 'PHARMEASY',
  'API HOLDINGS': 'PHARMEASY', // PharmEasy's registered entity name
  APOLLOPHARMACY: 'APOLLO PHARMACY',
  CULTFIT: 'CULT.FIT',
  'CURE FIT': 'CULT.FIT',
  POLICYBAZAAR: 'POLICYBAZAAR',
  'HOTSTAR DISNEY': 'HOTSTAR',
  'DISNEY HOTSTAR': 'HOTSTAR',
  'AMAZON PRIME': 'PRIME VIDEO',
  YOUTUBEPREMIUM: 'YOUTUBE PREMIUM',
  OPENAI: 'CHATGPT',
  'OPENAI CHATGPT': 'CHATGPT',
};

function stripUpiHandle(text: string): string {
  // e.g. "SWIGGY@okhdfcbank" or "9876543210@ybl"
  return text.replace(/@[a-z][a-z0-9.]*\b/gi, ' ');
}

function stripPrefixes(text: string): string {
  return text
    .replace(/\bUPI\s*[-/]?\s*(?:P2M|P2A|P2P)?\s*[-/]?/gi, ' ')
    .replace(/\bP2[AM]\b/gi, ' ')
    .replace(/\bPOS\s+/gi, ' ')
    .replace(/\bATM\s+/gi, ' ')
    // NEFT/IMPS/RTGS followed by an alphanumeric reference code and a hyphen.
    .replace(/\b(?:NEFT|IMPS|RTGS|ECS|NACH)[-\s]?[A-Za-z0-9]{6,}[-\s]/gi, ' ')
    .replace(/\bNEFT[-\s]?/gi, ' ')
    .replace(/\bIMPS[-\s]?/gi, ' ')
    .replace(/\bRTGS[-\s]?/gi, ' ')
    .replace(/\bECS[-\s]?/gi, ' ')
    .replace(/\bNACH[-\s]?/gi, ' ');
}

function stripLongNumbers(text: string): string {
  // Order/terminal/ref ids: runs of 6+ digits, or shorter digit runs that are
  // clearly ids (surrounded by slashes/spaces, not part of a word like "24X7").
  return text.replace(/\b\d{6,}\b/g, ' ').replace(/\/\d{3,}\b/g, ' ');
}

function stripDateFragments(text: string): string {
  return text
    .replace(/\b\d{1,2}[-/][A-Za-z]{3}[-/]?\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
}

function stripTrailingLegalSuffix(text: string): string {
  let out = text;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      const re = new RegExp(`\\s+${suffix.replace(/\./g, '\\.?')}$`, 'i');
      if (re.test(out)) {
        out = out.replace(re, '');
        changed = true;
      }
    }
  }
  return out;
}

function stripTrailingCityState(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  while (tokens.length > 1 && CITY_STATE_WORDS.includes(tokens[tokens.length - 1]!.toUpperCase())) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/** Turn raw narration into a clean, uppercased, deduped merchant name. */
export function normalizeMerchant(raw: string | undefined | null): string {
  if (!raw) return '';
  let text = raw;

  text = stripUpiHandle(text);
  text = stripPrefixes(text);
  text = stripDateFragments(text);
  text = stripLongNumbers(text);
  text = text.replace(/[/*_#]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  text = stripTrailingLegalSuffix(text);
  text = stripTrailingCityState(text);
  text = stripTrailingLegalSuffix(text); // suffix may be exposed after city strip
  text = text.replace(/\s+/g, ' ').trim().toUpperCase();

  if (!text) return '';

  return MERCHANT_ALIASES[text] ?? text;
}
