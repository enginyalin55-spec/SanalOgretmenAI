from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from supabase import create_client, Client
from dotenv import load_dotenv
import os
import json
import uuid
import re
from pydantic import BaseModel
from typing import Union, List, Dict, Any

# =======================================================
# ⚙️ AYARLAR VE KURULUMLAR
# =======================================================
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.endswith("/"):
    SUPABASE_URL += "/"
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# İstemciler
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

# =======================================================
# 📝 VERİ MODELLERİ
# =======================================================
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

# =======================================================
# 📚 BİLGİ BANKASI (CEFR & TDK)
# =======================================================
CEFR_KRITERLERI = {
    "A1": "Basit, kısa cümleler ve temel kelimeler. İletişim kurmaya odaklı.",
    "A2": "Bağlaçlar (ve, ama, çünkü) kullanımı. Geçmiş ve gelecek zamanın temel kullanımı.",
    "B1": "Tutarlı paragraflar, deneyim aktarımı, neden-sonuç ilişkileri.",
    "B2": "Akıcı, detaylı ve teknik konularda net anlatım.",
    "C1": "Akademik, esnek ve kusursuz dil kullanımı."
}

def load_tdk_rules() -> List[Dict[str, Any]]:
    return [
        {"rule_id": "TDK_01_BAGLAC_DE", "text": "Bağlaç olan 'da/de' ayrı yazılır. (Örn: Evde (bulunma) bitişik, Sen de (bağlaç) ayrı)."},
        {"rule_id": "TDK_02_BAGLAC_KI", "text": "Bağlaç olan 'ki' ayrı yazılır. (Örn: Duydum ki unutmuşsun)."},
        {"rule_id": "TDK_03_SORU_EKI", "text": "Soru eki 'mı/mi' her zaman ayrı yazılır."},
        {"rule_id": "TDK_04_SEY_SOZ", "text": "'Şey' sözcüğü daima ayrı yazılır (Her şey, bir şey)."},
        {"rule_id": "TDK_05_BUYUK_CUMLE", "text": "Cümleler büyük harfle başlar."},
        {"rule_id": "TDK_06_BUYUK_OZEL", "text": "Özel isimler (Şehir, Kişi, Ülke) büyük harfle başlar."},
        {"rule_id": "TDK_07_BUYUK_KURUM", "text": "Kurum adları büyük harfle başlar."},
        {"rule_id": "TDK_09_KESME_OZEL", "text": "Özel isimlere gelen ekler kesme işaretiyle ayrılır (Ahmet'in, Samsun'a)."},
        {"rule_id": "TDK_10_KESME_KURUM", "text": "Kurum adlarına gelen ekler kesmeyle AYRILMAZ (Bakanlığına). NOT: Şehir adları kurum değildir, ayrılır!"},
        {"rule_id": "TDK_11_YARDIMCI_FIIL", "text": "Ses düşmesi/türemesi varsa bitişik (kaybolmak), yoksa ayrı (terk etmek)."},
        {"rule_id": "TDK_12_SAYILAR", "text": "Birden fazla kelimeli sayılar ayrı yazılır (on beş)."},
        {"rule_id": "TDK_20_NOKTA", "text": "Tamamlanmış cümlenin sonuna nokta konur."},
        {"rule_id": "TDK_21_VIRGUL", "text": "Eş görevli kelimeler arasına virgül konur."},
        {"rule_id": "TDK_23_YANLIS_YALNIZ", "text": "Doğrusu: Yanlış (yanılmaktan), Yalnız (yalından)."},
        {"rule_id": "TDK_24_HERKES", "text": "Herkes 's' ile biter, 'z' ile değil."},
        {"rule_id": "TDK_25_SERTLESME", "text": "Sert ünsüzden sonra sert gelir (Dolap-da değil Dolap-ta)."},
        {"rule_id": "TDK_28_YABANCI", "text": "Sık yapılan yanlışlar: Şoför, egzoz, makine, meyve, herhâlde."}
    ]

# =======================================================
# 🛠️ YARDIMCI FONKSİYONLAR (SPAN FIXER)
# =======================================================
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    return re.sub(r"\s+", " ", text).strip()

