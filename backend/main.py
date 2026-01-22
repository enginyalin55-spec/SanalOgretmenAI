from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from google.cloud import vision
from supabase import create_client, Client
from dotenv import load_dotenv
import os, json, uuid, re
import unicodedata
from pydantic import BaseModel
from typing import Union, List, Dict, Any, Optional

# =======================================================
# 1) AYARLAR VE KURULUM
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

app = FastAPI(title="Sanal Ogretmen AI API", version="4.0.0 (Full Features)")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost:(3000|5173|8081)|sanal-(ogretmen|ogrenci)-ai(-.*)?\.vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Sadece kararlı modeller
MODELS_TO_TRY = [
    "gemini-2.0-flash", 
    "gemini-1.5-flash",
]

MAX_FILE_SIZE = 6 * 1024 * 1024
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


# =======================================================
# 2) HELPER: GOOGLE CLOUD AUTH
# =======================================================
def ensure_gcp_credentials():
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"): return
    key_json = os.getenv("GCP_SA_KEY_JSON", "").strip()
    if not key_json:
        print("UYARI: GCP_SA_KEY_JSON yok, Vision API çalışmaz.")
        return
    try:
        path = "/tmp/gcp_sa.json"
        with open(path, "w", encoding="utf-8") as f: f.write(key_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
    except Exception as e:
        print(f"⚠️ Credentials hatası: {e}")


# =======================================================
# 3) DATA MODELS
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
# 4) TEXT & TDK UTILS (TAM LİSTE)
# =======================================================

def load_tdk_rules() -> List[Dict[str, Any]]:
    """TDK Kurallarının Tam Listesi"""
    return [
        # A) YAZIM
        {"rule_id": "TDK_01_BAGLAC_DE", "text": "Bağlaç olan 'da/de' ayrı yazılır."},
        {"rule_id": "TDK_02_BAGLAC_KI", "text": "Bağlaç olan 'ki' ayrı yazılır."},
        {"rule_id": "TDK_03_SORU_EKI_MI", "text": "Soru eki 'mı/mi' ayrı yazılır."},
        {"rule_id": "TDK_04_SEY_AYRI", "text": "'Şey' sözcüğü daima ayrı yazılır."},
        {"rule_id": "TDK_05_DA_DE_EK", "text": "Bulunma eki '-da/-de' bitişik yazılır."},
        {"rule_id": "TDK_06_YA_DA", "text": "'Ya da' ayrı yazılır."},
        {"rule_id": "TDK_07_HER_SEY", "text": "'Her şey' ayrı yazılır."},
        # B) BÜYÜK HARF
        {"rule_id": "TDK_10_CUMLE_BASI_BUYUK", "text": "Cümleler büyük harfle başlar."},
        {"rule_id": "TDK_11_OZEL_AD_BUYUK", "text": "Özel isimler büyük harfle başlar."},
        {"rule_id": "TDK_12_GEREKSIZ_BUYUK", "text": "Cümle içinde gereksiz büyük harf kullanılmaz."},
        {"rule_id": "TDK_13_GUN_AY_BUYUK", "text": "Belirli tarih bildirmeyen ay/gün adları küçük yazılır."},
        # C) KESME İŞARETİ
        {"rule_id": "TDK_20_KESME_OZEL_AD", "text": "Özel isimlere gelen ekler kesme ile ayrılır."},
        {"rule_id": "TDK_21_KESME_KURUM", "text": "Kurum ekleri kesme ile ayrılır."},
        {"rule_id": "TDK_22_KESME_SAYI", "text": "Sayılara gelen ekler kesme ile ayrılır."},
        {"rule_id": "TDK_23_KESME_GENEL_YOK", "text": "Cins isimlere gelen ekler kesme ile ayrılmaz."},
        # D) NOKTALAMA
        {"rule_id": "TDK_30_NOKTA_CUMLE_SONU", "text": "Cümle sonuna nokta konur."},
        {"rule_id": "TDK_31_SORU_ISARETI", "text": "Soru cümleleri soru işareti ile biter."},
        {"rule_id": "TDK_32_VIRGUL_SIRALAMA", "text": "Sıralı kelimeler arasına virgül konur."},
        {"rule_id": "TDK_33_TIRNAK_ALINTI", "text": "Alıntı sözler tırnak içinde yazılır."},
        {"rule_id": "TDK_34_APOSTROF_TIRNAK_KARISMA", "text": "Kesme işareti ile tırnak karıştırılmamalıdır."},
        # E) SIK YANLIŞLAR
        {"rule_id": "TDK_40_COK", "text": "'Çok' kelimesinin yazımı."},
        {"rule_id": "TDK_41_HERKES", "text": "'Herkes' (s ile yazılır)."},
        {"rule_id": "TDK_42_YALNIZ", "text": "'Yalnız' (yalın kökünden)."},
        {"rule_id": "TDK_43_YANLIS", "text": "'Yanlış' (yanılmak kökünden)."},
        {"rule_id": "TDK_44_BIRKAC", "text": "'Birkaç' bitişik yazılır."},
        {"rule_id": "TDK_45_HICBIR", "text": "'Hiçbir' bitişik yazılır."},
        {"rule_id": "TDK_46_PEKCOK", "text": "'Pek çok' ayrı yazılır."},
        {"rule_id": "TDK_47_INSALLAH", "text": "'İnşallah' kelimesinin yazımı."},
        {"rule_id": "TDK_48_KARADENIZ", "text": "'Karadeniz' özel isimdir, büyük başlar."},
        # F) SAYILAR
        {"rule_id": "TDK_50_SAYI_YAZIMI", "text": "Sayıların yazımı."},
        {"rule_id": "TDK_51_SAYI_BIRIM", "text": "Sayı ile birim arasında boşluk bırakılır."}
    ]

_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")
TR_LOWER_MAP = str.maketrans({"İ": "i", "I": "ı"})

def tr_lower(s: str) -> str:
    if not s: return ""
    return s.translate(TR_LOWER_MAP).lower()

def tr_lower_first(word: str) -> str:
    if not word: return ""
    return tr_lower(word[0]) + word[1:]

def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln != ""]
    return "\n".join(lines).strip()

