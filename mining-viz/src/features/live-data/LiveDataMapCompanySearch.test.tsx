// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import LiveDataMapCompanySearch from './LiveDataMapCompanySearch';
import type { OilLiveSearchResponse } from '../../api/oilLiveApi';

const companyHit: OilLiveSearchResponse = {
  hits: [
    {
      type: 'company',
      id: 'co-1',
      score: 5,
      source: {
        name: 'Acme Oil',
        country: 'NL',
        corridor_load: { lat: 51.9, lon: 4.5 },
      },
    },
  ],
  total: 1,
  took_ms: 3,
  query: 'acme',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LiveDataMapCompanySearch', () => {
  it('opens company drawer and flies map when a hit is selected', async () => {
    const onEntityClick = vi.fn();
    const onMapFlyTo = vi.fn();
    const searchFn = vi.fn(async () => companyHit);

    render(
      <LiveDataMapCompanySearch
        onEntityClick={onEntityClick}
        onMapFlyTo={onMapFlyTo}
        searchFn={searchFn}
      />,
    );

    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const hit = await screen.findByTestId('live-data-search-hit-company');
    fireEvent.click(hit);

    expect(onMapFlyTo).toHaveBeenCalledWith(51.9, 4.5);
    expect(onEntityClick).toHaveBeenCalledWith({
      entityKind: 'company',
      entityId: 'co-1',
      title: 'Acme Oil',
      subtitle: 'NL',
    });
  });

  it('shows degraded banner when API returns postgres fallback', async () => {
    const searchFn = vi.fn(
      async (): Promise<OilLiveSearchResponse> => ({
        ...companyHit,
        degraded: 'postgres',
      }),
    );

    render(<LiveDataMapCompanySearch searchFn={searchFn} onEntityClick={vi.fn()} />);
    const input = screen.getByTestId('live-data-search-input');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'acme' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    await waitFor(() => {
      expect(screen.getByTestId('live-data-search-degraded')).toBeInTheDocument();
    });
  });
});
