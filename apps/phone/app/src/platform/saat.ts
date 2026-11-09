import type { IptalEt, SaatPortu } from "../cekirdek/sozlesme.ts";

export const saatKur = (): SaatPortu => ({
  simdiMs: () => Date.now(),
  sonra: (ms, f): IptalEt => {
    const t = setTimeout(f, ms);
    return () => clearTimeout(t);
  },
});
