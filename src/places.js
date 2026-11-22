// Rounded city center coordinates, hand-curated; IANA identifiers name civil rules via Intl.
export const cities = [
  ['Reykjavik', 'Iceland', 64.147, -21.940, 'Atlantic/Reykjavik'],
  ['Tokyo', 'Japan', 35.681, 139.767, 'Asia/Tokyo'],
  ['New York', 'United States', 40.713, -74.006, 'America/New_York'],
  ['Los Angeles', 'United States', 34.052, -118.244, 'America/Los_Angeles'],
  ['Honolulu', 'United States', 21.307, -157.858, 'Pacific/Honolulu'],
  ['Mexico City', 'Mexico', 19.433, -99.133, 'America/Mexico_City'],
  ['Lima', 'Peru', -12.046, -77.043, 'America/Lima'],
  ['São Paulo', 'Brazil', -23.551, -46.633, 'America/Sao_Paulo'],
  ['Buenos Aires', 'Argentina', -34.604, -58.382, 'America/Argentina/Buenos_Aires'],
  ['Lisbon', 'Portugal', 38.722, -9.139, 'Europe/Lisbon'],
  ['London', 'United Kingdom', 51.507, -0.128, 'Europe/London'],
  ['Paris', 'France', 48.857, 2.352, 'Europe/Paris'],
  ['Tromsø', 'Norway', 69.649, 18.955, 'Europe/Oslo'],
  ['Cairo', 'Egypt', 30.044, 31.236, 'Africa/Cairo'],
  ['Nairobi', 'Kenya', -1.292, 36.822, 'Africa/Nairobi'],
  ['Cape Town', 'South Africa', -33.925, 18.424, 'Africa/Johannesburg'],
  ['Dubai', 'United Arab Emirates', 25.205, 55.271, 'Asia/Dubai'],
  ['Delhi', 'India', 28.614, 77.209, 'Asia/Kolkata'],
  ['Singapore', 'Singapore', 1.352, 103.820, 'Asia/Singapore'],
  ['Seoul', 'South Korea', 37.567, 126.978, 'Asia/Seoul'],
  ['Sydney', 'Australia', -33.869, 151.209, 'Australia/Sydney'],
  ['Auckland', 'New Zealand', -36.849, 174.763, 'Pacific/Auckland'],
].map(([name, country, lat, lon, zone]) => ({ name, country, lat, lon, zone }));

export const example = { ...cities[0], name: 'Reykjavik · example city' };
export function coordinateSite(name, lat, lon) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lon) || Math.abs(lon) > 180) return null;
  // No nearest-city guessing; an unlabeled coordinate does not carry a reliable civil zone.
  return { name, lat, lon, zone: 'UTC', fallback: true };
}

const normalized = text => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replaceAll('ø', 'o');
export function findCities(query) {
  const term = normalized(query.trim());
  return cities.filter(city => normalized(`${city.name} ${city.country}`).includes(term));
}
