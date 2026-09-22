// Read ?key=value overrides on top of defaults (types follow the defaults).
export function paramsFromURL<T extends Record<string, unknown>>(defaults: T): T {
  const q = new URLSearchParams(location.search);
  const out = { ...defaults };
  for (const k of Object.keys(defaults)) {
    const v = q.get(k);
    if (v === null || v === '') continue;
    const d = defaults[k];
    if (typeof d === 'number') (out as Record<string, unknown>)[k] = Number(v);
    else if (typeof d === 'boolean') (out as Record<string, unknown>)[k] = v === '1' || v === 'true';
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