def normalize_match(text: str) -> str:
    return normalize_text(text).casefold()

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    w = normalize_match(wrong)
    t = normalize_match(full_text)
    if not w: return None

    matches = []
    start_idx = 0
    while True:
        idx = t.find(w, start_idx)
        if idx == -1: break
        matches.append(idx)
        start_idx = idx + 1

    if not matches: return None
    
    if hint_start is None:
        best = matches[0]
    else:
        best = min(matches, key=lambda x: abs(x - hint_start))
        
    return (best, best + len(w))

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_ids: set) -> Dict[str, Any]:
    # Frontend uyumluluğu için boş yapı
    if not isinstance(result, dict):
        return {"rubric": {}, "errors": [], "teacher_note": "Analiz alınamadı."}

    raw_errors = result.get("errors", [])
    if not isinstance(raw_errors, list): raw_errors = []

    clean_errors = []
    n = len(full_text)

    for err in raw_errors:
        if not isinstance(err, dict): continue
        
        # Sadece izin verilen TDK kuralları
        rid = err.get("rule_id")
        if not rid or rid not in allowed_ids: continue

        wrong = err.get("wrong", "")
        correct = err.get("correct", "")

        # Halüsinasyon Kontrolü
        if normalize_match(wrong) == normalize_match(correct): continue
        if not wrong or not correct: continue

        # Span Hesaplama
        hint = err.get("span", {}).get("start") if isinstance(err.get("span"), dict) else None
        fixed = _find_best_span(full_text, wrong, hint)

        if fixed:
            start, end = fixed
            clean_errors.append({
                "wrong": full_text[start:end],
                "correct": correct,
                "type": "Yazım",
                "rule_id": rid,
                "explanation": err.get("explanation", ""),
                "span": {"start": start, "end": end}
            })

    # Sıralama ve Temizleme
    clean_errors.sort(key=lambda x: x["span"]["start"])
    result["errors"] = clean_errors
    return result

# =======================================================
# 🚀 ENDPOINTS
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
        file_content = await file.read()
        file_ext = file.filename.split(".")[-1]
        unique_filename = f"{classroom_code}_{uuid.uuid4()}.{file_ext}"
        image_url = ""
        
        # Supabase Upload
        try:
            supabase.storage.from_("odevler").upload(unique_filename, file_content, {"content-type": file.content_type})
            res = supabase.storage.from_("odevler").get_public_url(unique_filename)
            image_url = res if isinstance(res, str) else res.get("publicUrl")
        except: pass

        extracted_text = ""
        prompt = "Bu resimdeki el yazısı metni Türkçe olarak aynen dijital metne çevir. Sadece metni ver, yorum yapma."
        
        for model_name in MODELS_TO_TRY:
            try:
                response = client.models.generate_content(
                    model=model_name, 
                    contents=[prompt, types.Part.from_bytes(data=file_content, mime_type=file.content_type)]
                )
                extracted_text = (response.text or "").strip()
                if extracted_text: break
            except: continue
        
        if not extracted_text: return {"status": "error", "message": "OCR Başarısız"}
        return {"status": "success", "ocr_text": extracted_text, "image_url": image_url}
    except Exception as e: return {"status": "error", "message": str(e)}

