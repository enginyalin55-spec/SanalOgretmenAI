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
# 1. AYARLAR
# =======================================================
load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    raise RuntimeError("❌ KRİTİK HATA: GEMINI_API_KEY eksik!")

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("❌ KRİTİK HATA: SUPABASE bilgileri eksik!")

client = genai.Client(api_key=API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Sanal Ogretmen AI API", version="1.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost:(3000|5173|8081)|sanal-(ogretmen|ogrenci)-ai(-.*)?\.vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_TO_TRY = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"]
MAX_FILE_SIZE = 6 * 1024 * 1024
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}

# =======================================================
# 2. HEALTH
# =======================================================
@app.get("/")
@app.get("/health")
def health_check():
    return {"status": "ok", "service": "Sanal Ogretmen AI Backend"}

# =======================================================
# 3. MODELLER
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
# 4. CEFR + TDK RULES
# =======================================================
CEFR_KRITERLERI = {
    "A1": "Kısa, basit cümleler. Temel ihtiyaç iletişimi.",
    "A2": "Bağlaçlar (ve, ama). Geçmiş/Gelecek zaman temelleri. Günlük konular.",
    "B1": "Tutarlı paragraflar. Deneyim aktarımı. Neden-sonuç ilişkisi.",
    "B2": "Akıcı, detaylı ve teknik anlatım. Soyut konular.",
    "C1": "Akademik ve esnek dil kullanımı. İnce anlam farkları."
}

def load_tdk_rules() -> List[Dict[str, Any]]:
    return [
        {"rule_id": "TDK_01_BAGLAC_DE", "text": "Bağlaç olan 'da/de' ayrı yazılır."},
        {"rule_id": "TDK_02_BAGLAC_KI", "text": "Bağlaç olan 'ki' ayrı yazılır."},
        {"rule_id": "TDK_03_SORU_EKI", "text": "Soru eki 'mı/mi' ayrı yazılır."},
        {"rule_id": "TDK_04_SEY_SOZ", "text": "'Şey' sözcüğü daima ayrı yazılır."},
        {"rule_id": "TDK_05_BUYUK_CUMLE", "text": "Cümleler büyük harfle başlar."},
        {"rule_id": "TDK_06_BUYUK_OZEL", "text": "Özel isimler (Şehir, Kişi) büyük harfle başlar."},
        {"rule_id": "TDK_07_BUYUK_KURUM", "text": "Kurum adları büyük harfle başlar."},
        {"rule_id": "TDK_08_BUYUK_GEREKSIZ", "text": "Özel isim olmayan sözcükler cümle içinde büyük harfle yazılamaz."},
        {"rule_id": "TDK_09_KESME_OZEL", "text": "Özel isimlere gelen ekler kesme ile ayrılır (Samsun'a)."},
        {"rule_id": "TDK_10_KESME_KURUM", "text": "Kurum adlarına gelen ekler AYRILMAZ (Bakanlığına). NOT: Şehirler kurum değildir!"},
        {"rule_id": "TDK_13_KESME_GENEL", "text": "Cins isimlere gelen ekler kesme ile ayrılmaz (stadyuma, okula)."},
        {"rule_id": "TDK_11_YARDIMCI_FIIL", "text": "Ses olayı varsa bitişik, yoksa ayrı."},
        {"rule_id": "TDK_12_SAYILAR", "text": "Sayılar ayrı yazılır (on beş)."},
        {"rule_id": "TDK_20_NOKTA", "text": "Cümle sonuna nokta konur."},
        {"rule_id": "TDK_21_VIRGUL", "text": "Sıralı kelimelere virgül konur."},
        {"rule_id": "TDK_23_YANLIS_YALNIZ", "text": "Yanlış (yanılmak), Yalnız (yalın)."},
        {"rule_id": "TDK_24_HERKES", "text": "Herkes (s ile)."},
        {"rule_id": "TDK_25_SERTLESME", "text": "Sertleşme kuralı (Kitapta, 1923'te)."},
        {"rule_id": "TDK_28_YABANCI", "text": "Yabancı kelimeler (Şoför, egzoz, makine)."}
    ]

