/**
 * The builtin category set, in Indian-household context.
 *
 * `essential` is deliberate, not decorative: it feeds `monthlyEssentialExpenses`,
 * which sets the emergency-fund target and the survivable-burn figure
 * (docs/ARCHITECTURE.md §6, doctrine 1). The rule of thumb applied here: essential
 * = "this outflow recurs whether or not the user chooses it" — rent, EMIs,
 * utilities, groceries, insurance premiums, medical care, school fees, taxes.
 * Everything discretionary (dining out, shopping, entertainment, travel,
 * subscriptions, fees/penalties that are themselves a leak) is `false`.
 */

import type { Category } from '../domain/types';

function cat(
  id: string,
  name: string,
  group: Category['group'],
  essential: boolean,
  icon?: string
): Category {
  return { id, name, group, essential, icon, builtin: true };
}

export const BUILTIN_CATEGORIES: Category[] = [
  // -- housing -----------------------------------------------------------
  cat('cat.housing.rent', 'Rent', 'housing', true, '🏠'),
  cat('cat.housing.maintenance', 'Maintenance / Society Charges', 'housing', true, '🧰'),
  cat('cat.housing.repairs', 'Home Repairs', 'housing', false, '🛠️'),
  cat('cat.housing.furnishing', 'Furnishing & Decor', 'housing', false, '🛋️'),

  // -- food ----------------------------------------------------------------
  cat('cat.food.groceries', 'Groceries', 'food', true, '🛒'),
  cat('cat.food.restaurants', 'Restaurants & Dining Out', 'food', false, '🍽️'),
  cat('cat.food.food_delivery', 'Food Delivery', 'food', false, '🛵'),
  cat('cat.food.work_lunch', 'Office Lunch / Tiffin', 'food', false, '🍱'),

  // -- transport -------------------------------------------------------------
  cat('cat.transport.fuel', 'Fuel', 'transport', true, '⛽'),
  cat('cat.transport.public_transit', 'Metro / Bus / Local Train', 'transport', true, '🚇'),
  cat('cat.transport.cab_auto', 'Cab / Auto / Ride-hailing', 'transport', false, '🚕'),
  cat('cat.transport.parking_tolls', 'Parking & Tolls', 'transport', false, '🅿️'),
  cat('cat.transport.vehicle_maintenance', 'Vehicle Maintenance & Service', 'transport', true, '🔧'),

  // -- utilities ---------------------------------------------------------
  cat('cat.utilities.electricity', 'Electricity', 'utilities', true, '💡'),
  cat('cat.utilities.water', 'Water', 'utilities', true, '🚰'),
  cat('cat.utilities.gas', 'Cooking Gas / Piped Gas', 'utilities', true, '🔥'),
  cat('cat.utilities.internet', 'Internet / Broadband', 'utilities', true, '🌐'),
  cat('cat.utilities.mobile', 'Mobile Recharge / Postpaid', 'utilities', true, '📱'),
  cat('cat.utilities.dth', 'DTH / Cable', 'utilities', false, '📺'),

  // -- health --------------------------------------------------------------
  cat('cat.health.doctor_hospital', 'Doctor & Hospital', 'health', true, '🏥'),
  cat('cat.health.pharmacy', 'Pharmacy & Medicines', 'health', true, '💊'),
  cat('cat.health.diagnostics', 'Diagnostics & Checkups', 'health', true, '🩺'),
  cat('cat.health.fitness', 'Gym & Fitness', 'health', false, '🏋️'),

  // -- insurance -------------------------------------------------------------
  cat('cat.insurance.life', 'Life Insurance Premium', 'insurance', true, '🛡️'),
  cat('cat.insurance.health', 'Health Insurance Premium', 'insurance', true, '🩹'),
  cat('cat.insurance.vehicle', 'Vehicle Insurance Premium', 'insurance', true, '🚗'),
  cat('cat.insurance.other', 'Other Insurance Premium', 'insurance', true, '📄'),

  // -- education ---------------------------------------------------------
  cat('cat.education.school_fees', 'School / College Fees', 'education', true, '🎓'),
  cat('cat.education.tuition_coaching', 'Tuition / Coaching', 'education', true, '📚'),
  cat('cat.education.books_supplies', 'Books & Supplies', 'education', true, '📖'),
  cat('cat.education.courses', 'Online Courses & Certifications', 'education', false, '💻'),

  // -- shopping ------------------------------------------------------------
  cat('cat.shopping.clothing', 'Clothing & Footwear', 'shopping', false, '👕'),
  cat('cat.shopping.electronics', 'Electronics & Gadgets', 'shopping', false, '📱'),
  cat('cat.shopping.home_goods', 'Home & Kitchen', 'shopping', false, '🍳'),
  cat('cat.shopping.general', 'General / Online Shopping', 'shopping', false, '🛍️'),

  // -- entertainment -------------------------------------------------------
  cat('cat.entertainment.streaming', 'Streaming Subscriptions', 'entertainment', false, '🎬'),
  cat('cat.entertainment.movies_events', 'Movies & Events', 'entertainment', false, '🎟️'),
  cat('cat.entertainment.gaming', 'Gaming', 'entertainment', false, '🎮'),
  cat('cat.entertainment.hobbies', 'Hobbies', 'entertainment', false, '🎨'),

  // -- travel ----------------------------------------------------------------
  cat('cat.travel.flights', 'Flights', 'travel', false, '✈️'),
  cat('cat.travel.hotels', 'Hotels & Stays', 'travel', false, '🏨'),
  cat('cat.travel.vacation', 'Vacation Packages & Misc', 'travel', false, '🧳'),

  // -- personal_care ---------------------------------------------------------
  cat('cat.personal_care.salon_grooming', 'Salon & Grooming', 'personal_care', false, '💇'),
  cat('cat.personal_care.cosmetics', 'Cosmetics & Personal Products', 'personal_care', false, '💄'),

  // -- debt (EMIs and other committed debt service — essential by doctrine) ---
  cat('cat.debt.home_loan_emi', 'Home Loan EMI', 'debt', true, '🏦'),
  cat('cat.debt.auto_loan_emi', 'Auto Loan EMI', 'debt', true, '🚙'),
  cat('cat.debt.personal_loan_emi', 'Personal Loan EMI', 'debt', true, '💳'),
  cat('cat.debt.education_loan_emi', 'Education Loan EMI', 'debt', true, '🎓'),
  cat('cat.debt.credit_card_payment', 'Credit Card Payment', 'debt', true, '💳'),
  cat('cat.debt.other_emi', 'Other EMI', 'debt', true, '📆'),

  // -- investment (asset-building, excluded from essential burn) -------------
  cat('cat.investment.sip_mutual_fund', 'SIP / Mutual Fund', 'investment', false, '📈'),
  cat('cat.investment.stocks', 'Stocks & Equity', 'investment', false, '📊'),
  cat('cat.investment.ppf_epf', 'PPF / EPF Contribution', 'investment', false, '🏛️'),
  cat('cat.investment.nps', 'NPS Contribution', 'investment', false, '🧓'),
  cat('cat.investment.fd_rd', 'Fixed / Recurring Deposit', 'investment', false, '🏦'),
  cat('cat.investment.gold', 'Gold / Digital Gold', 'investment', false, '🥇'),
  cat('cat.investment.crypto', 'Crypto', 'investment', false, '🪙'),

  // -- income ------------------------------------------------------------------
  cat('cat.income.salary', 'Salary', 'income', false, '💼'),
  cat('cat.income.business_freelance', 'Business / Freelance Income', 'income', false, '🧾'),
  cat('cat.income.interest', 'Interest Income', 'income', false, '💹'),
  cat('cat.income.dividend', 'Dividend Income', 'income', false, '💰'),
  cat('cat.income.rental', 'Rental Income', 'income', false, '🏘️'),
  cat('cat.income.refund_cashback', 'Refund / Cashback', 'income', false, '↩️'),
  cat('cat.income.other', 'Other Income', 'income', false, '➕'),

  // -- taxes (mandatory, essential) ---------------------------------------
  cat('cat.taxes.income_tax_tds', 'Income Tax / TDS', 'taxes', true, '🧾'),
  cat('cat.taxes.gst', 'GST', 'taxes', true, '🧾'),
  cat('cat.taxes.property_tax', 'Property Tax', 'taxes', true, '🏡'),
  cat('cat.taxes.other', 'Other Tax', 'taxes', true, '📜'),

  // -- fees (leakage the advisor engine hunts for — not essential) -----------
  cat('cat.fees.bank_charges', 'Bank Charges', 'fees', false, '🏦'),
  cat('cat.fees.late_penalty', 'Late Fee / Penalty', 'fees', false, '⚠️'),
  cat('cat.fees.atm', 'ATM Fee', 'fees', false, '🏧'),
  cat('cat.fees.interest_charged', 'Interest Charged', 'fees', false, '📉'),

  // -- gifts_donations -----------------------------------------------------
  cat('cat.gifts_donations.gifts', 'Gifts Given', 'gifts_donations', false, '🎁'),
  cat('cat.gifts_donations.charity', 'Donations & Charity', 'gifts_donations', false, '🤲'),

  // -- transfer (moves money between the user's own accounts — not an expense) -
  cat('cat.transfer.internal', 'Internal Transfer', 'transfer', false, '🔁'),
  cat('cat.transfer.wallet_topup', 'Wallet Top-up', 'transfer', false, '👛'),

  // -- uncategorized ---------------------------------------------------------
  cat('cat.uncategorized.general', 'Uncategorized', 'uncategorized', false, '❔'),
];