@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    print(f"🧠 Analiz: {data.student_name} ({data.level}) - Split Modu")

    # Hazırlık
    tdk_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in tdk_rules}
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])
    cefr_desc = CEFR_KRITERLERI.get(data.level, "Genel")

    # ----------------------------------------
    # 1. ADIM: TDK ANALİZİ (Teknik & Hata)
    # ----------------------------------------
    prompt_tdk = f"""
    ROL: Sen acımasız ve titiz bir TDK denetçisisin.
    GÖREV: Metindeki yazım, noktalama ve gramer hatalarını bul.
    
    ⛔ YASAKLAR:
    - İçeriğe, anlama veya öğrenci seviyesine YORUM YAPMA.
    - Şehir isimlerini (Samsun, İstanbul) kurum sanma. "Samsun'da" doğrudur.
    - Satır sonu kesilmelerini (Ka-radeniz) hata sayma. Birleştir oku.
    
    METİN: \"\"\"{data.ocr_text}\"\"\"
    
    KURALLAR: {rules_text}
    
    ÇIKTI (JSON):
    {{
      "rubric": {{
        "uzunluk": (0-16 puan),
        "noktalama": (0-14 puan),
        "dil_bilgisi": (0-16 puan),
        "soz_dizimi": (0-20 puan),
        "kelime": (0-14 puan)
      }},
      "errors": [
         {{ "wrong": "...", "correct": "...", "rule_id": "...", "explanation": "..." }}
      ]
    }}
    """

    # ----------------------------------------
    # 2. ADIM: CEFR ANALİZİ (İçerik & Yorum)
    # ----------------------------------------
    prompt_cefr = f"""
    ROL: Sen yapıcı ve motive edici bir öğretmensin.
    GÖREV: Öğrencinin ({data.level} seviyesi) yazdığı metni İÇERİK ve İLETİŞİM başarısı açısından değerlendir.
    
    ⛔ DİKKAT:
    - Yazım hatalarını görmezden gel (onu başkası puanladı).
    - Sadece öğrencinin derdini anlatıp anlatamadığına bak.
    
    METİN: \"\"\"{data.ocr_text}\"\"\"
    
    SEVİYE BEKLENTİSİ: {cefr_desc}
    
    ÇIKTI (JSON):
    {{
      "rubric_content_score": (0-20 puan),
      "teacher_note": "Öğrenciye hitaben (Sen diliyle), motive edici, {data.level} seviyesine uygun, hataları değil yapılan iyi şeyleri vurgulayan 2-3 cümlelik not."
    }}
    """

    analysis_result = {}
    last_error = ""

    # Gemini Çağrıları (Sıralı)
    for model_name in MODELS_TO_TRY:
        try:
            # 1. TDK ÇAĞRISI
            resp_tdk = client.models.generate_content(
                model=model_name, contents=prompt_tdk, 
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            json_tdk = json.loads(resp_tdk.text.strip().replace("```json", "").replace("```", ""))
            
            # 2. CEFR ÇAĞRISI
            resp_cefr = client.models.generate_content(
                model=model_name, contents=prompt_cefr, 
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            json_cefr = json.loads(resp_cefr.text.strip().replace("```json", "").replace("```", ""))

            # 3. BİRLEŞTİRME (Frontend'in beklediği yapıya dönüştür)
            
            # Validasyon (Span düzeltme)
            clean_tdk = validate_analysis(json_tdk, data.ocr_text, allowed_ids)
            
            # Rubric Birleştirme
            final_rubric = clean_tdk.get("rubric", {})
            # Eksik alanları tamamla (güvenlik için)
            for k in ["uzunluk", "noktalama", "dil_bilgisi", "soz_dizimi", "kelime"]:
                if k not in final_rubric: final_rubric[k] = 0
            
            # İçerik puanını CEFR'den al
            final_rubric["icerik"] = json_cefr.get("rubric_content_score", 10) # Varsayılan 10
            
            # Toplam Puan
            total_score = sum(final_rubric.values())

            # Final Obje
            analysis_result = {
                "rubric": final_rubric,
                "errors": clean_tdk.get("errors", []),
                "teacher_note": json_cefr.get("teacher_note", "Tebrikler.")
            }
            
            # Kayıt için hazırlık
            analysis_result["score_total"] = total_score
            
            print(f"✅ Analiz Tamam: {model_name} | Puan: {total_score}")
            break

        except Exception as e:
            print(f"⚠️ Model Hatası ({model_name}): {e}")
            last_error = str(e)
            continue

    if not analysis_result:
        raise HTTPException(status_code=500, detail=f"Analiz başarısız: {last_error}")

    # Veritabanına Kayıt
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
            "analysis_json": analysis_result, 
            "score_total": analysis_result["score_total"]
        }).execute()
        
        return {"status": "success", "data": analysis_result}
    except Exception as e:
        print(f"DB Hatası: {e}")
        return {"status": "success", "data": analysis_result, "warning": "DB kayıt hatası"}

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