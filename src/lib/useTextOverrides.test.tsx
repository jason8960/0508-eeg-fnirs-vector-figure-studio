/**
 * Hook tests for `useTextOverrides`. Verifies the override pruning,
 * resolve fallback chain and selection state without pulling in a
 * full React testing library — we mount a tiny harness component
 * with `react-dom/client` and act() through the hook.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  useTextOverrides,
  type TextOverride,
  type TextOverrideMap,
  type UseTextOverridesResult,
} from './useTextOverrides';

// React 18+ asks every host that drives renders during tests to opt
// into act(...) by setting this global; otherwise it logs a stderr
// warning on each act() call. happy-dom doesn't set it for us.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

/**
 * Mounts a harness component that captures the latest hook result
 * into `captured`. Returns a tuple of (snapshot getter, current
 * overrides getter) so individual tests can assert and dispatch.
 */
function mountHook(): {
  hook: () => UseTextOverridesResult;
  overrides: () => TextOverrideMap;
} {
  let latest: UseTextOverridesResult | null = null;
  let overridesNow: TextOverrideMap = {};

  function Harness() {
    const [overrides, setOverrides] = useState<TextOverrideMap>({});
    overridesNow = overrides;
    latest = useTextOverrides({ overrides, setOverrides });
    return null;
  }

  act(() => {
    root!.render(<Harness />);
  });
  if (latest === null) throw new Error('hook never produced a result');
  return {
    hook: () => latest!,
    overrides: () => overridesNow,
  };
}

describe('useTextOverrides', () => {
  test('starts with no selection and an empty override map', () => {
    const { hook } = mountHook();
    expect(hook().selectedId).toBeNull();
    expect(hook().overrides).toEqual({});
  });

  test('selectText sets and clears the selected id', () => {
    const { hook } = mountHook();
    act(() => hook().selectText('title'));
    expect(hook().selectedId).toBe('title');
    act(() => hook().selectText(null));
    expect(hook().selectedId).toBeNull();
  });

  test('setOverride writes a non-empty patch into the override map', () => {
    const { hook, overrides } = mountHook();
    act(() => hook().setOverride('title', { fontSize: 18, color: '#abc' }));
    const map = overrides();
    expect(map.title).toEqual({ fontSize: 18, color: '#abc' });
  });

  test('setOverride prunes empty / null fields so the slot can collapse', () => {
    const { hook, overrides } = mountHook();
    act(() => hook().setOverride('a', { fontSize: 14 }));
    expect(overrides().a).toEqual({ fontSize: 14 });
    // Clearing the only field removes the entry entirely.
    act(() => hook().setOverride('a', { fontSize: undefined }));
    expect(overrides().a).toBeUndefined();
  });

  test('setOverride(null) clears the entry for that id only', () => {
    const { hook, overrides } = mountHook();
    act(() => hook().setOverride('a', { color: '#fff' }));
    act(() => hook().setOverride('b', { color: '#000' }));
    act(() => hook().setOverride('a', null));
    expect(overrides().a).toBeUndefined();
    expect(overrides().b).toEqual({ color: '#000' });
  });

  test('clearOverride is a no-op for ids that have no override', () => {
    const { hook, overrides } = mountHook();
    act(() => hook().clearOverride('ghost'));
    expect(overrides()).toEqual({});
  });

  test('resolve falls back to defaults when no override exists', () => {
    const { hook } = mountHook();
    const resolved = hook().resolve('missing', {
      text: 'Hello',
      fontSize: 12,
      fontWeight: 600,
      color: '#111',
    });
    expect(resolved).toEqual({
      text: 'Hello',
      fontSize: 12,
      fontWeight: 600,
      italic: false,
      color: '#111',
      dx: 0,
      dy: 0,
      hidden: false,
    });
  });

  test('resolve overlays override fields on top of defaults', () => {
    const { hook } = mountHook();
    act(() =>
      hook().setOverride('t', {
        text: 'Replaced',
        italic: true,
        dx: 5,
        hidden: true,
      } as TextOverride),
    );
    const r = hook().resolve('t', {
      text: 'Original',
      fontSize: 14,
      fontWeight: 500,
      color: '#222',
    });
    expect(r.text).toBe('Replaced');
    expect(r.italic).toBe(true);
    expect(r.dx).toBe(5);
    expect(r.hidden).toBe(true);
    // Unrelated fields still come from the defaults.
    expect(r.fontSize).toBe(14);
    expect(r.fontWeight).toBe(500);
    expect(r.color).toBe('#222');
  });

  test('resolve falls back to currentColor / 400 weight when defaults omit them', () => {
    const { hook } = mountHook();
    const r = hook().resolve('blank', { text: 'x', fontSize: 10 });
    expect(r.fontWeight).toBe(400);
    expect(r.color).toBe('currentColor');
  });
});
