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
# ⚙️ SİSTEM AYARLARI
# =======================================================
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

# Yedekli Model Listesi (Biri çalışmazsa diğeri devreye girer)
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
# 📚 PEDAGOJİK BİLGİ BANKASI
# =======================================================
CEFR_KRITERLERI = {
    "A1": "Kısa, basit cümleler. Temel ihtiyaç iletişimi.",
    "A2": "Bağlaçlar (ve, ama). Geçmiş/Gelecek zaman temelleri. Günlük konular.",
    "B1": "Tutarlı paragraflar. Deneyim aktarımı. Neden-sonuç ilişkisi.",
    "B2": "Akıcı, detaylı ve teknik anlatım. Soyut konular.",
    "C1": "Akademik ve esnek dil kullanımı. İnce anlam farkları."
}

def load_tdk_rules() -> List[Dict[str, Any]]:
    """TDK Kurallarını Yükler (Frontend'de Hata Kodu Eşleştirmesi İçin Önemli)"""
    return [
        {"rule_id": "TDK_01_BAGLAC_DE", "text": "Bağlaç olan 'da/de' ayrı yazılır."},
        {"rule_id": "TDK_02_BAGLAC_KI", "text": "Bağlaç olan 'ki' ayrı yazılır."},
        {"rule_id": "TDK_03_SORU_EKI", "text": "Soru eki 'mı/mi' ayrı yazılır."},
        {"rule_id": "TDK_04_SEY_SOZ", "text": "'Şey' sözcüğü daima ayrı yazılır."},
        {"rule_id": "TDK_05_BUYUK_CUMLE", "text": "Cümleler büyük harfle başlar."},
        {"rule_id": "TDK_06_BUYUK_OZEL", "text": "Özel isimler (Şehir, Kişi) büyük harfle başlar."},
        {"rule_id": "TDK_07_BUYUK_KURUM", "text": "Kurum adları büyük harfle başlar."},
        {"rule_id": "TDK_09_KESME_OZEL", "text": "Özel isimlere gelen ekler kesme ile ayrılır (Samsun'a)."},
        {"rule_id": "TDK_10_KESME_KURUM", "text": "Kurum adlarına gelen ekler AYRILMAZ (Bakanlığına). NOT: Şehirler kurum değildir!"},
        {"rule_id": "TDK_11_YARDIMCI_FIIL", "text": "Ses olayı varsa bitişik (kaybolmak), yoksa ayrı (terk etmek)."},
        {"rule_id": "TDK_12_SAYILAR", "text": "Sayılar ayrı yazılır (on beş)."},
        {"rule_id": "TDK_20_NOKTA", "text": "Cümle sonuna nokta konur."},
        {"rule_id": "TDK_21_VIRGUL", "text": "Sıralı kelimelere virgül konur."},
        {"rule_id": "TDK_23_YANLIS_YALNIZ", "text": "Yanlış (yanılmak), Yalnız (yalın)."},
        {"rule_id": "TDK_24_HERKES", "text": "Herkes (s ile)."},
        {"rule_id": "TDK_25_SERTLESME", "text": "Sertleşme kuralı (Kitapta, 1923'te)."},
        {"rule_id": "TDK_28_YABANCI", "text": "Yabancı kelimeler (Şoför, egzoz, makine)."}
    ]

# =======================================================
# 🛠️ TEKNİK YARDIMCI FONKSİYONLAR (SPAN FIXER)
# =======================================================
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

def normalize_text(text: str) -> str:
    """Metni temizler, görünmez karakterleri atar."""
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    return re.sub(r"\s+", " ", text).strip()

def normalize_match(text: str) -> str:
    return normalize_text(text).casefold()

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    """Metin içinde hatalı kelimenin en doğru konumunu bulur."""
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
        # Yapay zekanın verdiği konuma en yakın olanı seç
        best = min(matches, key=lambda x: abs(x - hint_start))
        
    return (best, best + len(w))