# =======================================================
# 5. YARDIMCILAR
# =======================================================
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

def normalize_text(text: str) -> str:
    if not text:
        return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    return re.sub(r"\s+", " ", text).strip()

def normalize_match(text: str) -> str:
    return normalize_text(text).casefold()

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

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    w = normalize_match(wrong)
    t = normalize_match(full_text)
    if not w:
        return None

    matches = []
    start_idx = 0
    while True:
        idx = t.find(w, start_idx)
        if idx == -1:
            break
        matches.append(idx)
        start_idx = idx + 1

    if not matches:
        return None

    best = min(matches, key=lambda x: abs(x - hint_start)) if hint_start is not None else matches[0]
    return (best, best + len(w))

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_ids: set) -> Dict[str, Any]:
    """LLM'nin döndürdüğü hataları metin üzerinde span ile güvenli hale getirir."""
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

        wrong = err.get("wrong", "")
        correct = err.get("correct", "")
        if not wrong or not correct:
            continue
        if normalize_match(wrong) == normalize_match(correct):
            continue

        hint = None
        if isinstance(err.get("span"), dict):
            hint = to_int(err["span"].get("start"), None)

        fixed = _find_best_span(full_text, wrong, hint)
        if fixed:
            start, end = fixed
            clean_errors.append({
                "wrong": full_text[start:end],
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
    """Aynı span/aynı wrong/correct tekrarlarını temizler."""
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
# 5A) ✅ 4.1 OCR ŞÜPHELİ PARÇALARI YAKALAYAN FİLTRE
# =======================================================
OCR_NOISE_PATTERNS = [
    re.compile(r"^[a-zA-ZğüşöçıİĞÜŞÖÇ]+['’][a-zA-ZğüşöçıİĞÜŞÖÇ]\b"),  # stadyum'a f gibi
    re.compile(r"^[a-zA-Z]\b"),  # tek harf (çoğu zaman kırpılma)
]

def looks_like_ocr_noise(wrong: str, full_text: str, span: dict) -> bool:
    w = (wrong or "").strip()
    if len(w) <= 1:
        return True
    for p in OCR_NOISE_PATTERNS:
        if p.search(w):
            # örn: "stadyum'a f" ise çok şüpheli
            if " " in w and len(w.split()) == 2 and len(w.split()[1]) == 1:
                return True
    # span çok kısa ve çevresi harfse -> kelime kırpılmış olabilir
    try:
        s = span.get("start", -1); e = span.get("end", -1)
        if 0 <= s < e <= len(full_text):
            left = full_text[s-1] if s-1 >= 0 else ""
            right = full_text[e] if e < len(full_text) else ""
            if left.isalpha() and right.isalpha():
                return True
    except:
        pass
    return False

# =======================================================
# 5B) ✅ 4.2 “Gereksiz büyük harf” kural motoru (DÜZELTİLDİ)
#   - ? - Ben gibi durumlarda '-' / tırnak vs atlanır
#   - karışık büyük/küçük (iStadyum) OCR şüpheli işaretlenir
# =======================================================
TR_LOWER_EXCEPTIONS = {"I"}  # istersen boş bırak
PROPER_NOUNS_HINT = {"Samsun", "Karadeniz", "Türkiye"}  # istersen genişlet

SENT_SPLIT = re.compile(r"([.!?])")
_LEADING_JUNK = set(' \n\t\r"“”\'’()[]{}-–—:;')

def sentence_starts(text: str) -> set:
    starts = {0}
    for m in SENT_SPLIT.finditer(text):
        idx = m.end()
        while idx < len(text) and text[idx] in _LEADING_JUNK:
            idx += 1
        if idx < len(text):
            starts.add(idx)
    return starts

def _mixed_case(word: str) -> bool:
    return any(c.islower() for c in word) and any(c.isupper() for c in word)

def find_unnecessary_capitals(full_text: str) -> list:
    starts = sentence_starts(full_text)
    errors = []

    for m in re.finditer(r"\b[^\W\d_]+\b", full_text, flags=re.UNICODE):
        word = m.group(0)
        s, e = m.start(), m.end()

        if s in starts:
            continue  # cümle başı OK
        if word in PROPER_NOUNS_HINT:
            continue

        # ✅ OCR şüpheli: iStadyum / SoK / kısa token vs.
        if len(word) <= 2 or _mixed_case(word):
            errors.append({
                "wrong": word,
                "correct": word,
                "type": "OCR_ŞÜPHELİ",
                "rule_id": "OCR_SUSPECT",
                "explanation": "Büyük/küçük harf bozulması OCR kaynaklı olabilir.",
                "span": {"start": s, "end": e},
                "ocr_suspect": True
            })
            continue

        if word and word[0].isupper():
            errors.append({
                "wrong": word,
                "correct": word[:1].lower() + word[1:],
                "type": "Büyük Harf",
                "rule_id": "TDK_08_BUYUK_GEREKSIZ",
                "explanation": "Cümle ortasında gereksiz büyük harf kullanımı.",
                "span": {"start": s, "end": e},
                "ocr_suspect": False
            })
    return errors

# =======================================================
# 5C) ✅ 4.3 “çok/cok”, “mi/mı”, “de/da” hızlı yakalayıcılar (GELİŞTİRİLDİ)
#   - sok/Sok -> çok (OCR çok sık)
# =======================================================
def find_common_a2_errors(full_text: str) -> list:
    errs = []

    # cok/çog/cök -> çok
    for m in re.finditer(r"\b(cok|çog|cök|coK|COk)\b", full_text, flags=re.IGNORECASE):
        errs.append({
            "wrong": m.group(0),
            "correct": "çok",
            "type": "Yazım",
            "rule_id": "TDK_28_YABANCI",
            "explanation": "‘çok’ kelimesinin yazımı.",
            "span": {"start": m.start(), "end": m.end()},
            "ocr_suspect": False
        })

    # ✅ sok/Sok/SOK -> çok (OCR)
    for m in re.finditer(r"\b(sok|Sok|SOK)\b", full_text):
        errs.append({
            "wrong": m.group(0),
            "correct": "çok",
            "type": "Yazım",
            "rule_id": "TDK_28_YABANCI",
            "explanation": "OCR 'çok' kelimesini 'sok' olarak bozumuş olabilir.",
            "span": {"start": m.start(), "end": m.end()},
            "ocr_suspect": True
        })

    # soru eki bitişik: nasılsınmi / geldinmi / varmi
    for m in re.finditer(r"\b([^\W\d_]+)(mi|mı|mu|mü)\b", full_text, flags=re.UNICODE | re.IGNORECASE):
        word = m.group(0)
        if word.lower() in {"kimi", "bimi"}:
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

    # heuristik: "evdede" gibi -de bitişik
    for m in re.finditer(r"\b([^\W\d_]+)(da|de)\b", full_text, flags=re.UNICODE | re.IGNORECASE):
        word_l = m.group(0).lower()
        if word_l in {"samsunda", "ankarada"}:
            continue
        if len(m.group(1)) >= 3:
            errs.append({
                "wrong": m.group(0),
                "correct": m.group(1) + " " + m.group(2),
                "type": "Yazım",
                "rule_id": "TDK_01_BAGLAC_DE",
                "explanation": "Bağlaç olan da/de ayrı yazılır (heuristik).",
                "span": {"start": m.start(), "end": m.end()},
                "ocr_suspect": False
            })

    return errs

# =======================================================
# 6. ENDPOINTS
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

        extracted_text = ""
        prompt = (
            "Bu resimdeki el yazısı metni Türkçe olarak aynen dijital metne çevir.\n"
            "SATIRLARI mümkünse koru. Sadece metni ver, yorum yapma."
        )

        for model_name in MODELS_TO_TRY:
            try:
                resp = client.models.generate_content(
                    model=model_name,
                    contents=[prompt, types.Part.from_bytes(data=file_content, mime_type=safe_mime)]
                )
                extracted_text = (resp.text or "").strip()
                if extracted_text:
                    break
            except:
                continue

        if not extracted_text:
            return {"status": "error", "message": "OCR Başarısız"}

        return {"status": "success", "ocr_text": extracted_text, "image_url": image_url}

    except HTTPException:
        raise
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş, analiz yapılamaz.")

    full_text = data.ocr_text
    print(f"🧠 Analiz: {data.student_name} ({data.level})")

    tdk_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in tdk_rules}
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])

    # =======================================================
    # ✅ 1) TDK AJANI (OCR ignore yok → OCR şüpheli işaretle var)
    # =======================================================
    prompt_tdk = f"""
ROL: Sen nesnel ve kuralcı bir TDK denetçisisin.
GÖREV: Metindeki yazım / noktalama / büyük-küçük harf / kesme işareti / ek yazımı hatalarını mümkün olduğunca TAM bul.

ÖNEMLİ:
- "wrong" alanına metindeki parçayı BİREBİR yaz.
- En az 20 hata bulmaya çalış (yoksa bulabildiğin kadar).
- Cins isimlerde kesme kullanılmaz (stadyuma). Özel isimlerde kesme olabilir (Samsun'a).
- Cümle içinde özel isim olmayan kelimeler büyük harfle yazılamaz.
- OCR kaynaklı olabilecek parçalanmaları "ocr_suspect": true olarak İŞARETLE (silme/atlama).

METİN: \"\"\"{full_text}\"\"\"

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
    # ✅ 2) CEFR AJANI
    # =======================================================
    prompt_cefr = f"""
