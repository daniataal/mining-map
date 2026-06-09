export type BunkerHub = {
  locode: string;
  name: string;
  country: string;
};

export const BUNKER_REGISTRY_HUBS: BunkerHub[] = [
  { locode: 'AEFJR', name: 'Fujairah', country: 'United Arab Emirates' },
  { locode: 'AEJEA', name: 'Jebel Ali / Dubai', country: 'United Arab Emirates' },
  { locode: 'AEKHL', name: 'Khalifa Port', country: 'United Arab Emirates' },
  { locode: 'AEKLF', name: 'Khor Fakkan', country: 'United Arab Emirates' },
  { locode: 'OMSLL', name: 'Sohar', country: 'Oman' },
  { locode: 'SGSIN', name: 'Singapore', country: 'Singapore' },
  { locode: 'NLRTM', name: 'Rotterdam', country: 'Netherlands' },
  { locode: 'BEANR', name: 'Antwerp-Bruges', country: 'Belgium' },
  { locode: 'GB', name: 'United Kingdom', country: 'United Kingdom' },
  { locode: 'NZ', name: 'New Zealand', country: 'New Zealand' },
  { locode: 'GIGIB', name: 'Gibraltar', country: 'Gibraltar' },
  { locode: 'MTMLA', name: 'Malta', country: 'Malta' },
];

export function bunkerHubByLocode(locode: string | null | undefined): BunkerHub | undefined {
  if (!locode) return undefined;
  return BUNKER_REGISTRY_HUBS.find((h) => h.locode === locode);
}
