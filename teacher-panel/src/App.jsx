import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, Users, FileText, LogOut, ChevronRight, 
  Search, Download, Save, X, Trash2, Plus, ZoomIn, ZoomOut 
} from 'lucide-react';
import html2pdf from 'html2pdf.js';

// --- SUPABASE AYARLARI ---
// Buraya kendi Supabase URL ve Key bilgilerini girmelisin veya mevcut import'unu kullanmalısın.
import { supabase } from './supabase'; 

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

// --- GLOBAL CSS STİLLERİ ---
const STYLES = `
  .highlight-error {
    background-color: #fff0f0;
    color: #c0392b;
    font-weight: 700;
    border-bottom: 2px solid #e74c3c;
    cursor: pointer;
    transition: all 0.2s;
    padding: 0 2px;
    border-radius: 3px;
  }
  .highlight-error:hover {
    background-color: #e74c3c;
    color: white;
  }
  .popover-card {
    animation: popIn 0.2s ease-out;
  }
  @keyframes popIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

// --- WEB İÇİN HIGHLIGHT BİLEŞENİ ---
const HighlightedTextWeb = ({ text, errors, onErrorClick }) => {
  if (!text) return <p className="text-gray-400 italic">Metin bulunamadı.</p>;

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

    // Hatalı Metin (Span)
    elements.push(
      <span
        key={`err-${index}`}
        className="highlight-error"
        onClick={(e) => {
          e.stopPropagation();
          // Tıklanan elementin koordinatlarını al
          const rect = e.target.getBoundingClientRect();
          onErrorClick(err, { x: rect.left + window.scrollX, y: rect.bottom + window.scrollY });
        }}
      >
        {text.slice(start, end)}
      </span>
    );

    cursor = end;
  });

  if (cursor < text.length) {
    elements.push(<span key="txt-end">{text.slice(cursor)}</span>);
  }

  return (
    <div className="leading-relaxed text-gray-800 text-lg whitespace-pre-wrap font-medium">
      {elements}
    </div>
  );
};

// --- HATA KARTI (POPOVER) ---
const ErrorPopover = ({ data, onClose }) => {
  if (!data) return null;
  const { err, x, y } = data;
  const ruleTitle = TDK_LOOKUP[err.rule_id] || err.rule_id || "Kural İhlali";

  return (
    <div 
      className="fixed inset-0 z-50 flex items-start justify-start" 
      onClick={onClose} // Dışarı tıklayınca kapat
    >
      <div 
        className="popover-card absolute bg-white rounded-xl shadow-2xl border border-gray-200 w-80 p-5"
        style={{ left: Math.min(x - 20, window.innerWidth - 340), top: y + 10 }}
        onClick={(e) => e.stopPropagation()} // İçeriye tıklayınca kapanmasın
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

// --- ANA BİLEŞEN ---
export default function TeacherPanel() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  // Veriler
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  
  // UI State
  const [activeError, setActiveError] = useState(null); // { err, x, y }
  const [teacherNote, setTeacherNote] = useState("");
  const [rubric, setRubric] = useState({});
  const [totalScore, setTotalScore] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  useEffect(() => {
    // Session kontrolü
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
    // 1. Sınıfları Çek
    const { data: classData } = await supabase.from('classrooms').select('*');
    setClassrooms(classData || []);

    // 2. Ödevleri Çek
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
    const { error } = await supabase.from('classrooms').insert([{ 
        name: newClassName, 
        code: code, 
        teacher_email: session.user.email 
    }]);
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

  // Ödev Seçilince Çalışır
  const openSubmission = (sub) => {
      setSelectedSubmission(sub);
      setTeacherNote(sub.human_note || "");
      setRubric(sub.analysis_json?.rubric || {
          "uzunluk": 0, "noktalama": 0, "dil_bilgisi": 0, 
          "soz_dizimi": 0, "kelime": 0, "icerik": 0
      });
      setTotalScore(sub.score_total || 0);
      setActiveError(null);
      setImageZoom(1);
  };

  // Rubric Güncelleme
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
          // Listeyi güncelle
          setSubmissions(prev => prev.map(s => s.id === selectedSubmission.id ? {...s, score_total: totalScore, human_note: teacherNote} : s));
      } else {
          alert("Hata oluştu.");
      }
  };

  const downloadPDF = () => {
      const element = document.getElementById('report-container');
      const opt = {
          margin: 10,
          filename: `Odev_Raporu_${selectedSubmission.student_name}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2 },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
      };
      html2pdf().set(opt).from(element).save();
  };

  // --- RENDER ---

  if (!session) return (
    <div className="flex h-screen items-center justify-center bg-gray-100 font-sans">
      <form onSubmit={handleLogin} className="bg-white p-10 rounded-2xl shadow-xl w-96">
        <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                <Users size={32} />
            </div>
        </div>
        <h2 className="text-2xl font-bold text-center text-gray-800 mb-6">Öğretmen Girişi</h2>
        <input className="w-full p-3 mb-4 border rounded-lg bg-gray-50" type="email" placeholder="E-posta" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full p-3 mb-6 border rounded-lg bg-gray-50" type="password" placeholder="Şifre" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button disabled={loading} className="w-full bg-blue-600 text-white p-3 rounded-lg font-bold hover:bg-blue-700 transition">
            {loading ? "Giriş Yapılıyor..." : "Giriş Yap"}
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-50 font-sans overflow-hidden">
      <style>{STYLES}</style>

      {/* SOL MENÜ (SIDEBAR) */}
      <div className="w-64 bg-white border-r flex flex-col">
        <div className="p-6 border-b flex items-center gap-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg"><LayoutDashboard size={20}/></div>
            <h1 className="font-bold text-gray-800 text-lg">Panel</h1>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
            <div className="text-xs font-bold text-gray-400 mb-3 uppercase tracking-wider">Sınıflar</div>
            <button 
                onClick={() => setSelectedClass("ALL")}
                className={`w-full text-left p-3 rounded-lg mb-2 flex items-center gap-2 ${selectedClass === "ALL" ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
            >
                <Users size={18}/> Tüm Öğrenciler
            </button>
            {classrooms.map(c => (
                <button 
                    key={c.id} 
                    onClick={() => setSelectedClass(c.code)}
                    className={`w-full text-left p-3 rounded-lg mb-2 flex items-center justify-between ${selectedClass === c.code ? 'bg-blue-50 text-blue-600 font-bold' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <span>{c.name}</span>
                    <span className="text-xs bg-gray-200 px-2 py-1 rounded">{c.code}</span>
                </button>
            ))}
            
            {!showCreateClass ? (
                <button onClick={() => setShowCreateClass(true)} className="w-full border border-dashed border-gray-300 p-3 rounded-lg text-gray-500 hover:border-blue-500 hover:text-blue-500 flex items-center justify-center gap-2 mt-4">
                    <Plus size={16}/> Sınıf Ekle
                </button>
            ) : (
                <div className="mt-4 p-3 bg-gray-50 rounded-lg border">
                    <input className="w-full p-2 border rounded mb-2 text-sm" placeholder="Sınıf Adı" value={newClassName} onChange={e=>setNewClassName(e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={handleCreateClass} className="flex-1 bg-green-500 text-white text-xs p-2 rounded">Kaydet</button>
                        <button onClick={() => setShowCreateClass(false)} className="flex-1 bg-gray-300 text-gray-600 text-xs p-2 rounded">İptal</button>
                    </div>
                </div>
            )}
        </div>

        <div className="p-4 border-t">
            <button onClick={handleLogout} className="w-full flex items-center gap-2 text-red-500 hover:bg-red-50 p-3 rounded-lg transition">
                <LogOut size={18}/> Çıkış Yap
            </button>
        </div>
      </div>

      {/* ANA İÇERİK */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {selectedSubmission ? (
            // --- DETAY GÖRÜNÜMÜ ---
            <div className="flex flex-col h-full">
                {/* Üst Bar */}
                <div className="bg-white border-b p-4 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedSubmission(null)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">← Geri</button>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">{selectedSubmission.student_name} {selectedSubmission.student_surname}</h2>
                            <span className="text-sm text-gray-500">{new Date(selectedSubmission.created_at).toLocaleString('tr-TR')}</span>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${totalScore >= 70 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {totalScore} Puan
                        </span>
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-bold border border-yellow-200">
                            Seviye: {selectedSubmission.level || "A1"}
                        </span>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={saveChanges} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-medium">
                            <Save size={18}/> Kaydet
                        </button>
                        <button onClick={downloadPDF} className="flex items-center gap-2 bg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gray-900 font-medium">
                            <Download size={18}/> PDF
                        </button>
                    </div>
                </div>

                {/* İçerik Alanı (Scroll edilebilir) */}
                <div className="flex-1 overflow-hidden flex bg-gray-100 p-6 gap-6">
                    
                    {/* SOL: Resim */}
                    <div className="flex-1 bg-white rounded-xl shadow-lg border overflow-hidden flex flex-col">
                        <div className="p-3 border-b bg-gray-50 flex justify-between items-center">
                            <h3 className="font-bold text-gray-700">📄 Orijinal Kağıt</h3>
                            <div className="flex gap-2">
                                <button onClick={() => setImageZoom(z => Math.min(z + 0.5, 3))} className="p-1 bg-white border rounded hover:bg-gray-100"><ZoomIn size={16}/></button>
                                <button onClick={() => setImageZoom(z => Math.max(z - 0.5, 1))} className="p-1 bg-white border rounded hover:bg-gray-100"><ZoomOut size={16}/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto bg-gray-800 flex items-center justify-center p-4">
                            <img 
                                src={selectedSubmission.image_url} 
                                alt="Ödev" 
                                style={{ transform: `scale(${imageZoom})`, transition: 'transform 0.2s' }}
                                className="max-w-full shadow-xl"
                            />
                        </div>
                    </div>

                    {/* SAĞ: Analiz ve Rapor (PDF Alanı) */}
                    <div className="flex-1 overflow-y-auto pr-2" id="report-container">
                        
                        {/* 1. Metin Analizi */}
                        <div className="bg-white rounded-xl shadow-lg border p-8 mb-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2">📝 Metin Analizi (OCR)</h3>
                            <div className="bg-gray-50 p-6 rounded-lg border border-gray-100">
                                <HighlightedTextWeb 
                                    text={selectedSubmission.ocr_text} 
                                    errors={selectedSubmission.analysis_json?.errors} 
                                    onErrorClick={(err, coords) => setActiveError({ err, ...coords })}
                                />
                            </div>
                        </div>

                        {/* 2. Puanlama Tablosu */}
                        <div className="bg-white rounded-xl shadow-lg border p-6 mb-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">📊 Puanlama (Rubric)</h3>
                            <div className="grid grid-cols-3 gap-4">
                                {[
                                    { k: "uzunluk", l: "Uzunluk", m: 16 },
                                    { k: "noktalama", l: "Noktalama", m: 14 },
                                    { k: "dil_bilgisi", l: "Dil Bilgisi", m: 16 },
                                    { k: "soz_dizimi", l: "Söz Dizimi", m: 20 },
                                    { k: "kelime", l: "Kelime Bilgisi", m: 14 },
                                    { k: "icerik", l: "İçerik", m: 20 }
                                ].map((item) => (
                                    <div key={item.k} className="bg-gray-50 p-3 rounded-lg border text-center">
                                        <div className="text-xs font-bold text-gray-500 uppercase mb-2">{item.l}</div>
                                        <div className="flex items-center justify-center gap-1">
                                            <input 
                                                type="number" 
                                                className="w-12 text-center font-bold text-lg border-b-2 border-blue-500 bg-transparent focus:outline-none"
                                                value={rubric[item.k] || 0}
                                                onChange={(e) => updateRubric(item.k, e.target.value, item.m)}
                                                min="0" max={item.m}
                                            />
                                            <span className="text-gray-400 text-sm">/ {item.m}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-4 flex justify-between items-center bg-gray-100 p-4 rounded-lg">
                                <span className="font-bold text-gray-600">TOPLAM PUAN</span>
                                <span className={`text-3xl font-extrabold ${totalScore >= 70 ? 'text-green-600' : 'text-red-600'}`}>{totalScore} / 100</span>
                            </div>
                        </div>

                        {/* 3. Öğretmen Notu */}
                        <div className="bg-white rounded-xl shadow-lg border p-6">
                            <h3 className="text-lg font-bold text-gray-800 mb-4">👨‍🏫 Öğretmen Notu</h3>
                            <textarea 
                                className="w-full border rounded-lg p-4 h-32 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                placeholder="Öğrenciye iletmek istediğiniz not..."
                                value={teacherNote}
                                onChange={(e) => setTeacherNote(e.target.value)}
                            />
                        </div>

                    </div>
                </div>
            </div>
        ) : (
            // --- LİSTE GÖRÜNÜMÜ ---
            <div className="p-8 h-full overflow-y-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-800">Ödev Teslimleri</h1>
                        <p className="text-gray-500 mt-1">
                            {selectedClass === "ALL" ? "Tüm Sınıflar" : `${classrooms.find(c=>c.code===selectedClass)?.name || selectedClass} Sınıfı`}
                        </p>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-3 text-gray-400" size={20}/>
                        <input className="pl-10 pr-4 py-2 border rounded-full w-64 focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Öğrenci ara..." />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="p-4 font-bold text-gray-600">Öğrenci</th>
                                <th className="p-4 font-bold text-gray-600">Sınıf</th>
                                <th className="p-4 font-bold text-gray-600">Tarih</th>
                                <th className="p-4 font-bold text-gray-600">Seviye</th>
                                <th className="p-4 font-bold text-gray-600">Puan</th>
                                <th className="p-4 font-bold text-gray-600 text-right">İşlem</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {submissions.filter(s => selectedClass === "ALL" || s.classroom_code === selectedClass).map(sub => (
                                <tr key={sub.id} className="hover:bg-gray-50 transition cursor-pointer" onClick={() => openSubmission(sub)}>
                                    <td className="p-4 font-medium text-gray-800">{sub.student_name} {sub.student_surname}</td>
                                    <td className="p-4 text-gray-600"><span className="bg-gray-100 px-2 py-1 rounded text-xs font-bold">{sub.classroom_code}</span></td>
                                    <td className="p-4 text-gray-600">{new Date(sub.created_at).toLocaleDateString()}</td>
                                    <td className="p-4"><span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold">{sub.level || "A1"}</span></td>
                                    <td className="p-4">
                                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${sub.score_total >= 70 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {sub.score_total}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => openSubmission(sub)} className="p-2 hover:bg-blue-50 text-blue-600 rounded-lg"><ChevronRight size={20}/></button>
                                        <button onClick={() => deleteSubmission(sub.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={18}/></button>
                                    </td>
                                </tr>
                            ))}
                            {submissions.length === 0 && (
                                <tr>
                                    <td colSpan="6" className="p-10 text-center text-gray-400">Henüz ödev yüklenmemiş.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>

      {/* POPOVER BALONCUK */}
      <ErrorPopover data={activeError} onClose={() => setActiveError(null)} />
    </div>
  );
}