def normalize_match(text: str) -> str:
    return tr_lower(normalize_text(text))

def to_int(x, default=0):
    try:
        if x is None: return default
        if isinstance(x, (int, float)): return int(x)
        if isinstance(x, str):
            clean = re.sub(r"[^\d\-]", "", x.split("/")[0])
            return int(clean) if clean else default
        return default
    except: return default

async def read_limited(upload: UploadFile, limit: int) -> bytes:
    chunks = []
    size = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk: break
        size += len(chunk)
        if size > limit: raise HTTPException(status_code=413, detail="Dosya çok büyük.")
        chunks.append(chunk)
    return b"".join(chunks)

SENT_BOUNDARY = re.compile(r"([.!?]+|[\n\r]+|[:;]+|—|–|-{2,})")
def sentence_starts(text: str) -> set:
    starts = {0}
    for m in SENT_BOUNDARY.finditer(text):
        idx = m.end()
        while idx < len(text) and text[idx].isspace(): idx += 1
        if idx < len(text): starts.add(idx)
    return starts

# GÜNCEL PROPER NOUN KONTROLÜ (PIAZZA, CITY MALL DAHİL)
PROPER_ROOTS = {"samsun", "karadeniz", "türkiye", "piazza", "city", "mall", "meydan", "sahil", "avm", "tramvay"}

def norm_token(token: str) -> str:
    if not token: return ""
    t = token.strip().replace("’", "'")
    t = re.sub(r"[.,;:!?()\[\]{}]", "", t)
    return t

def token_root(token: str) -> str:
    t = norm_token(token)
    if "'" in t: t = t.split("'")[0]
    return tr_lower(t)

def is_probably_proper(word: str) -> bool:
    r = token_root(word)
    if r in PROPER_ROOTS: return True
    if "'" in norm_token(word) and word[:1].isupper(): return True
    return False

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    wrong_n = normalize_match(wrong).replace("\n", " ")
    full_n = normalize_match(full_text).replace("\n", " ")
    if not wrong_n: return None
    matches = []
    start_idx = 0
    while True:
        idx = full_n.find(wrong_n, start_idx)
        if idx == -1: break
        matches.append(idx)
        start_idx = idx + 1
    if not matches: return None
    best = min(matches, key=lambda x: abs(x - hint_start)) if hint_start is not None else matches[0]
    return (best, best + len(wrong_n))

# --- YENİ EKLENEN GÜVENLİK (KİLİT) FONKSİYONLARI ---
def _has_question_mark_near(full_text: str, start: int, end: int, window: int = 80) -> bool:
    a = max(0, start - window)
    b = min(len(full_text), end + window)
    return "?" in full_text[a:b]

