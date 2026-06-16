/** API client for the deal playground (deal graphs built on the map). */
import { authFetchOpts } from "@/lib/auth";
import { apiBase } from "@/lib/layers";

export type DealSummary = {
  id: string;
  title: string;
  commodity: string;
  status: string;
  nodes: number;
  links: number;
  dd_verified: number;
  dd_rejected: number;
  updated_at?: string;
};

export type DealNode = {
  id: string;
  kind: string;
  name: string;
  ref_entity_type?: string;
  ref_entity_id?: string;
  lat?: number | null;
  lon?: number | null;
  dd_status: string;
  dd_notes?: string;
  metadata?: Record<string, unknown>;
};

export type DealLink = {
  id: string;
  from_node: string;
  to_node: string;
  role: string;
  notes?: string;
};

export type DealGraph = {
  id: string;
  title: string;
  commodity: string;
  status: string;
  nodes: DealNode[];
  links: DealLink[];
};

export type SearchHit = {
  id: string;
  name: string;
  entity_type: string;
  asset_type?: string;
  mmsi?: string;
  country_code?: string;
  latitude?: number | null;
  longitude?: number | null;
  subtitle?: string;
};

const jsonOpts = (method: string, body?: unknown): RequestInit => ({
  ...authFetchOpts,
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function expectOk(res: Response): Promise<void> {
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
}

export async function listDeals(): Promise<DealSummary[]> {
  const res = await fetch(`${apiBase()}/api/deals/`, authFetchOpts);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.deals ?? []) as DealSummary[];
}

export async function createDeal(title: string, commodity: string): Promise<string> {
  const res = await fetch(`${apiBase()}/api/deals/`, jsonOpts("POST", { title, commodity }));
  await expectOk(res);
  return (await res.json()).id as string;
}

export async function updateDeal(id: string, patch: Partial<{ title: string; commodity: string; status: string }>): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${id}`, jsonOpts("PATCH", patch)));
}

export async function deleteDeal(id: string): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${id}`, jsonOpts("DELETE")));
}

export async function fetchDealGraph(id: string): Promise<DealGraph> {
  const res = await fetch(`${apiBase()}/api/deals/${id}/graph`, authFetchOpts);
  await expectOk(res);
  return (await res.json()) as DealGraph;
}

export async function addNode(dealId: string, node: Partial<DealNode>): Promise<string> {
  const res = await fetch(`${apiBase()}/api/deals/${dealId}/nodes`, jsonOpts("POST", node));
  await expectOk(res);
  return (await res.json()).id as string;
}

export async function updateNode(dealId: string, nodeId: string, patch: Partial<DealNode>): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${dealId}/nodes/${nodeId}`, jsonOpts("PATCH", patch)));
}

export async function deleteNode(dealId: string, nodeId: string): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${dealId}/nodes/${nodeId}`, jsonOpts("DELETE")));
}

export async function addLink(dealId: string, fromNode: string, toNode: string, role: string): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${dealId}/links`, jsonOpts("POST", { from_node: fromNode, to_node: toNode, role })));
}

export async function deleteLink(dealId: string, linkId: string): Promise<void> {
  await expectOk(await fetch(`${apiBase()}/api/deals/${dealId}/links/${linkId}`, jsonOpts("DELETE")));
}

export async function searchEntities(q: string): Promise<SearchHit[]> {
  if (q.trim().length < 2) return [];
  const res = await fetch(`${apiBase()}/api/core/search?q=${encodeURIComponent(q)}`, authFetchOpts);
  if (!res.ok) return [];
  return (await res.json()) as SearchHit[];
}
