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
import asyncio

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

app = FastAPI(title="Sanal Ogretmen AI API - TUBITAK Hybrid Edition", version="5.5.2")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost:(3000|5173|8081)|sanal-(ogretmen|ogrenci)-ai(-.*)?\.vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_TO_TRY = ["gemini-2.0-flash", "gemini-1.5-flash"]
MAX_FILE_SIZE = 6 * 1024 * 1024

# =======================================================
# 2) AKADEMİK REFERANS VERİ SETLERİ VE REGEX (DESENLER)
# =======================================================

MI_SUFFIX_BLACKLIST = {
    "cami", "mami", "hami", "samimi", "kimi", "tümü", "ilhami", "resmi", "cismi",
    "ismi", "yemi", "gemisi", "sevgilisi", "kendisi", "annesi", "babası", "abisi",
    "mermi", "irmi", "vermi", "gemi", "komi", "kalemi", "problemi", "dönemi",
    "gözlemi", "sistemi", "ailemi", "annemi", "babamı", "kardeşimi", "elimi", "evimi",
    "gözümü", "sözümü", "yüzümü", "hacmi", "mülkiyeti", "hakimiyeti"
}

PROPER_NOUNS_WHITELIST = {
    "türkiye", "samsun", "istanbul", "ankara", "izmir", "atatürk", "mehmet", "ahmet",
    "ayşe", "fatma", "ali", "veli", "atakum", "ilkadım", "canik", "çarşamba", "bafra",
    "ingilizce", "türkçe", "almanca", "fransızca", "allah", "tanrı", "mardin", "mersin",
    "batman", "bartın", "karaman", "erzincan", "van", "muş"
}

COMMON_NOUNS = {
    "okul", "kitap", "kalem", "masa", "sandalye", "araba", "ev", "bahçe", "şehir", 
    "insan", "çocuk", "kadın", "adam", "sokak", "mahalle", "köy", "su", "ekmek", 
    "çay", "kahve", "çok", "pek", "güzel", "iyi", "kötü", "büyük", "küçük", 
    "öğrenci", "öğretmen", "ders", "sınıf", "arkadaş", "sevgi", "saygı", "mutluluk",
    "yemek", "bardak", "defter", "silgi", "çanta", "dolap", "kapı", "pencere"
}

QUESTION_WORDS = re.compile(r"\b(ne|neden|niçin|nasıl|nasil|kim|hangi|nerede|nereye|nereden|kaç|kac)\b", re.IGNORECASE | re.UNICODE)
EMBEDDED_QUESTION_GUARDS = re.compile(r"\b(bilmiyorum|emin\s+değilim|sanmıyorum|hatırlamıyorum|diyemem|diyemiyorum|anlamıyorum|bilmez|sormadım)\b", re.IGNORECASE | re.UNICODE)

PATTERNS = {
    "TDK_03_SORU_EKI": re.compile(r"\b(\w{2,})(mi|mı|mu|mü)(?=[?.!,;:\s]|$)", re.IGNORECASE | re.UNICODE),
    "TDK_04_SEY_AYRI": re.compile(r"\b(\w+)şey\b", re.IGNORECASE | re.UNICODE),
    "TDK_06_YA_DA": re.compile(r"\byada\b", re.IGNORECASE | re.UNICODE),
    "TDK_07_HER_SEY": re.compile(r"\bherşey\b", re.IGNORECASE | re.UNICODE),
    "TDK_44_BIRKAC": re.compile(r"\bbir\s+kaç\b", re.IGNORECASE | re.UNICODE),
    "TDK_45_HICBIR": re.compile(r"\bhiç\s+bir\b", re.IGNORECASE | re.UNICODE),
    "TDK_46_PEKCOK": re.compile(r"\bpekçok\b", re.IGNORECASE | re.UNICODE),
    "TDK_41_HERKES": re.compile(r"\bherkez\b", re.IGNORECASE | re.UNICODE),
    "TDK_42_YALNIZ": re.compile(r"\byanliz\b", re.IGNORECASE | re.UNICODE),
    "TDK_43_YANLIS": re.compile(r"\byanlis\b", re.IGNORECASE | re.UNICODE),
    "TDK_47_INSALLAH": re.compile(r"\binsallah\b", re.IGNORECASE | re.UNICODE),
    "TDK_23_KESME_GENEL": re.compile(r"\b([A-ZÇĞİÖŞÜa-zçğıöşü]{3,})'([a-zçğıöşü]+)\b", re.UNICODE)
}

PROPER_NOUN_SUFFIX_REGEX = re.compile(
    r"\b([A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,})(nin|nın|nun|nün|in|ın|un|ün|de|da|den|dan|e|a|i|ı|u|ü|le|la)\b",
    re.UNICODE
)

