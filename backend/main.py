# main.py - FINAL (Span Doğrulamalı, Halüsinasyon Önleyici, TDK+CEFR)
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client, Client
from dotenv import load_dotenv
import os, json, uuid, re
from pydantic import BaseModel
from typing import Union, List, Dict, Any

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.endswith("/"):
    SUPABASE_URL += "/"
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

client = genai.Client(api_key=API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_TO_TRY = ["gemini-2.0-flash-exp", "gemini-1.5-flash", "gemini-1.5-pro"]
WORD_COUNTS = {"A1": 75, "A2": 100, "B1": 125, "B2": 150, "C1": 175, "C2": 200}

CEFR_KRITERLERI = {
    "A1": "Basit cümleler, kendini tanıtma. Kelime sırası hatalarını daha hoşgörülü değerlendir.",
    "A2": "Basit bağlaçlarla cümle bağlayabilmeli; temel zamanları ve en sık ekleri genelde doğru kullanmalı.",
    "B1": "Bağlantılı metin, neden-sonuç, daha tutarlı anlatım.",
    "B2": "Daha akıcı, daha doğru yazım. Sık yazım/noktalama hataları daha fazla puan kırdırır.",
    "C1": "Geniş söz varlığı, neredeyse kusursuz yazım/dil bilgisi beklenir.",
}

class AnalyzeRequest(BaseModel):
    ocr_text: str
    image_url: str
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

# --- TDK RULES LOADER ---
TDK_RULES_PATH = os.getenv("TDK_RULES_PATH", "tdk_rules.json")
def load_tdk_rules() -> List[Dict[str, Any]]:
    try:
        with open(TDK_RULES_PATH, "r", encoding="utf-8") as f:
            rules = json.load(f)
        if not isinstance(rules, list):
            raise ValueError("tdk_rules.json bir liste (array) olmalı.")
        return [r for r in rules if isinstance(r, dict) and r.get("rule_id")]
    except Exception as e:
        print(f"⚠️ TDK Kuralları Yüklenemedi: {e}")
        return []

# --- GUARDRAILS ---
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")
def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_rule_ids: set) -> Dict[str, Any]:
    if not isinstance(result, dict):
        return {"rubric": {}, "errors": [], "teacher_note": "Analiz formatı hatalı."}

    raw_errors = result.get("errors", [])
    if not isinstance(raw_errors, list): raw_errors = []

    clean_errors = []
    n = len(full_text)

    for err in raw_errors:
        if not isinstance(err, dict): continue

        rid = err.get("rule_id")
        if not rid or rid not in allowed_rule_ids: continue # Kural listemizde yoksa sil

        span = err.get("span")
        # SPAN YOKSA REDDET (Jüri Güvenliği)
        if not isinstance(span, dict) or "start" not in span or "end" not in span:
            print(f"🗑️ Span yok, hata reddedildi: {err.get('wrong','')}")
            continue

        try:
            start, end = int(span["start"]), int(span["end"])
        except: continue

        if start < 0 or end <= start or end > n: continue

        wrong = err.get("wrong", "")
        evidence_fragment = full_text[start:end]

        # KANIT KONTROLÜ (Büyük/Küçük harf duyarlı)
        if normalize_text(evidence_fragment) != normalize_text(wrong):
            print(f"🗑️ Kanıt uyuşmazlığı: Model='{wrong}' Metin='{evidence_fragment}'")
            continue

        clean_errors.append({
            "wrong": wrong,
            "correct": err.get("correct", ""),
            "type": err.get("type", "Yazım"),
            "rule_id": rid,
            "explanation": err.get("explanation", ""),
            "span": {"start": start, "end": end}
        })

    # Çakışma Temizliği (Uzun olanı tut)
    clean_errors.sort(key=lambda x: (x["span"]["start"], -(x["span"]["end"] - x["span"]["start"])))
    final_errors = []
    last_end = -1

    for e in clean_errors:
        if e["span"]["start"] < last_end: continue
        final_errors.append(e)
        last_end = e["span"]["end"]

    result["errors"] = final_errors
    return result

