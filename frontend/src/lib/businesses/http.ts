import { NextResponse } from 'next/server';

/**
 * Guarantees a JSON response from every route handler, including on an unexpected throw.
 * Without this a crash returns an EMPTY body and the browser reports
 * "Unexpected end of JSON input" with no indication of the real cause.
 */
export function withApi<T extends any[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (e: any) {
      console.error('[businesses api]', e);
      return NextResponse.json(
        { error: e?.message || 'Server error', detail: e?.detail },
        { status: 500 },
      );
    }
  };
}
