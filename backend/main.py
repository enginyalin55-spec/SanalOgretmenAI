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

# --- AYARLAR ---
load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
if SUPABASE_URL and not SUPABASE_URL.endswith("/"):
    SUPABASE_URL += "/"
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# --- İSTEMCİLER ---
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

# --- MODELLER (PYDANTIC) ---
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

# --- CEFR KRİTERLERİ ---
CEFR_KRITERLERI = {
    "A1": "Basit cümleler.", "A2": "Bağlaçlar, temel zamanlar.",
    "B1": "Tutarlı metin.", "B2": "Akıcı ve doğru.", "C1": "Kusursuz."
}

# =======================================================
# 🛡️ TDK KURALLARI (ZAMAN UYUMU DAHİL)
# =======================================================
def load_tdk_rules() -> List[Dict[str, Any]]:
    return [
        {"rule_id": "TDK_01_BAGLAC_DE", "title": "Bağlaç Olan 'da/de'nin Yazımı", "text": "Bağlaç olan 'da / de' her zaman ayrı yazılır.", "category": "Bağlaçlar"},
        {"rule_id": "TDK_02_BAGLAC_KI", "title": "Bağlaç Olan 'ki'nin Yazımı", "text": "Bağlaç olan 'ki' ayrı yazılır.", "category": "Bağlaçlar"},
        {"rule_id": "TDK_03_SORU_EKI", "title": "Soru Eki 'mı/mi'nin Yazımı", "text": "Soru eki her zaman ayrı yazılır.", "category": "Ekler"},
        {"rule_id": "TDK_04_SEY_SOZ", "title": "'Şey' Sözcüğünün Yazımı", "text": "'Şey' sözcüğü her zaman ayrı yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_05_BUYUK_CUMLE", "title": "Cümle Başı Büyük Harf", "text": "Cümleler büyük harfle başlar.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_06_BUYUK_OZEL", "title": "Özel İsimlerin Yazımı", "text": "Özel isimler büyük harfle başlar.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_07_BUYUK_KURUM", "title": "Kurum Adları", "text": "Kurum adları büyük harfle başlar.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_08_TARIH_GUN_AY", "title": "Tarihlerin Yazımı", "text": "Ay/gün adları büyük başlar.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_09_KESME_OZEL", "title": "Özel İsimlere Gelen Ekler", "text": "Özel isimlere gelen ekler kesme ile ayrılır.", "category": "Noktalama"},
        {"rule_id": "TDK_10_KESME_KURUM", "title": "Kurum Ekleri", "text": "Kurum ekleri ayrılmaz.", "category": "Noktalama"},
        {"rule_id": "TDK_11_YARDIMCI_FIIL_SES", "title": "Yardımcı Fiiller", "text": "Ses olayı varsa bitişik, yoksa ayrı.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_12_SAYI_AYRI", "title": "Sayıların Yazımı", "text": "Sayılar ayrı yazılır.", "category": "Sayılar"},
        {"rule_id": "TDK_13_ULESTIRME", "title": "Üleştirme Sayıları", "text": "Üleştirme yazıyla yazılır.", "category": "Sayılar"},
        {"rule_id": "TDK_14_KISALTMA_BUYUK", "title": "Kısaltmalar", "text": "Ekler okunuşa göre gelir.", "category": "Kısaltmalar"},
        {"rule_id": "TDK_15_IKILEMELER", "title": "İkilemeler", "text": "İkilemeler ayrı yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_16_PEKISTIRME", "title": "Pekiştirmeler", "text": "Pekiştirmeler bitişik yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_17_YUMUSAK_G", "title": "Yumuşak G", "text": "Kelime ğ ile başlamaz.", "category": "Yazım"},
        {"rule_id": "TDK_18_HER_BIR", "title": "'Her' Kelimesi", "text": "Her bir ayrı yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_19_BELIRSIZLIK_SIFATLARI", "title": "Bitişik Kelimeler", "text": "Biraz, birçok bitişik yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_20_NOKTA", "title": "Nokta", "text": "Cümle sonuna nokta konur.", "category": "Noktalama"},
        {"rule_id": "TDK_21_VIRGUL", "title": "Virgül", "text": "Sıralı kelimelere virgül konur.", "category": "Noktalama"},
        {"rule_id": "TDK_22_DARALMA_KURALI", "title": "Ünlü Daralması", "text": "Gereksiz daralma yapılmaz (Gelcem -> Geleceğim).", "category": "Yazım"},
        {"rule_id": "TDK_23_YANLIS_YALNIZ", "title": "Yanlış/Yalnız", "text": "Yanlış, Yalnız.", "category": "Yazım"},
        {"rule_id": "TDK_24_HERKES", "title": "Herkes", "text": "Herkes 's' ile biter.", "category": "Yazım"},
        {"rule_id": "TDK_25_SERTLESME", "title": "Sertleşme", "text": "Sert ünsüzden sonra sert gelir (kitapta).", "category": "Yazım"},
        {"rule_id": "TDK_26_HANE", "title": "Hane", "text": "Hastane, postane.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_27_ART_ARDA", "title": "Art Arda", "text": "Art arda ayrı yazılır.", "category": "Ayrı/Bitişik Yazım"},
        {"rule_id": "TDK_28_YABANCI_KELIMELER", "title": "Yabancı Kelimeler", "text": "Şoför, egzoz, metot.", "category": "Yazım"},
        {"rule_id": "TDK_29_UNVANLAR", "title": "Unvanlar", "text": "Unvanlar büyük başlar.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_30_YONLER", "title": "Yönler", "text": "Özel isimden önceyse büyük.", "category": "Büyük Harfler"},
        {"rule_id": "TDK_31_ZAMAN_UYUMU", "title": "Zaman ve Kip Uyumu", "text": "Zaman zarfları (yarın, dün) ile yüklem uyumlu olmalıdır (Yarın gitti -> Yarın gidecek).", "category": "Dilbilgisi"}
    ]

