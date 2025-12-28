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
WORD_COUNTS = {"A1": 75, "A2": 100, "B1": 125, "B2": 150, "C1": 175, "C2": 200}

# =======================================================
# 🛡️ TDK KURALLARI (KOD İÇİNE GÖMÜLÜ)
# =======================================================
def load_tdk_rules() -> List[Dict[str, Any]]:
    return [
        {
            "rule_id": "TDK_01_BAGLAC_DE",
            "title": "Bağlaç Olan 'da/de'nin Yazımı",
            "text": "Bağlaç olan 'da / de' her zaman ayrı yazılır. Cümleden çıkarılınca anlam bozulmaz.",
            "category": "Bağlaçlar"
        },
        {
            "rule_id": "TDK_02_BAGLAC_KI",
            "title": "Bağlaç Olan 'ki'nin Yazımı",
            "text": "Bağlaç olan 'ki' ayrı yazılır. (İstisnalar: sanki, oysaki, mademki, belki, halbuki, çünkü, meğerki, illaki).",
            "category": "Bağlaçlar"
        },
        {
            "rule_id": "TDK_03_SORU_EKI",
            "title": "Soru Eki 'mı/mi'nin Yazımı",
            "text": "Soru eki olan 'mı, mi, mu, mü' her zaman ayrı yazılır.",
            "category": "Ekler"
        },
        {
            "rule_id": "TDK_04_SEY_SOZ",
            "title": "'Şey' Sözcüğünün Yazımı",
            "text": "'Şey' sözcüğü her zaman ayrı yazılır (her şey, bir şey, çok şey).",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_05_BUYUK_CUMLE",
            "title": "Cümle Başı Büyük Harf",
            "text": "Cümleler her zaman büyük harfle başlar.",
            "category": "Büyük Harfler"
        },
        {
            "rule_id": "TDK_06_BUYUK_OZEL",
            "title": "Özel İsimlerin Yazımı",
            "text": "Kişi, ülke, şehir, dil ve millet adları büyük harfle başlar (Ahmet, Ankara, Türkçe).",
            "category": "Büyük Harfler"
        },
        {
            "rule_id": "TDK_07_BUYUK_KURUM",
            "title": "Kurum ve Kuruluş Adları",
            "text": "Kurum adlarının her kelimesi büyük harfle başlar (Türk Dil Kurumu).",
            "category": "Büyük Harfler"
        },
        {
            "rule_id": "TDK_08_TARIH_GUN_AY",
            "title": "Belirli Tarihlerin Yazımı",
            "text": "Tam tarih bildiren ay ve gün adları büyük harfle başlar (29 Mayıs 1453 Salı).",
            "category": "Büyük Harfler"
        },
        {
            "rule_id": "TDK_09_KESME_OZEL",
            "title": "Özel İsimlere Gelen Ekler",
            "text": "Özel isimlere gelen çekim ekleri kesme işareti (') ile ayrılır (Ayşe'nin).",
            "category": "Noktalama"
        },
        {
            "rule_id": "TDK_10_KESME_KURUM",
            "title": "Kurum Adlarına Gelen Ekler",
            "text": "Kurum ve kuruluş adlarına gelen ekler kesmeyle ayrılmaz (Bakanlığına).",
            "category": "Noktalama"
        },
        {
            "rule_id": "TDK_11_YARDIMCI_FIIL_SES",
            "title": "Yardımcı Fiillerde Ses Olayı",
            "text": "Ses düşmesi/türemesi varsa bitişik (kaybolmak), yoksa ayrı (terk etmek) yazılır.",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_12_SAYI_AYRI",
            "title": "Sayıların Yazımı",
            "text": "Birden fazla kelimeden oluşan sayılar ayrı yazılır (on beş, yüz elli).",
            "category": "Sayılar"
        },
        {
            "rule_id": "TDK_13_ULESTIRME",
            "title": "Üleştirme Sayıları",
            "text": "Üleştirme sayıları rakamla değil yazıyla yazılır (5'er değil beşer).",
            "category": "Sayılar"
        },
        {
            "rule_id": "TDK_14_KISALTMA_BUYUK",
            "title": "Büyük Harfli Kısaltmalar",
            "text": "Büyük harfli kısaltmalara gelen ekler, son harfin okunuşuna göre gelir (TDK'dan değil TDK'den).",
            "category": "Kısaltmalar"
        },
        {
            "rule_id": "TDK_15_IKILEMELER",
            "title": "İkilemelerin Yazımı",
            "text": "İkilemeler ayrı yazılır ve araya noktalama konmaz (yavaş yavaş).",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_16_PEKISTIRME",
            "title": "Pekiştirmelerin Yazımı",
            "text": "Pekiştirmeli sıfatlar bitişik yazılır (masmavi, tertemiz).",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_17_YUMUSAK_G",
            "title": "Yumuşak G Başlangıcı",
            "text": "Türkçede kelimeler 'ğ' ile başlamaz.",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_18_HER_BIR",
            "title": "'Her' Kelimesi",
            "text": "'Her' kelimesi genellikle ayrı yazılır (her bir, her gün). İstisna: Herkes, herhangi.",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_19_BELIRSIZLIK_SIFATLARI",
            "title": "Bitişik Yazılan Belirsizlik Kelimeleri",
            "text": "Biraz, birçok, birkaç, birtakım, herhangi kelimeleri bitişik yazılır.",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_20_NOKTA",
            "title": "Cümle Sonu Nokta",
            "text": "Tamamlanmış cümlelerin sonuna nokta konur.",
            "category": "Noktalama"
        },
        {
            "rule_id": "TDK_21_VIRGUL",
            "title": "Virgül Kullanımı",
            "text": "Eş görevli kelimeler ve sıralı cümleler arasına virgül konur.",
            "category": "Noktalama"
        },
        {
            "rule_id": "TDK_22_DARALMA_KURALI",
            "title": "Gereksiz Ünlü Daralması",
            "text": "Yor eki dışında, konuşma dilindeki daralmalar yazıya geçirilmez. (Yapcam -> Yapacağım, Gelcem -> Geleceğim).",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_23_YANLIS_YALNIZ",
            "title": "Yanlış/Yalnız Yazımı",
            "text": "Doğrusu: Yanlış (yanılmaktan), Yalnız (yalından).",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_24_HERKES",
            "title": "Herkes Yazımı",
            "text": "'Herkes' kelimesi 's' ile biter, 'z' ile bitmez.",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_25_SERTLESME",
            "title": "Ünsüz Benzeşmesi (Sertleşme)",
            "text": "Fıstıkçı Şahap ünsüzlerinden sonra 'c, d, g' -> 'ç, t, k' olur (kitapda değil kitapta, 1923'de değil 1923'te).",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_26_HANE",
            "title": "Hane Kelimesi",
            "text": "Sesliyle bitenlerde 'ha' düşer (hastane, postane). Ünsüzle bitenlerde kalır (dershane).",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_27_ART_ARDA",
            "title": "Art Arda Yazımı",
            "text": "'Art arda' ayrı ve 't' ile yazılır (ardarda değil).",
            "category": "Ayrı/Bitişik Yazım"
        },
        {
            "rule_id": "TDK_28_YABANCI_KELIMELER",
            "title": "Sık Karıştırılan Kelimeler",
            "text": "Doğrular: Şoför, egzoz, metot, tıraş, kılavuz, kulüp, sürpriz.",
            "category": "Yazım"
        },
        {
            "rule_id": "TDK_29_UNVANLAR",
            "title": "Unvanların Yazımı",
            "text": "Kişi adlarıyla kullanılan unvanlar büyük harfle başlar (Ayşe Hanım, Doktor Ali).",
            "category": "Büyük Harfler"
        },
        {
            "rule_id": "TDK_30_YONLER",
            "title": "Yön Adlarının Yazımı",
            "text": "Yön adları özel isimden önceyse büyük (Doğu Anadolu), sonraysa küçük (Anadolu'nun doğusu) yazılır.",
            "category": "Büyük Harfler"
        }
    ]

