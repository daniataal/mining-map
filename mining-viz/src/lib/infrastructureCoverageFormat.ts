export interface InfrastructureCoverageViewport {
  osm_pipelines?: number;
  osm_refineries?: number;
  osm_storage?: number;
  gem_pipelines?: number;
  gem_plants?: number;
  gem_lng_terminals?: number;
  gem_extraction_fields?: number;
}

export interface InfrastructureCoverageReport {
  viewport_bbox?: number[] | null;
  viewport?: InfrastructureCoverageViewport;
  summary_line?: string;
  coverage_gap?: boolean;
  limitations?: string[];
  pipeline_comparison?: Record<string, unknown>;
}

export function formatInfrastructureCoverageBanner(
  report: InfrastructureCoverageReport | null | undefined,
  storageInView?: number | null,
): string | null {
  if (!report?.viewport) return null;
  const v = report.viewport;
  const parts = [
    `OSM ${v.osm_pipelines ?? 0} pipes`,
    `${v.osm_refineries ?? 0} refineries`,
    `${v.osm_storage ?? 0} storage`,
    `· GEM ${v.gem_pipelines ?? 0} pipes`,
    `${v.gem_plants ?? 0} plants`,
    `${v.gem_lng_terminals ?? 0} LNG`,
    `${v.gem_extraction_fields ?? 0} fields`,
  ];
  if (storageInView != null && storageInView > 0) {
    parts.push(`· ${storageInView} tank markers loaded`);
  }
  return `${parts.join(' ')} — complementary sources, not duplicates.`;
}

export function infrastructureCoverageGapMessage(
  report: InfrastructureCoverageReport | null | undefined,
): string | null {
  if (!report?.coverage_gap) return null;
  return (
    'No OSM/GEM pipeline or OSM storage features in this viewport. ' +
    'Pan to a known corridor (e.g. Gulf) or run GEM/OSM ingest on the server.'
  );
}