ROL: Sen destekleyici bir öğretmensin.
GÖREV: {data.level} seviyesindeki öğrencinin İLETİŞİM BECERİSİNİ değerlendir.

KURALLAR:
1) Yazım/noktalama hatalarını PUANLAMADA ikinci plana at (iletişim öncelikli).
2) PUANLAMA: Tam sayı.
3) teacher_note başına "[SEVİYE: ...]" ekle.

METİN: \"\"\"{full_text}\"\"\"

ÇIKTI (SADECE JSON):
{{
  "rubric_part": {{
    "uzunluk": (0-16 Int), "soz_dizimi": (0-20 Int), "kelime": (0-14 Int), "icerik": (0-20 Int)
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
            # ✅ PUAN birleştirme
            # =======================================================
            tdk_p = json_tdk.get("rubric_part", {})
            cefr_p = json_cefr.get("rubric_part", {})

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
            # ✅ 4.4 HATALARI ARTIRAN BİRLEŞİM
            # =======================================================
            cleaned_tdk = validate_analysis(json_tdk, full_text, allowed_ids)

            rule_caps = find_unnecessary_capitals(full_text)
            rule_common = find_common_a2_errors(full_text)

            all_errors = merge_and_dedupe_errors(
                cleaned_tdk.get("errors", []),
                rule_caps,
                rule_common
            )

            # ✅ OCR şüpheli işaretleme
            filtered = []
            seen = set()

            for e in all_errors:
                span = e.get("span") or {}
                key = (span.get("start"), span.get("end"), e.get("rule_id"), e.get("wrong"), e.get("correct"))
                if key in seen:
                    continue
                seen.add(key)

                if "start" not in span or "end" not in span:
                    continue

                ocr_flag = bool(e.get("ocr_suspect", False)) or looks_like_ocr_noise(e.get("wrong", ""), full_text, span)
                if ocr_flag:
                    e["type"] = "OCR_ŞÜPHELİ"
                    e["explanation"] = (e.get("explanation", "") + " (OCR parçalanması olabilir.)").strip()
                    e["ocr_suspect"] = True

                filtered.append(e)

            filtered.sort(key=lambda x: x["span"]["start"])

            raw_note = (json_cefr.get("teacher_note") or "").strip()
            if not raw_note:
                raw_note = f"[SEVİYE: {data.level}] Değerlendirme notu oluşturulamadı."
            elif not raw_note.startswith("["):
                raw_note = f"[SEVİYE: {data.level}] " + raw_note

            final_result = {
                "rubric": combined_rubric,
                "errors": filtered,
                "teacher_note": raw_note,
                "score_total": total_score
            }

            print(f"✅ Başarılı: {model_name} | Puan: {total_score} | Hata: {len(filtered)}")
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
            "ocr_text": full_text,
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
