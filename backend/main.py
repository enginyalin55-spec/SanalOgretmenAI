from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client, Client
from dotenv import load_dotenv
import os, json, uuid, re
from pydantic import BaseModel
from typing import Union, List, Dict, Any, Optional

# =======================================================
# 1) AYARLAR
# =======================================================
load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("❌ KRİTİK HATA: GEMINI_API_KEY eksik!")

SUPABASE_URL = (os.getenv("SUPABASE_URL", "") or "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ KRİTİK HATA: SUPABASE bilgileri eksik!")

client = genai.Client(api_key=API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Sanal Ogretmen AI API", version="1.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost:(3000|5173|8081)|sanal-(ogretmen|ogrenci)-ai(-.*)?\.vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Model fallback
MODELS_TO_TRY = [
    "gemini-2.0-flash-exp",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
]

MAX_FILE_SIZE = 6 * 1024 * 1024
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

# =======================================================
# 2) HEALTH
# =======================================================
@app.get("/")
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Sanal Ogretmen AI Backend"}

# =======================================================
# 3) MODELLER
# =======================================================
class AnalyzeRequest(BaseModel):
    ocr_text: str
    image_url: Optional[str] = ""
    student_name: str
    student_surname: str
    classroom_code: str
    level: str
    country: str
    native_language: str

class UpdateScoreRequest(BaseModel):
    submission_id: Union[int, str]
    new_rubric: dict
    new_total: int

# =======================================================
# 4) TDK RULES
# =======================================================
def load_tdk_rules() -> List[Dict[str, Any]]:
    return [
        {"rule_id": "TDK_01_BAGLAC_DE", "text": "Bağlaç olan 'da/de' ayrı yazılır."},
        {"rule_id": "TDK_02_BAGLAC_KI", "text": "Bağlaç olan 'ki' ayrı yazılır."},
        {"rule_id": "TDK_03_SORU_EKI", "text": "Soru eki 'mı/mi' ayrı yazılır."},
        {"rule_id": "TDK_04_SEY_SOZ", "text": "'Şey' sözcüğü daima ayrı yazılır."},
        {"rule_id": "TDK_05_BUYUK_CUMLE", "text": "Cümleler büyük harfle başlar."},
        {"rule_id": "TDK_06_BUYUK_OZEL", "text": "Özel isimler büyük harfle başlar."},
        {"rule_id": "TDK_08_BUYUK_GEREKSIZ", "text": "Özel isim olmayan sözcükler cümle içinde büyük harfle yazılamaz."},
        {"rule_id": "TDK_09_KESME_OZEL", "text": "Özel isimlere gelen ekler kesme ile ayrılır (Samsun'a)."},
        {"rule_id": "TDK_13_KESME_GENEL", "text": "Cins isimlere gelen ekler kesme ile ayrılmaz (stadyuma, okula)."},
        {"rule_id": "TDK_12_SAYILAR", "text": "Sayılar ayrı yazılır (on beş)."},
        {"rule_id": "TDK_20_NOKTA", "text": "Cümle sonuna nokta konur."},
        {"rule_id": "TDK_21_VIRGUL", "text": "Sıralı kelimelere virgül konur."},
        {"rule_id": "TDK_23_YANLIS_YALNIZ", "text": "Yanlış (yanılmak), Yalnız (yalın)."},
        {"rule_id": "TDK_24_HERKES", "text": "Herkes (s ile)."},
        {"rule_id": "TDK_25_SERTLESME", "text": "Sertleşme kuralı (Kitapta, 1923'te)."},
        {"rule_id": "TDK_28_YABANCI", "text": "Yabancı kelimeler (Şoför, egzoz, makine)."}
    ]

# =======================================================
# 5) YARDIMCILAR
# =======================================================
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

# ✅ Türkçe lower fix
TR_LOWER_MAP = str.maketrans({"İ": "i", "I": "ı"})
def tr_lower(s: str) -> str:
    if not s:
        return ""
    return s.translate(TR_LOWER_MAP).lower()

def tr_lower_first(word: str) -> str:
    if not word:
        return ""
    return tr_lower(word[0]) + word[1:]

def normalize_text(text: str) -> str:
    """
    ✅ NEWLINE KORUR.
    OCR satırları cümle başı tespiti için kritik.
    """
    if not text:
        return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)

    # Windows newline -> \n
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # satır içi boşlukları toparla, newline kalsın
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    # boş satırları at
    lines = [ln for ln in lines if ln != ""]
    return "\n".join(lines).strip()

