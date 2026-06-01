/** MAD-46 §8 — discover → verify → price → execute workflow steps. */
export type TradingWorkflowStepId = 'discover' | 'verify' | 'price' | 'execute';

export type TradingWorkflowStepStatus = 'empty' | 'ready' | 'blocked';

export interface TradingWorkflowStepDef {
  id: TradingWorkflowStepId;
  labelEn: string;
  labelHe: string;
  headingEn: string;
  headingHe: string;
  descriptionEn: string;
  descriptionHe: string;
}

/** Section headings aligned with docs/UX_SPEC_MAD-46.md §8. */
export const TRADING_WORKFLOW_STEPS: TradingWorkflowStepDef[] = [
  {
    id: 'discover',
    labelEn: 'Discover',
    labelHe: 'גילוי',
    headingEn: 'Map & search',
    headingHe: 'מפה וחיפוש',
    descriptionEn: 'Spatial context from map layers and intel search; tier badges on every signal.',
    descriptionHe: 'הקשר מרחבי משכבות המפה וחיפוש אינטל; תגיות רמה על כל אות.',
  },
  {
    id: 'verify',
    labelEn: 'Verify',
    labelHe: 'אימות',
    headingEn: 'Evidence & provenance',
    headingHe: 'ראיות ומקור',
    descriptionEn: 'Source URLs, MCR recipe lines, and sanctions/LEI chips before pricing.',
    descriptionHe: 'קישורי מקור, שורות מתכון MCR וצ\'יפים לסנקציות/LEI לפני תמחור.',
  },
  {
    id: 'price',
    labelEn: 'Price',
    labelHe: 'תמחור',
    headingEn: 'Economics & benchmarks',
    headingHe: 'כלכלה ובנצ\'מרקים',
    descriptionEn: 'Public benchmarks and landed-cost proxies only — labeled inferred where needed.',
    descriptionHe: 'בנצ\'מרקים ציבוריים ופרוקסי עלות נחיתה בלבד — מסומן כהסקה במידת הצורך.',
  },
  {
    id: 'execute',
    labelEn: 'Execute',
    labelHe: 'ביצוע',
    headingEn: 'Suppliers & deal room',
    headingHe: 'ספקים וחדר עסקה',
    descriptionEn: 'Save counterparty, route planner, deal room, and export when licensed.',
    descriptionHe: 'שמירת צד, תכנון מסלול, חדר עסקה וייצוא כשיש הרשאה.',
  },
];

export interface TradingWorkflowEmptyState {
  messageEn: string;
  messageHe: string;
  actionEn?: string;
  actionHe?: string;
}

/** Honest empty states — docs/UX_SPEC_MAD-46.md §8 table (no demo deals). */
export const TRADING_WORKFLOW_EMPTY_BY_STEP: Record<TradingWorkflowStepId, TradingWorkflowEmptyState> = {
  discover: {
    messageEn: 'Select a map feature or search hit to anchor this workflow.',
    messageHe: 'בחרו ישות במפה או תוצאת חיפוש כדי לעגן את התהליך.',
    actionEn: 'Pan the map or use company search',
    actionHe: 'הזיזו את המפה או השתמשו בחיפוש חברות',
  },
  verify: {
    messageEn: 'No evidence chain or source URL linked to this entity yet.',
    messageHe: 'אין עדיין שרשרת ראיות או קישור מקור לישות זו.',
    actionEn: 'Open MCR / deal pack tab when available, or run graph-sync',
    actionHe: 'פתחו לשונית MCR / חבילת עסקה אם זמינה, או הריצו graph-sync',
  },
  price: {
    messageEn: 'Benchmarks and economics load from deal pack — not available for this entity.',
    messageHe: 'בנצ\'מרקים וכלכלה נטענים מחבילת עסקה — לא זמינים לישות זו.',
    actionEn: 'Select an opportunity or cargo with a deal pack',
    actionHe: 'בחרו הזדמנות או מטען עם חבילת עסקה',
  },
  execute: {
    messageEn: 'Save to Suppliers and deal room require linked companies and sign-in.',
    messageHe: 'שמירה לספקים וחדר עסקה דורשים חברות מקושרות והתחברות.',
    actionEn: 'Use deal pack actions when parties resolve',
    actionHe: 'השתמשו בפעולות חבילת העסקה כשהצדדים מזוהים',
  },
};
