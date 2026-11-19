// lib/address.js — v1.37: is the shipping address complete enough to print and ship a book?
// Used by the performer's page ("Send for layout" is refused until it is) — a book must not reach layout,
// proof or print with a half-typed address (first real case: a street line that only said "5").
// The same rules are mirrored in my/index.html (shipMissing) so the customer is told before pressing the button.

// Countries where the printer needs a state / province code.
const REGION_NEEDED = new Set(['CA', 'US', 'AU', 'MX', 'BR']);
// Countries and territories that have no postal codes.
const NO_POSTAL = new Set(['HK', 'AE', 'QA', 'BS', 'PA', 'JM', 'MO', 'AG', 'AW', 'BZ', 'BO', 'BW', 'FJ', 'GH', 'KE', 'UG', 'ZW', 'TT']);

// Returns the list of what is missing, in plain words ([] = complete).
// cc = function that turns what the customer typed as a country into a 2-letter code ('' when not recognised).
export function shipMissing(o, cc) {
  const v = k => String((o && o[k]) || '').trim();
  const miss = [];
  if (v('ship_name').length < 2) miss.push('full name');
  if (v('phone').replace(/\D/g, '').length < 7) miss.push('phone number');
  const street = v('ship_address');
  if (street.length < 5 || !/\p{L}{2}/u.test(street)) miss.push('street address with the street name');
  if (v('ship_city').length < 2) miss.push('city');
  const code = cc(v('ship_country'));
  if (!code) miss.push('country');
  if ((!code || REGION_NEEDED.has(code)) && !v('ship_region')) miss.push('state / province');
  if (!NO_POSTAL.has(code) && v('ship_postal').length < 3) miss.push('postal code');
  return miss;
}
