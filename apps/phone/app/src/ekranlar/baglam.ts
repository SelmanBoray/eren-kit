import { useSyncExternalStore } from "react";
import type { Cekirdek, CekirdekDurumu, Sohbet, SohbetDurumu } from "../cekirdek/index.ts";

export const useCekirdekDurumu = (c: Cekirdek): CekirdekDurumu => useSyncExternalStore(c.abone, c.durum);

export const useSohbetDurumu = (s: Sohbet): SohbetDurumu => useSyncExternalStore(s.abone, s.durum);