# --- YENİ NESİL METİN VE SPAN İŞLEMLERİ (AUTO-FIX) ---
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

def normalize_text(text: str) -> str:
    """Orijinal metni bozmadan temizler."""
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def normalize_match(text: str) -> str:
    """Eşleştirme için (Küçük harf duyarsız + temiz)."""
    return normalize_text(text).casefold()

def _find_best_span(full_text: str, wrong: str, hint_start: int = None):
    """
    wrong ifadesini full_text içinde arar.
    Birden fazla varsa, AI'ın verdiği ipucu konumuna (hint_start) en yakın olanı seçer.
    """
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

    # En yakın eşleşmeyi seç
    if hint_start is None:
        best = matches[0]
    else:
        best = min(matches, key=lambda x: abs(x - hint_start))

    return (best, best + len(w))

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
        if not rid or rid not in allowed_rule_ids: continue

        wrong = err.get("wrong", "") or ""
        correct = err.get("correct", "") or ""

        # 1. Correct boşsa veya Wrong ile aynıysa reddet (AI Halüsinasyonu)
        if normalize_text(correct) == "": continue
        if normalize_match(wrong) == normalize_match(correct):
            print(f"🗑️ Gereksiz düzeltme atıldı: {wrong} -> {correct}")
            continue

        # 2. Span Kontrolü ve ONARIMI
        span = err.get("span")
        hint_start = None
        
        # AI'ın verdiği span'i ipucu olarak al
        if isinstance(span, dict) and "start" in span:
            try: hint_start = int(span["start"])
            except: pass

        # Önce Python ile metinde kelimeyi ARA ve en iyi konumu bul
        fixed = _find_best_span(full_text, wrong, hint_start)
        
        if fixed:
            start, end = fixed
            print(f"✅ Span Onarıldı: '{wrong}' -> {start}-{end}")
        else:
            print(f"⚠️ Metinde bulunamadı: '{wrong}'")
            continue

        # Güvenlik kontrolü
        if start < 0 or end > n: continue

        clean_errors.append({
            "wrong": full_text[start:end], # Metindeki orijinal halini al
            "correct": correct,
            "type": err.get("type", "Yazım"),
            "rule_id": rid,
            "explanation": err.get("explanation", ""),
            "span": {"start": start, "end": end}
        })

    # Çakışma temizliği
    clean_errors.sort(key=lambda x: (x["span"]["start"], -(x["span"]["end"] - x["span"]["start"])))
    final_errors = []
    last_end = -1

    for e in clean_errors:
        if e["span"]["start"] < last_end:
            continue
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
        prompt = "Bu resimdeki metni Türkçe olarak aynen metne dök. Sadece metni ver."
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
    allowed_ids = {r["rule_id"] for r in all_rules}
    rules_text = "\n".join([f"- ID: {r['rule_id']} | {r['title']}: {r['text']}" for r in all_rules])
    cefr_text = CEFR_KRITERLERI.get(data.level, "Genel değerlendirme.")

    prompt = f"""
    GÖREV: Öğrenci metnini analiz et.
    HEDEF: TDK yazım kurallarına ve TEMEL DİLBİLGİSİ (gramer) kurallarına göre hataları bul.
    ÖNEMLİ: Hatalı kelimeyi 'wrong' alanına metindeki haliyle yaz.
    
    TDK KURALLARI:{rules_text}
    SEVİYE ({data.level}): {cefr_text}
    METİN: \"\"\"{data.ocr_text}\"\"\"

    JSON ÇIKTI FORMATI:
    {{
      "rubric": {{ "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 }},
      "errors": [ {{ "wrong": "HatalıKelime", "correct": "Doğrusu", "type": "Yazım", "rule_id": "TDK_...", "explanation": "..." }} ],
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
            
            # BURADA VALIDATE FONKSIYONU DEVREYE GİRİYOR VE KONUMLARI DÜZELTİYOR
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