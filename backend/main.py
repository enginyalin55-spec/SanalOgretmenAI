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

app = FastAPI(title="Sanal Ogretmen AI API", version="3.2.0 (Standardized Rules)")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODELS_TO_TRY = ["gemini-2.0-flash", "gemini-1.5-flash"]
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
# 4) TEXT UTILS & TDK STANDARDS
# =======================================================
def normalize_text(text: str) -> str:
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'").replace("“", '"').replace("”", '"')
    return unicodedata.normalize("NFKC", text).strip()

def _find_span_simple(full_text: str, wrong: str):
    if not wrong: return None
    ft_lower = full_text.lower()
    wr_lower = wrong.lower()
    idx = ft_lower.find(wr_lower)
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

# --- STANDARTLAŞTIRILMIŞ TDK KURALLARI KATALOĞU ---
def load_tdk_rules() -> List[Dict[str, Any]]:
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
        {"rule_id": "TDK_13_GUN_AY_BUYUK", "text": "Ay ve gün adları belirli tarih yoksa küçük yazılır."},

        # C) KESME İŞARETİ
        {"rule_id": "TDK_20_KESME_OZEL_AD", "text": "Özel isimlere gelen ekler kesme ile ayrılır."},
        {"rule_id": "TDK_21_KESME_KURUM", "text": "Kurum ekleri kesme ile ayrılır (Okul seviyesi için)."},
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
        {"rule_id": "TDK_50_SAYI_YAZIMI", "text": "Sayıların yazımı (yazı/rakam kuralı)."},
        {"rule_id": "TDK_51_SAYI_BIRIM", "text": "Sayı ile birim arasında boşluk bırakılır."}
    ]

# =======================================================
# 5) ENDPOINTS
# =======================================================
@app.get("/")
def health_check():
    return {"status": "ok"}

# --- OCR Endpoint (Aynen Korundu) ---
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

        vision_client = vision.ImageAnnotatorClient()
        image = vision.Image(content=file_content)
        context = vision.ImageContext(language_hints=["tr"])
        response = vision_client.document_text_detection(image=image, image_context=context)
        
        full_text = response.full_text_annotation.text or ""
        
        return {"status": "success", "ocr_text": full_text, "image_url": image_url}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- ANALİZ (GÜNCELLENMİŞ VERSİYON: 2 AŞAMALI, STANDART TDK & CEFR) ---