def _only_adds_space_for_mi(wrong: str, correct: str) -> bool:
    w = normalize_match(wrong)
    c = normalize_match(correct)
    if not w or not c: return False
    return c.replace(" ", "") == w and (" " in c)

def _only_case_change(wrong: str, correct: str) -> bool:
    return normalize_match(wrong) == normalize_match(correct) and wrong != correct

def _only_apostrophe_remove(wrong: str, correct: str) -> bool:
    return normalize_text(wrong).replace("'", "") == normalize_text(correct)

def _is_safe_tdk_pair(rule_id: str, wrong: str, correct: str, full_text: str, span: dict) -> bool:
    """GPT'nin önerdiği sert filtreleme mantığı (Saçmalamayı Önler)."""
    w = normalize_text(wrong)
    c = normalize_text(correct)
    s = to_int((span or {}).get("start"), None)
    e = to_int((span or {}).get("end"), None)

    # 1. SORU EKİ (mi): Sadece boşluk ekliyorsa VE yakında ? varsa
    if rule_id == "TDK_03_SORU_EKI_MI":
        if not _only_adds_space_for_mi(w, c): return False # Mevsimi -> Mevsimi mi (RED)
        if s is not None and e is not None:
            if not _has_question_mark_near(full_text, s, e): return False # Soru işareti yoksa (RED)
        return True

    # 2. GEREKSİZ BÜYÜK: Sadece harf büyüklüğü değişmişse
    if rule_id == "TDK_12_GEREKSIZ_BUYUK":
        return _only_case_change(w, c)

    # 3. BAĞLAÇ DE/DA: Sadece boşluk ekliyorsa
    if rule_id == "TDK_01_BAGLAC_DE":
        return normalize_match(c).replace(" ", "") == normalize_match(w) and (" " in c)

    # 4. KESME YOK: Sadece kesme kalkıyorsa
    if rule_id == "TDK_23_KESME_GENEL_YOK":
        return _only_apostrophe_remove(w, c)

    # 5. ÇOK: Sadece "çok" kelimesine dönüşüyorsa
    if rule_id == "TDK_40_COK":
        return normalize_match(c) == "çok"

    return False

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_ids: set) -> Dict[str, Any]:
    if not isinstance(result, dict): return {"errors": []}
    clean_errors = []
    for err in result.get("errors", []):
        if not isinstance(err, dict): continue
        rid = err.get("rule_id")
        if not rid or rid not in allowed_ids: continue
        
        wrong = err.get("wrong", "") or ""
        correct = err.get("correct", "") or ""
        if not wrong or not correct: continue
        
        hint = None
        if isinstance(err.get("span"), dict): hint = to_int(err["span"].get("start"), None)
        fixed = _find_best_span(full_text, wrong, hint)
        
        if fixed:
            start, end = fixed
            temp_span = {"start": start, "end": end}
            
            # ✅ KURAL BAZLI SERT FİLTRE (YENİ)
            if not _is_safe_tdk_pair(rid, wrong, correct, full_text, temp_span):
                continue

            clean_errors.append({
                "wrong": wrong, "correct": correct, "type": "Yazım",
                "rule_id": rid, "explanation": err.get("explanation", ""),
                "span": temp_span, "ocr_suspect": bool(err.get("ocr_suspect", False))
            })
    clean_errors.sort(key=lambda x: x["span"]["start"])
    return {"errors": clean_errors}