def normalize_match(text: str) -> str:
    return tr_lower(normalize_text(text))

def to_int(x, default=0):
    try:
        if x is None:
            return default
        if isinstance(x, (int, float)):
            return int(x)
        if isinstance(x, str):
            if "/" in x:
                x = x.split("/")[0]
            clean = re.sub(r"[^\d\-]", "", x)
            return int(clean) if clean else default
        return default
    except:
        return default

async def read_limited(upload: UploadFile, limit: int) -> bytes:
    chunks = []
    size = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > limit:
            raise HTTPException(status_code=413, detail=f"Dosya çok büyük (Maks {limit // (1024*1024)}MB).")
        chunks.append(chunk)
    return b"".join(chunks)

# Cümle/segment başlangıcı: nokta + newline + : ; — – --
SENT_BOUNDARY = re.compile(r"([.!?]+|[\n\r]+|[:;]+|—|–|-{2,})")

def sentence_starts(text: str) -> set:
    starts = {0}
    for m in SENT_BOUNDARY.finditer(text):
        idx = m.end()
        while idx < len(text) and text[idx].isspace():
            idx += 1
        if idx < len(text):
            starts.add(idx)
    return starts

# basit özel isim ipuçları (gerekirse genişlet)
PROPER_ROOTS = {"samsun", "karadeniz", "türkiye"}

def norm_token(token: str) -> str:
    if not token:
        return ""
    t = token.strip().replace("’", "'")
    t = re.sub(r"[.,;:!?()\[\]{}]", "", t)
    return t

def token_root(token: str) -> str:
    t = norm_token(token)
    if "'" in t:
        t = t.split("'")[0]
    return tr_lower(t)

def is_probably_proper(word: str) -> bool:
    r = token_root(word)
    if r in PROPER_ROOTS:
        return True
    if "'" in norm_token(word) and word[:1].isupper():
        return True
    return False

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    """
    normalize_match newline korur; ama find için line-break farkı sorun olabilir.
    Bu yüzden aramayı 'display' üzerinden yapıyoruz: newline -> space
    """
    wrong_n = normalize_match(wrong).replace("\n", " ")
    full_n = normalize_match(full_text).replace("\n", " ")

    if not wrong_n:
        return None

    matches = []
    start_idx = 0
    while True:
        idx = full_n.find(wrong_n, start_idx)
        if idx == -1:
            break
        matches.append(idx)
        start_idx = idx + 1

    if not matches:
        return None

    best = min(matches, key=lambda x: abs(x - hint_start)) if hint_start is not None else matches[0]

    # ⚠️ burada idx, newline->space dönüştürülmüş metne göre
    # Basit yaklaşım: gerçek metinde de aynı indeks çoğunlukla tutar (satır sonu azsa).
    # Daha sağlam istersen mapping yapılır ama şimdilik pratikte yeterli.
    return (best, best + len(wrong_n))

# =======================================================
# 5A) LLM düzeltmelerini güvenli hale getir (paraphrase engeli)
# =======================================================
def is_safe_correction(wrong: str, correct: str) -> bool:
    w = normalize_text(wrong)
    c = normalize_text(correct)
    if not w or not c:
        return False

    # 1) Cümle/paragraf gibi uzun parça düzeltmesi istemiyoruz
    if len(w) > 25 or "\n" in w:
        return False

    # 2) Aşırı kısaltma (kelime düşürme)
    if len(c) < max(2, int(len(w) * 0.75)):
        return False

    # 3) Çok büyük değişimi engelle (basit karakter set örtüşmesi)
    w0 = normalize_match(w)
    c0 = normalize_match(c)
    common = set(w0) & set(c0)
    if len(common) / max(1, len(set(w0))) < 0.5:
        return False

    return True

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_ids: set) -> Dict[str, Any]:
    if not isinstance(result, dict):
        return {"errors": []}

    raw_errors = result.get("errors", [])
    if not isinstance(raw_errors, list):
        raw_errors = []

    clean_errors = []
    for err in raw_errors:
        if not isinstance(err, dict):
            continue

        rid = err.get("rule_id")
        if not rid or rid not in allowed_ids:
            continue

        wrong = err.get("wrong", "") or ""
        correct = err.get("correct", "") or ""
        if not wrong or not correct:
            continue
        if normalize_match(wrong) == normalize_match(correct):
            continue

        # ✅ paraphrase/cümle bozma filtresi
        if not is_safe_correction(wrong, correct):
            continue

        hint = None
        if isinstance(err.get("span"), dict):
            hint = to_int(err["span"].get("start"), None)

        fixed = _find_best_span(full_text, wrong, hint)
        if fixed:
            start, end = fixed
            # gerçek metinden slice almak newline index farkında sorun çıkarabilir.
            # UI için wrong olarak LLM wrong'ı tutmak daha güvenli:
            clean_errors.append({
                "wrong": wrong,
                "correct": correct,
                "type": "Yazım",
                "rule_id": rid,
                "explanation": err.get("explanation", ""),
                "span": {"start": start, "end": end},
                "ocr_suspect": bool(err.get("ocr_suspect", False))
            })

    clean_errors.sort(key=lambda x: x["span"]["start"])
    return {"errors": clean_errors}