CAPITALIZED_WORD_REGEX = re.compile(r"\b[A-ZÇĞİÖŞÜ][a-zçğıöşü]+\b", re.UNICODE)

# =======================================================
# 3) DATA MODELS & HELPERS
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

def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = unicodedata.normalize("NFKC", text)
    return text.strip()

def tr_lower(text: str) -> str:
    return text.replace("İ", "i").replace("I", "ı").lower()

def safe_json(text: str) -> dict:
    if not text: return {}
    t = text.strip().replace("```json", "").replace("```", "").strip()
    try: return json.loads(t)
    except: return {}

def to_int(x, default=0):
    try:
        if x is None: return default
        if isinstance(x, (int, float)): return int(x)
        if isinstance(x, str):
            clean = re.sub(r"[^\d\-]", "", x.split("/")[0])
            return int(clean) if clean else default
        return default
    except: return default

def get_sentence_starts(text: str) -> set:
    starts = {0}
    for match in re.finditer(r"[.!?]\s+", text):
        starts.add(match.end())
    return starts

def apply_case(original: str, target: str) -> str:
    """Kelimenin büyük/küçük harf durumunu koruyan akıllı yardımcı fonksiyon."""
    if not original or not target: return target
    if original.istitle() or (original[0].isupper() and original[1:].islower()):
        return target.capitalize()
    if original.isupper():
        return target.upper()
    return target

async def ensure_gcp_credentials():
    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"): return
    key_json = os.getenv("GCP_SA_KEY_JSON", "").strip()
    if not key_json: return
    try:
        path = "/tmp/gcp_sa.json"
        with open(path, "w", encoding="utf-8") as f: f.write(key_json)
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = path
    except: pass

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

