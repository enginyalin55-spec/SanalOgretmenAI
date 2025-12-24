import google.generativeai as genai

# --- ŞİFRENİ BURAYA YAPIŞTIR ---
API_KEY = "AIzaSyDXAxh6bfLolw2d3rpqd-kAD24Uwsldxkk"

genai.configure(api_key=API_KEY)

print("🔍 Google'a soruluyor: Hangi modelleri kullanabilirim?...")

try:
    print("-" * 30)
    for m in genai.list_models():
        # Sadece içerik üretebilen (bizim işimize yarayan) modelleri göster
        if 'generateContent' in m.supported_generation_methods:
            print(f"✅ İSİM: {m.name}")
    print("-" * 30)
    print("Yukarıdaki 'name' kısmında yazanlardan birini main.py'ye yazacağız.")

except Exception as e:
    print(f"❌ HATA: {e}")