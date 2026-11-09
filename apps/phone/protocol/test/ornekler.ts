import type { Plan } from "../src/index.ts";

export const NONCE = "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNA==";
export const JETON = "abcdefghijklmnopqrstuvwxyz012345_-ABCDEFG";
export const IMZA = "MEUCIQDabc123+/defGHIjklMNOpqrSTUvwxYZ0123==";
export const ANAHTAR = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEabc123+/def==";
export const HASH = "a".repeat(64);

export const PLAN_PC: Plan = {
  plan_id: "plan-1",
  baslik: "Testleri düzelt",
  tur: "pc",
  cwd: "C:\\Proje\\ornek",
  gorev_metni: "Kırık testleri düzelt.\nRaporu yaz.",
};

export const PLAN_TELEFON: Plan = {
  plan_id: "plan-2",
  baslik: "Mesajı oku",
  tur: "telefon",
  cwd: "",
  gorev_metni: "Son mesajı oku ve özetle.",
  telefon_izin_istegi: { uygulamalar: ["com.example.mesaj"], mod: "oku" },
};

export const RAPOR = {
  yapildi: ["Testler düzeltildi"],
  yapilmadi: [],
  dosyalar: ["src/a.ts"],
  acik_noktalar: [],
};