# =======================================================
# 4) CORE ALGORİTMA: DETERMİNİSTİK ANALİZ (REGEX)
# =======================================================
def analyze_deterministic(text: str) -> List[Dict[str, Any]]:
    errors = []
    sentence_starts = get_sentence_starts(text)
    
    # 1. STANDART REGEX HATALARI
    for rule_id, pattern in PATTERNS.items():
        for match in pattern.finditer(text):
            whole_word = match.group(0)
            
            if rule_id == "TDK_03_SORU_EKI":
                stem = match.group(1)
                suffix = match.group(2)
                span_end = match.end()
                
                if tr_lower(whole_word) in MI_SUFFIX_BLACKLIST:
                    continue 
                
                base_correct = f"{stem} {suffix}"
                correct_str = apply_case(whole_word, base_correct)
                explanation = "Soru eki 'mi/mı' her zaman ayrı yazılır."

                # Gelişmiş Soru İşareti Mantığı (Virgül/Nokta varsa soru işaretine çevirir)
                next_char = text[span_end] if span_end < len(text) else ""
                
                if next_char in [".", ",", ";", ":"]:
                    span_end += 1
                    whole_word += next_char
                    correct_str += "?"
                    explanation += " Ayrıca soru cümlesi olduğu için sonuna soru işareti (?) konmalıdır."
                elif next_char == "" or next_char in ["\n", "\r"]:
                    correct_str += "?"
                    explanation += " Ayrıca soru cümlesi olduğu için sonuna soru işareti (?) konmalıdır."

                errors.append({
                    "wrong": whole_word,
                    "correct": correct_str,
                    "rule_id": rule_id,
                    "span": {"start": match.start(), "end": span_end},
                    "type": "Yazım",
                    "explanation": explanation,
                    "confidence": 1.0,
                    "source": "RULE_BASED"
                })
                continue
            
            elif rule_id == "TDK_04_SEY_AYRI":
                stem = match.group(1)
                correct = apply_case(whole_word, f"{stem} şey")
                explanation = "'Şey' sözcüğü her zaman ayrı yazılır."
            elif rule_id == "TDK_06_YA_DA": 
                correct = apply_case(whole_word, "ya da")
                explanation = "'Ya da' bağlacı ayrı yazılır."
            elif rule_id == "TDK_07_HER_SEY": 
                correct = apply_case(whole_word, "her şey")
                explanation = "'Her şey' ayrı yazılır."
            elif rule_id == "TDK_44_BIRKAC": 
                correct = apply_case(whole_word, "birkaç")
                explanation = "'Birkaç' kelimesi bitişik yazılır."
            elif rule_id == "TDK_45_HICBIR": 
                correct = apply_case(whole_word, "hiçbir")
                explanation = "'Hiçbir' kelimesi bitişik yazılır."
            elif rule_id == "TDK_46_PEKCOK": 
                correct = apply_case(whole_word, "pek çok")
                explanation = "'Pek çok' ayrı yazılır."
            elif rule_id == "TDK_41_HERKES": 
                correct = apply_case(whole_word, "herkes")
                explanation = "'Herkes' kelimesi 's' ile yazılır."
            elif rule_id == "TDK_42_YALNIZ": 
                correct = apply_case(whole_word, "yalnız")
                explanation = "Yalın kökünden gelir, 'yalnız' yazılır."
            elif rule_id == "TDK_43_YANLIS": 
                correct = apply_case(whole_word, "yanlış")
                explanation = "Yanılmak kökünden gelir, 'yanlış' yazılır."
            elif rule_id == "TDK_47_INSALLAH": 
                correct = apply_case(whole_word, "inşallah")
                explanation = "Doğru yazım 'inşallah' şeklindedir."
            
            elif rule_id == "TDK_23_KESME_GENEL":
                stem = match.group(1)
                suffix = match.group(2)
                if tr_lower(stem) not in COMMON_NOUNS and stem[0].isupper():
                    continue
                base_correct = f"{stem}{suffix}"
                if stem.endswith("p") and suffix[0] in "aıou": base_correct = f"{stem[:-1]}b{suffix}"
                elif stem.endswith("t") and suffix[0] in "aıou": base_correct = f"{stem[:-1]}d{suffix}"
                elif stem.endswith("ç") and suffix[0] in "aıou": base_correct = f"{stem[:-1]}c{suffix}"
                elif stem.endswith("k") and suffix[0] in "aıou": base_correct = f"{stem[:-1]}ğ{suffix}"
                
                correct = apply_case(whole_word, base_correct)
                explanation = "Cins isimlere (özel isim olmayan) gelen ekler kesme işaretiyle ayrılmaz."

            errors.append({
                "wrong": whole_word,
                "correct": correct,
                "rule_id": rule_id,
                "span": {"start": match.start(), "end": match.end()},
                "type": "Yazım",
                "explanation": explanation,
                "confidence": 1.0,
                "source": "RULE_BASED"
            })

    # 2. ÖZEL İSİM SONEK ANALİZİ (Ahmetin -> Ahmet'in)
    for match in PROPER_NOUN_SUFFIX_REGEX.finditer(text):
        whole_word = match.group(0)
        stem = match.group(1)
        suffix = match.group(2)
        start_idx = match.start()
        is_sentence_start = start_idx in sentence_starts
        
        if tr_lower(whole_word) in PROPER_NOUNS_WHITELIST:
            continue

        if tr_lower(stem) in COMMON_NOUNS:
            errors.append({
                "wrong": whole_word,
                "correct": tr_lower(whole_word),
                "rule_id": "TDK_12_GEREKSIZ_BUYUK",
                "span": {"start": start_idx, "end": match.end()},
                "type": "Büyük Harf",
                "explanation": "Cins isimler cümle ortasında küçük harfle yazılır.",
                "confidence": 0.95,
                "source": "RULE_BASED"
            })
            continue

        if (not is_sentence_start) or (tr_lower(stem) in PROPER_NOUNS_WHITELIST):
            errors.append({
                "wrong": whole_word,
                "correct": f"{stem}'{suffix}",
                "rule_id": "TDK_20_KESME_OZEL_AD",
                "span": {"start": start_idx, "end": match.end()},
                "type": "Noktalama",
                "explanation": "Özel isimlere gelen ekler kesme işareti ile ayrılır.",
                "confidence": 0.95,
                "source": "RULE_BASED"
            })

    # 3. GEREKSİZ BÜYÜK HARF TARAMASI
    for match in CAPITALIZED_WORD_REGEX.finditer(text):
        whole_word = match.group(0)
        start_idx = match.start()
        
        if start_idx in sentence_starts: continue
        if tr_lower(whole_word) in PROPER_NOUNS_WHITELIST: continue
        
        already_found = any(e['span']['start'] == start_idx for e in errors)
        if already_found: continue

        if tr_lower(whole_word) in COMMON_NOUNS:
             errors.append({
                "wrong": whole_word,
                "correct": tr_lower(whole_word),
                "rule_id": "TDK_12_GEREKSIZ_BUYUK",
                "span": {"start": start_idx, "end": match.end()},
                "type": "Büyük Harf",
                "explanation": "Küçük harfle başlamalı.",
                "confidence": 0.90,
                "source": "RULE_BASED"
            })

    return errors

# =======================================================
# 5) ENDPOINTS
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
        await ensure_gcp_credentials()
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