def merge_and_dedupe_errors(*lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    merged = []
    for lst in lists:
        for e in (lst or []):
            sp = e.get("span", {}) or {}
            key = (
                sp.get("start"), sp.get("end"),
                normalize_match(e.get("wrong", "")),
                normalize_match(e.get("correct", "")),
                e.get("rule_id")
            )
            if key in seen:
                continue
            seen.add(key)
            merged.append(e)
    merged.sort(key=lambda x: x.get("span", {}).get("start", 10**9))
    return merged

# =======================================================
# 5B) OCR ŞÜPHELİ TESPİT
# =======================================================
OCR_NOISE_PATTERNS = [
    re.compile(r".*\b[a-zA-ZğüşöçıİĞÜŞÖÇ]+['’][a-zA-Z]\b"),
    re.compile(r"^[a-zA-Z]\b"),
]

def looks_like_ocr_noise(wrong: str, full_text: str, span: dict) -> bool:
    w = (wrong or "").strip()
    if len(w) <= 1:
        return True
    for p in OCR_NOISE_PATTERNS:
        if p.search(w):
            if " " in w and len(w.split()) == 2 and len(w.split()[1]) == 1:
                return True
    return False

# =======================================================
# 5C) Büyük harf (false-positive azaltılmış)
# =======================================================
def find_unnecessary_capitals(full_text: str) -> list:
    starts = sentence_starts(full_text)
    errors = []

    for m in re.finditer(r"\b[^\W\d_]+\b", full_text, flags=re.UNICODE):
        word = m.group(0)
        s, e = m.start(), m.end()

        if s in starts:
            continue

        if is_probably_proper(word):
            continue

        # "Sok" kelimesi çoğu zaman OCR->çok; büyük harf önerisi üretme
        if tr_lower(word) in {"sok"}:
            continue

        upp = sum(1 for ch in word if ch.isupper())
        low = sum(1 for ch in word if ch.islower())
        is_weird_case = (upp >= 2 and low >= 1)

        if is_weird_case:
            errors.append({
                "wrong": word,
                "correct": word,
                "type": "OCR_ŞÜPHELİ",
                "rule_id": "TDK_08_BUYUK_GEREKSIZ",
                "explanation": "Büyük/küçük harf karışıklığı OCR kaynaklı olabilir.",
                "span": {"start": s, "end": e},
                "ocr_suspect": True
            })
            continue

        if word and word[0].isupper():
            errors.append({
                "wrong": word,
                "correct": tr_lower_first(word),
                "type": "Büyük Harf",
                "rule_id": "TDK_08_BUYUK_GEREKSIZ",
                "explanation": "Cümle ortasında gereksiz büyük harf kullanımı.",
                "span": {"start": s, "end": e},
                "ocr_suspect": False
            })

    return errors

# =======================================================
# 5D) A2 heuristics
# =======================================================
POSSESSIVE_HINT = re.compile(r"(ım|im|um|üm|ın|in|un|ün|m|n)$", re.IGNORECASE | re.UNICODE)

def find_conjunction_dade_joined(full_text: str) -> list:
    errs = []
    for m in re.finditer(r"\b([^\W\d_]+)(da|de)\b", full_text, flags=re.UNICODE | re.IGNORECASE):
        base = m.group(1)
        suf = m.group(2)
        whole = full_text[m.start():m.end()]

        # mektubun-da, evim-de gibi -> bölme
        if POSSESSIVE_HINT.search(base):
            continue

        # özel isim/büyük harf varsa dokunma
        if any(ch.isupper() for ch in whole) or is_probably_proper(whole):
            continue

        errs.append({
            "wrong": whole,
            "correct": f"{base} {suf}",
            "type": "Yazım",
            "rule_id": "TDK_01_BAGLAC_DE",
            "explanation": "Bağlaç olan da/de ayrı yazılır. (Düşük güven: ek de olabilir.)",
            "span": {"start": m.start(), "end": m.end()},
            "ocr_suspect": True
        })
    return errs

def find_common_a2_errors(full_text: str) -> list:
    errs = []

    # cok/çok OCR varyantları
    for m in re.finditer(r"\b(cok|çog|cök|coK|COk|sok)\b", full_text, flags=re.IGNORECASE):
        wrong = m.group(0)
        errs.append({
            "wrong": wrong,
            "correct": "çok",
            "type": "Yazım",
            "rule_id": "TDK_28_YABANCI",
            "explanation": "‘çok’ kelimesinin yazımı.",
            "span": {"start": m.start(), "end": m.end()},
            "ocr_suspect": True
        })

    # soru eki bitişik: geldinmi -> geldin mi
    for m in re.finditer(r"\b([^\W\d_]{2,})(mi|mı|mu|mü)\b", full_text, flags=re.UNICODE | re.IGNORECASE):
        word = m.group(0)
        wl = tr_lower(word)
        if wl in {"kimi", "bimi"}:
            continue
        errs.append({
            "wrong": word,
            "correct": m.group(1) + " " + m.group(2),
            "type": "Yazım",
            "rule_id": "TDK_03_SORU_EKI",
            "explanation": "Soru eki ayrı yazılır.",
            "span": {"start": m.start(), "end": m.end()},
            "ocr_suspect": False
        })

    return errs

# =======================================================
# 5E) Tek span tek öneri
# =======================================================
RULE_PRIORITY = {
    "TDK_28_YABANCI": 100,
    "TDK_03_SORU_EKI": 90,
    "TDK_09_KESME_OZEL": 80,
    "TDK_13_KESME_GENEL": 80,
    "TDK_25_SERTLESME": 70,
    "TDK_01_BAGLAC_DE": 60,
    "TDK_08_BUYUK_GEREKSIZ": 30,
    "TDK_05_BUYUK_CUMLE": 20,
    "TDK_20_NOKTA": 20,
    "TDK_21_VIRGUL": 20,
    "TDK_23_YANLIS_YALNIZ": 10,
}

def pick_best_per_span(errors: list) -> list:
    buckets: Dict[tuple, List[dict]] = {}
    for e in errors:
        sp = e.get("span") or {}
        key = (sp.get("start"), sp.get("end"))
        if None in key:
            continue
        buckets.setdefault(key, []).append(e)

    chosen = []
    for _, items in buckets.items():
        def score(e):
            pri = RULE_PRIORITY.get(e.get("rule_id"), 0)
            ocr_penalty = 20 if e.get("ocr_suspect") else 0
            same_penalty = 50 if normalize_match(e.get("wrong","")) == normalize_match(e.get("correct","")) else 0
            return pri - ocr_penalty - same_penalty
        chosen.append(max(items, key=score))

    chosen.sort(key=lambda x: x["span"]["start"])
    return chosen

# =======================================================
# 5F) CEFR fallback (0 puanları bitirmek için)
# =======================================================
def cefr_fallback_scores(level: str, text: str) -> Dict[str, int]:
    t = normalize_text(text).replace("\n", " ")
    if not t:
        return {"uzunluk": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0}

    words = re.findall(r"\b[^\W\d_]+\b", t, flags=re.UNICODE)
    sentences = [s for s in re.split(r"[.!?]+", t) if s.strip()]
    has_connectors = bool(re.search(r"\b(ve|ama|çünkü|bu yüzden|sonra|fakat)\b", tr_lower(t)))
    uniq = len(set([tr_lower(w) for w in words])) if words else 0

    uzunluk = min(16, max(4, int(len(words) / 10) + 6))
    kelime = min(14, max(5, int(uniq / 8) + 6))

    soz = 8
    if len(sentences) >= 3:
        soz += 4
    if has_connectors:
        soz += 4
    soz_dizimi = min(20, max(6, soz))

    icerik = 8
    if len(sentences) >= 3:
        icerik += 4
    if len(words) >= 40:
        icerik += 4
    icerik = min(20, max(6, icerik))

    return {"uzunluk": int(uzunluk), "soz_dizimi": int(soz_dizimi), "kelime": int(kelime), "icerik": int(icerik)}

# =======================================================
# 6) ENDPOINTS
# =======================================================
@app.get("/check-class/{code}")
async def check_class_code(code: str):
    try:
        response = supabase.table("classrooms").select("name").eq("code", code.upper().strip()).execute()
        if response.data:
            return {"valid": True, "class_name": response.data[0]["name"]}
        return {"valid": False}
    except:
        return {"valid": False}

@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    try:
        file_content = await read_limited(file, MAX_FILE_SIZE)

        filename = file.filename or "unknown.jpg"
        file_ext = "jpg"
        if "." in filename:
            ext = filename.rsplit(".", 1)[-1].lower()
            if ext in ALLOWED_EXTENSIONS:
                file_ext = ext

        safe_mime = file.content_type
        if not safe_mime or not safe_mime.startswith("image/"):
            safe_mime = MIME_BY_EXT.get(file_ext, "image/jpeg")

        safe_code = re.sub(r"[^A-Za-z0-9_-]", "_", classroom_code)[:20]
        unique_filename = f"{safe_code}_{uuid.uuid4()}.{file_ext}"
        image_url = ""

        try:
            supabase.storage.from_("odevler").upload(
                unique_filename, file_content, {"content-type": safe_mime, "upsert": "false"}
            )
            res = supabase.storage.from_("odevler").get_public_url(unique_filename)
            image_url = res if isinstance(res, str) else res.get("publicUrl")
        except Exception as up_err:
            print(f"⚠️ Upload Uyarısı: {up_err}")

        # =======================================================
        # 1) AŞAMA: HAM OCR (DÜZELTME YOK)
        # =======================================================
        extracted_text = ""
        prompt_ocr = """ROL: Sen bir OCR katibisin. Öğretmen değilsin. Dil uzmanı değilsin.

GÖREV:
Bu görseldeki EL YAZISI Türkçe metni, KAĞITTA GÖRDÜĞÜN GİBİ dijital metne aktar.

KESİN KURALLAR:
- ASLA düzeltme yapma.
- ASLA kelimeyi daha doğru / daha anlamlı hale getirme.
- ASLA yazım, noktalama, büyük/küçük harf, ek düzeltmesi yapma.
- Yanlış olduğunu düşünsen bile, gördüğünü yaz.

BİÇİM:
- SATIRLARI KORU (kağıttaki satır sonları kalsın).
- Yorum/başlık/açıklama ekleme.
- SADECE metni yaz.

ÇIKTI:
SADECE OCR METNİ. BAŞKA HİÇBİR ŞEY YAZMA.
"""

        for model_name in MODELS_TO_TRY:
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=[prompt_ocr, types.Part.from_bytes(data=file_content, mime_type=safe_mime)],
                    config=types.GenerateContentConfig(
                        temperature=0,
                        response_mime_type="text/plain",
                    ),
                )
                extracted_text = (resp.text or "").strip().replace("```", "").strip()
                if extracted_text:
                    break
            except Exception:
                continue

        if not extracted_text:
            return {"status": "error", "message": "OCR Başarısız"}

        raw_text = extracted_text

        # =======================================================
        # 2) AŞAMA: EMNİYET FİLTRESİ (DÜZELTME YOK, SADECE ⍰ İŞARETLE)
        #    Amaç: LLM tahmin edip "emin değilim" demese bile,
        #    Türkçe-dışı / şüpheli kelimelerde karakter maskele.
        # =======================================================
        MARK_CHAR = "⍰"
        WORD_MARK = "(⍰)"

        VOWELS = set("aeıioöuüAEIİOÖUÜ")
        # Türkçe'de çok nadir/şüpheli görülen bazı ikililer (heuristic)
        SUSPICIOUS_BIGRAMS = {
            "tz", "zd", "dt", "tb", "pk", "bp", "gk", "kg", "qy", "wq", "xq",
            "yi̇",  # bazı OCR birleşimleri
        }
        # Türkçe'de beklenmeyen karakterler (rakam, ascii dışı vb.)
        ALLOWED_CHARS = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZçÇğĞıİöÖşŞüÜ'-.,;:!?()“”\" \n\t")

        def is_turkish_like_word(w: str) -> bool:
            # Sadece harflerden oluşmayan parçaları (ör. "2026", "—") kelime saymayalım
            letters = [c for c in w if c.isalpha() or c in "çÇğĞıİöÖşŞüÜ"]
            if not letters:
                return True

            # En az 1 ünlü yoksa çok şüpheli (örn: "trl", "stdy")
            if not any(c in VOWELS for c in letters):
                return False

            # 4+ ünsüz ardışık ise şüpheli
            consec_cons = 0
            for c in letters:
                if c in VOWELS:
                    consec_cons = 0
                else:
                    consec_cons += 1
                    if consec_cons >= 4:
                        return False

            # Basit bigram kontrolü
            low = "".join(letters).lower()
            for i in range(len(low) - 1):
                bg = low[i:i+2]
                if bg in SUSPICIOUS_BIGRAMS:
                    return False

            return True

        def mask_one_char(word: str) -> str:
            """
            Kelimeyi ASLA düzeltmez.
            Sadece şüpheli kelimede 1 karakteri ⍰ yapar.
            Hangi karakter?:
              - Harf olmayan/garip karakter varsa onu maskeler.
              - Yoksa uzun ünsüz dizisinin ortasını maskeler.
              - Hâlâ seçemezse sonuna (⍰) ekler.
            """
            # Garip karakter yakala
            for idx, ch in enumerate(word):
                if ch not in ALLOWED_CHARS:
                    return word[:idx] + MARK_CHAR + word[idx+1:]

            # Harf dizisi üzerinden ünsüz serisi bul
            letters_idx = [(i, ch) for i, ch in enumerate(word) if ch.isalpha() or ch in "çÇğĞıİöÖşŞüÜ"]
            if not letters_idx:
                return word + WORD_MARK

            # 4+ ünsüz koşusunu bul
            run = []
            current = []
            for i, ch in letters_idx:
                if ch in VOWELS:
                    if len(current) >= 4:
                        run = current
                        break
                    current = []
                else:
                    current.append((i, ch))
            if not run and len(current) >= 4:
                run = current

            if run:
                mid_i = run[len(run)//2][0]
                return word[:mid_i] + MARK_CHAR + word[mid_i+1:]

            # Bigram yakala ve ikinci harfi maskele
            low = "".join(ch for _, ch in letters_idx).lower()
            if len(low) >= 2:
                for j in range(len(low) - 1):
                    if low[j:j+2] in SUSPICIOUS_BIGRAMS:
                        # j+1'in orijinal indexini bul
                        orig_i = letters_idx[j+1][0]
                        return word[:orig_i] + MARK_CHAR + word[orig_i+1:]

            # Son çare: kelime sonuna işaret
            return word + WORD_MARK

        def post_mask_text(text: str) -> str:
            # Satırları koruyarak token bazlı ilerleyelim.
            # Boşlukları kaybetmemek için split değil, regex ile token yakalayacağız.
            def repl(m):
                token = m.group(0)
                # Çok kısa şeylere dokunma
                if len(token) <= 2:
                    return token
                # Kelime benzeri token ise kontrol et
                if any(ch.isalpha() or ch in "çÇğĞıİöÖşŞüÜ" for ch in token):
                    if not is_turkish_like_word(token):
                        return mask_one_char(token)
                return token

            # "kelime benzeri" parçaları yakala (boşluk/enter aynen kalsın)
            # Not: apostrof ve tireyi de token içine alıyoruz.
            pattern = r"[A-Za-zÇĞİÖŞÜçğıöşü'’-]+"
            return re.sub(pattern, repl, text)

        flagged_text = post_mask_text(raw_text)

        return {
            "status": "success",
            "ocr_text": flagged_text,      # öğrenciye göster (⍰ işaretli)
            "raw_ocr_text": raw_text,      # opsiyonel debug
            "image_url": image_url,

            # UX metinleri
            "ocr_notice": f"ℹ️ Turuncu işaretli ({MARK_CHAR}) yerler OCR tarafından net okunamamıştır. Lütfen metni kontrol edip düzeltiniz.",
            "ocr_hover_text": "OCR bu kısmı net okuyamadı. Öğrenci kontrol etmelidir.",
            "ocr_markers": { "char": MARK_CHAR, "word": WORD_MARK }
        }

    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "message": str(e)}



