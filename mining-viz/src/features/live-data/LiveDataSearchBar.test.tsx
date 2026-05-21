// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LiveDataSearchBar, { hitTitle, hitSubtitle } from './LiveDataSearchBar';
import type { OilLiveSearchResponse } from '../../api/oilLiveApi';

const sampleResponse: OilLiveSearchResponse = {
  hits: [
    {
      type: 'company',
      id: 'co-1',
      score: 4.2,
      source: { name: 'Acme Oil & Gas', country: 'NL' },
    },
    {
      type: 'company',
      id: 'co-2',
      score: 3.1,
      source: { name: 'Acme Trading', country: 'CH' },
    },
    {
      type: 'cargo',
      id: 'mcr-1',
      score: 2.8,
      source: {
        shipper_name: 'Acme Oil',
        consignee_name: 'Buyer Ltd',
        commodity_family: 'crude',
        load_country: 'SA',
      },
    },
    {
      type: 'terminal',
      id: 'term-1',
      score: 1.5,
      source: { name: 'Acme Terminal', country: 'NL', operator_name: 'Acme Ports' },
    },
  ],
  total: 4,
  took_ms: 12,
  query: 'acme',
};

function makeSearchFn(opts: {
  delayMs?: number;
  response?: OilLiveSearchResponse;
  failWith?: 'reject' | 'unavailable';
}) {
  const calls: string[] = [];
  const fn = vi.fn(async (q: string) => {
    calls.push(q);
    if (opts.delayMs) {
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }
    if (opts.failWith === 'reject') throw new Error('network');
    if (opts.failWith === 'unavailable') {
      return {
        hits: [],
        total: 0,
        took_ms: 0,
        query: q,
        error: 'search_unavailable',
      } satisfies OilLiveSearchResponse;
    }
    return opts.response ?? sampleResponse;
  });
  return { fn, calls };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function typeAndFlushDebounce(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350); // > DEBOUNCE_MS
  });
}

describe('LiveDataSearchBar', () => {
  it('debounces the query and renders grouped hits', async () => {
    const onHitClick = vi.fn();
    const { fn, calls } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');

    // Three quick keystrokes should collapse into one debounced fetch.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ac' } });
    fireEvent.change(input, { target: { value: 'acme' } });
    expect(fn).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['acme']);

    await waitFor(() => {
      expect(screen.getByTestId('live-data-search-dropdown')).toBeInTheDocument();
    });

    // Each hit should be addressable; per-type buttons should match the counts.
    const cargoHits = screen.getAllByTestId('live-data-search-hit-cargo');
    const companyHits = screen.getAllByTestId('live-data-search-hit-company');
    const terminalHits = screen.getAllByTestId('live-data-search-hit-terminal');
    expect(cargoHits).toHaveLength(1);
    expect(companyHits).toHaveLength(2);
    expect(terminalHits).toHaveLength(1);
  });

  it('renders the "no results" empty state when query returns zero hits', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({
      response: { hits: [], total: 0, took_ms: 1, query: 'zzz' },
    });
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'zzz');

    await waitFor(() => {
      expect(screen.getByTestId('live-data-search-empty')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('live-data-search-unavailable')).toBeNull();
  });

  it('shows the "Search unavailable" state when ES is down (503 envelope)', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({ failWith: 'unavailable' });
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'down');

    await waitFor(() => {
      expect(screen.getByTestId('live-data-search-unavailable')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('live-data-search-hit-cargo')).toBeNull();
    expect(onHitClick).not.toHaveBeenCalled();
  });

  it('treats unexpected network errors as "Search unavailable" so the panel never breaks', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({ failWith: 'reject' });
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'oops');

    await waitFor(() => {
      expect(screen.getByTestId('live-data-search-unavailable')).toBeInTheDocument();
    });
  });

  it('fires onHitClick with the resolved title when a hit is clicked', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'acme');

    const cargoButton = await screen.findByTestId('live-data-search-hit-cargo');
    fireEvent.click(cargoButton);
    expect(onHitClick).toHaveBeenCalledTimes(1);
    const arg = onHitClick.mock.calls[0][0];
    expect(arg.type).toBe('cargo');
    expect(arg.id).toBe('mcr-1');
    expect(arg.title).toBe('Acme Oil → Buyer Ltd');
  });

  it('opens the first hit when Enter is pressed', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'acme');

    await screen.findByTestId('live-data-search-dropdown');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onHitClick).toHaveBeenCalledTimes(1);
    // First hit in the response is the company "Acme Oil & Gas".
    expect(onHitClick.mock.calls[0][0].id).toBe('co-1');
  });

  it('closes the dropdown on Escape', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'acme');

    await screen.findByTestId('live-data-search-dropdown');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByTestId('live-data-search-dropdown')).toBeNull();
    });
  });

  it('does NOT fire a fetch for an empty / whitespace-only query', async () => {
    const onHitClick = vi.fn();
    const { fn } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={onHitClick} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('hit title/subtitle helpers', () => {
  it('hitTitle picks the most specific label per type', () => {
    expect(
      hitTitle({
        type: 'cargo',
        id: 'x',
        score: 0,
        source: { shipper_name: 'A', consignee_name: 'B' },
      }),
    ).toBe('A → B');
    expect(
      hitTitle({ type: 'company', id: 'x', score: 0, source: { name: 'Acme' } }),
    ).toBe('Acme');
    expect(hitTitle({ type: 'vessel', id: '12345', score: 0, source: { imo: 'IMO-1' } })).toBe(
      'IMO-1',
    );
  });

  it('hitSubtitle joins available context fields with " · "', () => {
    expect(
      hitSubtitle({
        type: 'terminal',
        id: 'x',
        score: 0,
        source: { operator_name: 'Op', country: 'NL' },
      }),
    ).toBe('Op · NL');
    expect(hitSubtitle({ type: 'company', id: 'x', score: 0, source: { country: 'SA' } })).toBe(
      'SA',
    );
  });
});

// Sanity check the dropdown is positioned inside a listbox (a11y nicety).
describe('LiveDataSearchBar a11y', () => {
  it('exposes a combobox + listbox pair when hits are present', async () => {
    const { fn } = makeSearchFn({});
    render(<LiveDataSearchBar onHitClick={vi.fn()} searchFn={fn} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    await typeAndFlushDebounce(input, 'acme');
    await screen.findByRole('listbox');
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);
  });
});
