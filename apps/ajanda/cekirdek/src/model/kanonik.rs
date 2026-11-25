//! Kanonik JSON (`kanonik.ts`), SHA-256 ve base64. Bağımlılıksız: aynı girdiden TS ile aynı baytlar.
//! Kanonik kural: anahtarlar UTF-16 birim sırasıyla, boşluk yok, metin kaçışı yalnız `"` `\` ve
//! U+0000-001F (`\b \t \n \f \r`, ötekiler `\u00xx`), sayılar yalnız güvenli tam sayı.

use serde_json::Value;

fn metin_yaz(cikti: &mut String, metin: &str) {
    cikti.push('"');
    for c in metin.chars() {
        match c {
            '"' => cikti.push_str("\\\""),
            '\\' => cikti.push_str("\\\\"),
            '\u{08}' => cikti.push_str("\\b"),
            '\t' => cikti.push_str("\\t"),
            '\n' => cikti.push_str("\\n"),
            '\u{0c}' => cikti.push_str("\\f"),
            '\r' => cikti.push_str("\\r"),
            c if (c as u32) < 0x20 => cikti.push_str(&format!("\\u00{:02x}", c as u32)),
            c => cikti.push(c),
        }
    }
    cikti.push('"');
}

fn deger_yaz(cikti: &mut String, deger: &Value) {
    match deger {
        Value::Null => cikti.push_str("null"),
        Value::Bool(b) => cikti.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => match (n.as_i64(), n.as_f64()) {
            (Some(i), _) => cikti.push_str(&i.to_string()),
            // `-0` serde_json'da f64'tür; JS `String(-0 === 0 ? 0 : n)` gibi 0 yazılır.
            (None, Some(f)) if f.is_finite() && f.fract() == 0.0 && f.abs() < 9_007_199_254_740_992.0 => {
                cikti.push_str(&(f as i64).to_string())
            }
            // Kayıt modelinde tam sayı dışı sayı yoktur; TS bu halde hata atar.
            _ => panic!("kanonik JSON yalnız güvenli tam sayı kabul eder"),
        },
        Value::String(s) => metin_yaz(cikti, s),
        Value::Array(a) => {
            cikti.push('[');
            for (i, oge) in a.iter().enumerate() {
                if i > 0 {
                    cikti.push(',');
                }
                deger_yaz(cikti, oge);
            }
            cikti.push(']');
        }
        Value::Object(h) => {
            let mut anahtarlar: Vec<&String> = h.keys().collect();
            anahtarlar.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            cikti.push('{');
            for (i, a) in anahtarlar.into_iter().enumerate() {
                if i > 0 {
                    cikti.push(',');
                }
                metin_yaz(cikti, a);
                cikti.push(':');
                deger_yaz(cikti, &h[a]);
            }
            cikti.push('}');
        }
    }
}

/// `kanonikJson`.
pub fn kanonik_json(deger: &Value) -> String {
    let mut cikti = String::new();
    deger_yaz(&mut cikti, deger);
    cikti
}

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
];

/// SHA-256, küçük harfli 64 karakter onaltılık.
pub fn sha256_hex(veri: &[u8]) -> String {
    let mut h: [u32; 8] =
        [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let mut dolgulu = veri.to_vec();
    dolgulu.push(0x80);
    while dolgulu.len() % 64 != 56 {
        dolgulu.push(0);
    }
    dolgulu.extend_from_slice(&((veri.len() as u64) * 8).to_be_bytes());
    let mut w = [0u32; 64];
    for blok in dolgulu.chunks_exact(64) {
        for t in 0..16 {
            w[t] = u32::from_be_bytes([blok[4 * t], blok[4 * t + 1], blok[4 * t + 2], blok[4 * t + 3]]);
        }
        for t in 16..64 {
            let s0 = w[t - 15].rotate_right(7) ^ w[t - 15].rotate_right(18) ^ (w[t - 15] >> 3);
            let s1 = w[t - 2].rotate_right(17) ^ w[t - 2].rotate_right(19) ^ (w[t - 2] >> 10);
            w[t] = w[t - 16].wrapping_add(s0).wrapping_add(w[t - 7]).wrapping_add(s1);
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut i] = h;
        for t in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = i.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[t]).wrapping_add(w[t]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            i = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (hh, x) in h.iter_mut().zip([a, b, c, d, e, f, g, i]) {
            *hh = hh.wrapping_add(x);
        }
    }
    h.iter().map(|x| format!("{x:08x}")).collect()
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standart base64, dolgulu (anahtar, imza, nonce kabloda böyle).
pub fn base64_yaz(veri: &[u8]) -> String {
    let mut s = String::with_capacity(veri.len().div_ceil(3) * 4);
    for parca in veri.chunks(3) {
        let b = [parca[0], *parca.get(1).unwrap_or(&0), *parca.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= parca.len() {
                s.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                s.push('=');
            }
        }
    }
    s
}

/// Standart base64 çözümü (dolgu isteğe bağlı); geçersizse `None`.
pub fn base64_coz(metin: &str) -> Option<Vec<u8>> {
    let govde = metin.trim_end_matches('=');
    if metin.len() - govde.len() > 2 || govde.len() % 4 == 1 {
        return None;
    }
    let mut cikti = Vec::with_capacity(govde.len() * 3 / 4);
    let mut tampon = 0u32;
    let mut bit = 0;
    for c in govde.bytes() {
        let d = B64.iter().position(|&x| x == c)? as u32;
        tampon = (tampon << 6) | d;
        bit += 6;
        if bit >= 8 {
            bit -= 8;
            cikti.push((tampon >> bit) as u8);
            tampon &= (1 << bit) - 1;
        }
    }
    Some(cikti)
}

/// URL güvenli base64, dolgusuz: `OpakId` deseninde kimlik üretmek için (`k_...`, `i_...`).
pub fn base64url_yaz(veri: &[u8]) -> String {
    base64_yaz(veri).trim_end_matches('=').replace('+', "-").replace('/', "_")
}

#[cfg(test)]
mod testler {
    use super::*;

    #[test]
    fn sha256_bilinen() {
        assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let uzun = vec![b'a'; 1000];
        assert_eq!(sha256_hex(&uzun), "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3");
    }

    #[test]
    fn base64_gidip_gelir() {
        for n in 0..10 {
            let veri: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(base64_coz(&base64_yaz(&veri)).unwrap(), veri);
        }
        assert_eq!(base64_yaz(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_yaz(b"fo"), "Zm8=");
        assert!(!base64url_yaz(&[0xfb, 0xff, 0xbf]).contains(['+', '/', '=']));
    }

    #[test]
    fn kanonik_sira_ve_kacis() {
        let v: Value = serde_json::from_str(r#"{"b":1,"a":[true,null,"x\u0001\n"],"A":-0}"#).unwrap();
        assert_eq!(kanonik_json(&v), r#"{"A":0,"a":[true,null,"x\u0001\n"],"b":1}"#);
    }
}
