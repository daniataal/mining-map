import DossierPageClient from "@/components/DossierPageClient";

type SearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IntelDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityType: string; id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { entityType, id } = await params;
  const query = searchParams ? await searchParams : {};
  return (
    <DossierPageClient
      entityType={entityType}
      id={id}
      name={firstParam(query.name)}
      legacy={firstParam(query.legacy)}
    />
  );
}
