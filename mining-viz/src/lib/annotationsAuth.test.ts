import { describe, expect, it } from 'vitest';
import axios from 'axios';
import { isAnnotationsAuthError } from './annotationsAuth';

describe('isAnnotationsAuthError', () => {
  it('detects axios 401 responses', () => {
    expect(
      isAnnotationsAuthError(
        new axios.AxiosError('Unauthorized', 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 401,
          statusText: 'Unauthorized',
          headers: {},
          config: {} as never,
          data: {},
        }),
      ),
    ).toBe(true);
    expect(isAnnotationsAuthError(new Error('nope'))).toBe(false);
  });
});
