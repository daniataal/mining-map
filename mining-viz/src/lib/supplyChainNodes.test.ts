import { describe, it, expect } from 'vitest';
import {
  buildSupplyChainNodes,
  nodesFromTradeFlows,
  computeSupplyChainHud,
  filterSupplyChainNodes,
} from './supplyChainNodes';

describe('supplyChainNodes', () => {
  it('maps Comtrade import to supplier and export to consumer', () => {
    const nodes = nodesFromTradeFlows([
      { partner: 'China', flow_type: 'M', year: 2023, trade_value_usd: 1_000_000, hs_code: '2709' },
      { partner: 'Germany', flow_type: 'X', year: 2023, trade_value_usd: 2_000_000, hs_code: '2709' },
    ]);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.name === 'China')?.role).toBe('supplier');
    expect(nodes.find((n) => n.name === 'Germany')?.role).toBe('consumer');
    expect(nodes[0].source).toBe('comtrade_db');
  });

  it('returns empty list when no inputs', () => {
    expect(buildSupplyChainNodes({})).toEqual([]);
  });

  it('deduplicates same partner and role', () => {
    const nodes = buildSupplyChainNodes({
      tradeFlows: [
        { partner: 'France', flow_type: 'X', year: 2022, trade_value_usd: 100 },
        { partner: 'France', flow_type: 'X', year: 2023, trade_value_usd: 200 },
      ],
    });
    expect(nodes.filter((n) => n.name === 'France' && n.role === 'consumer')).toHaveLength(1);
  });

  it('computes HUD from nodes and flows', () => {
    const flows = [{ partner: 'US', flow_type: 'X', year: 2023, trade_value_usd: 5_000_000 }];
    const nodes = nodesFromTradeFlows(flows);
    const hud = computeSupplyChainHud(nodes, flows);
    expect(hud.downstreamCount).toBe(1);
    expect(hud.totalTradeValueUsd).toBe(5_000_000);
    expect(hud.hasData).toBe(true);
  });

  it('filters by role and search', () => {
    const nodes = nodesFromTradeFlows([
      { partner: 'Alpha', flow_type: 'M', year: 2023 },
      { partner: 'Beta', flow_type: 'X', year: 2023 },
    ]);
    const filtered = filterSupplyChainNodes(nodes, 'alpha', 'all');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Alpha');
  });
});
