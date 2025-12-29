import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  LayoutDashboard, Users, FileText, LogOut, ChevronRight, 
  Search, Download, Save, X, Trash2, Plus, ZoomIn, ZoomOut,
  Info, CheckCircle, AlertTriangle
} from 'lucide-react';
import html2pdf from 'html2pdf.js';

// --- SUPABASE AYARLARI ---
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

// --- GÜNCELLENMİŞ GLOBAL CSS ---
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
  
  /* Normalde ekranda görünür */
  .no-print { display: block; }

  /* PDF üretirken kesin gizle (body'e class eklendiğinde) */
  .pdf-export-mode .no-print { display: none !important; }
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

    if (start > cursor) {
      elements.push(<span key={`txt-${cursor}`}>{text.slice(cursor, start)}</span>);
    }

    elements.push(
      <span
        key={`err-${index}`}
        className="highlight-error"
        onClick={(e) => {
          e.stopPropagation();
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
    <div className="fixed inset-0 z-50 flex items-start justify-start" onClick={onClose}>
      <div 
        className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 w-80 p-5 transform transition-all duration-200 ease-out"
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

export default function TeacherPanel() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClass, setSelectedClass] = useState("ALL");
  const [submissions, setSubmissions] = useState([]);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  
  const [activeError, setActiveError] = useState(null);
  const [teacherNote, setTeacherNote] = useState("");
  const [aiInsight, setAiInsight] = useState(""); 
  const [rubric, setRubric] = useState({});
  const [totalScore, setTotalScore] = useState(0);
  const [imageZoom, setImageZoom] = useState(1);
  const [showCreateClass, setShowCreateClass] = useState(false);
  const [newClassName, setNewClassName] = useState("");

  useEffect(() => {
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
    const { data: classData } = await supabase.from('classrooms').select('*');
    setClassrooms(classData || []);
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
      setAiInsight("YZ Analizi: Öğrenci A2 seviyesinde. 'Da/De' bağlaçlarında ve geçmiş zaman eklerinde sık hata yapıyor. Kelime dağarcığı tatil konusu için yeterli ancak cümle yapıları basit. Tavsiye: Okuma çalışmaları verilmeli.");
      
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
      const element = document.getElementById('report-printable-area');
      if (!element || !selectedSubmission) return;

      // PDF export moduna geç (no-print kesin gizlensin)
      document.body.classList.add("pdf-export-mode");

      const opt = {
          margin: 5,
          filename: `Odev_Raporu_${selectedSubmission.student_name}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
      };

      try {
          await html2pdf().set(opt).from(element).save();
      } catch (err) {
          console.error("PDF Hatası:", err);
      } finally {
          document.body.classList.remove("pdf-export-mode");
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

      {/* --- SIDEBAR --- */}
      <div className="w-72 bg-white border-r flex flex-col shadow-sm z-20">
        <div className="p-6 border-b flex items-center gap-3 bg-blue-600 text-white">
            <LayoutDashboard size={24}/>
            <h1 className="font-bold text-xl">Öğretmen Paneli</h1>
        </div>
        
        <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">SINIFLARIM</span>
                <button onClick={() => setShowCreateClass(true)} className="text-blue-600 hover:bg-blue-50 p-1 rounded"><Plus size={18}/></button>
            </div>

            <div className="space-y-2">
                <button 
                    onClick={() => setSelectedClass("ALL")}
                    className={`w-full text-left p-3 rounded-lg flex items-center gap-3 transition ${selectedClass === "ALL" ? 'bg-blue-50 text-blue-700 border border-blue-100 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                    <div className={`p-2 rounded-full ${selectedClass === "ALL" ? 'bg-blue-200' : 'bg-gray-200'}`}><Users size={16}/></div>
                    <span className="font-medium">Tüm Sınıflar</span>
                </button>
                {classrooms.map(c => (
                    <button 
                        key={c.id} 
                        onClick={() => setSelectedClass(c.code)}
                        className={`w-full text-left p-3 rounded-lg flex items-center justify-between transition ${selectedClass === c.code ? 'bg-blue-50 text-blue-700 border border-blue-100 shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
                    >
                        <div className="flex items-center gap-3">
                            <div className="p-2 rounded-full bg-indigo-100 text-indigo-600 font-bold text-xs">{c.code.substring(0,2)}</div>
                            <span className="font-medium">{c.name}</span>
                        </div>
                        <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500 font-mono">{c.code}</span>
                    </button>
                ))}
            </div>

            {showCreateClass && (
                <div className="mt-4 p-4 bg-gray-50 rounded-xl border border-blue-100 shadow-inner">
                    <h4 className="text-sm font-bold text-gray-700 mb-2">Yeni Sınıf Oluştur</h4>
                    <input className="w-full p-2 border rounded mb-2 text-sm bg-white" placeholder="Örn: 9-A Şubesi" value={newClassName} onChange={e=>setNewClassName(e.target.value)} />
                    <div className="flex gap-2">
                        <button onClick={handleCreateClass} className="flex-1 bg-blue-600 text-white text-xs p-2 rounded hover:bg-blue-700">Oluştur</button>
                        <button onClick={() => setShowCreateClass(false)} className="flex-1 bg-gray-200 text-gray-600 text-xs p-2 rounded hover:bg-gray-300">İptal</button>
                    </div>
                </div>
            )}
        </div>

        <div className="p-4 border-t bg-gray-50">
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 text-red-600 hover:bg-red-100 p-3 rounded-lg transition font-medium">
                <LogOut size={18}/> Oturumu Kapat
            </button>
        </div>
      </div>

      {/* --- ANA ALAN --- */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-gray-100 relative">
        {selectedSubmission ? (
            // --- DETAY GÖRÜNÜMÜ (3 SÜTUNLU YAPI) ---
            <div className="flex flex-col h-full">
                {/* Üst Bar */}
                <div className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm z-10">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setSelectedSubmission(null)} className="flex items-center gap-1 text-gray-500 hover:text-gray-800 font-medium">
                            <ChevronRight className="rotate-180" size={20}/> Geri Dön
                        </button>
                        <div className="h-8 w-px bg-gray-300"></div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                                {selectedSubmission.student_name} {selectedSubmission.student_surname}
                                <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full border">
                                    {selectedSubmission.classroom_code}
                                </span>
                            </h2>
                        </div>
                    </div>
                    <div className="flex gap-3">
                        <button onClick={saveChanges} className="flex items-center gap-2 bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 font-bold shadow-sm transition">
                            <Save size={18}/> Kaydet
                        </button>
                        <button onClick={downloadPDF} className="flex items-center gap-2 bg-gray-800 text-white px-5 py-2.5 rounded-lg hover:bg-gray-900 font-bold shadow-sm transition">
                            <Download size={18}/> PDF
                        </button>
                    </div>
                </div>

                {/* İçerik (3 Sütunlu Yapı) */}
                <div className="flex-1 overflow-hidden flex p-6 gap-6">
                    
                    {/* SOL PANEL: Orijinal Kağıt (%30) */}
                    <div className="w-[30%] bg-white rounded-xl shadow-md border border-gray-200 flex flex-col overflow-hidden">
                        <div className="p-3 bg-gray-50 border-b flex justify-between items-center">
                            <span className="font-bold text-gray-600 text-sm flex items-center gap-2"><FileText size={16}/> Orijinal Kağıt</span>
                            <div className="flex gap-1">
                                <button onClick={() => setImageZoom(z => Math.min(z + 0.5, 3))} className="p-1.5 hover:bg-white rounded"><ZoomIn size={16}/></button>
                                <button onClick={() => setImageZoom(z => Math.max(z - 0.5, 1))} className="p-1.5 hover:bg-white rounded"><ZoomOut size={16}/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-4">
                            <img 
                                src={selectedSubmission.image_url} 
                                alt="Student Paper" 
                                style={{ transform: `scale(${imageZoom})`, transition: 'transform 0.2s' }}
                                className="max-w-full shadow-lg border bg-white"
                            />
                        </div>
                    </div>

                    {/* SAĞ ALAN: PDF’e çıkan kısım + (PDF’e çıkmayan) YZ ipucu */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        
                        {/* PDF’e çıkacak alan (ORTA VE SAĞ SÜTUNLAR) */}
                        <div id="report-printable-area" className="flex-1 overflow-y-auto pr-2">
                            
                            <div className="flex gap-6">
                                {/* ORTA PANEL: YZ Analizi (%45) */}
                                <div className="w-[60%] bg-white rounded-xl shadow-md border border-gray-200 p-6">
                                    <h3 className="text-lg font-bold text-gray-800 mb-4 border-b pb-2 flex items-center gap-2">
                                        📝 Metin Analizi <span className="text-xs font-normal text-gray-400 bg-gray-100 px-2 rounded">OCR</span>
                                    </h3>
                                    <div className="bg-gray-50 p-6 rounded-lg border border-gray-100 min-h-[300px]">
                                        <HighlightedTextWeb 
                                            text={selectedSubmission.ocr_text} 
                                            errors={selectedSubmission.analysis_json?.errors} 
                                            onErrorClick={(err, coords) => setActiveError({ err, ...coords })}
                                        />
                                    </div>
                                </div>

                                {/* SAĞ PANEL: CEFR Puanlama (%25) */}
                                <div className="w-[40%] bg-white rounded-xl shadow-md border border-gray-200 p-5 flex flex-col">
                                    <h3 className="text-lg font-bold text-gray-800 mb-4 text-center">📊 Puanlama</h3>
                                    <div className="flex-1 space-y-3">
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
                                                <div className="flex items-center gap-1">
                                                    <input 
                                                        type="number" 
                                                        className="w-12 text-center font-bold text-sm border-b border-blue-400 bg-transparent focus:outline-none"
                                                        value={rubric[item.k] || 0}
                                                        onChange={(e) => updateRubric(item.k, e.target.value, item.m)}
                                                        min="0" max={item.m}
                                                    />
                                                    <span className="text-gray-400 text-xs">/{item.m}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-4 pt-4 border-t text-center">
                                        <div className="text-xs text-gray-500 font-bold mb-1">TOPLAM PUAN</div>
                                        <div className={`text-4xl font-black ${totalScore >= 70 ? 'text-green-600' : 'text-red-600'}`}>
                                            {totalScore}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ALT KISIM (PDF’e çıkar): Öğretmen Notu */}
                            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6 mt-6">
                                <h3 className="text-lg font-bold text-gray-800 mb-2 flex items-center gap-2">
                                    👨‍🏫 Öğretmen Değerlendirmesi
                                </h3>
                                <textarea 
                                    className="w-full border rounded-lg p-4 h-32 focus:ring-2 focus:ring-blue-500 outline-none resize-none text-gray-700 bg-yellow-50/30"
                                    placeholder="Sevgili Öğrenci, genel olarak iyisin ama kelime çalışman lazım..."
                                    value={teacherNote}
                                    onChange={(e) => setTeacherNote(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* PDF’e çıkmaz: YZ İpucu */}
                        <div className="no-print bg-blue-50 rounded-xl border border-blue-200 p-4 mt-4 flex gap-4 items-start shadow-sm">
                            <div className="bg-blue-100 p-2 rounded-full text-blue-600 mt-1"><Info size={24}/></div>
                            <div>
                                <h4 className="font-bold text-blue-800 text-sm mb-1">🤖 YZ İpucu (Sadece Siz Görüyorsunuz)</h4>
                                <p className="text-blue-900 text-sm leading-relaxed">{aiInsight}</p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        ) : (
            // --- DASHBOARD (LİSTE GÖRÜNÜMÜ) ---
            <div className="p-8 h-full overflow-y-auto">
                <div className="flex justify-between items-end mb-8">
                    <div>
                        <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight">Sınıf Listesi</h1>
                        <p className="text-gray-500 mt-1">
                            {selectedClass === "ALL" ? "Tüm Sınıflardaki Öğrenciler" : `${classrooms.find(c=>c.code===selectedClass)?.name || selectedClass} Sınıfı`}
                        </p>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-3 text-gray-400" size={20}/>
                        <input className="pl-10 pr-4 py-2.5 border border-gray-300 rounded-full w-72 focus:ring-2 focus:ring-blue-500 outline-none shadow-sm transition" placeholder="Öğrenci ara..." />
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Öğrenci</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Ülke / Dil</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Sınıf Kodu</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Teslim Tarihi</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Seviye</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider">Durum</th>
                                <th className="p-5 font-bold text-gray-500 text-xs uppercase tracking-wider text-right">İşlem</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {submissions.filter(s => selectedClass === "ALL" || s.classroom_code === selectedClass).map(sub => (
                                <tr key={sub.id} className="hover:bg-blue-50/50 transition cursor-pointer group" onClick={() => openSubmission(sub)}>
                                    <td className="p-5">
                                        <div className="font-bold text-gray-800">{sub.student_name} {sub.student_surname}</div>
                                    </td>
                                    <td className="p-5">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xl">
                                                {sub.country === 'Türkiye' ? '🇹🇷' : sub.country === 'Almanya' ? '🇩🇪' : '🌍'}
                                            </span>
                                            <div className="flex flex-col">
                                                <span className="text-sm font-medium text-gray-700">{sub.country || "Bilinmiyor"}</span>
                                                <span className="text-xs text-gray-400">{sub.native_language || "Dil yok"}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-5">
                                        <span className="bg-gray-100 text-gray-600 px-2 py-1 rounded text-xs font-bold border border-gray-200">{sub.classroom_code}</span>
                                    </td>
                                    <td className="p-5 text-gray-600 text-sm">{new Date(sub.created_at).toLocaleDateString('tr-TR')}</td>
                                    <td className="p-5">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                                            (sub.level || 'A1') === 'A1' ? 'bg-green-100 text-green-700 border border-green-200' :
                                            (sub.level || 'A1') === 'A2' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 
                                            'bg-purple-100 text-purple-700 border border-purple-200'
                                        }`}>
                                            {sub.level || "A1"}
                                        </span>
                                    </td>
                                    <td className="p-5">
                                        {sub.score_total ? (
                                            <div className="flex items-center gap-1 text-green-600 font-bold text-sm">
                                                <CheckCircle size={16}/> Puanlandı ({sub.score_total})
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 text-orange-500 font-bold text-sm">
                                                <AlertTriangle size={16}/> Bekliyor
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-5 text-right flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition" onClick={(e) => e.stopPropagation()}>
                                        <button onClick={() => openSubmission(sub)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:bg-blue-700">İncele</button>
                                        <button onClick={() => deleteSubmission(sub.id)} className="p-2 hover:bg-red-50 text-red-500 rounded-lg"><Trash2 size={18}/></button>
                                    </td>
                                </tr>
                            ))}
                            {submissions.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="p-12 text-center">
                                        <div className="flex flex-col items-center text-gray-400">
                                            <FileText size={48} className="mb-2 opacity-20"/>
                                            <p>Henüz bu sınıfa ait ödev yüklenmemiş.</p>
                                        </div>
                                    </td>
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