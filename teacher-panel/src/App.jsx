import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, Users, FileText, LogOut, ChevronRight, 
  Search, Download, Save, Trash2, Plus, ZoomIn, ZoomOut,
  Info, CheckCircle, AlertTriangle
} from 'lucide-react';
import html2pdf from 'html2pdf.js';

// --- SUPABASE AYARLARI ---
// Buraya kendi proje URL ve Anon Key bilgilerini girmelisin
const supabaseUrl = 'BURAYA_SUPABASE_URL_GELECEK';
const supabaseKey = 'BURAYA_SUPABASE_ANON_KEY_GELECEK';
const supabase = createClient(supabaseUrl, supabaseKey);

// --- TDK KURAL SÖZLÜĞÜ ---
const TDK_LOOKUP = {
  "TDK_01_BAGLAC_DE": "Bağlaç Olan 'da/de'",
  "TDK_02_BAGLAC_KI": "Bağlaç Olan 'ki'",
  "TDK_03_SORU_EKI": "Soru Eki 'mı/mi'",
  "TDK_04_SEY_SOZ": "'Şey' Sözcüğü",
  "TDK_05_BUYUK_CUMLE": "Cümle Başı Büyük Harf",
  "TDK_06_BUYUK_OZEL": "Özel İsimler",
  "TDK_07_BUYUK_KURUM": "Kurum Adları",
  "TDK_08_TARIH_GUN_AY": "Tarihlerin Yazımı",
  "TDK_09_KESME_OZEL": "Kesme İşareti (Özel)",
  "TDK_10_KESME_KURUM": "Kurum Ekleri",
  "TDK_11_YARDIMCI_FIIL_SES": "Yardımcı Fiiller",
  "TDK_12_SAYI_AYRI": "Sayıların Yazımı",
  "TDK_13_ULESTIRME": "Üleştirme Sayıları",
  "TDK_14_KISALTMA_BUYUK": "Kısaltmalar",
  "TDK_15_IKILEMELER": "İkilemeler",
  "TDK_16_PEKISTIRME": "Pekiştirmeler",
  "TDK_17_YUMUSAK_G": "Yumuşak G Kuralı",
  "TDK_18_HER_BIR": "'Her' Kelimesi",
  "TDK_19_BELIRSIZLIK_SIFATLARI": "Bitişik Kelimeler",
  "TDK_20_NOKTA": "Nokta Kullanımı",
  "TDK_21_VIRGUL": "Virgül Kullanımı",
  "TDK_22_DARALMA_KURALI": "Gereksiz Daralma",
  "TDK_23_YANLIS_YALNIZ": "Yanlış/Yalnız",
  "TDK_24_HERKES": "Herkes (s/z)",
  "TDK_25_SERTLESME": "Ünsüz Benzeşmesi",
  "TDK_26_HANE": "Hane Kelimesi",
  "TDK_27_ART_ARDA": "Art Arda",
  "TDK_28_YABANCI_KELIMELER": "Yabancı Kelimeler",
  "TDK_29_UNVANLAR": "Unvanlar",
  "TDK_30_YONLER": "Yön Adları",
  "TDK_31_ZAMAN_UYUMU": "Zaman ve Kip Uyumu"
};

// --- GLOBAL STİLLER ---
const STYLES = `
  .highlight-error {
    background-color: #fff0f0;
    color: #c0392b;
    font-weight: 700;
    border-bottom: 2px solid #e74c3c;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 3px;
    transition: all 0.2s;
  }
  .highlight-error:hover {
    background-color: #e74c3c;
    color: white;
  }
  /* PDF Modu: YZ İpucunu ve gereksiz butonları gizle */
  .pdf-mode .no-print { display: none !important; }
  .pdf-mode { font-size: 12px; }
`;

// --- HIGHLIGHT BİLEŞENİ (WEB) ---
const HighlightedTextWeb = ({ text, errors, onErrorClick }) => {
  if (!text) return <p className="text-gray-400 italic">Metin bulunamadı.</p>;

  // Hataları güvenli hale getir ve sırala
  const safeErrors = (errors || [])
    .filter(e => e?.span?.start !== undefined)
    .sort((a, b) => a.span.start - b.span.start);

  if (safeErrors.length === 0) return <p className="leading-relaxed text-gray-800 text-lg whitespace-pre-wrap">{text}</p>;

  const elements = [];
  let cursor = 0;

  safeErrors.forEach((err, index) => {
    const start = Math.max(0, err.span.start);
    let end = err.span.end;
    if (end > text.length) end = text.length;
    
    if (start >= end || start < cursor) return;

    // Normal Metin
    if (start > cursor) {
      elements.push(<span key={`txt-${cursor}`}>{text.slice(cursor, start)}</span>);
    }

    // Hatalı Kısım
    elements.push(
      <span
        key={`err-${index}`}
        className="highlight-error"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.target.getBoundingClientRect();
          // Scroll payını da hesaba katarak koordinat gönder
          onErrorClick(err, { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
        }}
      >
        {text.slice(start, end)}
      </span>
    );

    cursor = end;
  });

  // Kalan Metin
  if (cursor < text.length) {
    elements.push(<span key="txt-end">{text.slice(cursor)}</span>);
  }

  return <div className="leading-loose text-gray-800 text-lg whitespace-pre-wrap font-medium">{elements}</div>;
};

