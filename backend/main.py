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

app = FastAPI(title="Sanal Ogretmen AI API", version="3.0.0 (6-Criteria Rubric)")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*", # Güvenlik için production'da spesifik domain girin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gemini Modelleri
MODELS_TO_TRY = ["gemini-2.0-flash", "gemini-1.5-flash"]

MAX_FILE_SIZE = 6 * 1024 * 1024
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}

# =======================================================
# 2) HELPER: GOOGLE CLOUD AUTH (OCR İÇİN)
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
# 4) TEXT UTILS
# =======================================================
def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'").replace("“", '"').replace("”", '"')
    return unicodedata.normalize("NFKC", text).strip()

def _find_span(full_text: str, wrong: str):
    """Basit span bulucu. Frontend işaretleyebilsin diye."""
    if not wrong: return None
    idx = full_text.find(wrong)
    if idx == -1: return None
    return {"start": idx, "end": idx + len(wrong)}

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
# 5) ENDPOINTS
# =======================================================
@app.get("/")
def health_check():
    return {"status": "ok", "version": "3.0.0"}

# --- OCR Endpoint'i (Değişmedi, aynı kalıyor) ---
@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    try:
        ensure_gcp_credentials()
        file_content = await read_limited(file, MAX_FILE_SIZE)
        
        # Supabase Upload
        filename = f"{uuid.uuid4()}.jpg"
        image_url = ""
        try:
            supabase.storage.from_("odevler").upload(filename, file_content, {"content-type": "image/jpeg"})
            image_url = supabase.storage.from_("odevler").get_public_url(filename)
        except: pass

        # Vision API
        vision_client = vision.ImageAnnotatorClient()
        image = vision.Image(content=file_content)
        context = vision.ImageContext(language_hints=["tr"])
        response = vision_client.document_text_detection(image=image, image_context=context)
        
        # Basit Maskeleme Mantığı (Daha önce frontend'de çözdük ama backend desteği)
        full_text = response.full_text_annotation.text or ""
        
        # '?' işaretlerini '⍰' yapmıyoruz artık, Vision ne döndürürse o.
        # Frontend zaten '⍰' varsa uyaracak. Vision düşük güvenli harfleri işaretlemiyor varsayılan olarak.
        # Eğer Vision'dan 'confidence' almak istersen önceki karmaşık kodu kullanabilirsin.
        # Ancak basitlik adına düz metin döndürüyoruz:
        
        return {
            "status": "success",
            "ocr_text": full_text,
            "image_url": image_url
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- ANALİZ (YENİLENEN 6 KRİTERLİ VERSİYON) ---
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    # 1. Güvenlik Kontrolü (Frontend'den kaçarsa diye)
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş.")
    if "⍰" in data.ocr_text:
        raise HTTPException(status_code=400, detail="Lütfen önce belirsiz karakterleri (⍰) düzeltin.")

    print(f"🧠 Analiz Başlıyor: {data.student_name} - Seviye: {data.level}")

    # 2. PROMPT HAZIRLIĞI (Tek Seferde Tam Analiz)
    # Puanlama Kriterleri:
    # 1. Uzunluk (16)
    # 2. Noktalama (14)
    # 3. Dil Bilgisi (16)
    # 4. Söz Dizimi (20)
    # 5. Kelime (14)
    # 6. İçerik (20)
    # TOPLAM = 100
    
    prompt = f"""
    ROL: Sen uzman bir Türkçe öğretmenisin.
    GÖREV: {data.level} (CEFR) seviyesindeki yabancı bir öğrencinin yazdığı aşağıdaki metni analiz et.
    
    METİN:
    \"\"\"{data.ocr_text}\"\"\"

    YAPMAN GEREKENLER:
    1. Metni aşağıdaki 6 kriter üzerinden puanla (Toplam 100 Puan):
       - UZUNLUK (0-16 Puan): Metin seviyeye göre yeterince uzun mu?
       - NOKTALAMA (0-14 Puan): Nokta, virgül, büyük harf, kesme işareti kullanımı.
       - DİL BİLGİSİ (0-16 Puan): Ekler, zaman uyumu, dilbilgisi kuralları.
       - SÖZ DİZİMİ (0-20 Puan): Cümle yapısı, kelime sırası, devrik cümleler.
       - KELİME (0-14 Puan): Kelime çeşitliliği ve doğruluğu.
       - İÇERİK (0-20 Puan): Konu bütünlüğü, anlamlılık, kendini ifade etme.
    
    2. Hataları Listele:
       - Metindeki yazım yanlışlarını, mantık hatalarını ve TDK ihlallerini bul.
       - "wrong": Hatalı kelime/kelime grubu (Metinde geçtiği gibi).
       - "correct": Olması gereken hali.
       - "rule_id": Hata türü (Örn: TDK_YAZIM, TDK_NOKTALAMA, GRAMER, ANLATIM_BOZUKLUGU).
       - "explanation": Öğrenciye kısa, yapıcı açıklama.

    3. Öğretmen Notu:
       - Öğrenciye hitaben, motive edici ve geliştirici kısa bir paragraf yaz.

    ÇIKTI FORMATI (SADECE JSON):
    {{
      "rubric": {{
        "uzunluk": 0,
        "noktalama": 0,
        "dil_bilgisi": 0,
        "soz_dizimi": 0,
        "kelime": 0,
        "icerik": 0
      }},
      "errors": [
        {{ "wrong": "...", "correct": "...", "rule_id": "...", "explanation": "..." }}
      ],
      "teacher_note": "..."
    }}
    """

    final_result = None
    
    # 3. GEMINI ISTEGI
    for model_name in MODELS_TO_TRY:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.2 # Tutarlı puanlama için düşük sıcaklık
                )
            )
            
            # JSON Parse Et
            raw_text = response.text.strip()
            # Markdown block temizliği (gerekirse)
            if raw_text.startswith("```json"):
                raw_text = raw_text[7:-3]
            
            analysis_json = json.loads(raw_text)
            
            # Span (Konum) Hesaplama
            # Frontend'de altını çizmek için hataların metindeki yerini buluyoruz.
            norm_text = normalize_text(data.ocr_text)
            enriched_errors = []
            for err in analysis_json.get("errors", []):
                span = _find_span(norm_text, normalize_text(err.get("wrong", "")))
                if span:
                    err["span"] = span
                    enriched_errors.append(err)
            
            # Hata listesini güncelle (Sadece konumu bulunanları al)
            # Not: İstersen konumu bulunamayanları da ekleyebilirsin ama altını çizemezsin.
            analysis_json["errors"] = enriched_errors

            # Toplam Puan Hesapla
            rubric = analysis_json.get("rubric", {})
            total_score = sum([
                int(rubric.get("uzunluk", 0)),
                int(rubric.get("noktalama", 0)),
                int(rubric.get("dil_bilgisi", 0)),
                int(rubric.get("soz_dizimi", 0)),
                int(rubric.get("kelime", 0)),
                int(rubric.get("icerik", 0))
            ])
            
            final_result = {
                "rubric": rubric,
                "score_total": total_score,
                "errors": analysis_json.get("errors", []),
                "teacher_note": analysis_json.get("teacher_note", "Analiz tamamlandı.")
            }
            break # Başarılıysa döngüden çık
        except Exception as e:
            print(f"Model hatası ({model_name}): {e}")
            continue

    if not final_result:
        raise HTTPException(status_code=500, detail="Yapay zeka analizi yapılamadı.")

    # 4. DB KAYIT
    try:
        supabase.table("submissions").insert({
            "student_name": data.student_name,
            "student_surname": data.student_surname,
            "classroom_code": data.classroom_code,
            "image_url": data.image_url,
            "ocr_text": data.ocr_text,
            "level": data.level,
            "country": data.country,
            "native_language": data.native_language,
            "analysis_json": final_result,
            "score_total": final_result["score_total"]
        }).execute()
    except Exception as e:
        print(f"DB Kayıt Hatası: {e}")
        # DB hatası olsa bile kullanıcıya sonucu dönelim

    return {"status": "success", "data": final_result}

@app.post("/student-history")
async def get_student_history(
    student_name: str = Form(...), 
    student_surname: str = Form(...), 
    classroom_code: str = Form(...)
):
    try:
        res = supabase.table("submissions").select("*")\
            .ilike("student_name", student_name.strip())\
            .ilike("student_surname", student_surname.strip())\
            .eq("classroom_code", classroom_code.strip())\
            .order("created_at", desc=True).execute()
        return {"status": "success", "data": res.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    """Öğretmen panelinden gelen yeni puanları kaydeder."""
    try:
        # Mevcut JSON'ı çek
        res = supabase.table("submissions").select("analysis_json").eq("id", data.submission_id).execute()
        if not res.data: raise HTTPException(status_code=404, detail="Kayıt yok")
        
        current_json = res.data[0]["analysis_json"]
        
        # Rubriği güncelle
        if "rubric" not in current_json: current_json["rubric"] = {}
        current_json["rubric"].update(data.new_rubric)
        
        # DB'yi güncelle
        supabase.table("submissions").update({
            "score_total": data.new_total,
            "analysis_json": current_json
        }).eq("id", data.submission_id).execute()
        
        return {"status": "success", "message": "Puan güncellendi"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))