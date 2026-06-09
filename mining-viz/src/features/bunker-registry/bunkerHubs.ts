export type BunkerHub = {
  locode: string;
  name: string;
  country: string;
};

export const BUNKER_REGISTRY_HUBS: BunkerHub[] = [
  { locode: 'AEFJR', name: 'Fujairah', country: 'United Arab Emirates' },
  { locode: 'SGSIN', name: 'Singapore', country: 'Singapore' },
  { locode: 'NLRTM', name: 'Rotterdam', country: 'Netherlands' },
  { locode: 'BEANR', name: 'Antwerp-Bruges', country: 'Belgium' },
  { locode: 'GB', name: 'United Kingdom', country: 'United Kingdom' },
  { locode: 'NZ', name: 'New Zealand', country: 'New Zealand' },
];

export function bunkerHubByLocode(locode: string | null | undefined): BunkerHub | undefined {
  if (!locode) return undefined;
  return BUNKER_REGISTRY_HUBS.find((h) => h.locode === locode);
}