@app.post("/analyze")
async def analyze_submission(data: AnalyzeRequest):
    if not data.ocr_text or not data.ocr_text.strip():
        raise HTTPException(status_code=400, detail="Metin boş, analiz yapılamaz.")
    
    if "⍰" in data.ocr_text:
        raise HTTPException(
            status_code=400, 
            detail="OCR belirsiz (⍰) işaretli yerler var. Lütfen önce bu kısımları düzeltin."
        )
    
    full_text = normalize_text(data.ocr_text)
    display_text = full_text.replace("\n", " ")

    print(f"🧠 Analiz: {data.student_name} ({data.level})")

    # 1. AŞAMA: TDK KURAL KATALOĞU
    tdk_rules = load_tdk_rules()
    rules_text = "\n".join([f"- {r['rule_id']}: {r['text']}" for r in tdk_rules])

    prompt_tdk = f"""
    ROL: Sen nesnel bir TDK denetçisisin.
    GÖREV: Metindeki yazım hatalarını SADECE aşağıdaki kural setine göre bul.
    
    REFERANS KURALLAR:
    {rules_text}

    METİN: \"\"\"{display_text}\"\"\"

    ÇIKTI (SADECE JSON):
    {{ "errors": [ {{ "wrong": "...", "correct": "...", "rule_id": "...", "explanation": "..." }} ] }}
    """

    # 2. AŞAMA: CEFR PUANLAMA (Seviyeye Özel Rubric)
    # Seviyeye göre beklentiyi dinamikleştiriyoruz
    level_expectations = ""
    if data.level == "A1":
        level_expectations = """
        - Uzunluk (16): 2-4 basit cümle yeterli. Çok kısa ise puan düşer.
        - Söz Dizimi (20): Özne+Yüklem basit yapılar.
        - Kelime (14): Temel kelimeler (ben, sen, gitmek, var/yok).
        - İçerik (20): 1-2 temel bilgi aktarımı varsa tam puan.
        """
    elif data.level == "A2":
        level_expectations = """
        - Uzunluk (16): 4-6 cümle, basit paragraf hissi.
        - Söz Dizimi (20): ve/ama/çünkü bağlaçları ile bağlı cümleler.
        - Kelime (14): Günlük hayat kelimeleri. Aynı kelime tekrarı az olmalı.
        - İçerik (20): İstek/plan anlatımı, basit sıralama.
        """
    elif data.level == "B1":
        level_expectations = """
        - Uzunluk (16): 8-12 cümle, 2 kısa paragraf.
        - Söz Dizimi (20): Neden-sonuç, karşılaştırma.
        - Kelime (14): Çeşitlilik artmalı, eş anlamlılar kullanılmalı.
        - İçerik (20): Giriş-gelişme-sonuç bütünlüğü.
        """
    elif data.level == "B2":
        level_expectations = """
        - Uzunluk (16): 2-3 paragraf, gelişmiş anlatım.
        - Söz Dizimi (20): Karmaşık cümleler, yan cümleler, bağ-fiiller.
        - Kelime (14): Soyut kelimeler, görüş bildirme.
        - İçerik (20): Fikir geliştirme, argüman sunma.
        """
    else: # C1 ve üstü
        level_expectations = """
        - Uzunluk (16): Derinlikli, yoğun metin.
        - Söz Dizimi (20): Akıcı, retorik olarak etkili, devrik cümle kontrolü.
        - Kelime (14): Zengin, yerinde ve doğal seçim.
        - İçerik (20): İkna edici, tutarlı perspektif.
        """

    prompt_rubric = f"""
    ROL: Sen {data.level} seviyesindeki bir öğrenciyi değerlendiren öğretmensin.
    GÖREV: Aşağıdaki metni puanla. Puanları kırma konusunda seviyeye uygun davran.
    
    METİN: \"\"\"{display_text}\"\"\"

    SEVİYE BEKLENTİLERİ ({data.level}):
    {level_expectations}

    PUANLAMA KRİTERLERİ (TOPLAM 100):
    1. UZUNLUK (0-16): Metin uzunluğu ve yoğunluğu seviyeye uygun mu?
    2. NOKTALAMA (0-14): Temel işaretler (nokta, virgül, büyük harf) doğru mu?
    3. DİL BİLGİSİ (0-16): Ekler ve zaman uyumu seviyeye uygun mu?
    4. SÖZ DİZİMİ (0-20): Cümle yapıları ve akış düzgün mü?
    5. KELİME (0-14): Kelime seçimi doğru ve çeşitli mi?
    6. İÇERİK (0-20): Anlatılmak istenen net mi, konu bütünlüğü var mı?

    ÇIKTI (SADECE JSON):
    {{
      "rubric_part": {{
        "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0,
        "soz_dizimi": 0, "kelime": 0, "icerik": 0
      }},
      "teacher_note": "Öğrenciye hitaben motive edici kısa not."
    }}
    """

    final_result = None
    last_error = ""

    for model_name in MODELS_TO_TRY:
        try:
            # 1. TDK İsteği
            resp_tdk = client.models.generate_content(
                model=model_name, contents=prompt_tdk,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0)
            )
            json_tdk = json.loads(resp_tdk.text.strip().replace("```json", "").replace("```", "")) if resp_tdk.text else {}

            # 2. Rubric İsteği
            resp_rubric = client.models.generate_content(
                model=model_name, contents=prompt_rubric,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.1)
            )
            json_rubric = json.loads(resp_rubric.text.strip().replace("```json", "").replace("```", "")) if resp_rubric.text else {}

            # Puanları Birleştir (Güvenlik için int dönüşümü)
            p = json_rubric.get("rubric_part", {})
            
            # Puan hesaplarken min/max sınırları ile güvenli matematik
            def safe_score(val, max_val):
                try: return min(max_val, max(0, int(val)))
                except: return 0

            combined_rubric = {
                "uzunluk": safe_score(p.get("uzunluk"), 16),
                "noktalama": safe_score(p.get("noktalama"), 14),
                "dil_bilgisi": safe_score(p.get("dil_bilgisi"), 16),
                "soz_dizimi": safe_score(p.get("soz_dizimi"), 20),
                "kelime": safe_score(p.get("kelime"), 14),
                "icerik": safe_score(p.get("icerik"), 20),
            }
            total_score = sum(combined_rubric.values())

            # Hata İşleme ve Konum Bulma (Span)
            errors_student = []
            raw_errors = json_tdk.get("errors", [])
            
            for e in raw_errors:
                span = _find_span_simple(full_text, e.get("wrong", ""))
                if span:
                    e["span"] = span
                    errors_student.append(e)
            
            errors_student.sort(key=lambda x: x["span"]["start"])

            raw_note = (json_rubric.get("teacher_note") or "").strip()
            if not raw_note: raw_note = f"[SEVİYE: {data.level}] Değerlendirme tamamlandı."

            final_result = {
                "rubric": combined_rubric,
                "errors": errors_student,
                "teacher_note": raw_note,
                "score_total": total_score
            }
            break
        except Exception as e:
            last_error = str(e)
            continue

    if not final_result:
        raise HTTPException(status_code=500, detail=f"Analiz başarısız: {last_error}")

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
    try:
        res = supabase.table("submissions").select("analysis_json").eq("id", data.submission_id).execute()
        if not res.data: raise HTTPException(status_code=404, detail="Kayıt yok")
        
        curr = res.data[0]["analysis_json"]
        if "rubric" not in curr: curr["rubric"] = {}
        curr["rubric"].update(data.new_rubric)
        
        supabase.table("submissions").update({
            "score_total": data.new_total,
            "analysis_json": curr
        }).eq("id", data.submission_id).execute()
        
        return {"status": "success", "message": "Güncellendi"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))