# --- ENDPOINTS ---
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
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        unique_filename = f"{classroom_code}_{uuid.uuid4()}.{file_ext}"
        image_url = ""
        try:
            supabase.storage.from_("odevler").upload(unique_filename, file_content, {"content-type": file.content_type})
            res = supabase.storage.from_("odevler").get_public_url(unique_filename)
            image_url = res if isinstance(res, str) else res.get("publicUrl")
        except: pass

        extracted_text = ""
        prompt = "Bu resimdeki metni, el yazısı olsa bile Türkçe olarak aynen metne dök. Sadece metni ver."
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name, contents=[prompt, types.Part.from_bytes(data=file_content, mime_type=file.content_type)]
                )
                extracted_text = (response.text or "").strip()
                if extracted_text: break
            except: continue
        
        if not extracted_text: return {"status": "error", "message": "OCR Başarısız"}
        return {"status": "success", "ocr_text": extracted_text, "image_url": image_url}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    print(f"🧠 Analiz: {data.student_name} ({data.level})")

    all_rules = load_tdk_rules()
    if not all_rules: raise HTTPException(status_code=500, detail="TDK kuralları yüklenemedi.")

    allowed_ids = {r["rule_id"] for r in all_rules}
    rules_text = "\n".join([f"- ID: {r['rule_id']} | {r['title']}: {r['text']}" for r in all_rules])
    cefr_text = CEFR_KRITERLERI.get(data.level, "Genel değerlendirme.")

    prompt = f"""
    GÖREV: Öğrenci metnini analiz et.
    ZORUNLU TALİMATLAR:
    1. SADECE aşağıdaki TDK KURALLARI listesini kullan. Listede olmayan hatayı YAZMA.
    2. Her hata için MUTLAKA metindeki 'span' (start, end) bilgisini doğru hesapla.
    3. 'wrong' alanı, metindeki ilgili parça ile BİREBİR aynı olmalı.

    TDK KURALLARI:{rules_text}
    SEVİYE ({data.level}): {cefr_text}
    METİN: \"\"\"{data.ocr_text}\"\"\"

    JSON ÇIKTI FORMATI:
    {{
      "rubric": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }},
      "errors": [ {{ "wrong": "...", "correct": "...", "type": "...", "rule_id": "...", "explanation": "...", "span": {{ "start": 0, "end": 0 }} }} ],
      "teacher_note": "..."
    }}
    """
    
    analysis_result = None
    last_error = ""

    for model_name in MODELS_TO_TRY:
        try:
            response = client.models.generate_content(model=model_name, contents=prompt, config=types.GenerateContentConfig(response_mime_type="application/json"))
            text_resp = (response.text or "").strip().replace("```json", "").replace("```", "")
            raw_result = json.loads(text_resp)
            
            # GÜVENLİK KONTROLÜ
            sanitized = validate_analysis(raw_result, data.ocr_text, allowed_ids)
            
            sanitized["score_total"] = sum(sanitized.get("rubric", {}).values())
            analysis_result = sanitized
            print(f"✅ Analiz Başarılı: {model_name}")
            break
        except Exception as e:
            last_error = str(e)
            continue

    if not analysis_result: raise HTTPException(status_code=500, detail=f"Hata: {last_error}")

    try:
        supabase.table("submissions").insert({
            "student_name": data.student_name, "student_surname": data.student_surname, "classroom_code": data.classroom_code,
            "image_url": data.image_url, "ocr_text": data.ocr_text, "level": data.level, "country": data.country,
            "native_language": data.native_language, "analysis_json": analysis_result, "score_total": analysis_result["score_total"]
        }).execute()
        return {"status": "success", "data": analysis_result}
    except Exception as e: return {"status": "success", "data": analysis_result, "warning": "DB Hatası"}

# Diğer endpointler (history, update) aynı kalacak...
@app.post("/student-history")
async def get_student_history(student_name: str = Form(...), student_surname: str = Form(...), classroom_code: str = Form(...)):
    try:
        response = supabase.table("submissions").select("*").eq("student_name", student_name).eq("student_surname", student_surname).eq("classroom_code", classroom_code).order("created_at", desc=True).execute()
        return {"status": "success", "data": response.data}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    try:
        supabase.table("submissions").update({"score_total": data.new_total, "analysis_json": data.new_rubric}).eq("id", data.submission_id).execute()
        return {"status": "success", "message": "Puan güncellendi"}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))