def merge_and_dedupe_errors(*lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen, merged = set(), []
    for lst in lists:
        for e in (lst or []):
            sp = e.get("span", {}) or {}
            key = (sp.get("start"), sp.get("end"), e.get("rule_id"))
            if key in seen: continue
            seen.add(key)
            merged.append(e)
    merged.sort(key=lambda x: x.get("span", {}).get("start", 10**9))
    return merged

OCR_NOISE_PATTERNS = [re.compile(r".*\b[a-zA-ZğüşöçıİĞÜŞÖÇ]+['’][a-zA-Z]\b"), re.compile(r"^[a-zA-Z]\b")]
def looks_like_ocr_noise(wrong: str, full_text: str, span: dict) -> bool:
    w = (wrong or "").strip()
    if len(w) <= 1: return True
    for p in OCR_NOISE_PATTERNS:
        if p.search(w):
            if " " in w and len(w.split()) == 2 and len(w.split()[1]) == 1: return True
    return False

def find_unnecessary_capitals(full_text: str) -> list:
    starts = sentence_starts(full_text)
    errors = []
    for m in re.finditer(r"\b[^\W\d_]+\b", full_text, flags=re.UNICODE):
        word = m.group(0)
        s, e = m.start(), m.end()
        if s in starts: continue
        
        # Piazza, City Mall koruması
        if is_probably_proper(word): continue
        if tr_lower(word) in {"sok"}: continue
        
        upp = sum(1 for ch in word if ch.isupper())
        low = sum(1 for ch in word if ch.islower())
        if (upp >= 2 and low >= 1):
            errors.append({"wrong": word, "correct": word, "type": "OCR_ŞÜPHELİ", "rule_id": "TDK_12_GEREKSIZ_BUYUK", "explanation": "Büyük/küçük harf karışıklığı OCR kaynaklı olabilir.", "span": {"start": s, "end": e}, "ocr_suspect": True})
            continue
        if word and word[0].isupper():
            errors.append({"wrong": word, "correct": tr_lower_first(word), "type": "Büyük Harf", "rule_id": "TDK_12_GEREKSIZ_BUYUK", "explanation": "Cümle ortasında gereksiz büyük harf kullanımı.", "span": {"start": s, "end": e}, "ocr_suspect": False})
    return errors

POSSESSIVE_HINT = re.compile(r"(ım|im|um|üm|ın|in|un|ün|m|n)$", re.IGNORECASE | re.UNICODE)
def find_conjunction_dade_joined(full_text: str) -> list:
    errs = []
    for m in re.finditer(r"\b([^\W\d_]+)(da|de)\b", full_text, flags=re.UNICODE | re.IGNORECASE):
        base, suf = m.group(1), m.group(2)
        whole = full_text[m.start():m.end()]
        if POSSESSIVE_HINT.search(base): continue
        if any(ch.isupper() for ch in whole) or is_probably_proper(whole): continue
        errs.append({"wrong": whole, "correct": f"{base} {suf}", "type": "Yazım", "rule_id": "TDK_01_BAGLAC_DE", "explanation": "Bağlaç olan da/de ayrı yazılır.", "span": {"start": m.start(), "end": m.end()}, "ocr_suspect": True})
    return errs

def find_common_a2_errors(full_text: str) -> list:
    errs = []
    for m in re.finditer(r"\b(cok|çog|cök|coK|COk|sok)\b", full_text, flags=re.IGNORECASE):
        errs.append({"wrong": m.group(0), "correct": "çok", "type": "Yazım", "rule_id": "TDK_40_COK", "explanation": "‘çok’ kelimesinin yazımı.", "span": {"start": m.start(), "end": m.end()}, "ocr_suspect": True})
    return errs

RULE_PRIORITY = {
    "TDK_40_COK": 100, "TDK_03_SORU_EKI_MI": 90, "TDK_20_KESME_OZEL_AD": 80, "TDK_23_KESME_GENEL_YOK": 80,
    "TDK_25_SERTLESME": 70, "TDK_01_BAGLAC_DE": 60, "TDK_12_GEREKSIZ_BUYUK": 30
}
def pick_best_per_span(errors: list) -> list:
    buckets = {}
    for e in errors:
        sp = e.get("span") or {}
        key = (sp.get("start"), sp.get("end"))
        if None in key: continue
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

def cefr_fallback_scores(level: str, text: str) -> Dict[str, int]:
    # Basit bir puanlama mantığı (Yapay zeka yanıt vermezse devreye girer)
    t = normalize_text(text).replace("\n", " ")
    if not t: return {"uzunluk": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0}
    words = re.findall(r"\b[^\W\d_]+\b", t, flags=re.UNICODE)
    sentences = [s for s in re.split(r"[.!?]+", t) if s.strip()]
    has_connectors = bool(re.search(r"\b(ve|ama|çünkü|bu yüzden|sonra|fakat)\b", tr_lower(t)))
    uniq = len(set([tr_lower(w) for w in words])) if words else 0
    
    uzunluk = min(16, max(4, int(len(words) / 10) + 6))
    kelime = min(14, max(5, int(uniq / 8) + 6))
    soz = 8
    if len(sentences) >= 3: soz += 4
    if has_connectors: soz += 4
    soz_dizimi = min(20, max(6, soz))
    icerik = 8
    if len(sentences) >= 3: icerik += 4
    if len(words) >= 40: icerik += 4
    icerik = min(20, max(6, icerik))
    
    return {"uzunluk": int(uzunluk), "soz_dizimi": int(soz_dizimi), "kelime": int(kelime), "icerik": int(icerik)}


# =======================================================
# 6) ENDPOINTS
# =======================================================
@app.get("/check-class/{code}")
async def check_class_code(code: str):
    try:
        response = supabase.table("classrooms").select("name").eq("code", code.upper().strip()).execute()
        if response.data: return {"valid": True, "class_name": response.data[0]["name"]}
        return {"valid": False}
    except: return {"valid": False}

@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    try:
        ensure_gcp_credentials()
        file_content = await read_limited(file, MAX_FILE_SIZE)
        filename = f"{uuid.uuid4()}.jpg"
        image_url = ""
        try:
            supabase.storage.from_("odevler").upload(filename, file_content, {"content-type": "image/jpeg"})
            image_url = supabase.storage.from_("odevler").get_public_url(filename)
        except: pass

        try: vision_client = vision.ImageAnnotatorClient()
        except: return {"status": "error", "message": "Vision API Hatası"}

        image = vision.Image(content=file_content)
        context = vision.ImageContext(language_hints=["tr"])
        response = vision_client.document_text_detection(image=image, image_context=context)
        if response.error.message: return {"status": "error", "message": response.error.message}

        CONFIDENCE_THRESHOLD = 0.40
        masked_parts, raw_parts = [], []
        PUNCTUATION = set(".,;:!?\"'’`()-–—…")

        def append_break(break_type_val: int):
            if not break_type_val: return
            if break_type_val in (1, 2):
                masked_parts.append(" "); raw_parts.append(" ")
            elif break_type_val in (3, 5):
                masked_parts.append("\n"); raw_parts.append("\n")

        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        for symbol in word.symbols:
                            ch = symbol.text or ""
                            conf = getattr(symbol, "confidence", 1.0)
                            raw_parts.append(ch)
                            if ch in PUNCTUATION: masked_parts.append(ch)
                            elif ch.isalpha(): masked_parts.append("⍰" if conf < CONFIDENCE_THRESHOLD else ch)
                            else: masked_parts.append(ch)
                            
                            prop = getattr(symbol, "property", None)
                            db = getattr(prop, "detected_break", None) if prop else None
                            if db: append_break(int(getattr(db, "type_", getattr(db, "type", 0))))

        raw_text = unicodedata.normalize("NFC", "".join(raw_parts).strip())
        masked_text = unicodedata.normalize("NFC", "".join(masked_parts).strip())

        def force_suspect(t: str) -> str:
            t = re.sub(r"\b[gG]ok\b", lambda m: "⍰"+m.group(0)[1:], t)
            return re.sub(r"\b[gG]ay\b", lambda m: "⍰"+m.group(0)[1:], t)
        
        masked_text = force_suspect(masked_text)

        return {"status": "success", "ocr_text": masked_text, "raw_ocr_text": raw_text, "image_url": image_url}
    except Exception as e: return {"status": "error", "message": str(e)}

# =======================================================
# ANALYZE: 3 KATMANLI KİLİT SİSTEMİ İLE KORUNMUŞ ANALİZ
# =======================================================
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş.")
    if "⍰" in data.ocr_text:
        raise HTTPException(status_code=400, detail="Önce ⍰ işaretlerini düzeltin.")

    full_text = normalize_text(data.ocr_text)
    display_text = full_text.replace("\n", " ")

    print(f"🧠 Analiz: {data.student_name} ({data.level})")

    # 1. AŞAMA: TDK ANALİZİ (İzinli Rule ID Listesi)
    tdk_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in tdk_rules}
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])

    prompt_tdk = f"""
    ROL: Sen TDK denetçisisin.
    GÖREV: Metindeki yazım hatalarını SADECE aşağıdaki kural setine göre bul.
    ASLA metinde olmayan kelimeleri uydurma (Hallucination yapma).
    ASLA kelimenin kökünü değiştirme (Örn: mont -> mantı YAPMA).
    
    REFERANS KURALLAR (SADECE BUNLARA BAK):
    {rules_text}

    METİN: \"\"\"{display_text}\"\"\"
    ÇIKTI (JSON): {{ "errors": [ {{ "wrong": "...", "correct": "...", "rule_id": "...", "explanation": "..." }} ] }}
    """

    # 2. AŞAMA: CEFR PUANLAMA
    prompt_rubric = f"""
    ROL: Öğretmen ({data.level}).
    METİN: \"\"\"{display_text}\"\"\"
    
    PUANLA (TOPLAM 100):
    1. UZUNLUK (0-16)
    2. NOKTALAMA (0-14)
    3. DİL BİLGİSİ (0-16)
    4. SÖZ DİZİMİ (0-20)
    5. KELİME (0-14)
    6. İÇERİK (0-20)

    ÇIKTI: {{ "rubric_part": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }}, "teacher_note": "..." }}
    """

    final_result = None
    
    for model_name in MODELS_TO_TRY:
        try:
            # TDK
            resp_tdk = client.models.generate_content(
                model=model_name, contents=prompt_tdk,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0)
            )
            json_tdk = json.loads(resp_tdk.text.strip().replace("```json", "").replace("```", "")) if resp_tdk.text else {}

            # Rubric
            resp_rubric = client.models.generate_content(
                model=model_name, contents=prompt_rubric,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1)
            )
            json_rubric = json.loads(resp_rubric.text.strip().replace("```json", "").replace("```", "")) if resp_rubric.text else {}

            # Puanlar (Fallback ile güvenli hale getirildi)
            p = json_rubric.get("rubric_part", {})
            fb = cefr_fallback_scores(data.level, full_text)
            
            def safe_score(key, max_val):
                val = to_int(p.get(key))
                if val == 0: val = fb.get(key, 0) # Fallback kullan
                return min(max_val, max(0, val))

            combined_rubric = {
                "uzunluk": safe_score("uzunluk", 16),
                "noktalama": safe_score("noktalama", 14),
                "dil_bilgisi": safe_score("dil_bilgisi", 16),
                "soz_dizimi": safe_score("soz_dizimi", 20),
                "kelime": safe_score("kelime", 14),
                "icerik": safe_score("icerik", 20),
            }
            total_score = sum(combined_rubric.values())

            # Hata İşleme (Sert Filtreler Devrede)
            cleaned_tdk = validate_analysis(json_tdk, full_text, allowed_ids)
            rule_caps = find_unnecessary_capitals(full_text)
            rule_common = find_common_a2_errors(full_text)
            rule_dade = find_conjunction_dade_joined(full_text)

            all_errors = merge_and_dedupe_errors(cleaned_tdk.get("errors", []), rule_caps, rule_common, rule_dade)
            all_errors = pick_best_per_span(all_errors)

            errors_student, errors_ocr = [], []
            for e in all_errors:
                span = e.get("span") or {}
                if "start" not in span: continue
                ocr_flag = bool(e.get("ocr_suspect", False)) or looks_like_ocr_noise(e.get("wrong", ""), full_text, span)
                if ocr_flag:
                    e["type"] = "OCR_ŞÜPHELİ"; e["ocr_suspect"] = True; errors_ocr.append(e)
                else: errors_student.append(e)
            
            errors_student.sort(key=lambda x: x["span"]["start"])

            final_result = {
                "rubric": combined_rubric,
                "errors": errors_student,
                "errors_student": errors_student,
                "errors_ocr": errors_ocr,
                "teacher_note": json_rubric.get("teacher_note", "Değerlendirme tamamlandı."),
                "score_total": total_score
            }
            break
        except Exception: continue

    if not final_result: raise HTTPException(status_code=500, detail="Analiz yapılamadı.")

    try:
        supabase.table("submissions").insert({
            "student_name": data.student_name, "student_surname": data.student_surname,
            "classroom_code": data.classroom_code, "image_url": data.image_url,
            "ocr_text": full_text, "level": data.level, "country": data.country,
            "native_language": data.native_language, "analysis_json": final_result,
            "score_total": final_result["score_total"]
        }).execute()
        return {"status": "success", "data": final_result}
    except Exception: return {"status": "success", "data": final_result, "warning": "DB Hatası"}

@app.post("/student-history")
async def get_student_history(student_name: str = Form(...), student_surname: str = Form(...), classroom_code: str = Form(...)):
    try:
        res = supabase.table("submissions").select("*")\
            .ilike("student_name", student_name.strip())\
            .ilike("student_surname", student_surname.strip())\
            .eq("classroom_code", classroom_code.strip())\
            .order("created_at", desc=True).execute()
        return {"status": "success", "data": res.data}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    try:
        res = supabase.table("submissions").select("analysis_json").eq("id", data.submission_id).execute()
        if not res.data: raise HTTPException(status_code=404, detail="Kayıt yok")
        curr = res.data[0]["analysis_json"]
        if "rubric" not in curr: curr["rubric"] = {}
        curr["rubric"].update(data.new_rubric)
        supabase.table("submissions").update({ "score_total": data.new_total, "analysis_json": curr }).eq("id", data.submission_id).execute()
        return {"status": "success", "message": "Güncellendi"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))