@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş, analiz yapılamaz.")

    full_text = normalize_text(data.ocr_text)  # ✅ newline korunuyor
    display_text = full_text.replace("\n", " ")  # LLM için

    print(f"🧠 Analiz: {data.student_name} ({data.level})")

    tdk_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in tdk_rules}
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])

    # =======================================================
    # 1) TDK AGENT (paraphrase yasak)
    # =======================================================
    prompt_tdk = f"""
ROL: Sen nesnel ve kuralcı bir TDK denetçisisin.
GÖREV: Metindeki yazım / noktalama / büyük-küçük harf / kesme işareti / ek yazımı hatalarını bul.

ÖNEMLİ:
- YENİDEN YAZIM YAPMA: Cümleleri daha doğal hale getirip yeniden yazma.
- SADECE LOKAL DÜZELT: 1-2 kelimelik küçük parçalar düzelt.
- wrong alanı en fazla 25 karakterlik küçük bir parça olsun. (Cümle komple olmaz.)
- "wrong" alanına metindeki parçayı BİREBİR yaz.
- OCR kaynaklı olabilecek parçalanmaları "ocr_suspect": true olarak işaretle.
- Cins isimlerde kesme kullanılmaz (stadyuma). Özel isimlerde kesme olabilir (Samsun'a).

METİN: \"\"\"{display_text}\"\"\"

REFERANS KURALLAR:
{rules_text}

ÇIKTI (SADECE JSON):
{{
  "rubric_part": {{ "noktalama": (0-14 Int), "dil_bilgisi": (0-16 Int) }},
  "errors": [
    {{
      "wrong": "...",
      "correct": "...",
      "rule_id": "...",
      "explanation": "...",
      "span": {{ "start": 0 }},
      "ocr_suspect": false
    }}
  ]
}}
"""

    # =======================================================
    # 2) CEFR AGENT
    # =======================================================
    prompt_cefr = f"""
ROL: Sen destekleyici bir öğretmensin.
GÖREV: {data.level} seviyesindeki öğrencinin iletişim becerisini değerlendir.

KURALLAR:
1) Yazım/noktalama hatalarını puanlamada ikinci plana at (iletişim öncelikli).
2) PUANLAMA: Tam sayı.
3) teacher_note başına "[SEVİYE: ...]" ekle.
4) rubric_part içindeki 4 alan ZORUNLU ve Int olmalı.

METİN: \"\"\"{display_text}\"\"\"

ÇIKTI (SADECE JSON):
{{
  "rubric_part": {{
    "uzunluk": (0-16 Int),
    "soz_dizimi": (0-20 Int),
    "kelime": (0-14 Int),
    "icerik": (0-20 Int)
  }},
  "teacher_note": "[SEVİYE: UYGUN] ..."
}}
"""

    final_result = None
    last_error = ""

    for model_name in MODELS_TO_TRY:
        try:
            print(f"🔄 Model: {model_name}")

            resp_tdk = client.models.generate_content(
                model=model_name,
                contents=prompt_tdk,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0
                ),
            )
            raw_tdk = (resp_tdk.text or "").strip()
            if not raw_tdk:
                raise ValueError("Boş TDK Yanıtı")
            json_tdk = json.loads(raw_tdk.replace("```json", "").replace("```", ""))

            resp_cefr = client.models.generate_content(
                model=model_name,
                contents=prompt_cefr,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0
                ),
            )
            raw_cefr = (resp_cefr.text or "").strip()
            if not raw_cefr:
                raise ValueError("Boş CEFR Yanıtı")
            json_cefr = json.loads(raw_cefr.replace("```json", "").replace("```", ""))

            # =======================================================
            # PUAN BİRLEŞTİRME + FALLBACK
            # =======================================================
            tdk_p = json_tdk.get("rubric_part", {}) if isinstance(json_tdk, dict) else {}
            cefr_p = json_cefr.get("rubric_part", {}) if isinstance(json_cefr, dict) else {}

            if not isinstance(cefr_p, dict) or not cefr_p:
                cefr_p = cefr_fallback_scores(data.level, full_text)

            combined_rubric = {
                "noktalama": min(14, max(0, to_int(tdk_p.get("noktalama")))),
                "dil_bilgisi": min(16, max(0, to_int(tdk_p.get("dil_bilgisi")))),
                "uzunluk": min(16, max(0, to_int(cefr_p.get("uzunluk")))),
                "soz_dizimi": min(20, max(0, to_int(cefr_p.get("soz_dizimi")))),
                "kelime": min(14, max(0, to_int(cefr_p.get("kelime")))),
                "icerik": min(20, max(0, to_int(cefr_p.get("icerik")))),
            }
            total_score = sum(combined_rubric.values())

            # =======================================================
            # HATA TOPLAMA
            # =======================================================
            cleaned_tdk = validate_analysis(json_tdk, full_text, allowed_ids)
            rule_caps = find_unnecessary_capitals(full_text)
            rule_common = find_common_a2_errors(full_text)
            rule_dade = find_conjunction_dade_joined(full_text)

            all_errors = merge_and_dedupe_errors(
                cleaned_tdk.get("errors", []),
                rule_caps,
                rule_common,
                rule_dade
            )

            # ✅ aynı span çatışmasını tek öneriye indir
            all_errors = pick_best_per_span(all_errors)

            # =======================================================
            # OCR / ÖĞRENCİ AYIR
            # =======================================================
            errors_student = []
            errors_ocr = []

            for e in all_errors:
                span = e.get("span") or {}
                if "start" not in span or "end" not in span:
                    continue

                ocr_flag = bool(e.get("ocr_suspect", False)) or looks_like_ocr_noise(e.get("wrong", ""), full_text, span)
                if ocr_flag:
                    e["type"] = "OCR_ŞÜPHELİ"
                    e["explanation"] = (e.get("explanation", "") + " (OCR parçalanması olabilir.)").strip()
                    e["ocr_suspect"] = True
                    errors_ocr.append(e)
                else:
                    errors_student.append(e)

            errors_student.sort(key=lambda x: x["span"]["start"])
            errors_ocr.sort(key=lambda x: x["span"]["start"])

            raw_note = (json_cefr.get("teacher_note") or "").strip() if isinstance(json_cefr, dict) else ""
            if not raw_note:
                raw_note = f"[SEVİYE: {data.level}] Değerlendirme notu oluşturulamadı."
            elif not raw_note.startswith("["):
                raw_note = f"[SEVİYE: {data.level}] " + raw_note

            final_result = {
                "rubric": combined_rubric,

                # eski UI uyumluluğu: errors = öğrenci hataları
                "errors": errors_student,

                "errors_student": errors_student,
                "errors_ocr": errors_ocr,

                "teacher_note": raw_note,
                "score_total": total_score
            }

            print(f"✅ Başarılı: {model_name} | Puan: {total_score} | Öğrenci: {len(errors_student)} | OCR: {len(errors_ocr)}")
            break

        except Exception as e:
            print(f"⚠️ Hata ({model_name}): {e}")
            last_error = str(e)
            continue

    if not final_result:
        raise HTTPException(status_code=500, detail=f"Analiz başarısız: {last_error}")

    # DB kayıt
    try:
        supabase.table("submissions").insert({
            "student_name": data.student_name.strip(),
            "student_surname": data.student_surname.strip(),
            "classroom_code": data.classroom_code.strip(),
            "image_url": data.image_url,
            "ocr_text": full_text,  # ✅ newline ile saklanır
            "level": data.level,
            "country": data.country,
            "native_language": data.native_language,
            "analysis_json": final_result,
            "score_total": final_result["score_total"]
        }).execute()

        return {"status": "success", "data": final_result}

    except Exception as e:
        print(f"DB Kayıt Hatası: {e}")
        return {"status": "success", "data": final_result, "warning": "Veritabanı hatası"}

@app.post("/student-history")
async def get_student_history(student_name: str = Form(...), student_surname: str = Form(...), classroom_code: str = Form(...)):
    try:
        response = supabase.table("submissions").select("*")\
            .ilike("student_name", student_name.strip())\
            .ilike("student_surname", student_surname.strip())\
            .eq("classroom_code", classroom_code.strip())\
            .order("created_at", desc=True).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    try:
        res = supabase.table("submissions").select("analysis_json").eq("id", data.submission_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Kayıt bulunamadı")

        current_json = res.data[0].get("analysis_json") or {}
        if "rubric" not in current_json:
            current_json["rubric"] = {}
        current_json["rubric"].update(data.new_rubric)

        supabase.table("submissions").update({
            "score_total": data.new_total,
            "analysis_json": current_json
        }).eq("id", data.submission_id).execute()

        return {"status": "success", "message": "Puan güvenle güncellendi"}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
