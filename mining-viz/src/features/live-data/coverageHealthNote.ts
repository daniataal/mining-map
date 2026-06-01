/** Explain why map-view counts can be 0 while DB ledger counts are high (MAD-74). */
export function coverageViewVsDbNote(options: {
  inView: { terminals: number; vessels: number; corridors: number; opportunities: number };
  db: { vesselObservations: number; terminals: number };
}): { en: string; he: string } | null {
  const { inView, db } = options;
  const inViewTotal =
    inView.terminals + inView.vessels + inView.corridors + inView.opportunities;
  const dbHasData = db.vesselObservations > 0 || db.terminals > 0;
  if (inViewTotal > 0 || !dbHasData) return null;

  const dbVessels = db.vesselObservations.toLocaleString();
  const dbTerminals = db.terminals.toLocaleString();

  return {
    en: `0 in current map bbox — the ledger has ${dbVessels} vessel observations and ${dbTerminals} terminals globally. Pan/zoom to your hub, or check oil-live-intel-worker sync if you expect live AIS here.`,
    he: `0 בתיבת המפה הנוכחית — במאגר ${dbVessels} תצפיות כלי שיט ו-${dbTerminals} מסופים גלובלית. הזיזו/התקרבו למרכז העניין או בדקו סנכרון oil-live-intel-worker.`,
  };
}