@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş.")
    if "⍰" in data.ocr_text:
        raise HTTPException(status_code=400, detail="Önce ⍰ işaretlerini düzeltin.")

    full_text = normalize_text(data.ocr_text)
    print(f"🧠 HİBRİT ANALİZ BAŞLIYOR: {data.student_name} ({data.level})")

    rule_errors = analyze_deterministic(full_text)
    
    prompt = f"""
    GÖREV: Aşağıdaki öğrenci metnini analiz et.
    ÖNEMLİ: Zaten regex ile bulunan (-de/-da, -ki, mi/mı, özel isimler) hataları yoksay. Sadece regex'in bulamadığı anlamsal/kök bozukluklarını bul.
    METİN:
    {full_text}
    ÇIKTI FORMATI (JSON):
    {{ "additional_errors": [ {{ "wrong": "...", "correct": "...", "explanation": "..." }} ] }}
    """
    
    llm_errors = []
    
    prompt_rubric = f"""
    ROL: Öğretmen ({data.level}).
    GÖREV: Aşağıdaki metni okuyup, CEFR kriterlerine göre değerlendir. 
    ÖNEMLİ KURALLAR:
    1. 'teacher_note' içine öğrencinin yazısı hakkında ÇOK KISA, en fazla 3-4 cümlelik, maddeler (bullet points) İÇERMEYEN, tek bir paragraf özet yaz.
    2. Kesinlikle uzun alt başlıklar veya listeler kullanma. Tıpkı şu örnekteki gibi genel bir özet olsun: "Öğrencinin metni genel olarak anlaşılır ve konu bütünlüğü taşımaktadır. Ancak noktalama ve büyük harf kurallarına dikkat edilmelidir."
    METİN: \"\"\"{full_text}\"\"\"
    PUANLA (TOPLAM 100): Uzunluk(16), Noktalama(14), Dil Bilgisi(16), Söz Dizimi(20), Kelime(14), İçerik(20).
    ÇIKTI: {{ "rubric": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }}, "teacher_note": "Kısa, tek paragraf genel değerlendirme özeti." }}
    """

    final_result = None

    for model_name in MODELS_TO_TRY:
        try:
            resp_err = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            llm_json = safe_json(getattr(resp_err, "text", "") or "")
            raw_llm_errors = llm_json.get("additional_errors", [])

            resp_rubric = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=prompt_rubric,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1)
            )
            rubric_json = safe_json(getattr(resp_rubric, "text", "") or "")

            for item in raw_llm_errors:
                wrong_word = item.get("wrong", "")
                if not wrong_word: continue
                match = re.search(re.escape(wrong_word), full_text)
                if match:
                    is_overlap = any((match.start() < e["span"]["end"] and match.end() > e["span"]["start"]) for e in rule_errors)
                    if not is_overlap:
                        llm_errors.append({
                            "wrong": wrong_word,
                            "correct": item.get("correct"),
                            "rule_id": "LLM_SEMANTIC",
                            "span": {"start": match.start(), "end": match.end()},
                            "type": "Kelime Hatası",
                            "explanation": item.get("explanation"),
                            "confidence": 0.85,
                            "source": "LLM"
                        })

            all_errors = rule_errors + llm_errors
            all_errors.sort(key=lambda x: x["span"]["start"])

            unique_error_map = {}
            for err in all_errors:
                key = f"{err['rule_id']}_{err['wrong'].lower()}"
                if key not in unique_error_map:
                    unique_error_map[key] = err
            
            error_summary = list(unique_error_map.values())
            error_summary.sort(key=lambda x: x["span"]["start"])

            rb = rubric_json.get("rubric", {})
            rubric = {
                "uzunluk": to_int(rb.get("uzunluk"), 10),
                "noktalama": to_int(rb.get("noktalama"), 10),
                "dil_bilgisi": to_int(rb.get("dil_bilgisi"), 10),
                "soz_dizimi": to_int(rb.get("soz_dizimi"), 15),
                "kelime": to_int(rb.get("kelime"), 10),
                "icerik": to_int(rb.get("icerik"), 15),
            }
            total_score = sum(rubric.values())

            yz_notu = rubric_json.get("teacher_note", "")
            if not yz_notu or yz_notu in ["...", "Detaylı değerlendirme yazısı."]:
                yz_notu = "Yapay zeka değerlendirmesi başarıyla tamamlandı."

            final_result = {
                "score_total": total_score,
                "rubric": rubric,
                "errors": all_errors,           
                "error_summary": error_summary, 
                "errors_ocr": [], 
                "teacher_note": yz_notu,
                "ai_insight": yz_notu
            }
            break

        except Exception as e:
            print(f"LLM Hata ({model_name}): {e}")
            continue

    if not final_result:
        raise HTTPException(status_code=500, detail="Analiz başarısız oldu.")

    try:
        supabase.table("submissions").insert({
            "student_name": data.student_name,
            "student_surname": data.student_surname,
            "classroom_code": data.classroom_code,
            "image_url": data.image_url,
            "ocr_text": full_text,
            "level": data.level,
            "country": data.country,
            "native_language": data.native_language,
            "analysis_json": final_result,
            "score_total": final_result["score_total"]
        }).execute()
    except Exception as e:
        print(f"DB Kayıt Hatası: {e}")

    return {"status": "success", "data": final_result}

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