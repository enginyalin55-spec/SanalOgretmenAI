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
model = genai.GenerativeModel(model_name="gemini-1.5-flash")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- TÖMER STANDARTLARI (Kelime Hedefleri) ---
WORD_COUNTS = {
    "A1": 75,
    "A2": 100,
    "B1": 125,
    "B2": 150,
    "C1": 175,
    "C2": 200 
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

# 1. SINIF KONTROL
@app.get("/check-class/{code}")
async def check_class_code(code: str):
    try:
        response = supabase.table("classrooms").select("name").eq("code", code.upper().strip()).execute()
        if response.data: return {"valid": True, "class_name": response.data[0]['name']}
        return {"valid": False}
    except: return {"valid": False}

# 2. OCR (GÜÇLENDİRİLMİŞ - DENGELİ OKUMA)
# Senin beğendiğin o kod bloğu BURADA 👇
@app.post("/ocr")
async def ocr_image(file: UploadFile = File(...), classroom_code: str = Form(...)):
    try:
        # 1. Dosyayı Okuyoruz
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        unique_filename = f"{classroom_code}_{uuid.uuid4()}.{file_ext}"
        
        # 2. Supabase'e (Depoya) Yüklüyoruz (Yedek olsun diye)
        image_url = ""
        try:
            supabase.storage.from_("odevler").upload(unique_filename, file_content, {"content-type": file.content_type})
            public_url_response = supabase.storage.from_("odevler").get_public_url(unique_filename)
            # Supabase bazen string bazen obje döner, garantileyelim:
            image_url = public_url_response if isinstance(public_url_response, str) else public_url_response.get("publicUrl")
        except Exception as e:
            print(f"Resim Depolama Hatası (Önemsiz): {e}")

        # 3. GEMINI OCR (Asıl Beyin Burası) 🧠
        # Resmi Gemini'ye direkt veriyoruz, o bize metni verecek.
        prompt = "Bu resimdeki metni, el yazısı olsa bile Türkçe olarak aynen metne dök. Sadece metni ver, yorum yapma."
        
        response = model.generate_content([
            prompt,
            {
                "mime_type": file.content_type,
                "data": file_content
            }
        ])
        
        extracted_text = response.text
        print(f"Okunan Metin: {extracted_text[:50]}...") # Loglarda başını görelim

        # 4. Sonucu Uygulamaya Dönüyoruz
        return {
            "text": extracted_text,
            "url": image_url
        }

    except Exception as e:
        print(f"OCR Kritis Hatası: {str(e)}")
        # Uygulama çökmesin diye hatayı düzgün formatta dönüyoruz
        return {"error": str(e), "text": "Metin okunamadı, lütfen tekrar deneyin."}

        prompt = """
        Bu resimdeki el yazısını dijital metne dök.
        
        ÖNEMLİ BAĞLAM:
        Bu metin, Türkçe öğrenen yabancı bir öğrenci tarafından yazılmıştır.
        
        TALİMATLAR:
        1. DEŞİFRE ET (Decoding): Yazı kareli kağıtta ve silik olabilir. Harfler okunaksızsa, bunun bir "Türkçe Metin" olduğunu düşünerek en mantıklı kelimeyi bul. (Örneğin: "reaguletu" gibi anlamsız şeyler yazma, bağlama bakarak "küçüktü" veya "güzeldi" olduğunu anla).
        
        2. HATALARI KORU (Sadık Kal): Ancak, öğrenci net bir şekilde yanlış harf yazmışsa onu DÜZELTME.
            - Öğrenci "Otelda" yazmışsa -> "Otelda" olarak bırak. ("Otelde" yapma).
            - Öğrenci "gitdik" yazmışsa -> "gitdik" olarak bırak.
            - Öğrenci "gidiyom" yazmışsa -> "gidiyom" olarak bırak.

        3. TEMİZLİK:
            - Öğretmenin kırmızı kalemle yaptığı düzeltmeleri ve çizikleri GÖRMEZDEN GEL.
            - Sadece öğrencinin kurşun kalemle yazdığı metni aktar.

        Sadece metni ver.
        """
        
        response = model.generate_content([{'mime_type': file.content_type, 'data': file_content}, prompt])
        
        return {"status": "success", "ocr_text": response.text.strip(), "image_url": public_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 3. ANALİZ (GRAMER POLİSİ + MATEMATİK DÜZELTMELİ)
# Yeni sert Puanlama sistemi BURADA 👇
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    print(f"🧠 Analiz: {data.student_name} - Seviye: {data.level}")
    
    target_word_count = WORD_COUNTS.get(data.level, 75) 

    try:
        prompt = f"""
        Sen TÖMER'de görevli çok titiz bir Türkçe öğretmenisin.
        Görevin öğrenci yazısını hem puanlamak hem de EN KÜÇÜK HATALARI bile tespit etmektir.

        ÖĞRENCİ BİLGİLERİ:
        - Ad: {data.student_name}
        - Seviye: {data.level} (Hedef: {target_word_count} kelime)
        - Ana Dil: {data.native_language}
        
        METİN:
        "{data.ocr_text}"

        GÖREV 1: PUANLAMA (Aşağıdaki 6 Kriteri Kullan):
        
        1. UZUNLUK (Max 16 Puan): Kelime sayısı hedefe yakın mı?
        2. NOKTALAMA VE YAZIM (Max 14 Puan): Büyük harf, nokta, virgül hataları var mı?
        3. DİL BİLGİSİ (Max 16 Puan): Ekler doğru mu? Zaman çekimleri doğru mu?
        4. SÖZ DİZİMİ (Syntax) (Max 20 Puan): Özne-Yüklem sırası doğru mu?
        5. KELİME BİLGİSİ (Max 14 Puan): Kelimeler bağlama uygun mu?
        6. İÇERİK (Max 20 Puan): Konu bütünlüğü var mı?

        GÖREV 2: HATA TESPİTİ (BURASI ÇOK ÖNEMLİ!):
        Aşağıdaki hataları affetme ve "errors" listesine ekle:
        1. BÜYÜK/KÜÇÜK HARF: Özel isimler (Mekke, İstanbul, Ahmet) küçük yazılmışsa HATA. Cümle başı küçükse HATA. Cümle ortasında gereksiz büyük harf (Kaldık gibi) varsa HATA.
        2. NOKTALAMA: "Mekke'ye" yerine "Mekkeye" veya "mekkeye" yazılmışsa (kesme işareti yoksa) HATA. Cümle sonu nokta yoksa HATA.
        3. EK YANLIŞLARI: "Otelda" -> HATA. "Gittik" yerine "gitdik" -> HATA.
        4. YAZIM YANLIŞI: "Yanlız" -> HATA. "Gidiyom" -> HATA.

        CEVAP FORMATI (SADECE JSON):
        {{
            "score_total": 0, 
            "rubric": {{
                "uzunluk": 0,
                "noktalama": 0,
                "dil_bilgisi": 0,
                "soz_dizimi": 0,
                "kelime": 0,
                "icerik": 0
            }},
            "errors": [
                {{ "wrong": "mekkede", "correct": "Mekke'de", "type": "Yazım Kuralı", "explanation": "Özel isimler büyük başlar ve ekler kesme işaretiyle ayrılır." }}
            ],
            "teacher_note": "Öğrenciye ({data.student_name}) hitaben, motive edici Türkçe not."
        }}
        """

        response = model.generate_content(prompt)
        text_response = response.text.replace("```json", "").replace("```", "").strip()
        analysis_result = json.loads(text_response)

        # --- MATEMATİK GARANTİSİ ---
        rubric = analysis_result.get("rubric", {})
        calculated_total = (
            rubric.get("uzunluk", 0) +
            rubric.get("noktalama", 0) +
            rubric.get("dil_bilgisi", 0) +
            rubric.get("soz_dizimi", 0) +
            rubric.get("kelime", 0) +
            rubric.get("icerik", 0)
        )
        analysis_result["score_total"] = calculated_total

        submission_data = {
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
        }
        supabase.table("submissions").insert(submission_data).execute()
        
        return {"status": "success", "data": analysis_result}

    except Exception as e:
        print(f"❌ Hata: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 4. GEÇMİŞ
@app.post("/student-history")
async def get_student_history(student_name: str = Form(...), student_surname: str = Form(...), classroom_code: str = Form(...)):
    try:
        response = supabase.table("submissions").select("*").eq("student_name", student_name).eq("student_surname", student_surname).eq("classroom_code", classroom_code).order("created_at", desc=True).execute()
        return {"status": "success", "data": response.data}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# 5. PUAN GÜNCELLEME (Editör Modu İçin)
@app.post("/update-score")
async def update_score(data: UpdateScoreRequest):
    print(f"📥 Güncelleme İsteği: ID={data.submission_id}, Puan={data.new_total}")
    try:
        response = supabase.table("submissions").update({
            "score_total": data.new_total,
            "analysis_json": data.new_rubric
        }).eq("id", data.submission_id).execute()
        
        return {"status": "success", "message": "Puan güncellendi"}
    except Exception as e:
        print(f"❌ Güncelleme Hatası: {e}")
        raise HTTPException(status_code=500, detail=str(e))