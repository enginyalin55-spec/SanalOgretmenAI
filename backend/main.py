from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import google.generativeai as genai
from supabase import create_client, Client
from dotenv import load_dotenv
import os
import json
import uuid
from pydantic import BaseModel
from typing import Union

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

genai.configure(api_key=API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- MODEL LİSTESİ (Sırayla Hepsini Deneyecek) ---
# Biri çalışmazsa diğerine geçer. İşini şansa bırakmaz.
MODELS_TO_TRY = ["gemini-1.5-flash", "gemini-pro", "gemini-1.0-pro", "gemini-1.5-pro"]

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

# --- AKILLI OCR FONKSİYONU ---
@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    # 1. Dosya Hazırlığı
    try:
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

        # 3. ÇOKLU MODEL DENEMESİ (MAYMUNCUK SİSTEMİ) 🗝️
        extracted_text = ""
        last_error = ""
        success = False

        prompt = "Bu resimdeki metni, el yazısı olsa bile Türkçe olarak aynen metne dök. Sadece metni ver, yorum yapma."

        for model_name in MODELS_TO_TRY:
            try:
                print(f"🔄 Deneniyor: {model_name}...")
                # Modeli o an seçiyoruz
                current_model = genai.GenerativeModel(model_name)
                
                response = current_model.generate_content([
                    prompt,
                    {
                        "mime_type": file.content_type,
                        "data": file_content
                    }
                ])
                extracted_text = response.text
                print(f"✅ BAŞARILI: {model_name} çalıştı!")
                success = True
                break # Biri çalışırsa döngüden çık, diğerlerini deneme.
            except Exception as e:
                print(f"❌ {model_name} başarısız oldu: {e}")
                last_error = str(e)
                continue # Sıradaki modele geç

        if not success:
            # Hiçbiri çalışmazsa hata dön
            return {"status": "error", "message": "Hiçbir model çalışmadı.", "details": last_error}
        
        return {
            "status": "success",
            "ocr_text": extracted_text,
            "image_url": image_url
        }

    except Exception as e:
        return {"status": "error", "message": "Genel hata", "details": str(e)}

# --- ANALİZ FONKSİYONU (Burası da Garantili) ---
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    target_word_count = WORD_COUNTS.get(data.level, 75)
    
    # Burada da garanti olması için 'gemini-pro' kullanıyoruz
    # Ama OCR çalıştıysa zaten sorun yok demektir.
    model = genai.GenerativeModel("gemini-pro") 

    try:
        prompt = f"""
        Sen TÖMER öğretmenisin. Puanla ve hataları bul.
        Öğrenci: {data.student_name}, Seviye: {data.level}, Dil: {data.native_language}.
        Metin: "{data.ocr_text}"
        
        CEVAP (SADECE JSON):
        {{
            "rubric": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }},
            "errors": [ {{ "wrong": "hata", "correct": "doğru", "type": "tür", "explanation": "açıklama" }} ],
            "teacher_note": "Notun."
        }}
        """
        response = model.generate_content(prompt)
        text_response = response.text.replace("```json", "").replace("```", "").strip()
        analysis_result = json.loads(text_response)

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
        print(f"❌ Analiz Hatası: {e}")
        # Hata olsa bile analiz yok diye dönelim, çökmesin
        raise HTTPException(status_code=500, detail=str(e))

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