# --- METİN TEMİZLİĞİ (GÜÇLENDİRİLMİŞ) ---
_ZERO_WIDTH = re.compile(r"[\u200B\u200C\u200D\uFEFF]")

def normalize_text(text: str) -> str:
    """Gösterim ve genel temizlik için (Orijinal hali korur)."""
    if not text: return ""
    text = text.replace("’", "'").replace("`", "'")
    text = _ZERO_WIDTH.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def normalize_match(text: str) -> str:
    """Eşleştirme için (Büyük/Küçük harf duyarsız)."""
    return normalize_text(text).casefold()

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

        span = err.get("span")
        if not isinstance(span, dict) or "start" not in span or "end" not in span:
            continue

        try:
            start, end = int(span["start"]), int(span["end"])
        except: continue

        if start < 0 or end <= start or end > n: continue

        wrong = err.get("wrong", "") or ""
        correct = err.get("correct", "") or ""
        evidence_fragment = full_text[start:end]

        # 0) Correct boşsa: AI saçmalaması -> reddet
        if normalize_text(correct) == "":
            print(f"🗑️ Düzeltme boş, reddedildi: {wrong}")
            continue

        # 1) Gereksiz düzeltme: wrong == correct (case/boşluk farkları dahil) -> reddet
        # Bu satır "Ben -> Ben" hatasını çözer.
        if normalize_match(wrong) == normalize_match(correct):
            print(f"🗑️ Gereksiz düzeltme (aynı kelime), reddedildi: {wrong} -> {correct}")
            continue

        # 2) Kanıt uyuşması: span içindeki parça wrong ile eşleşmeli (case-insensitive)
        # Bu satır "gelcem" (küçük) ile "Gelcem" (AI çıktısı) arasındaki farkı yok sayar ve hatayı kabul eder.
        if normalize_match(evidence_fragment) != normalize_match(wrong):
            print(f"🗑️ Kanıt uyuşmazlığı: Model='{wrong}' Metin='{evidence_fragment}'")
            continue

        clean_errors.append({
            "wrong": wrong,
            "correct": correct,
            "type": err.get("type", "Yazım"),
            "rule_id": rid,
            "explanation": err.get("explanation", ""),
            "span": {"start": start, "end": end}
        })

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

# --- MODELLER ve CEFR ---
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

    # KODDAN OKUYORUZ
    all_rules = load_tdk_rules()
    allowed_ids = {r["rule_id"] for r in all_rules}
    
    rules_text = "\n".join([f"- ID: {r['rule_id']} | {r['title']}: {r['text']}" for r in all_rules])
    cefr_text = CEFR_KRITERLERI.get(data.level, "Genel değerlendirme.")

    prompt = f"""
    GÖREV: Öğrenci metnini analiz et.
    ZORUNLU TALİMATLAR:
    1. SADECE aşağıdaki "TDK KURALLARI" listesini kullan. Listede olmayan hatayı YAZMA.
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