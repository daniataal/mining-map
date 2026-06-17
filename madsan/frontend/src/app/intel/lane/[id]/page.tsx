import LaneDossierPageClient from "@/components/LaneDossierPageClient";
import type { LaneDossierSegmentKey } from "@/lib/energyApi";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSegment(value?: string): LaneDossierSegmentKey {
  if (value === "chain" || value === "act" || value === "numbers" || value === "thesis") return value;
  return "thesis";
}

export default async function LaneDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams ? await searchParams : {};
  return (
    <LaneDossierPageClient
      opportunityId={decodeURIComponent(id)}
      initialSegment={parseSegment(firstParam(query.segment))}
    />
  );
}
