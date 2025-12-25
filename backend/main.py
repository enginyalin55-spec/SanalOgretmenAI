from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client, Client
from dotenv import load_dotenv
import os
import json
import uuid
from pydantic import BaseModel
from typing import Union

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

# Supabase URL sonuna '/' ekleme (Güvenlik önlemi)
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.endswith("/"):
    SUPABASE_URL += "/"
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# --- YENİ KÜTÜPHANE BAŞLATMA ---
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

# --- MODEL LİSTESİ ---
# DİKKAT: Loglarda 'gemini-2.0-flash-exp' modelinin çalıştığını kanıtladık.
# Bu yüzden onu EN BAŞA koyuyoruz.
MODELS_TO_TRY = [
    "gemini-2.0-flash-exp", # ✅ Az önce çalışan model bu!
    "gemini-1.5-flash",     
    "gemini-1.5-pro",       
]

# --- KELİME HEDEFLERİ ---
WORD_COUNTS = {"A1": 75, "A2": 100, "B1": 125, "B2": 150, "C1": 175, "C2": 200}

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

@app.get("/check-class/{code}")
async def check_class_code(code: str):
    try:
        response = supabase.table("classrooms").select("name").eq("code", code.upper().strip()).execute()
        if response.data: return {"valid": True, "class_name": response.data[0]['name']}
        return {"valid": False}
    except: return {"valid": False}

# --- GÜÇLENDİRİLMİŞ OCR (Metin Tarama) ---
@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    try:
        # 1. Dosya Okuma
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        unique_filename = f"{classroom_code}_{uuid.uuid4()}.{file_ext}"
        
        # 2. Supabase Yedekleme
        image_url = ""
        try:
            supabase.storage.from_("odevler").upload(unique_filename, file_content, {"content-type": file.content_type})
            res = supabase.storage.from_("odevler").get_public_url(unique_filename)
            image_url = res if isinstance(res, str) else res.get("publicUrl")
        except Exception as e:
            print(f"Resim Depolama Hatası: {e}")

        # 3. YENİ SDK İLE ÇOKLU MODEL DENEMESİ
        extracted_text = ""
        last_error = ""
        success = False

        prompt = "Bu resimdeki metni, el yazısı olsa bile Türkçe olarak aynen metne dök. Sadece metni ver, yorum yapma."

        for model_name in MODELS_TO_TRY:
            try:
                print(f"🔄 OCR Deneniyor: {model_name}...")
                
                # Yeni SDK Kullanımı
                response = client.models.generate_content(
                    model=model_name,
                    contents=[
                        prompt,
                        types.Part.from_bytes(data=file_content, mime_type=file.content_type),
                    ]
                )

                extracted_text = (response.text or "").strip()
                
                if not extracted_text:
                    raise Exception("Boş cevap döndü")

                print(f"✅ OCR BAŞARILI: {model_name} çalıştı!")
                success = True
                break 
            except Exception as e:
                print(f"❌ {model_name} OCR başarısız: {e}")
                last_error = str(e)
                continue 

        if not success:
            return {"status": "error", "message": "Hiçbir model çalışmadı.", "details": last_error}
        
        return {
            "status": "success",
            "ocr_text": extracted_text,
            "image_url": image_url
        }

    except Exception as e:
        return {"status": "error", "message": "Genel hata", "details": str(e)}

# --- GÜÇLENDİRİLMİŞ ANALİZ (Puanlama) ---
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    print(f"🧠 Analiz Başlıyor: {data.student_name}")
    
    analysis_result = None
    last_error = ""

    prompt = f"""
    Sen TÖMER öğretmenisin. Aşağıdaki öğrenci metnini analiz et.
    
    Öğrenci: {data.student_name}
    Seviye: {data.level} (Hedef kelime: {WORD_COUNTS.get(data.level, 75)})
    Ana Dil: {data.native_language}
    
    METİN:
    "{data.ocr_text}"
    
    GÖREV:
    1. Metni puanla (Toplam 100 üzerinden).
    2. Hataları tespit et.
    3. Öğrenciye not yaz.
    
    Lütfen yanıtı SADECE aşağıdaki JSON formatında ver:
    {{
        "rubric": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }},
        "errors": [ {{ "wrong": "hatalı kelime", "correct": "doğrusu", "type": "Hata Türü", "explanation": "Neden hatalı?" }} ],
        "teacher_note": "Öğrenciye kısa, motive edici not."
    }}
    """

    # Analiz için de aynı model listesini kullanıyoruz (2.0-flash-exp başta)
    for model_name in MODELS_TO_TRY:
        try:
            print(f"📊 Analiz deneniyor: {model_name}...")
            
            # JSON Modu ile garantili çıktı
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type='application/json' 
                )
            )

            text_response = (response.text or "").strip()
            # Markdown temizliği
            text_response = text_response.replace("```json", "").replace("```", "").strip()
            
            analysis_result = json.loads(text_response)
            print(f"✅ Analiz Başarılı: {model_name}")
            break # Başardık, çıkalım.
            
        except Exception as e:
            print(f"❌ {model_name} analiz hatası: {e}")
            last_error = str(e)
            continue

    if not analysis_result:
        print("💥 Tüm analiz modelleri başarısız oldu.")
        raise HTTPException(status_code=500, detail=f"Analiz yapılamadı: {last_error}")

    # --- KAYDETME ---
    try:
        rubric = analysis_result.get("rubric", {})
        calculated_total = sum(rubric.values())
        analysis_result["score_total"] = calculated_total

        supabase.table("submissions").insert({
            "student_name": data.student_name,
            "student_surname": data.student_surname,
            "classroom_code": data.classroom_code,
            "image_url": data.image_url,
            "ocr_text": data.ocr_text,
            "level": data.level,
            "country": data.country,
            "native_language": data.native_language,
            "analysis_json": analysis_result,
            "score_total": calculated_total
        }).execute()
        
        return {"status": "success", "data": analysis_result}
        
    except Exception as e:
        print(f"💾 Veritabanı Kayıt Hatası: {e}")
        # Kayıt olmasa bile hocaya sonucu gösterelim
        return {"status": "success", "data": analysis_result, "warning": "Veritabanına kaydedilemedi ama analiz başarılı."}

@app.post("/student-history")
async def get_student_history(student_name: str = Form(...), student_surname: str = Form(...), classroom_code: str = Form(...)):
    try:
        response = supabase.table("submissions").select("*").eq("student_name", student_name).eq("student_surname", student_surname).eq("classroom_code", classroom_code).order("created_at", desc=True).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    try:
        supabase.table("submissions").update({
            "score_total": data.new_total, "analysis_json": data.new_rubric
        }).eq("id", data.submission_id).execute()
        return {"status": "success", "message": "Puan güncellendi"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))