def validate_analysis(result: Dict[str, Any], full_text: str, allowed_ids: set) -> Dict[str, Any]:
    """YZ çıktısını doğrular, spanları onarır ve halüsinasyonları temizler."""
    if not isinstance(result, dict): return {"errors": []}
    
    raw_errors = result.get("errors", [])
    if not isinstance(raw_errors, list): raw_errors = []

    clean_errors = []
    n = len(full_text)

    for err in raw_errors:
        if not isinstance(err, dict): continue
        rid = err.get("rule_id")
        # Sadece izin verilen TDK kuralları
        if not rid or rid not in allowed_ids: continue

        wrong = err.get("wrong", "")
        correct = err.get("correct", "")

        # Halüsinasyon Kontrolü: Yanlış ve Doğru aynıysa hata değildir.
        if normalize_match(wrong) == normalize_match(correct): continue
        if not wrong or not correct: continue

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

    clean_errors.sort(key=lambda x: x["span"]["start"])
    result["errors"] = clean_errors
    return result

# =======================================================
# 🚀 ENDPOINT: SPLIT-BRAIN ANALİZİ (TDK + CEFR)
# =======================================================

@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    print(f"🧠 Analiz Başlıyor: {data.student_name} - {data.level}")

    # Hazırlık
    tdk_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in tdk_rules}
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])
    cefr_desc = CEFR_KRITERLERI.get(data.level, "Genel Değerlendirme")

    # ---------------------------------------------------------
    # 🤖 AJAN 1: TDK DENETÇİSİ (Teknik & Hata Odaklı)
    # Rolü: Objektif, kuralcı, içerikten bağımsız.
    # Görevi: Sadece Noktalama ve Dil Bilgisi puanlarını verir. Hataları bulur.
    # ---------------------------------------------------------
    prompt_tdk = f"""
    ROL: Sen nesnel ve kuralcı bir TDK denetçisisin. 
    GÖREV: Aşağıdaki metni TDK kurallarına göre tara. Sadece teknik hataları bul.
    
    KURALLAR:
    1. İÇERİĞİ YORUMLAMA: Öğrencinin ne anlattığı senin işin değil.
    2. HALÜSİNASYON GÖRME: Şehir isimleri (Samsun, İstanbul) kurum değildir. "Samsun'da" yazımı DOĞRUDUR.
    3. OCR TEMİZLİĞİ: "Ka-radeniz", "ot-obüs" gibi satır sonu kesilmelerini hata sayma.
    
    METİN: \"\"\"{data.ocr_text}\"\"\"
    
    REFERANS KURALLAR: {rules_text}
    
    ÇIKTI FORMATI (JSON):
    {{
      "rubric_part": {{
        "noktalama": (0-14 puan),
        "dil_bilgisi": (0-16 puan)
      }},
      "errors": [
         {{ "wrong": "HatalıKelime", "correct": "Doğrusu", "rule_id": "TDK_...", "explanation": "..." }}
      ]
    }}
    """

    # ---------------------------------------------------------
    # 👩‍🏫 AJAN 2: CEFR EĞİTMENİ (İçerik & İletişim Odaklı)
    # Rolü: Destekleyici, pedagojik, hatalara takılmayan.
    # Görevi: İçerik, Söz Dizimi, Kelime, Uzunluk puanlarını verir ve yorum yazar.
    # ---------------------------------------------------------
    prompt_cefr = f"""
    ROL: Sen destekleyici ve yapıcı bir öğretmensin.
    GÖREV: {data.level} seviyesindeki öğrencinin metnini İLETİŞİM ve İÇERİK başarısı açısından değerlendir.
    
    KURALLAR:
    1. YAZIM HATALARINI GÖRMEZDEN GEL: Onları teknik denetçi puanladı. Sen sadece "Öğrenci derdini anlatabilmiş mi?" buna bak.
    2. İLETİŞİM ODAĞI: Kelimeler yanlış yazılmış olsa bile, anlamlı bir bütün oluşturuyorsa yüksek puan ver.
    3. SEVİYE YORUMU: Öğretmen notunda, metnin {data.level} seviyesine uygun olup olmadığını belirt.
    
    SEVİYE BEKLENTİSİ ({data.level}): {cefr_desc}
    
    METİN: \"\"\"{data.ocr_text}\"\"\"
    
    ÇIKTI FORMATI (JSON):
    {{
      "rubric_part": {{
        "uzunluk": (0-16 puan - Kelime sayısına ve yoğunluğuna göre),
        "soz_dizimi": (0-20 puan - Cümle yapılarının anlaşılırlığı),
        "kelime": (0-14 puan - Kelime çeşitliliği),
        "icerik": (0-20 puan - Konuyu anlatma başarısı)
      }},
      "teacher_note": "Öğrenciye hitaben (Sen diliyle), motive edici, {data.level} seviyesine uygunluğunu belirten 2-3 cümlelik not."
    }}
    """

    final_result = {}
    last_error = ""

    # Gemini ile 2 Ayrı Çağrı Yapıyoruz (Sıralı)
    # 1. TDK Çağrısı (Teknik Analiz)
    try:
        resp_tdk = client.models.generate_content(
            model="gemini-2.0-flash-exp", 
            contents=prompt_tdk, 
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        json_tdk = json.loads(resp_tdk.text.strip().replace("```json", "").replace("```", ""))
        print("✅ TDK Analizi Tamam")
    except Exception as e:
        print(f"❌ TDK Hatası: {e}")
        # Hata olursa varsayılan boş değerler, sistem çökmez.
        json_tdk = {"rubric_part": {"noktalama": 0, "dil_bilgisi": 0}, "errors": []}

    # 2. CEFR Çağrısı (Pedagojik Analiz)
    try:
        resp_cefr = client.models.generate_content(
            model="gemini-2.0-flash-exp", 
            contents=prompt_cefr, 
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        json_cefr = json.loads(resp_cefr.text.strip().replace("```json", "").replace("```", ""))
        print("✅ CEFR Analizi Tamam")
    except Exception as e:
        print(f"❌ CEFR Hatası: {e}")
        # Hata olursa varsayılan değerler
        json_cefr = {"rubric_part": {"uzunluk": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0}, "teacher_note": "Analiz alınamadı."}

    # ---------------------------------------------------------
    # 🔗 BİRLEŞTİRME VE HESAPLAMA (Finalizing)
    # Frontend'in beklediği tek parça JSON yapısına dönüştür.
    # ---------------------------------------------------------
    
    # 1. Puanları Güvenli Çek ve Sınırla (Clamp) - 0 ile Max Puan arası
    tdk_scores = json_tdk.get("rubric_part", {})
    cefr_scores = json_cefr.get("rubric_part", {})

    final_rubric = {
        "noktalama": min(14, max(0, int(tdk_scores.get("noktalama", 0)))),
        "dil_bilgisi": min(16, max(0, int(tdk_scores.get("dil_bilgisi", 0)))),
        "uzunluk": min(16, max(0, int(cefr_scores.get("uzunluk", 0)))),
        "soz_dizimi": min(20, max(0, int(cefr_scores.get("soz_dizimi", 0)))),
        "kelime": min(14, max(0, int(cefr_scores.get("kelime", 0)))),
        "icerik": min(20, max(0, int(cefr_scores.get("icerik", 0))))
    }

    # 2. Toplam Puan (Yazma Becerisi Puanı)
    # Akademik Not: Bu puan, teknik doğruluk ve iletişim başarısının toplamıdır.
    total_score = sum(final_rubric.values())

    # 3. Hata Temizliği (Sadece TDK hataları geçerli, halüsinasyonlar elenir)
    cleaned_tdk = validate_analysis(json_tdk, data.ocr_text, allowed_ids)

    # 4. Final Yapı
    analysis_result = {
        "rubric": final_rubric,
        "errors": cleaned_tdk.get("errors", []),
        "teacher_note": json_cefr.get("teacher_note", "Tebrikler.")
    }
    
    # Veritabanı için toplam skor
    analysis_result["score_total"] = total_score
    
    print(f"🏆 Final Puan: {total_score}")

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
            "score_total": total_score
        }).execute()
        
        return {"status": "success", "data": analysis_result}
    except Exception as e:
        print(f"DB Kayıt Hatası: {e}")
        return {"status": "success", "data": analysis_result, "warning": "DB Hatası"}

# --- DİĞER ENDPOINTLER (STANDART) ---
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
        prompt = "Bu resimdeki el yazısı metni Türkçe olarak aynen dijital metne çevir. Sadece metni ver, yorum yapma."
        
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