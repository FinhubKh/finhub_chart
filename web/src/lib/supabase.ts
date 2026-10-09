// Temporary stub replacing the removed `@supabase/supabase-js` client.
//
// Auth moved to Firebase in Task 7 (see `./auth.tsx` and `./firebase.ts`).
// `strategiesApi.ts` and `pineApi.ts` still call this chainable stub until
// Task 8 rewrites them to call the Cloud Run API (`/api/user/...`) via
// Firebase ID tokens. At that point this file can be deleted entirely.
//
// `data` is intentionally typed `any` here: callers cast the (always-null)
// result to their expected row types, and this stub never actually returns
// data, so strict generic plumbing would add complexity with no benefit.

export const supabaseConfigured = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StubResult = { data: any; error: Error | null };

function notConfigured(): Promise<StubResult> {
  return Promise.resolve({
    data: null,
    error: new Error(
      "Supabase has been removed. Strategies/pine data now lives behind the Cloud Run API (Task 8)."
    ),
  });
}

class StubQueryBuilder implements PromiseLike<StubResult> {
  select(..._args: unknown[]): this {
    return this;
  }
  insert(..._args: unknown[]): this {
    return this;
  }
  update(..._args: unknown[]): this {
    return this;
  }
  upsert(..._args: unknown[]): this {
    return this;
  }
  delete(..._args: unknown[]): this {
    return this;
  }
  eq(..._args: unknown[]): this {
    return this;
  }
  order(..._args: unknown[]): this {
    return this;
  }
  limit(..._args: unknown[]): this {
    return this;
  }
  maybeSingle(): Promise<StubResult> {
    return notConfigured();
  }
  single(): Promise<StubResult> {
    return notConfigured();
  }
  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return notConfigured().then(onfulfilled, onrejected);
  }
}

export const supabase = {
  from(_table: string): StubQueryBuilder {
    return new StubQueryBuilder();
  },
};