// --- HATA KARTI (POPOVER) ---
const ErrorPopover = ({ data, onClose }) => {
  if (!data) return null;
  const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div 
        className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 w-80 p-5 z-50 transform transition-all duration-200"
        style={{ left: Math.min(x - 20, window.innerWidth - 340), top: y + 10 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4 border-b pb-2">
          <h4 className="font-bold text-red-600 flex items-center gap-2">⚠️ Hata Detayı</h4>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 font-bold">✕</button>
        </div>
        <div className="flex justify-between items-center bg-gray-50 p-3 rounded-lg mb-4">
          <div className="text-center flex-1">
            <div className="text-xs text-red-500 font-bold mb-1">YANLIŞ</div>
            <div className="text-red-700 font-bold line-through">{err.wrong}</div>
          </div>
          <div className="text-gray-300 text-xl mx-2">➜</div>
          <div className="text-center flex-1">
            <div className="text-xs text-green-600 font-bold mb-1">DOĞRU</div>
            <div className="text-green-700 font-bold">{err.correct}</div>
          </div>
        </div>
        <div className="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500 mb-3">
          <div className="text-xs text-blue-600 font-bold">KURAL</div>
          <div className="text-sm font-bold text-gray-800">{ruleTitle}</div>
        </div>
        <p className="text-sm text-gray-600 leading-relaxed">{err.explanation}</p>
      </div>
    </div>
  );
};

// --- ANA UYGULAMA ---
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Veri State'leri
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  
  // Arayüz State'leri
  const [activeError, setActiveError] = useState(null);
  const [teacherNote, setTeacherNote] = useState("");
  const [aiInsight, setAiInsight] = useState(""); 
  const [rubric, setRubric] = useState({});
  const [totalScore, setTotalScore] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  useEffect(() => {
    // Oturum kontrolü
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if(session) fetchData();
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if(session) fetchData();
    });
    return () => subscription.unsubscribe();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    // Sınıfları çek
    const { data: classData } = await supabase.from('classrooms').select('*');
    setClassrooms(classData || []);
    // Ödevleri çek
    const { data: subData } = await supabase.from('submissions').select('*').order('created_at', { ascending: false });
    setSubmissions(subData || []);
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    setLoading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const handleCreateClass = async () => {
    if(!newClassName) return;
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const { error } = await supabase.from('classrooms').insert([{ name: newClassName, code: code, teacher_email: session.user.email }]);
    if(!error) {
        alert(`Sınıf Oluşturuldu! Kod: ${code}`);
        setNewClassName("");
        setShowCreateClass(false);
        fetchData();
    }
  };

  const deleteSubmission = async (id) => {
      if(!window.confirm("Bu ödevi silmek istediğinize emin misiniz?")) return;
      await supabase.from('submissions').delete().eq('id', id);
      setSubmissions(submissions.filter(s => s.id !== id));
      if(selectedSubmission?.id === id) setSelectedSubmission(null);
  };

  const openSubmission = (sub) => {
      setSelectedSubmission(sub);
      setTeacherNote(sub.human_note || "");
      // YZ İpucu (Simülasyon - Gerçekte veritabanından gelebilir)
      setAiInsight("YZ Analizi: Öğrenci A2 seviyesinde. Özellikle 'da/de' bağlaçlarında ve geçmiş zaman eklerinde hatalar mevcut. Cümle yapıları basit ancak anlaşılır. Tavsiye: Bağlaçlar üzerine ek çalışma verilebilir.");
      
      const defaultRubric = { "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, "soz_dizimi": 0, "kelime": 0, "icerik": 0 };
      setRubric(sub.analysis_json?.rubric || defaultRubric);
      setTotalScore(sub.score_total || 0);
      setActiveError(null);
      setImageZoom(1);
  };

  const updateRubric = (key, val, max) => {
      let newVal = parseInt(val) || 0;
      if(newVal > max) newVal = max;
      if(newVal < 0) newVal = 0;
      const newRubric = { ...rubric, [key]: newVal };
      setRubric(newRubric);
      const newTotal = Object.values(newRubric).reduce((a,b) => a+b, 0);
      setTotalScore(newTotal);
  };

  const saveChanges = async () => {
      const fullJson = { ...selectedSubmission.analysis_json, rubric: rubric };
      const { error } = await supabase.from('submissions').update({
          score_total: totalScore,
          analysis_json: fullJson,
          human_note: teacherNote
      }).eq('id', selectedSubmission.id);

      if(!error) {
          alert("✅ Kaydedildi!");
          setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? {...s, score_total: totalScore, human_note: teacherNote} : s));
      } else {
          alert("Hata oluştu.");
      }
  };

  const downloadPDF = async () => {
      const element = document.getElementById('report-container');
      if (!element || !selectedSubmission) return;

      // PDF modunu aç (Gereksizleri gizle)
      document.body.classList.add("pdf-mode");

      const opt = {
          margin: 5,
          filename: `Rapor_${selectedSubmission.student_name}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };

      try {
          await html2pdf().set(opt).from(element).save();
      } finally {
          document.body.classList.remove("pdf-mode");
      }
  };

  if (!session) return (
    <div className="flex h-screen items-center justify-center bg-gray-100 font-sans">
      <form onSubmit={handleLogin} className="bg-white p-10 rounded-2xl shadow-xl w-96">
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">Öğretmen Girişi</h2>
        <input className="w-full p-3 mb-4 border rounded-lg bg-gray-50" type="email" placeholder="E-posta" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full p-3 mb-6 border rounded-lg bg-gray-50" type="password" placeholder="Şifre" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button disabled={loading} className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700 transition">Giriş Yap</button>
      </form>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100 font-sans overflow-hidden">
      <style>{STYLES}</style>

      {/* --- SOL MENÜ (SIDEBAR) --- */}
      <div className="w-64 bg-white border-r flex flex-col shadow-md z-20">
        <div className="p-6 border-b flex items-center gap-2 bg-blue-600 text-white">
            <LayoutDashboard size={20}/>
            <h1 className="font-bold text-lg">Panel</h1>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-bold text-gray-400 uppercase">SINIFLAR</span>
                <button onClick={() => setShowCreateClass(true)} className="text-blue-600 hover:bg-blue-50 p-1 rounded"><Plus size={16}/></button>
            </div>

            <div className="space-y-1">
                <button 
                    onClick={() => setSelectedClass("ALL")}
                    className={`w-full text-left p-2 rounded flex items-center gap-2 text-sm ${selectedClass === "ALL" ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <Users size={16}/> Tüm Öğrenciler
                </button>
                {classrooms.map(c => (
                    <button 
                        key={c.id} 
                        onClick={() => setSelectedClass(c.code)}
                        className={`w-full text-left p-2 rounded flex items-center justify-between text-sm ${selectedClass === c.code ? 'bg-blue-50 text-blue-700 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                        <span>{c.name}</span>
                        <span className="text-xs bg-gray-200 px-1.5 rounded">{c.code}</span>
                    </button>
                ))}
            </div>

            {showCreateClass && (
                <div className="mt-4 p-3 bg-gray-50 rounded border text-sm">
                    <input className="w-full p-1.5 border rounded mb-2" placeholder="Sınıf Adı" value={newClassName} onChange={e=>setNewClassName(e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={handleCreateClass} className="flex-1 bg-green-600 text-white p-1 rounded">Ekle</button>
                        <button onClick={() => setShowCreateClass(false)} className="flex-1 bg-gray-300 text-gray-700 p-1 rounded">İptal</button>
                    </div>
                </div>
            )}
        </div>

        <div className="p-4 border-t">
            <button onClick={handleLogout} className="w-full flex items-center gap-2 text-red-600 text-sm font-bold hover:bg-red-50 p-2 rounded transition">
                <LogOut size={16}/> Çıkış Yap
            </button>
        </div>
      </div>

      {/* --- ANA EKRAN --- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 relative">
        {selectedSubmission ? (
            // --- DETAY GÖRÜNÜMÜ (3 SÜTUNLU YAPI) ---
            <div className="flex flex-col h-full">
                {/* Üst Bar */}
                <div className="bg-white border-b px-6 py-3 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedSubmission(null)} className="flex items-center gap-1 text-gray-500 hover:text-gray-800 font-medium text-sm">
                            <ChevronRight className="rotate-180" size={16}/> Geri
                        </button>
                        <div className="h-6 w-px bg-gray-300"></div>
                        <div>
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                {selectedSubmission.student_name} {selectedSubmission.student_surname}
                                <span className="text-xs font-normal text-white bg-blue-500 px-2 py-0.5 rounded">
                                    {selectedSubmission.classroom_code}
                                </span>
                            </h2>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={saveChanges} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded text-sm font-bold hover:bg-green-700">
                            <Save size={16}/> Kaydet
                        </button>
                        <button onClick={downloadPDF} className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded text-sm font-bold hover:bg-gray-900">
                            <Download size={16}/> PDF
                        </button>
                    </div>
                </div>

                {/* --- 3 SÜTUNLU İÇERİK --- */}
                <div className="flex-1 overflow-hidden flex p-4 gap-4 bg-gray-100" id="report-container">
                    
                    {/* 1. SOL: Orijinal Kağıt (%30) - PDF'e ÇIKMAZ (no-print) */}
                    <div className="w-[30%] bg-white rounded-lg shadow border flex flex-col overflow-hidden no-print">
                        <div className="p-2 bg-gray-50 border-b flex justify-between items-center">
                            <span className="font-bold text-gray-600 text-xs flex items-center gap-1"><FileText size={14}/> Kağıt</span>
                            <div className="flex gap-1">
                                <button onClick={() => setImageZoom(z => Math.min(z + 0.5, 3))} className="p-1 hover:bg-white rounded"><ZoomIn size={14}/></button>
                                <button onClick={() => setImageZoom(z => Math.max(z - 0.5, 1))} className="p-1 hover:bg-white rounded"><ZoomOut size={14}/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto bg-gray-200 flex items-center justify-center p-2">
                            <img 
                                src={selectedSubmission.image_url} 
                                alt="Paper" 
                                style={{ transform: `scale(${imageZoom})`, transition: 'transform 0.2s' }}
                                className="max-w-full shadow border bg-white"
                            />
                        </div>
                    </div>

                    {/* 2. ORTA: YZ Analizi (%45) */}
                    <div className="w-[45%] flex flex-col gap-4">
                        <div className="flex-1 bg-white rounded-lg shadow border p-6 overflow-y-auto">
                            <h3 className="text-md font-bold text-gray-800 mb-4 border-b pb-2 flex items-center justify-between">
                                <span>📝 Analiz Sonucu</span>
                                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 rounded">OCR</span>
                            </h3>
                            <HighlightedTextWeb 
                                text={selectedSubmission.ocr_text} 
                                errors={selectedSubmission.analysis_json?.errors} 
                                onErrorClick={(err, coords) => setActiveError({ err, ...coords })}
                            />
                        </div>
                        
                        {/* YZ İPUCU (Sadece Ekranda Görünür - PDF'de Gizli) */}
                        <div className="no-print bg-blue-50 border border-blue-200 p-3 rounded-lg flex gap-3 shadow-sm">
                            <Info className="text-blue-600 mt-1" size={20} />
                            <div>
                                <h4 className="font-bold text-blue-800 text-xs mb-1">🤖 YZ İpucu (Öğretmene Özel)</h4>
                                <p className="text-blue-900 text-sm leading-snug">{aiInsight}</p>
                            </div>
                        </div>

                        {/* ÖĞRETMEN NOTU (PDF'e Çıkar) */}
                        <div className="bg-white rounded-lg shadow border p-4">
                            <h3 className="text-sm font-bold text-gray-700 mb-2">👨‍🏫 Öğretmen Değerlendirmesi</h3>
                            <textarea 
                                className="w-full border rounded p-2 h-24 text-sm focus:ring-1 focus:ring-blue-500 outline-none resize-none bg-yellow-50/20"
                                placeholder="Öğrenciye notunuzu buraya yazın..."
                                value={teacherNote}
                                onChange={(e) => setTeacherNote(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 3. SAĞ: Puanlama (Rubric) (%25) */}
                    <div className="w-[25%] bg-white rounded-lg shadow border p-4 flex flex-col overflow-y-auto">
                        <h3 className="text-md font-bold text-gray-800 mb-4 text-center border-b pb-2">📊 Puanlama</h3>
                        <div className="flex-1 space-y-2">
                            {[
                                { k: "uzunluk", l: "Uzunluk", m: 16 },
                                { k: "noktalama", l: "Noktalama", m: 14 },
                                { k: "dil_bilgisi", l: "Dil Bilgisi", m: 16 },
                                { k: "soz_dizimi", l: "Söz Dizimi", m: 20 },
                                { k: "kelime", l: "Kelime", m: 14 },
                                { k: "icerik", l: "İçerik", m: 20 }
                            ].map((item) => (
                                <div key={item.k} className="flex items-center justify-between bg-gray-50 p-2 rounded border">
                                    <span className="text-xs font-bold text-gray-600 uppercase">{item.l}</span>
                                    <div className="flex items-center">
                                        <input 
                                            type="number" 
                                            className="w-10 text-center font-bold text-sm border-b border-blue-400 bg-transparent focus:outline-none"
                                            value={rubric[item.k] || 0}
                                            onChange={(e) => updateRubric(item.k, e.target.value, item.m)}
                                            min="0" max={item.m}
                                        />
                                        <span className="text-gray-400 text-xs">/{item.m}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-4 pt-4 border-t text-center bg-gray-50 rounded p-2">
                            <div className="text-xs text-gray-500 font-bold">TOPLAM PUAN</div>
                            <div className={`text-3xl font-black ${totalScore >= 70 ? 'text-green-600' : 'text-red-600'}`}>
                                {totalScore}
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        ) : (
            // --- DASHBOARD (LİSTE GÖRÜNÜMÜ) ---
            <div className="p-8 h-full overflow-y-auto">
                <div className="flex justify-between items-end mb-6">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-800">Sınıf Listesi</h1>
                        <p className="text-gray-500 text-sm mt-1">
                            {selectedClass === "ALL" ? "Tüm Sınıflar" : `${classrooms.find(c=>c.code===selectedClass)?.name || selectedClass} Sınıfı`}
                        </p>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-gray-400" size={18}/>
                        <input className="pl-9 pr-4 py-2 border border-gray-300 rounded-full w-64 text-sm focus:ring-2 focus:ring-blue-500 outline-none shadow-sm" placeholder="Öğrenci ara..." />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Öğrenci</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Ülke / Dil</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Sınıf</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Tarih</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Seviye</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase">Durum</th>
                                <th className="p-4 font-bold text-gray-500 text-xs uppercase text-right">İşlem</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {submissions.filter(s => selectedClass === "ALL" || s.classroom_code === selectedClass).map(sub => (
                                <tr key={sub.id} className="hover:bg-blue-50/50 transition cursor-pointer" onClick={() => openSubmission(sub)}>
                                    <td className="p-4 font-bold text-gray-800 text-sm">{sub.student_name} {sub.student_surname}</td>
                                    <td className="p-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">
                                                {sub.country === 'Türkiye' ? '🇹🇷' : sub.country === 'Almanya' ? '🇩🇪' : sub.country === 'Hindistan' ? '🇮🇳' : '🌍'}
                                            </span>
                                            <div className="flex flex-col">
                                                <span className="text-xs font-bold text-gray-700">{sub.country || "Bilinmiyor"}</span>
                                                <span className="text-[10px] text-gray-400">{sub.native_language || "Dil yok"}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-4"><span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold border">{sub.classroom_code}</span></td>
                                    <td className="p-4 text-gray-600 text-sm">{new Date(sub.created_at).toLocaleDateString('tr-TR')}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            (sub.level || 'A1') === 'A1' ? 'bg-green-100 text-green-700' :
                                            (sub.level || 'A1') === 'A2' ? 'bg-blue-100 text-blue-700' : 
                                            'bg-purple-100 text-purple-700'
                                        }`}>
                                            {sub.level || "A1"}
                                        </span>
                                    </td>
                                    <td className="p-4">
                                        {sub.score_total ? (
                                            <span className="flex items-center gap-1 text-green-600 font-bold text-xs"><CheckCircle size={14}/> {sub.score_total} Puan</span>
                                        ) : (
                                            <span className="flex items-center gap-1 text-orange-500 font-bold text-xs"><AlertTriangle size={14}/> Bekliyor</span>
                                        )}
                                    </td>
                                    <td className="p-4 text-right flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => openSubmission(sub)} className="bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-bold shadow hover:bg-blue-700">İncele</button>
                                        <button onClick={() => deleteSubmission(sub.id)} className="p-1.5 hover:bg-red-100 text-red-500 rounded"><Trash2 size={16}/></button>
                                    </td>
                                </tr>
                            ))}
                            {submissions.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="p-8 text-center text-gray-400 text-sm">Bu sınıfta henüz ödev yok.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>

      {/* --- POPOVER BALONCUK --- */}
      <ErrorPopover data={activeError} onClose={() => setActiveError(null)} />
    </div>
  );
}